import dotenv from "dotenv";
dotenv.config();

const adminSessionSecret = "phase6-media-test-session-secret-qa-3106";
process.env.ADMIN_SESSION_SECRET = adminSessionSecret;

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as net from "node:net";
import { randomBytes, scrypt as scryptCallback, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import sharp from "sharp";
import { createAdminSessionToken } from "../lib/adminSession";

const scrypt = promisify(scryptCallback);
const { Client } = pg;

// ============================================================
// 1. Safety & Disposable DB Target Validation
// ============================================================

const testBaseUrl = process.env.DATABASE_URL_TEST;
if (!testBaseUrl) {
  throw new Error("TASK24_DATABASE_URL_TEST_MISSING");
}

const parsedBase = new URL(testBaseUrl);
if (parsedBase.hostname.includes("neon.tech")) {
  throw new Error("Safety violation: DATABASE_URL_TEST points to Neon cloud.");
}
if (!["localhost", "127.0.0.1"].includes(parsedBase.hostname)) {
  throw new Error("Safety violation: DATABASE_URL_TEST must target local PostgreSQL container.");
}

const timestamp = Date.now();
const pid = process.pid;
const dbName = `pure_haven_media_browser_${timestamp}_${pid}`;
if (!/^pure_haven_media_browser_[0-9]+_[0-9]+$/.test(dbName)) {
  throw new Error(`Safety violation: Invalid disposable database name ${dbName}`);
}

const disposableTestUrl = testBaseUrl.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);
const adminUrl = testBaseUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");

const QA_PORT = 3106;
const CHROME_DEBUG_PORT = 9228;
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

interface CDPEvaluationResult {
  result?: {
    type?: string;
    value?: unknown;
  };
  exceptionDetails?: {
    text?: string;
    exception?: {
      description?: string;
    };
  };
}

interface ScreenshotResult {
  data: string;
}

interface NetworkRequestEvent {
  requestId: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  timestamp: number;
}

interface NetworkResponseEvent {
  requestId: string;
  response: {
    url: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    mimeType: string;
    timing?: unknown;
  };
  timestamp: number;
}

