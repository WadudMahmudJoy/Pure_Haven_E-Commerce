import dotenv from "dotenv";
dotenv.config();

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

  let photoMediaId = "";
  let textureMediaId = "";
  let highDpiMediaId = "";
  let suspendedMediaId = "";
  let safeSecMediaId = "";
  let gradientMediaId = "";

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
        const webpBuf = await sharp(svgBuf).webp({ quality: 80 }).toBuffer();
        const avifBuf = await sharp(svgBuf).avif({ quality: 65 }).toBuffer();

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

    const photoMedia = await seedManagedMedia({ mediaId: photoMediaId, label: "Photo" });
    const textureMedia = await seedManagedMedia({ mediaId: textureMediaId, label: "Texture" });
    const highDpiMedia = await seedManagedMedia({ mediaId: highDpiMediaId, label: "HighDPI" });
    await seedManagedMedia({ mediaId: suspendedMediaId, label: "Suspended", disabled: true });
    const safeSecMedia = await seedManagedMedia({ mediaId: safeSecMediaId, label: "SafeSecondary" });
    const gradientMedia = await seedManagedMedia({ mediaId: gradientMediaId, label: "Gradient" });

    // Seed Products
    // 1. Multi-image product (Card Carousel)
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

    // 2. High-DPI Detail Product
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

    // 3. Suspended Product (with stale compatibility markers)
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

    // 4. Mixed legacy product
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

    // 5. Additional products to create offscreen cards
    for (let i = 1; i <= 8; i++) {
      await dbClient.query(`
        INSERT INTO "Product" (name, price, stock, image, category, "categoryId", "isActive", "createdAt", "updatedAt")
        VALUES ('QA Filler Product ${i}', 500, 10, '/images/categories/essentials.jpg', 'qa-skincare', ${categoryId}, true, NOW(), NOW());
      `);
    }

    // Seed Ephemeral Admin Credential
    const salt = randomBytes(16).toString("hex");
    const key = (await scrypt(ephemeralAdminPassword, salt, 64)) as Buffer;
    const passwordHash = `scrypt$${salt}$${key.toString("hex")}`;

    await dbClient.query(`
      INSERT INTO "AdminCredential" (email, "passwordHash", "createdAt", "updatedAt")
      VALUES ('${ephemeralAdminEmail}', '${passwordHash}', NOW(), NOW());
    `);

    // 6. Start Next.js Production Server
    const nextBin = path.resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");
    nextServerProc = spawn(process.execPath, [nextBin, "start", "-p", String(QA_PORT)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: disposableTestUrl,
        PORT: String(QA_PORT),
        NODE_ENV: "production",
        MEDIA_PUBLIC_ORIGIN: `http://localhost:${QA_PORT}/media`,
        ADMIN_SESSION_SECRET: "phase6-media-test-session-secret-qa-3106",
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

    // 7. Start Google Chrome Headless
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
  // 2. Viewport Matrix, DPR Scaling & Live currentSrc Table
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

    // --- Mobile: 390x844, DPR 2 ---
    await setViewport(390, 844, 2, true);
    await navigateAndWait(`http://localhost:${QA_PORT}/shop`, 1500);
    await captureScreenshot("mobile-390x844-shop.png");

    const mobileCardImg = await evaluateInPage<{
      currentSrc: string;
      naturalWidth: number;
      clientWidth: number;
    }>(`(() => {
      const img = document.querySelector('a[href="/product/${multiImageProductId}"] picture img');
      return img ? { currentSrc: img.currentSrc, naturalWidth: img.naturalWidth, clientWidth: img.clientWidth } : null;
    })()`);

    assert.ok(mobileCardImg, "Mobile card image must exist in DOM");
    assert.ok(mobileCardImg.currentSrc.includes(photoMediaId), "Must reference photo media");

    // Match rendition width from currentSrc URL
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

    // --- Tablet: 768x1024, DPR 1 ---
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

    // --- Desktop: 1280x800, DPR 1 (PDP) ---
    await setViewport(1280, 800, 1, false);
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
  // 3. Lazy-Loading Network Request Sequence & Timing
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
  // 4. Product Detail Network Behavior & Thumbnail Switching
  // ---------------------------------------------------------------------------
  it("4. PDP main image has eager/priority hints and thumbnail switches main image cleanly", async () => {
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
  // 5. Suspension Hard Browser Gate
  // ---------------------------------------------------------------------------
  it("5. Suspended managed primary with stale markers produces ZERO browser leaks and requests", async () => {
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
  // 6. Zero Master & Private Leak Audit Across All Surfaces
  // ---------------------------------------------------------------------------
  it("6. Master object keys, private paths, and credentials never leak into real browser DOM or network", async () => {
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
  // 7. Network Response & Cache Evidence
  // ---------------------------------------------------------------------------
  it("7. Captures real HTTP response headers and audits local cache contract", async () => {
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
  // 8. Visual Evidence Package & Final Compression
  // ---------------------------------------------------------------------------
  it("8. Generates visual screenshots, asserts 0 console errors, and packages evidence bundle", async () => {
    // Assert 0 real browser console errors
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

    // Verify screenshots were written to disk
    const screenshots = fs.readdirSync(screenshotsDir);
    assert.ok(screenshots.length >= 4, "Must produce at least 4 real browser viewport screenshots");

    // Update comprehensive evidence report
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
    };

    fs.writeFileSync(
      path.join(evidenceDir, "real-browser-execution-report.json"),
      JSON.stringify(evidenceReport, null, 2),
      "utf8"
    );
  });
});