async function assertPortAvailable(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(new Error(`Port ${port} is not available: ${err.message}`));
    });
    server.once("listening", () => {
      server.close(() => resolve());
    });
    server.listen(port);
  });
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectSecretCategories(content: string, adminPassword = "", secretKey = ""): string[] {
  const categories: string[] = [];
  const secretPatterns: Array<{ category: string; regex: RegExp }> = [
    ...(adminPassword ? [{ category: "ephemeral-password", regex: new RegExp(escapeRegex(adminPassword)) }] : []),
    { category: "scrypt-hash", regex: /scrypt\$[a-f0-9]+\$[a-f0-9]+/i },
    { category: "credential-material", regex: /"password(?:Hash)?"\s*:\s*"[^"]+"/i },
    { category: "database-url", regex: /DATABASE_URL(?:_TEST)?/ },
    { category: "postgres-credentials", regex: /postgres(?:ql)?:\/\/[^@\s]+:[^@\s]+@/i },
    { category: "authorization-header", regex: /authorization:\s*\S+/i },
    { category: "bearer-token", regex: /bearer\s+[a-z0-9._~+/-]+=*/i },
    { category: "cookie-header", regex: /(?:set-)?cookie:\s*[^\r\n]+/i },
    { category: "session-token", regex: /pure_haven_admin_session/i },
    {
      category: "token-hash-material",
      regex: /(?:passwordResetToken(?:Hash)?|resetToken(?:Hash)?|recoveryToken(?:Hash)?|recoveryHash|verificationToken(?:Hash)?|verificationHash|sessionToken(?:Hash)?|sessionHash|tokenHash)\s*[:=]\s*["']?[a-zA-Z0-9_-]{4,}["']?/i,
    },
    { category: "private-key", regex: /-----BEGIN[ A-Z0-9_-]+PRIVATE KEY-----/ },
    ...(secretKey ? [{ category: "admin-secret", regex: new RegExp(escapeRegex(secretKey)) }] : []),
    {
      category: "env-assignment",
      regex: /(?:[A-Z0-9_]*(?:PASSWORD|SECRET|API_KEY|TOKEN|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*(?:['"][^'"\r\n]+['"]|[^\s'"\r\n]+)/i,
    },
  ];

  for (const { category, regex } of secretPatterns) {
    if (regex.test(content)) {
      categories.push(category);
    }
  }
  return categories;
}

function scanDirectoryForSecrets(
  dir: string,
  adminPassword = "",
  secretKey = ""
): { totalFindings: number; findings: Array<{ file: string; category: string }> } {
  const textFiles: string[] = [];
  function walk(current: string) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(json|txt|log|md|csv|html)$/i.test(entry.name)) {
        textFiles.push(full);
      }
    }
  }
  walk(dir);

  const findings: Array<{ file: string; category: string }> = [];

  for (const file of textFiles) {
    const rel = path.relative(dir, file);
    const content = fs.readFileSync(file, "utf8");
    const matched = detectSecretCategories(content, adminPassword, secretKey);
    for (const category of matched) {
      findings.push({ file: rel, category });
    }
  }

  return { totalFindings: findings.length, findings };
}

describe("Task 24 Real Browser & Network QA (CDP)", () => {
  let dbClient: pg.Client;
  let nextServerProc: ReturnType<typeof spawn> | null = null;
  let chromeProc: ReturnType<typeof spawn> | null = null;
  let tempChromeProfile: string | null = null;
  let cdpWs: WebSocket | null = null;
  let msgId = 1;

  // Tracked Product & Media IDs
  let multiImageProductId = 0;
  let highDpiProductId = 0;
  let suspendedProductId = 0;
  let mixedProductId = 0;
  let offscreenProductId = 0;
  let adminEditProductId = 0;

  let photoMediaId = "";
  let textureMediaId = "";
  let highDpiMediaId = "";
  let suspendedMediaId = "";
  let safeSecMediaId = "";
  let gradientMediaId = "";
  let offscreenMediaId = "";

  // Ephemeral admin credentials
  const ephemeralAdminEmail = `media-admin-${timestamp}@purehaven.test`;
  const ephemeralAdminPassword = `MediaPass-${timestamp}-${randomBytes(8).toString("hex")}!`;

  // Telemetry & Logs
  const capturedRequests: NetworkRequestEvent[] = [];
  const capturedResponses: NetworkResponseEvent[] = [];
  const consoleErrors: string[] = [];
  const uncaughtExceptions: string[] = [];

  const evidenceDir = path.join(process.cwd(), "artifacts", "phase6-media-browser");
  const screenshotsDir = path.join(evidenceDir, "screenshots");
  const localMediaPublicDir = path.join(process.cwd(), "public", "media", "public");

  function sendCdp<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!cdpWs || cdpWs.readyState !== WebSocket.OPEN) {
        return reject(new Error("CDP WebSocket is not connected"));
      }
      const id = msgId++;
      const handler = (event: MessageEvent) => {
        try {
          const data = JSON.parse(String(event.data)) as {
            id?: number;
            result?: T;
            error?: { message: string };
          };
          if (data.id === id) {
            cdpWs?.removeEventListener("message", handler);
            if (data.error) {
              reject(new Error(`CDP Error [${method}]: ${data.error.message}`));
            } else {
              resolve(data.result as T);
            }
          }
        } catch (err) {
          reject(err);
        }
      };
      cdpWs.addEventListener("message", handler);
      cdpWs.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluateInPage<T = unknown>(expression: string): Promise<T> {
    const res = await sendCdp<CDPEvaluationResult>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(
        `Browser JS Exception: ${res.exceptionDetails.text} - ${res.exceptionDetails.exception?.description || ""}`
      );
    }
    return res.result?.value as T;
  }

  async function navigateAndWait(url: string, waitMs = 1500): Promise<void> {
    await sendCdp("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, waitMs));
  }

  async function setViewport(width: number, height: number, dpr: number, mobile: boolean): Promise<void> {
    await sendCdp("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: dpr,
      mobile,
    });
    await new Promise((r) => setTimeout(r, 400));
  }

  async function captureScreenshot(filename: string): Promise<void> {
    const res = await sendCdp<ScreenshotResult>("Page.captureScreenshot", { format: "png" });
    const targetPath = path.join(screenshotsDir, filename);
    fs.writeFileSync(targetPath, Buffer.from(res.data, "base64"));
  }

  before(async () => {
    // 1. Ensure artifact directories exist
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    if (!fs.existsSync(localMediaPublicDir)) {
      fs.mkdirSync(localMediaPublicDir, { recursive: true });
    }

    // 2. Preflight ports
    await assertPortAvailable(QA_PORT);
    await assertPortAvailable(CHROME_DEBUG_PORT);

    // 3. Provision disposable database
    const adminClient = new Client({ connectionString: adminUrl });
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE "${dbName}";`);
    await adminClient.end();

    // 4. Deploy schema migrations to disposable DB
    execFileSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["prisma", "migrate", "deploy", "--schema", ".\\prisma\\schema.prisma"],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: disposableTestUrl },
        stdio: "pipe",
        shell: process.platform === "win32",
      }
    );

    // 5. Connect to disposable DB & seed fixtures
    dbClient = new Client({ connectionString: disposableTestUrl });
    await dbClient.connect();

    // Seed category
    const catRes = await dbClient.query(`
      INSERT INTO "Category" (name, slug, "sortOrder", "isActive", "createdAt", "updatedAt")
      VALUES ('QA Skincare', 'qa-skincare', 1, true, NOW(), NOW())
      RETURNING id;
    `);
    const categoryId = catRes.rows[0].id;

    // Helper to create and write physical Sharp images
    async function createAndStoreImages(mediaId: string, label: string) {
      const mediaFolder = path.join(localMediaPublicDir, mediaId);
      if (!fs.existsSync(mediaFolder)) {
        fs.mkdirSync(mediaFolder, { recursive: true });
      }

      const widths = [400, 800, 1200, 1500];
      for (const w of widths) {
        const svg = `<svg width="${w}" height="${w}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${w}" height="${w}" fill="#f4ede6"/>
          <circle cx="${w / 2}" cy="${w / 2}" r="${w / 3}" fill="#a12d4a"/>
          <text x="${w / 2}" y="${w / 2 + 20}" font-size="${Math.max(24, Math.round(w / 15))}" font-family="sans-serif" text-anchor="middle" fill="#ffffff">${label} ${w}w</text>
        </svg>`;
        const svgBuf = Buffer.from(svg);
        const webpBuf = await sharp(svgBuf).resize(w, w).webp({ quality: 80 }).toBuffer();
        const avifBuf = await sharp(svgBuf).resize(w, w).avif({ quality: 65 }).toBuffer();

        fs.writeFileSync(path.join(mediaFolder, `rendition-${w}.webp`), webpBuf);
        fs.writeFileSync(path.join(mediaFolder, `rendition-${w}.avif`), avifBuf);
      }
    }

    // Helper to seed ManagedMedia in DB
    async function seedManagedMedia(opts: {
      mediaId: string;
      label: string;
      disabled?: boolean;
    }) {
      const { mediaId, label, disabled } = opts;
      await createAndStoreImages(mediaId, label);

      const runId = randomUUID();
      await dbClient.query(`
        INSERT INTO "ManagedMedia" (
          id, "mediaType", "lifecycleState", "ingestPurpose", "ingestActorScope",
          "ingestIdempotencyKey", "ingestSha256", "ingestByteSize", "ingestMimeType",
          "stagingProviderKey", "stagingObjectKey", "stagingState", "deliveryDisabledAt",
          "createdAt", "updatedAt"
        ) VALUES (
          '${mediaId}', 'IMAGE', 'READY', 'PRODUCT_IMAGE', 'qa-runner',
          'idemp-${mediaId}', 'sha-${mediaId}', 1048576, 'image/jpeg',
          'local-private', 'staging/${mediaId}', 'PRESENT',
          ${disabled ? "NOW()" : "NULL"},
          NOW(), NOW()
        );
      `);

      await dbClient.query(`
        INSERT INTO "MediaProcessingRun" (
          id, "managedMediaId", "profileVersion", "profileDefinitionHash", state,
          "completedAt", "createdAt", "updatedAt"
        ) VALUES (
          '${runId}', '${mediaId}', 'PRODUCT_IMAGE_PROFILE_V1', 'hash-v1', 'COMPLETE',
          NOW(), NOW(), NOW()
        );
      `);

      // Seed Rendition Objects (400, 800, 1200, 1500w)
      const widths = [400, 800, 1200, 1500];
      for (const w of widths) {
        await dbClient.query(`
          INSERT INTO "MediaObject" (
            id, "processingRunId", role, "accessClass", "variantKey",
            "storageProviderKey", "objectKey", "mimeType", width, height, "byteSize",
            "checksumSha256", "createdAt", "updatedAt"
          ) VALUES
          (
            '${randomUUID()}', '${runId}', 'RENDITION', 'PUBLIC_DELIVERY', 'webp-${w}',
            'local-public', 'public/${mediaId}/rendition-${w}.webp', 'image/webp', ${w}, ${w}, ${w * 50},
            'sha-webp-${w}-${mediaId}', NOW(), NOW()
          ),
          (
            '${randomUUID()}', '${runId}', 'RENDITION', 'PUBLIC_DELIVERY', 'avif-${w}',
            'local-public', 'public/${mediaId}/rendition-${w}.avif', 'image/avif', ${w}, ${w}, ${w * 40},
            'sha-avif-${w}-${mediaId}', NOW(), NOW()
          );
        `);
      }

      await dbClient.query(`
        UPDATE "ManagedMedia" SET "activeProcessingRunId" = '${runId}' WHERE id = '${mediaId}';
      `);

      return {
        mediaId,
        primaryCompatUrl: `http://localhost:${QA_PORT}/media/public/${mediaId}/rendition-800.webp`,
      };
    }

    // Seed media items with valid UUIDs
    photoMediaId = randomUUID();
    textureMediaId = randomUUID();
    highDpiMediaId = randomUUID();
    suspendedMediaId = randomUUID();
    safeSecMediaId = randomUUID();
    gradientMediaId = randomUUID();
    offscreenMediaId = randomUUID();

    const photoMedia = await seedManagedMedia({ mediaId: photoMediaId, label: "Photo" });
    const textureMedia = await seedManagedMedia({ mediaId: textureMediaId, label: "Texture" });
    const highDpiMedia = await seedManagedMedia({ mediaId: highDpiMediaId, label: "HighDPI" });
    await seedManagedMedia({ mediaId: suspendedMediaId, label: "Suspended", disabled: true });
    const safeSecMedia = await seedManagedMedia({ mediaId: safeSecMediaId, label: "SafeSecondary" });
    const gradientMedia = await seedManagedMedia({ mediaId: gradientMediaId, label: "Gradient" });
    const offscreenMedia = await seedManagedMedia({ mediaId: offscreenMediaId, label: "Offscreen" });

    // Seed Products:
    // IMPORTANT: Products are sorted by `id: "desc"` in catalog queries!
    // Therefore, items inserted FIRST have lower IDs (appear at bottom of page / below fold),
    // and items inserted LAST have higher IDs (appear at the very TOP of /shop)!

    // 1. Offscreen ProductCard (Product #1, lowest ID, sits far down in Row 6 below 800px viewport)
    const offscreenProd = await dbClient.query(`
      INSERT INTO "Product" (name, price, stock, image, category, "categoryId", "isActive", "createdAt", "updatedAt")
      VALUES ('QA Offscreen Lazy Card', 1100, 7, '${offscreenMedia.primaryCompatUrl}', 'qa-skincare', ${categoryId}, true, NOW(), NOW())
      RETURNING id;
    `);
    offscreenProductId = offscreenProd.rows[0].id;

    await dbClient.query(`
      INSERT INTO "ProductImage" ("productId", url, "sortOrder", "sourceKind", "managedMediaId", "createdAt", "updatedAt")
      VALUES (${offscreenProductId}, '${offscreenMedia.primaryCompatUrl}', 1, 'MANAGED', '${offscreenMediaId}', NOW(), NOW());
    `);

    // 2. 18 filler products (Products #2..19) ensuring target card is in Row 6 (distance > 1800px from viewport)
    for (let i = 1; i <= 18; i++) {
      await dbClient.query(`
        INSERT INTO "Product" (name, price, stock, image, category, "categoryId", "isActive", "createdAt", "updatedAt")
        VALUES ('QA Filler Product ${i}', 500, 10, '/images/categories/essentials.jpg', 'qa-skincare', ${categoryId}, true, NOW(), NOW());
      `);
    }

    // 3. Admin Product for Edit & Gallery Journey (Product #20)
    const adminProd = await dbClient.query(`
      INSERT INTO "Product" (name, price, stock, image, category, "categoryId", "isActive", "createdAt", "updatedAt")
      VALUES ('QA Admin Edit Cleanser', 1400, 10, '/images/categories/skincare.jpg', 'qa-skincare', ${categoryId}, true, NOW(), NOW())
      RETURNING id;
    `);
    adminEditProductId = adminProd.rows[0].id;

    await dbClient.query(`
      INSERT INTO "ProductImage" ("productId", url, "sortOrder", "sourceKind", "managedMediaId", "altText", "createdAt", "updatedAt")
      VALUES
        (${adminEditProductId}, '/images/categories/skincare.jpg', 1, 'LEGACY_LOCAL', NULL, 'Legacy Skin', NOW(), NOW()),
        (${adminEditProductId}, '/images/categories/bodycare.jpg', 2, 'LEGACY_LOCAL', NULL, 'Legacy Body', NOW(), NOW());
    `);

    // 4. Mixed legacy product (Product #21)
    const mixProd = await dbClient.query(`
      INSERT INTO "Product" (name, price, stock, image, category, "categoryId", "isActive", "createdAt", "updatedAt")
      VALUES ('QA Mixed Cleanser', 950, 8, '${gradientMedia.primaryCompatUrl}', 'qa-skincare', ${categoryId}, true, NOW(), NOW())
      RETURNING id;
    `);
    mixedProductId = mixProd.rows[0].id;

    await dbClient.query(`
      INSERT INTO "ProductImage" ("productId", url, "sortOrder", "sourceKind", "managedMediaId", "createdAt", "updatedAt")
      VALUES
        (${mixedProductId}, '${gradientMedia.primaryCompatUrl}', 1, 'MANAGED', '${gradientMediaId}', NOW(), NOW()),
        (${mixedProductId}, '/images/categories/bodycare.jpg', 2, 'LEGACY_LOCAL', NULL, NOW(), NOW());
    `);

    // 5. Suspended Product (Product #22)
    const staleMarker = `http://localhost:${QA_PORT}/media/stale-suspended-compat-marker.webp`;
    const suspProd = await dbClient.query(`
      INSERT INTO "Product" (name, price, stock, image, category, "categoryId", "isActive", "createdAt", "updatedAt")
      VALUES ('QA Suspended Lotion', 850, 5, '${staleMarker}', 'qa-skincare', ${categoryId}, true, NOW(), NOW())
      RETURNING id;
    `);
    suspendedProductId = suspProd.rows[0].id;

    await dbClient.query(`
      INSERT INTO "ProductImage" ("productId", url, "sortOrder", "sourceKind", "managedMediaId", "createdAt", "updatedAt")
      VALUES
        (${suspendedProductId}, '${staleMarker}', 1, 'MANAGED', '${suspendedMediaId}', NOW(), NOW()),
        (${suspendedProductId}, '${safeSecMedia.primaryCompatUrl}', 2, 'MANAGED', '${safeSecMediaId}', NOW(), NOW());
    `);

    // 6. High-DPI Detail Product (Product #23)
    const highDpiProd = await dbClient.query(`
      INSERT INTO "Product" (name, price, stock, image, category, "categoryId", "isActive", "createdAt", "updatedAt")
      VALUES ('QA High-DPI Serum', 2100, 20, '${highDpiMedia.primaryCompatUrl}', 'qa-skincare', ${categoryId}, true, NOW(), NOW())
      RETURNING id;
    `);
    highDpiProductId = highDpiProd.rows[0].id;

    await dbClient.query(`
      INSERT INTO "ProductImage" ("productId", url, "sortOrder", "sourceKind", "managedMediaId", "createdAt", "updatedAt")
      VALUES
        (${highDpiProductId}, '${highDpiMedia.primaryCompatUrl}', 1, 'MANAGED', '${highDpiMediaId}', NOW(), NOW()),
        (${highDpiProductId}, '/images/categories/skincare.jpg', 2, 'LEGACY_LOCAL', NULL, NOW(), NOW());
    `);

    // 7. Multi-image product (Product #24, highest ID, appears in Row 1 at the top of /shop!)
    const multiProd = await dbClient.query(`
      INSERT INTO "Product" (name, price, stock, image, category, "categoryId", "isActive", "createdAt", "updatedAt")
      VALUES ('QA Managed Multi Cream', 1250, 15, '${photoMedia.primaryCompatUrl}', 'qa-skincare', ${categoryId}, true, NOW(), NOW())
      RETURNING id;
    `);
    multiImageProductId = multiProd.rows[0].id;

    await dbClient.query(`
      INSERT INTO "ProductImage" ("productId", url, "sortOrder", "sourceKind", "managedMediaId", "createdAt", "updatedAt")
      VALUES
        (${multiImageProductId}, '${photoMedia.primaryCompatUrl}', 1, 'MANAGED', '${photoMediaId}', NOW(), NOW()),
        (${multiImageProductId}, '${textureMedia.primaryCompatUrl}', 2, 'MANAGED', '${textureMediaId}', NOW(), NOW());
    `);

    // 8. Seed Ephemeral Admin Credential
    const salt = randomBytes(16).toString("hex");
    const key = (await scrypt(ephemeralAdminPassword, salt, 64)) as Buffer;
    const passwordHash = `scrypt$${salt}$${key.toString("hex")}`;

    await dbClient.query(`
      INSERT INTO "AdminCredential" (email, "passwordHash", "createdAt", "updatedAt")
      VALUES ('${ephemeralAdminEmail}', '${passwordHash}', NOW(), NOW());
    `);

    // 9. Start Next.js Production Server with full media environment
    const nextBin = path.resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");
    nextServerProc = spawn(process.execPath, [nextBin, "start", "-p", String(QA_PORT)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: disposableTestUrl,
        PORT: String(QA_PORT),
        NODE_ENV: "production",
        MEDIA_ENVIRONMENT: "test",
        MANAGED_MEDIA_INGESTION_ENABLED: "true",
        MEDIA_PUBLIC_ORIGIN: `http://localhost:${QA_PORT}/media`,
        ADMIN_SESSION_SECRET: adminSessionSecret,
      },
      stdio: "pipe",
    });

    // Wait for server ready
    let serverReady = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const res = await fetch(`http://localhost:${QA_PORT}/api/categories`);
        if (res.ok) {
          serverReady = true;
          break;
        }
      } catch {}
    }
    if (!serverReady) {
      throw new Error("Next.js QA server failed to start within 20s");
    }

    // 10. Start Google Chrome Headless
    tempChromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), "ph-chrome-media-"));
    chromeProc = spawn(
      CHROME_PATH,
      [
        "--headless=new",
        `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
        `--user-data-dir=${tempChromeProfile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu",
        "--no-sandbox",
        "about:blank",
      ],
      { stdio: "ignore" }
    );

    // Wait for Chrome debugging WebSocket
    let targetWsUrl: string | null = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        const listRes = await fetch(`http://127.0.0.1:${CHROME_DEBUG_PORT}/json/list`);
        if (listRes.ok) {
          const list = (await listRes.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
          const page = list.find((p) => p.type === "page");
          if (page) {
            targetWsUrl = page.webSocketDebuggerUrl;
            break;
          }
        }
      } catch {}
    }
    if (!targetWsUrl) {
      throw new Error("Chrome failed to expose DevTools WebSocket target");
    }

    // Connect WebSocket
    cdpWs = new WebSocket(targetWsUrl);
    await new Promise<void>((resolve, reject) => {
      if (!cdpWs) return reject(new Error("No WebSocket"));
      cdpWs.onopen = () => resolve();
      cdpWs.onerror = reject;
    });

    // Enable CDP Domains & listeners
    await sendCdp("Page.enable");
    await sendCdp("Runtime.enable");
    await sendCdp("Network.enable");
    await sendCdp("DOM.enable");

    cdpWs.addEventListener("message", (event: MessageEvent) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          method?: string;
          params?: Record<string, unknown>;
        };
        if (msg.method === "Network.requestWillBeSent") {
          const params = msg.params as unknown as NetworkRequestEvent;
          capturedRequests.push(params);
        } else if (msg.method === "Network.responseReceived") {
          const params = msg.params as unknown as NetworkResponseEvent;
          capturedResponses.push(params);
        } else if (msg.method === "Runtime.consoleAPICalled") {
          const p = msg.params as { type: string; args?: Array<{ value: unknown }> };
          if (p.type === "error") {
            consoleErrors.push(String(p.args?.[0]?.value || "unknown console error"));
          }
        } else if (msg.method === "Runtime.exceptionThrown") {
          const p = msg.params as { exceptionDetails?: { text?: string } };
          uncaughtExceptions.push(String(p.exceptionDetails?.text || "uncaught exception"));
        }
      } catch {}
    });
  });

  after(async () => {
    // 1. Close CDP WebSocket
    if (cdpWs && cdpWs.readyState === WebSocket.OPEN) {
      try {
        cdpWs.close();
      } catch {}
    }

    // 2. Kill Chrome process
    if (chromeProc && chromeProc.pid) {
      try {
        if (process.platform === "win32") {
          execFileSync("taskkill", ["/PID", String(chromeProc.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          chromeProc.kill("SIGKILL");
        }
      } catch {}
    }

    await new Promise((r) => setTimeout(r, 600));

    // 3. Remove temp Chrome profile
    if (tempChromeProfile && fs.existsSync(tempChromeProfile)) {
      for (let i = 0; i < 5; i++) {
        try {
          fs.rmSync(tempChromeProfile, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }

    // 4. Kill Next.js server
    if (nextServerProc && nextServerProc.pid) {
      try {
        if (process.platform === "win32") {
          execFileSync("taskkill", ["/PID", String(nextServerProc.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          nextServerProc.kill("SIGKILL");
        }
      } catch {}
    }

    // 5. Close DB client & drop disposable database
    if (dbClient) {
      try {
        await dbClient.end();
      } catch {}
    }

    try {
      const adminClient = new Client({ connectionString: adminUrl });
      await adminClient.connect();
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
      await adminClient.end();
    } catch {}

    // 6. Clean up temporary media in public/
    try {
      if (fs.existsSync(localMediaPublicDir)) {
        fs.rmSync(localMediaPublicDir, { recursive: true, force: true });
      }
    } catch {}
  });

  // ---------------------------------------------------------------------------
  // 1. Live Server Reachability & Browser Context Health
  // ---------------------------------------------------------------------------
  it("1. Real Browser starts, connects via CDP, and loads Next.js homepage", async () => {
    await navigateAndWait(`http://localhost:${QA_PORT}/shop`, 2000);
    const title = await evaluateInPage<string>("document.title");
    assert.ok(title.length > 0, "Document title must not be empty");
  });

  // ---------------------------------------------------------------------------
  // 2. Viewport Matrix, DPR Scaling, naturalWidth & Live currentSrc Table
  // ---------------------------------------------------------------------------
  it("2. Evaluates responsive selection and proves sub-maximal rendition selection in real browser", async () => {
    const observations: Array<{
      page: string;
      component: string;
      viewport: string;
      dpr: number;
      renderedWidth: number;
      currentSrc: string;
      naturalWidth: number;
      requestedFormat: string;
      requestedRenditionWidth: number;
    }> = [];

    // --- Mobile: 390x844, DPR 2 (/shop & /pdp) ---
    await setViewport(390, 844, 2, true);
    await navigateAndWait(`http://localhost:${QA_PORT}/shop`, 1500);
    await captureScreenshot("mobile-390x844-shop.png");

    // Wait for image completion if needed
    await evaluateInPage(`(() => {
      const img = document.querySelector('a[href="/product/${multiImageProductId}"] picture img');
      if (!img) return true;
      if (img.complete && img.currentSrc) return true;
      return new Promise((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(true);
        setTimeout(() => resolve(true), 1200);
      });
    })()`);

    const mobileCardImg = await evaluateInPage<{
      currentSrc: string;
      naturalWidth: number;
      clientWidth: number;
    }>(`(() => {
      const img = document.querySelector('a[href="/product/${multiImageProductId}"] picture img');
      return img ? { currentSrc: img.currentSrc, naturalWidth: img.naturalWidth, clientWidth: img.clientWidth } : null;
    })()`);

    assert.ok(mobileCardImg, "Mobile card image must exist in DOM");
    assert.ok(
      mobileCardImg.currentSrc.includes(photoMediaId),
      `Mobile card must reference photo media, got: ${mobileCardImg.currentSrc}`
    );

    const mobileWidthMatch = mobileCardImg.currentSrc.match(/rendition-(\d+)\.(webp|avif)/);
    const mobileRenditionWidth = mobileWidthMatch ? parseInt(mobileWidthMatch[1], 10) : 0;
    const mobileFormat = mobileWidthMatch ? `image/${mobileWidthMatch[2]}` : "unknown";

    observations.push({
      page: "/shop",
      component: "ProductCard",
      viewport: "390x844",
      dpr: 2,
      renderedWidth: mobileCardImg.clientWidth,
      currentSrc: mobileCardImg.currentSrc,
      naturalWidth: mobileCardImg.naturalWidth,
      requestedFormat: mobileFormat,
      requestedRenditionWidth: mobileRenditionWidth,
    });

    // Sub-maximal selection assertion: On 390x844 2-column mobile, slot is ~180px, with DPR 2 needed width is ~360px.
    // The browser must select 400w or 800w, NEVER the maximal 1500w candidate!
    assert.ok(
      mobileRenditionWidth <= 800,
      `Mobile card must select <= 800w rendition, got ${mobileRenditionWidth}w`
    );

    // Mobile PDP screenshot: 390x844, DPR 2
    await navigateAndWait(`http://localhost:${QA_PORT}/product/${highDpiProductId}`, 1500);
    await captureScreenshot("mobile-390x844-pdp.png");

    // --- Tablet: 768x1024, DPR 1 (/shop & /pdp) ---
    await setViewport(768, 1024, 1, false);
    await navigateAndWait(`http://localhost:${QA_PORT}/shop`, 1500);
    await captureScreenshot("tablet-768x1024-shop.png");

    const tabletCardImg = await evaluateInPage<{
      currentSrc: string;
      naturalWidth: number;
      clientWidth: number;
    }>(`(() => {
      const img = document.querySelector('a[href="/product/${multiImageProductId}"] picture img');
      return img ? { currentSrc: img.currentSrc, naturalWidth: img.naturalWidth, clientWidth: img.clientWidth } : null;
    })()`);

    assert.ok(tabletCardImg);
    const tabletMatch = tabletCardImg.currentSrc.match(/rendition-(\d+)\.(webp|avif)/);
    const tabletRenditionWidth = tabletMatch ? parseInt(tabletMatch[1], 10) : 0;

    observations.push({
      page: "/shop",
      component: "ProductCard",
      viewport: "768x1024",
      dpr: 1,
      renderedWidth: tabletCardImg.clientWidth,
      currentSrc: tabletCardImg.currentSrc,
      naturalWidth: tabletCardImg.naturalWidth,
      requestedFormat: tabletMatch ? `image/${tabletMatch[2]}` : "unknown",
      requestedRenditionWidth: tabletRenditionWidth,
    });

    // Tablet PDP screenshot: 768x1024, DPR 1
    await navigateAndWait(`http://localhost:${QA_PORT}/product/${highDpiProductId}`, 1500);
    await captureScreenshot("tablet-768x1024-pdp.png");

    // --- Desktop: 1280x800, DPR 1 (/shop & /pdp) ---
    await setViewport(1280, 800, 1, false);
    await navigateAndWait(`http://localhost:${QA_PORT}/shop`, 1500);
    await captureScreenshot("desktop-1280x800-shop.png");

    await navigateAndWait(`http://localhost:${QA_PORT}/product/${highDpiProductId}`, 1500);
    await captureScreenshot("desktop-1280x800-pdp.png");

    const desktopPdpImg = await evaluateInPage<{
      currentSrc: string;
      naturalWidth: number;
      clientWidth: number;
    }>(`(() => {
      const img = document.querySelector('section picture img');
      return img ? { currentSrc: img.currentSrc, naturalWidth: img.naturalWidth, clientWidth: img.clientWidth } : null;
    })()`);

    assert.ok(desktopPdpImg, "Desktop PDP image must exist in DOM");
    const pdpMatch = desktopPdpImg.currentSrc.match(/rendition-(\d+)\.(webp|avif)/);
    const pdpRenditionWidth = pdpMatch ? parseInt(pdpMatch[1], 10) : 0;

    observations.push({
      page: `/product/${highDpiProductId}`,
      component: "ProductDetailsClient",
      viewport: "1280x800",
      dpr: 1,
      renderedWidth: desktopPdpImg.clientWidth,
      currentSrc: desktopPdpImg.currentSrc,
      naturalWidth: desktopPdpImg.naturalWidth,
      requestedFormat: pdpMatch ? `image/${pdpMatch[2]}` : "unknown",
      requestedRenditionWidth: pdpRenditionWidth,
    });

    // --- High-DPI Desktop: 1280x800, DPR 2 (PDP) ---
    await setViewport(1280, 800, 2, false);
    await navigateAndWait(`http://localhost:${QA_PORT}/product/${highDpiProductId}`, 1500);
    await captureScreenshot("highdpi-1280x800-pdp.png");

    const highDpiImg = await evaluateInPage<{
      currentSrc: string;
      naturalWidth: number;
      clientWidth: number;
    }>(`(() => {
      const img = document.querySelector('section picture img');
      return img ? { currentSrc: img.currentSrc, naturalWidth: img.naturalWidth, clientWidth: img.clientWidth } : null;
    })()`);

    assert.ok(highDpiImg);
    const highDpiMatch = highDpiImg.currentSrc.match(/rendition-(\d+)\.(webp|avif)/);
    const highDpiRenditionWidth = highDpiMatch ? parseInt(highDpiMatch[1], 10) : 0;

    observations.push({
      page: `/product/${highDpiProductId}`,
      component: "ProductDetailsClient",
      viewport: "1280x800",
      dpr: 2,
      renderedWidth: highDpiImg.clientWidth,
      currentSrc: highDpiImg.currentSrc,
      naturalWidth: highDpiImg.naturalWidth,
      requestedFormat: highDpiMatch ? `image/${highDpiMatch[2]}` : "unknown",
      requestedRenditionWidth: highDpiRenditionWidth,
    });

    // High-DPI DPR 2 assertion: On 1280x800 DPR 2, slot is ~600px * 2 = ~1200px.
    // The browser must select 1200w or 1500w high-density candidate!
    assert.ok(
      highDpiRenditionWidth >= 1200,
      `High-DPI PDP must select >= 1200w candidate on DPR 2, got ${highDpiRenditionWidth}w`
    );

    // Save observation table to JSON artifact
    fs.writeFileSync(
      path.join(evidenceDir, "real-browser-current-src-matrix.json"),
      JSON.stringify(observations, null, 2),
      "utf8"
    );
  });

  // ---------------------------------------------------------------------------
  // 3. Carousel Secondary Image Deferral
  // ---------------------------------------------------------------------------
  it("3. Verifies secondary carousel image is deferred until user navigation", async () => {
    await setViewport(1280, 800, 1, false);
    capturedRequests.length = 0; // reset log

    await navigateAndWait(`http://localhost:${QA_PORT}/shop`, 1500);

    // Initial state: only slide 0 should have network requests
    const initialSlide2Requests = capturedRequests.filter((r) =>
      r.request.url.includes(textureMediaId)
    );
    assert.strictEqual(
      initialSlide2Requests.length,
      0,
      "Secondary carousel image must NOT be requested on initial load"
    );

    // Click carousel "Next" button for QA Managed Multi Cream
    const clicked = await evaluateInPage<boolean>(`(() => {
      const card = document.querySelector('div[aria-label="QA Managed Multi Cream image gallery"]');
      if (!card) return false;
      const nextBtn = card.querySelector('button[aria-label="Next image"]');
      if (!nextBtn) return false;
      nextBtn.click();
      return true;
    })()`);

    assert.ok(clicked, "Must click Next image button");
    await new Promise((r) => setTimeout(r, 800));

    // Post-click state: slide 2 must now be requested!
    const postClickSlide2Requests = capturedRequests.filter((r) =>
      r.request.url.includes(textureMediaId)
    );
    assert.ok(
      postClickSlide2Requests.length > 0,
      "Secondary carousel image must be requested AFTER user navigates to slide 2"
    );
  });

  // ---------------------------------------------------------------------------
  // 4. Offscreen ProductCard Lazy Loading Proof
  // ---------------------------------------------------------------------------
  it("4. Verifies offscreen product card image is deferred until scrolled into viewport", async () => {
    await setViewport(1280, 800, 1, false);
    capturedRequests.length = 0; // reset log

    await navigateAndWait(`http://localhost:${QA_PORT}/shop`, 1500);

    // Initial state: Offscreen ProductCard is positioned far down in Row 6 (distance > 1800px below viewport)
    const initialOffscreenRequests = capturedRequests.filter((r) =>
      r.request.url.includes(offscreenMediaId)
    );
    assert.strictEqual(
      initialOffscreenRequests.length,
      0,
      `Offscreen card image must have 0 network requests before scrolling (got ${initialOffscreenRequests.length})`
    );

    // Scroll the target card into viewport
    const scrolled = await evaluateInPage<boolean>(`(() => {
      const target = document.querySelector('a[href="/product/${offscreenProductId}"]');
      if (!target) return false;
      target.scrollIntoView({ block: "center", behavior: "instant" });
      return true;
    })()`);

    assert.ok(scrolled, "Offscreen card anchor must be present in DOM and scrolled into view");
    await new Promise((r) => setTimeout(r, 1200));

    // Post-scroll state: Offscreen card image must now be requested!
    const postScrollRequests = capturedRequests.filter((r) =>
      r.request.url.includes(offscreenMediaId)
    );
    assert.ok(
      postScrollRequests.length >= 1,
      `Offscreen card image must be requested after scrolling into viewport (got ${postScrollRequests.length})`
    );

    const firstReq = postScrollRequests[0];
    const offscreenEvidence = {
      targetCard: "QA Offscreen Lazy Card",
      productId: offscreenProductId,
      mediaId: offscreenMediaId,
      initialViewport: "1280x800 (DPR 1)",
      initialRequestCount: initialOffscreenRequests.length,
      scrollAction: "scrollIntoView({ block: 'center' })",
      postScrollRequestCount: postScrollRequests.length,
      firstRequestUrl: firstReq.request.url,
      firstRequestTimestamp: firstReq.timestamp,
      result: "PASS",
    };

    fs.writeFileSync(
      path.join(evidenceDir, "real-browser-offscreen-lazy-evidence.json"),
      JSON.stringify(offscreenEvidence, null, 2),
      "utf8"
    );
  });

  // ---------------------------------------------------------------------------
  // 5. Product Detail Network Behavior & Thumbnail Switching
  // ---------------------------------------------------------------------------
  it("5. PDP main image has eager/priority hints and thumbnail switches main image cleanly", async () => {
    await setViewport(1280, 800, 1, false);
    await navigateAndWait(`http://localhost:${QA_PORT}/product/${highDpiProductId}`, 1500);

    // Verify main image attributes
    const hints = await evaluateInPage<{ loading: string; fetchPriority: string; decoding: string }>(`(() => {
      const img = document.querySelector('section picture img');
      return img ? { loading: img.loading, fetchPriority: img.fetchPriority || img.getAttribute('fetchpriority'), decoding: img.decoding } : null;
    })()`);

    assert.strictEqual(hints?.loading, "eager");
    assert.strictEqual(hints?.fetchPriority?.toLowerCase(), "high");
    assert.strictEqual(hints?.decoding, "async");

    // Thumbnail 2 click (legacy image)
    const thumbnailClicked = await evaluateInPage<boolean>(`(() => {
      const btn = document.querySelector('button[aria-label="Show product image 2 of 2"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);

    assert.ok(thumbnailClicked, "Must click thumbnail 2");
    await new Promise((r) => setTimeout(r, 500));

    // After clicking thumbnail 2, main image updates to legacy image
    const updatedSrc = await evaluateInPage<string>(`(() => {
      const img = document.querySelector('section img');
      return img ? img.src : '';
    })()`);

    assert.ok(updatedSrc.includes("skincare.jpg"), "Main display must show thumbnail 2 image after click");
  });

  // ---------------------------------------------------------------------------
  // 6. Suspension Hard Browser Gate
  // ---------------------------------------------------------------------------
  it("6. Suspended managed primary with stale markers produces ZERO browser leaks and requests", async () => {
    await setViewport(1280, 800, 1, false);
    capturedRequests.length = 0;

    await navigateAndWait(`http://localhost:${QA_PORT}/product/${suspendedProductId}`, 1500);

    const staleMarkerText = "stale-suspended-compat-marker.webp";

    // 1. Inspect DOM HTML
    const pageHtml = await evaluateInPage<string>("document.documentElement.outerHTML");
    assert.strictEqual(
      pageHtml.includes(staleMarkerText),
      false,
      "DOM HTML must not contain stale ProductImage.url / Product.image marker"
    );
    assert.strictEqual(
      pageHtml.includes(suspendedMediaId),
      false,
      "DOM HTML must not contain suspended media ID"
    );

    // 2. Inspect Network Requests
    const staleRequests = capturedRequests.filter((r) =>
      r.request.url.includes(staleMarkerText) || r.request.url.includes(suspendedMediaId)
    );
    assert.strictEqual(
      staleRequests.length,
      0,
      "Network must contain ZERO requests to stale compatibility marker or suspended media"
    );

    // 3. Inspect Canonical Master Requests
    const masterRequests = capturedRequests.filter((r) =>
      r.request.url.includes("canonical-master") || r.request.url.includes("master.png")
    );
    assert.strictEqual(
      masterRequests.length,
      0,
      "Network must contain ZERO requests to canonical masters"
    );

    // 4. Safe secondary fallback displayed
    const displayedImg = await evaluateInPage<string>(`(() => {
      const img = document.querySelector('section picture img');
      return img ? img.currentSrc : '';
    })()`);
    assert.ok(
      displayedImg.includes(safeSecMediaId),
      "Safe secondary managed media must be projected when primary is suspended"
    );
  });

  // ---------------------------------------------------------------------------
  // 7. Zero Master & Private Leak Audit Across All Surfaces
  // ---------------------------------------------------------------------------
  it("7. Master object keys, private paths, and credentials never leak into real browser DOM or network", async () => {
    const forbiddenPatterns = [
      "canonical-master",
      "PRIVATE_SOURCE",
      "staging/",
      "master.webp",
      "master.png",
      "storageProviderKey",
      "stagingProviderKey",
      "canonicalMasterObjectId",
      "AKIA",
      "s3://",
    ];

    // Scan /shop DOM
    await navigateAndWait(`http://localhost:${QA_PORT}/shop`, 1200);
    const shopHtml = await evaluateInPage<string>("document.documentElement.outerHTML");

    // Scan PDP DOM
    await navigateAndWait(`http://localhost:${QA_PORT}/product/${multiImageProductId}`, 1200);
    const pdpHtml = await evaluateInPage<string>("document.documentElement.outerHTML");

    for (const pattern of forbiddenPatterns) {
      assert.strictEqual(shopHtml.includes(pattern), false, `Shop DOM must not leak '${pattern}'`);
      assert.strictEqual(pdpHtml.includes(pattern), false, `PDP DOM must not leak '${pattern}'`);
    }

    // Scan all captured network request URLs
    for (const req of capturedRequests) {
      for (const pattern of forbiddenPatterns) {
        assert.strictEqual(
          req.request.url.includes(pattern),
          false,
          `Network request URL must not leak '${pattern}'`
        );
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 8. Network Response & Cache Evidence
  // ---------------------------------------------------------------------------
  it("8. Captures real HTTP response headers and audits local cache contract", async () => {
    const mediaResponses = capturedResponses.filter((r) =>
      r.response.url.includes("/media/public/")
    );

    assert.ok(mediaResponses.length > 0, "Must capture at least one public managed media HTTP response");

    const sampleResponse = mediaResponses[0].response;
    assert.strictEqual(sampleResponse.status, 200, "Rendition response must be HTTP 200");
    assert.ok(
      sampleResponse.mimeType.startsWith("image/"),
      `Content-Type must be an image format, got ${sampleResponse.mimeType}`
    );

    const networkEvidence = {
      totalMediaResponses: mediaResponses.length,
      sampleResponse: {
        url: sampleResponse.url,
        status: sampleResponse.status,
        statusText: sampleResponse.statusText,
        mimeType: sampleResponse.mimeType,
        headers: sampleResponse.headers,
      },
      responses: mediaResponses.map((r) => ({
        url: r.response.url,
        status: r.response.status,
        mimeType: r.response.mimeType,
        cacheControl: r.response.headers["cache-control"] || r.response.headers["Cache-Control"] || "none",
      })),
    };

    fs.writeFileSync(
      path.join(evidenceDir, "real-browser-network-responses.json"),
      JSON.stringify(networkEvidence, null, 2),
      "utf8"
    );
  });

  // ---------------------------------------------------------------------------
  // 9. Admin Managed Gallery Real-Browser Journey
  // ---------------------------------------------------------------------------
  it("9. Admin managed gallery journey: file upload preview, processing gate, reordering, and zero secret leak", async () => {
    await setViewport(1280, 800, 1, false);

    // 1. Authenticate admin browser session via signed session cookie
    const sessionToken = createAdminSessionToken(ephemeralAdminEmail);
    await sendCdp("Network.setCookie", {
      name: "pure_haven_admin_session",
      value: sessionToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    });

    // 2. Load authenticated Admin product edit page
    await navigateAndWait(`http://localhost:${QA_PORT}/admin/products/${adminEditProductId}/edit`, 2000);

    const heading = await evaluateInPage<string>("document.querySelector('h1')?.textContent || ''");
    assert.ok(heading.includes("Edit Product"), "Admin edit product page must load with heading");

    // 3. Existing legacy gallery remains visible/editable
    const legacyItemCount = await evaluateInPage<number>(
      "document.querySelectorAll('input[aria-label^=\"Alt text for image\"]').length"
    );
    assert.strictEqual(legacyItemCount, 2, "Must display 2 existing legacy gallery items");

    // 4. File selection produces blob: temporary preview and enters Processing/unattachable state
    const fileSelectionTriggered = await evaluateInPage<boolean>(`(() => {
      const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], "test-upload.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const fileInput = document.querySelector('input[type="file"]');
      if (!fileInput) return false;
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);

    assert.ok(fileSelectionTriggered, "File input event must be dispatched");
    await new Promise((r) => setTimeout(r, 600));

    // Verify blob: temporary preview appears in DOM
    const blobPreviewFound = await evaluateInPage<boolean>(`(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs.some((img) => img.src && img.src.startsWith('blob:'));
    })()`);
    assert.ok(blobPreviewFound, "DOM must immediately display a temporary blob: image preview");

    // 5. Processing/unattachable state blocks Save
    const isSaveBlockedInitially = await evaluateInPage<boolean>(
      "Boolean(document.querySelector('button[type=\"submit\"]')?.hasAttribute('disabled'))"
    );
    assert.strictEqual(isSaveBlockedInitially, true, "Submit button must be disabled while upload is processing/unattachable");

    // 6. Find uploaded media record in DB, advance to READY with renditions, and refresh status
    await new Promise((r) => setTimeout(r, 500));
    const mediaRow = await dbClient.query(
      `SELECT id FROM "ManagedMedia" WHERE "ingestActorScope" LIKE 'admin-%' ORDER BY "createdAt" DESC LIMIT 1`
    );
    assert.ok(mediaRow.rows.length > 0, "Uploaded media record must exist in database");
    const uploadedMediaId = mediaRow.rows[0].id;

    // Create delivery rendition for uploaded media
    const uploadedFolder = path.join(localMediaPublicDir, uploadedMediaId);
    if (!fs.existsSync(uploadedFolder)) {
      fs.mkdirSync(uploadedFolder, { recursive: true });
    }
    const sampleWebp = await sharp({
      create: {
        width: 800,
        height: 800,
        channels: 4,
        background: { r: 161, g: 45, b: 74, alpha: 1 },
      },
    })
      .webp({ quality: 80 })
      .toBuffer();
    fs.writeFileSync(path.join(uploadedFolder, "rendition-800.webp"), sampleWebp);

    const uploadedRunId = randomUUID();
    await dbClient.query(`
      INSERT INTO "MediaProcessingRun" (
        id, "managedMediaId", "profileVersion", "profileDefinitionHash", state,
        "completedAt", "createdAt", "updatedAt"
      ) VALUES (
        '${uploadedRunId}', '${uploadedMediaId}', 'PRODUCT_IMAGE_PROFILE_V1', 'hash-v1', 'COMPLETE',
        NOW(), NOW(), NOW()
      );
    `);

    await dbClient.query(`
      INSERT INTO "MediaObject" (
        id, "processingRunId", role, "accessClass", "variantKey",
        "storageProviderKey", "objectKey", "mimeType", width, height, "byteSize",
        "checksumSha256", "createdAt", "updatedAt"
      ) VALUES (
        '${randomUUID()}', '${uploadedRunId}', 'RENDITION', 'PUBLIC_DELIVERY', 'webp-800',
        'local-public', 'public/${uploadedMediaId}/rendition-800.webp', 'image/webp', 800, 800, 4096,
        'sha-admin-webp-800', NOW(), NOW()
      );
    `);

    await dbClient.query(`
      UPDATE "ManagedMedia"
      SET "lifecycleState" = 'READY', "activeProcessingRunId" = '${uploadedRunId}'
      WHERE id = '${uploadedMediaId}';
    `);

    // Click "Refresh status" or wait for status poll
    await evaluateInPage<boolean>(`(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const refreshBtn = btns.find((b) => b.textContent && b.textContent.includes('Refresh status'));
      if (refreshBtn) {
        refreshBtn.click();
        return true;
      }
      return false;
    })()`);

    await new Promise((r) => setTimeout(r, 1200));

    // Verify Save button is now ENABLED
    const isSaveEnabledNow = await evaluateInPage<boolean>(
      "!document.querySelector('button[type=\"submit\"]')?.hasAttribute('disabled')"
    );
    assert.strictEqual(isSaveEnabledNow, true, "Submit button must become enabled once media is Ready");

    // 7. Ordering controls are usable
    const altBeforeReorder = await evaluateInPage<string[]>(
      "Array.from(document.querySelectorAll('input[aria-label^=\"Alt text for image\"]')).map((i) => i.value)"
    );

    const moved = await evaluateInPage<boolean>(`(() => {
      const moveDownBtn = document.querySelector('button[aria-label="Move image down"]:not([disabled])');
      if (!moveDownBtn) return false;
      moveDownBtn.click();
      return true;
    })()`);
    assert.ok(moved, "Move image down button must be clickable");
    await new Promise((r) => setTimeout(r, 400));

    const altAfterReorder = await evaluateInPage<string[]>(
      "Array.from(document.querySelectorAll('input[aria-label^=\"Alt text for image\"]')).map((i) => i.value)"
    );
    assert.notDeepStrictEqual(altBeforeReorder, altAfterReorder, "Gallery order must change after clicking Move down");

    // 8. Ordinary Admin DOM contains zero leaks of secrets or internal storage keys
    const adminDomHtml = await evaluateInPage<string>("document.documentElement.outerHTML");
    const forbiddenPatterns = [
      "canonical-master",
      "PRIVATE_SOURCE",
      "staging/",
      "storageProviderKey",
      "stagingProviderKey",
      "canonicalMasterObjectId",
      "AKIA",
      "s3://",
    ];
    for (const pattern of forbiddenPatterns) {
      assert.strictEqual(
        adminDomHtml.includes(pattern),
        false,
        `Admin DOM must contain zero leaks of '${pattern}'`
      );
    }

    // 9. Capture required desktop Admin screenshot
    await captureScreenshot("desktop-1280x800-admin-managed-gallery.png");
  });

  // ---------------------------------------------------------------------------
  // 10. Visual Evidence Package & Final Compression
  // ---------------------------------------------------------------------------
  it("10. Generates visual screenshots, asserts 0 console errors, verifies secret scan, and packages evidence bundle", async () => {
    // Assert 0 real browser console errors & uncaught exceptions
    assert.strictEqual(
      consoleErrors.length,
      0,
      `Browser console errors detected: ${consoleErrors.join("; ")}`
    );
    assert.strictEqual(
      uncaughtExceptions.length,
      0,
      `Browser uncaught exceptions detected: ${uncaughtExceptions.join("; ")}`
    );

    // Verify all 8 screenshots exist on disk
    const screenshots = fs.readdirSync(screenshotsDir);
    const requiredScreenshots = [
      "mobile-390x844-shop.png",
      "mobile-390x844-pdp.png",
      "tablet-768x1024-shop.png",
      "tablet-768x1024-pdp.png",
      "desktop-1280x800-shop.png",
      "desktop-1280x800-pdp.png",
      "highdpi-1280x800-pdp.png",
      "desktop-1280x800-admin-managed-gallery.png",
    ];

    for (const reqShot of requiredScreenshots) {
      assert.ok(
        screenshots.includes(reqShot),
        `Required screenshot '${reqShot}' must exist in screenshots directory`
      );
    }
    assert.strictEqual(screenshots.length, 8, `Exactly 8 screenshots must exist, got ${screenshots.length}`);

    // Pre-ZIP Secret Scan on evidence directory
    const preScan = scanDirectoryForSecrets(evidenceDir, ephemeralAdminPassword, adminSessionSecret);
    assert.strictEqual(
      preScan.totalFindings,
      0,
      `Evidence directory secret scan failed with findings: ${JSON.stringify(preScan.findings)}`
    );

    // Verify secret scanner synthetic canary
    const canarySnippet = "Authorization: Basic ZmFrZTpmYWtl";
    const canaryDetected = detectSecretCategories(canarySnippet);
    assert.ok(
      canaryDetected.includes("authorization-header"),
      "Synthetic canary must detect authorization-header category"
    );

    // Package Evidence ZIP
    const zipPath = path.join(process.cwd(), "artifacts", "phase6-media-browser.zip");
    const downloadsZipPath = path.join(os.homedir(), "Downloads", "phase6-media-browser.zip");

    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${evidenceDir}\\*' -DestinationPath '${zipPath}' -Force`,
      ],
      { stdio: "pipe" }
    );

    assert.ok(fs.existsSync(zipPath), "artifacts/phase6-media-browser.zip must be created");

    // Copy to ~/Downloads
    fs.copyFileSync(zipPath, downloadsZipPath);
    assert.ok(fs.existsSync(downloadsZipPath), "Downloads phase6-media-browser.zip must exist");

    // Compute SHA256 of ZIP
    const zipBuf = fs.readFileSync(zipPath);
    const sha256 = (await import("node:crypto")).createHash("sha256").update(zipBuf).digest("hex");

    // Update comprehensive execution report
    const evidenceReport = {
      generatedAt: new Date().toISOString(),
      harness: {
        runner: "Node.js 20+ test runner (tsx --test)",
        protocol: "Chrome DevTools Protocol (CDP) WebSocket",
        browser: "Google Chrome (Headless New)",
        port: QA_PORT,
      },
      screenshots,
      consoleErrorsCount: consoleErrors.length,
      uncaughtExceptionsCount: uncaughtExceptions.length,
      totalRequestsLogged: capturedRequests.length,
      totalResponsesLogged: capturedResponses.length,
      secretScanFindings: preScan.totalFindings,
      zipSha256: sha256,
    };

    fs.writeFileSync(
      path.join(evidenceDir, "real-browser-execution-report.json"),
      JSON.stringify(evidenceReport, null, 2),
      "utf8"
    );
  });
});
