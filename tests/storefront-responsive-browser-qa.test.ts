import dotenv from "dotenv";
dotenv.config();

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as net from "node:net";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const scrypt = promisify(scryptCallback);
const { Client } = pg;

// ============================================================
// 1. Safety & Derived Disposable DB Target Validation
// ============================================================

const testBaseUrl = process.env.DATABASE_URL_TEST;
if (!testBaseUrl) {
  throw new Error("TASK11_DATABASE_URL_TEST_MISSING");
}

const parsedBase = new URL(testBaseUrl);
if (parsedBase.hostname.includes("neon.tech")) {
  throw new Error("Safety violation: DATABASE_URL_TEST points to Neon cloud.");
}
if (!["localhost", "127.0.0.1"].includes(parsedBase.hostname)) {
  throw new Error("Safety violation: DATABASE_URL_TEST must target local PostgreSQL test container.");
}

const timestamp = Date.now();
const pid = process.pid;
const dbName = `pure_haven_storefront_browser_${timestamp}_${pid}`;
if (!/^pure_haven_storefront_browser_[0-9]+_[0-9]+$/.test(dbName)) {
  throw new Error(`Safety violation: Invalid disposable database name ${dbName}`);
}

const disposableTestUrl = testBaseUrl.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);
const adminUrl = testBaseUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");

// Fully validate the derived disposable DB target BEFORE CREATE/migration/connection
const parsedDisposable = new URL(disposableTestUrl);
assert.strictEqual(parsedDisposable.protocol, parsedBase.protocol, "Disposable URL protocol must match base");
assert.strictEqual(parsedDisposable.hostname, parsedBase.hostname, "Disposable URL hostname must match base");
assert.strictEqual(parsedDisposable.port, parsedBase.port, "Disposable URL port must match base");
assert.strictEqual(parsedDisposable.pathname, `/${dbName}`, "Disposable URL pathname must be /<dbName>");
assert.notStrictEqual(dbName, parsedBase.pathname.replace(/^\//, ""), "dbName must not equal base DB name");
assert.notStrictEqual(dbName, "postgres", "dbName must not be 'postgres'");
assert.ok(["localhost", "127.0.0.1"].includes(parsedDisposable.hostname), "Disposable hostname must remain localhost or 127.0.0.1");
assert.ok(!parsedDisposable.hostname.includes("neon.tech"), "Disposable URL must not point to Neon cloud");

// Fully validate adminUrl target
const parsedAdmin = new URL(adminUrl);
assert.strictEqual(parsedAdmin.protocol, parsedBase.protocol, "Admin URL protocol must match base");
assert.strictEqual(parsedAdmin.hostname, parsedBase.hostname, "Admin URL hostname must match base");
assert.strictEqual(parsedAdmin.port, parsedBase.port, "Admin URL port must match base");
assert.strictEqual(parsedAdmin.pathname, "/postgres", "Admin URL pathname must be /postgres");
assert.ok(["localhost", "127.0.0.1"].includes(parsedAdmin.hostname), "Admin hostname must remain localhost or 127.0.0.1");
assert.ok(!parsedAdmin.hostname.includes("neon.tech"), "Admin URL must not point to Neon cloud");

const QA_PORT = 3105;
const CHROME_DEBUG_PORT = 9226;
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

interface ViewportMetric {
  viewport: string;
  requested: { width: number; height: number };
  actual: {
    innerWidth: number;
    innerHeight: number;
    clientWidth: number;
    scrollWidth: number;
  };
  horizontalOverflow: boolean;
}

interface ScreenshotMeta {
  filename: string;
  requested: { width: number; height: number };
  actual: {
    innerWidth: number;
    innerHeight: number;
    clientWidth: number;
    scrollWidth: number;
  };
  horizontalOverflow: boolean;
}

interface NetworkRequestEvent {
  requestId: string;
  request: {
    url: string;
    method: string;
  };
}

// Safe port availability preflight helper
async function assertPortAvailable(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(new Error(`Port ${port} is not available (preflight check failed: ${err.message})`));
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

describe("Task 11 — Storefront Full Responsive Browser QA & Evidence", () => {
  let dbClient: pg.Client;
  let nextServerProc: ReturnType<typeof spawn> | null = null;
  let chromeProc: ReturnType<typeof spawn> | null = null;
  let tempChromeProfile: string | null = null;
  let cdpWs: WebSocket | null = null;
  let msgId = 1;

  // Tracked IDs
  let multiImageProductId: number = 0;
  let variantProductId: number = 0;
  let adminSingleImageProductId: number = 0;
  let adminReorderProductId: number = 0;
  let adminMetadataProductId: number = 0;

  // Ephemeral admin credentials (in-memory only)
  const ephemeralAdminEmail = `qa-admin-${timestamp}@purehaven.test`;
  const ephemeralAdminPassword = `QaPass-${timestamp}-${randomBytes(8).toString("hex")}!`;

  // Telemetry & metrics
  const requestedUrls: string[] = [];
  const consoleErrors: string[] = [];
  const uncaughtExceptions: string[] = [];
  const viewportMatrix: ViewportMetric[] = [];
  const screenshotMatrix: ScreenshotMeta[] = [];

  // Unique, clean evidence workspace (never reuse fixed folder)
  const evidenceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pure-haven-storefront-ux-evidence-")
  );

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

  async function navigateAndWait(url: string, waitMs = 1200): Promise<void> {
    await sendCdp("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, waitMs));
  }

  async function setViewport(width: number, height: number, mobile: boolean): Promise<ViewportMetric["actual"]> {
    await sendCdp("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
    await new Promise((r) => setTimeout(r, 300));
    const dims = await evaluateInPage<{
      innerWidth: number;
      innerHeight: number;
      clientWidth: number;
      scrollWidth: number;
    }>(`({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    })`);
    return dims;
  }

  async function captureScreenshot(filename: string, reqW?: number, reqH?: number): Promise<void> {
    const dims = await evaluateInPage<{
      innerWidth: number;
      innerHeight: number;
      clientWidth: number;
      scrollWidth: number;
    }>(`({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    })`);

    const match = filename.match(/(\d+)x(\d+)/);
    const expectedW = reqW ?? (match ? parseInt(match[1], 10) : dims.innerWidth);
    const expectedH = reqH ?? (match ? parseInt(match[2], 10) : dims.innerHeight);

    assert.strictEqual(
      dims.innerWidth,
      expectedW,
      `Screenshot ${filename}: actual innerWidth ${dims.innerWidth} must match requested ${expectedW}`
    );
    assert.strictEqual(
      dims.innerHeight,
      expectedH,
      `Screenshot ${filename}: actual innerHeight ${dims.innerHeight} must match requested ${expectedH}`
    );

    const horizontalOverflow = dims.scrollWidth > dims.innerWidth;
    screenshotMatrix.push({
      filename,
      requested: { width: expectedW, height: expectedH },
      actual: dims,
      horizontalOverflow,
    });

    const res = await sendCdp<ScreenshotResult>("Page.captureScreenshot", { format: "png" });
    const targetPath = path.join(evidenceDir, filename);
    fs.writeFileSync(targetPath, Buffer.from(res.data, "base64"));
  }

  function detectSecretCategories(content: string): string[] {
    const categories: string[] = [];
    const secretPatterns: Array<{ category: string; regex: RegExp }> = [
      { category: "ephemeral-password", regex: new RegExp(escapeRegex(ephemeralAdminPassword)) },
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
      { category: "admin-secret", regex: new RegExp(escapeRegex(process.env.ADMIN_SESSION_SECRET || "never-match-placeholder")) },
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

  function scanDirectoryForSecrets(dir: string): { totalFindings: number; findings: Array<{ file: string; category: string }> } {
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
      const matched = detectSecretCategories(content);
      for (const category of matched) {
        findings.push({ file: rel, category });
      }
    }

    return { totalFindings: findings.length, findings };
  }

  before(async () => {
    // 1. Preflight BOTH owned ports before spawning anything
    await assertPortAvailable(QA_PORT);
    await assertPortAvailable(CHROME_DEBUG_PORT);

    // 2. Provision disposable PostgreSQL database
    const adminClient = new Client({ connectionString: adminUrl });
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE "${dbName}";`);
    await adminClient.end();

    // 3. Deploy migrations
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

    // 4. Connect to disposable DB & seed fixtures
    dbClient = new Client({ connectionString: disposableTestUrl });
    await dbClient.connect();

    // Seed Categories
    const catRes = await dbClient.query(`
      INSERT INTO "Category" (name, slug, "sortOrder", "isActive", "createdAt", "updatedAt")
      VALUES
        ('QA Fragrances', 'qa-fragrances', 1, true, NOW(), NOW()),
        ('QA Skincare', 'qa-skincare', 2, true, NOW(), NOW()),
        ('QA Haircare', 'qa-haircare', 3, true, NOW(), NOW()),
        ('QA Bodycare', 'qa-bodycare', 4, true, NOW(), NOW()),
        ('QA Cosmetics', 'qa-cosmetics', 5, true, NOW(), NOW()),
        ('QA Essentials', 'qa-essentials', 6, true, NOW(), NOW()),
        ('QA Inactive Cat', 'qa-inactive-cat', 7, false, NOW(), NOW())
      RETURNING id, slug;
    `);

    const catMap = new Map<string, number>();
    for (const row of catRes.rows as Array<{ id: number; slug: string }>) {
      catMap.set(row.slug, row.id);
    }

    // Seed Subcategories for Category 1 (QA Fragrances)
    const fragId = catMap.get("qa-fragrances");
    await dbClient.query(`
      INSERT INTO "Subcategory" ("categoryId", name, slug, "sortOrder", "isActive", "createdAt", "updatedAt")
      VALUES
        (${fragId}, 'QA Perfume Oil', 'qa-perfume-oil', 1, true, NOW(), NOW()),
        (${fragId}, 'QA Eau De Parfum', 'qa-eau-de-parfum', 2, true, NOW(), NOW());
    `);

    // Seed Products with distinct images
    const prodRes = await dbClient.query(`
      INSERT INTO "Product" (name, price, stock, image, category, "categoryId", "isActive", "createdAt", "updatedAt")
      VALUES
        ('QA Normal Product', 500, 10, '/images/categories/essentials.jpg', 'qa-skincare', ${catMap.get("qa-skincare")}, true, NOW(), NOW()),
        ('QA Out of Stock Product', 750, 0, '/images/categories/perfume.jpg', 'qa-bodycare', ${catMap.get("qa-bodycare")}, true, NOW(), NOW()),
        ('QA Multi Image Product', 1200, 15, '/images/products/bodyspray.jpg', 'qa-haircare', ${catMap.get("qa-haircare")}, true, NOW(), NOW()),
        ('QA Variant Product', 900, 20, '/images/categories/skincare.jpg', 'qa-fragrances', ${fragId}, true, NOW(), NOW()),
        ('QA Admin Single Image', 300, 10, '/images/hero/lotion.jpg', 'qa-skincare', ${catMap.get("qa-skincare")}, true, NOW(), NOW()),
        ('QA Admin Reorder Product', 400, 10, '/images/categories/skincare.jpg', 'qa-skincare', ${catMap.get("qa-skincare")}, true, NOW(), NOW()),
        ('QA Admin Metadata Product', 450, 10, '/images/categories/bodycare.jpg', 'qa-bodycare', ${catMap.get("qa-bodycare")}, true, NOW(), NOW())
      RETURNING id, name;
    `);

    const prodMap = new Map<string, number>();
    for (const row of prodRes.rows as Array<{ id: number; name: string }>) {
      prodMap.set(row.name, row.id);
    }

    multiImageProductId = prodMap.get("QA Multi Image Product")!;
    variantProductId = prodMap.get("QA Variant Product")!;
    adminSingleImageProductId = prodMap.get("QA Admin Single Image")!;
    adminReorderProductId = prodMap.get("QA Admin Reorder Product")!;
    adminMetadataProductId = prodMap.get("QA Admin Metadata Product")!;

    // Seed ProductImages for multi-image product (distinct images not used elsewhere)
    await dbClient.query(`
      INSERT INTO "ProductImage" ("productId", url, "sortOrder", "createdAt", "updatedAt")
      VALUES
        (${multiImageProductId}, '/images/products/bodyspray.jpg', 1, NOW(), NOW()),
        (${multiImageProductId}, '/images/products/cleanser.jpg', 2, NOW(), NOW()),
        (${multiImageProductId}, '/images/products/honey.jpg', 3, NOW(), NOW()),
        (${multiImageProductId}, '/images/products/sunscreen.jpg', 4, NOW(), NOW());
    `);

    // Seed ProductImages for Variant Product
    await dbClient.query(`
      INSERT INTO "ProductImage" ("productId", url, "sortOrder", "createdAt", "updatedAt")
      VALUES
        (${variantProductId}, '/images/categories/skincare.jpg', 1, NOW(), NOW()),
        (${variantProductId}, '/images/categories/haircare.jpg', 2, NOW(), NOW()),
        (${variantProductId}, '/images/categories/bodycare.jpg', 3, NOW(), NOW());
    `);

    // Seed ProductVariants for Variant Product (Variant 1 has NO image, Variant 2 HAS image)
    await dbClient.query(`
      INSERT INTO "ProductVariant" ("productId", label, price, stock, image, "createdAt", "updatedAt")
      VALUES
        (${variantProductId}, '100ml Luxury', 2500, 10, null, NOW(), NOW()),
        (${variantProductId}, '50ml Luxury', 1500, 10, '/images/categories/cosmetics.jpg', NOW(), NOW());
    `);

    // Seed Admin Single Image (1 image)
    await dbClient.query(`
      INSERT INTO "ProductImage" ("productId", url, "sortOrder", "createdAt", "updatedAt")
      VALUES (${adminSingleImageProductId}, '/images/hero/lotion.jpg', 1, NOW(), NOW());
    `);

    // Seed Admin Reorder Product (4 images)
    await dbClient.query(`
      INSERT INTO "ProductImage" ("productId", url, "sortOrder", "createdAt", "updatedAt")
      VALUES
        (${adminReorderProductId}, '/images/categories/skincare.jpg', 1, NOW(), NOW()),
        (${adminReorderProductId}, '/images/categories/bodycare.jpg', 2, NOW(), NOW()),
        (${adminReorderProductId}, '/images/categories/haircare.jpg', 3, NOW(), NOW()),
        (${adminReorderProductId}, '/images/categories/cosmetics.jpg', 4, NOW(), NOW());
    `);

    // Seed Admin Metadata Product (2 images)
    await dbClient.query(`
      INSERT INTO "ProductImage" ("productId", url, "sortOrder", "createdAt", "updatedAt")
      VALUES
        (${adminMetadataProductId}, '/images/categories/bodycare.jpg', 1, NOW(), NOW()),
        (${adminMetadataProductId}, '/images/categories/essentials.jpg', 2, NOW(), NOW());
    `);

    // Seed Ephemeral Admin Credential (in-memory password, scrypt hash in DB only)
    const salt = randomBytes(16).toString("hex");
    const key = (await scrypt(ephemeralAdminPassword, salt, 64)) as Buffer;
    const passwordHash = `scrypt$${salt}$${key.toString("hex")}`;

    await dbClient.query(`
      INSERT INTO "AdminCredential" (email, "passwordHash", "createdAt", "updatedAt")
      VALUES ('${ephemeralAdminEmail}', '${passwordHash}', NOW(), NOW());
    `);

    // 5. Start Next.js Production Server
    const nextBin = path.resolve(process.cwd(), "node_modules/next/dist/bin/next");
    nextServerProc = spawn(process.execPath, [nextBin, "start", "-p", String(QA_PORT)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: disposableTestUrl,
        PORT: String(QA_PORT),
        NODE_ENV: "production",
      },
      stdio: "pipe",
    });

    // Wait for server ready
    let ready = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const res = await fetch(`http://localhost:${QA_PORT}/api/categories`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {}
    }
    if (!ready) {
      throw new Error("Next.js QA server failed to start within 20s");
    }

    // 6. Start Google Chrome
    tempChromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), "ph-chrome-profile-"));
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

    // Wait for Chrome debugging endpoint
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

    cdpWs.addEventListener("message", (event: MessageEvent) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          method?: string;
          params?: Record<string, unknown>;
        };
        if (msg.method === "Network.requestWillBeSent") {
          const params = msg.params as unknown as NetworkRequestEvent;
          requestedUrls.push(params.request.url);
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
    const cleanupErrors: Error[] = [];

    // 1. Close CDP WebSocket
    if (cdpWs && cdpWs.readyState === WebSocket.OPEN) {
      try {
        cdpWs.close();
      } catch (err) {
        cleanupErrors.push(err as Error);
      }
    }

    // 2. Kill Chrome process
    if (chromeProc && chromeProc.pid) {
      try {
        if (process.platform === "win32") {
          execFileSync("taskkill", ["/PID", String(chromeProc.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          chromeProc.kill("SIGKILL");
        }
      } catch (err) {
        cleanupErrors.push(err as Error);
      }
    }

    // Give Chrome processes time to exit and release file locks on Windows
    await new Promise((r) => setTimeout(r, 800));

    // 3. Remove temp Chrome profile (with retry for Windows file locks)
    if (tempChromeProfile && fs.existsSync(tempChromeProfile)) {
      for (let attempt = 0; attempt < 5; attempt++) {
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
      } catch (err) {
        cleanupErrors.push(err as Error);
      }
    }

    // 5. Close DB client & drop disposable database
    if (dbClient) {
      try {
        await dbClient.end();
      } catch (err) {
        cleanupErrors.push(err as Error);
      }
    }

    try {
      const adminClient = new Client({ connectionString: adminUrl });
      await adminClient.connect();
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
      const checkRes = await adminClient.query(`SELECT 1 FROM pg_database WHERE datname = '${dbName}';`);
      if (checkRes.rows.length > 0) {
        cleanupErrors.push(new Error(`Cleanup failure: Disposable database ${dbName} still exists in pg_database`));
      }
      await adminClient.end();
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    // 6. Remove evidence temp workspace after packaging verification
    if (evidenceDir && fs.existsSync(evidenceDir)) {
      try {
        fs.rmSync(evidenceDir, { recursive: true, force: true });
      } catch (err) {
        cleanupErrors.push(err as Error);
      }
    }

    // Brief wait for OS socket release
    await new Promise((r) => setTimeout(r, 600));

    // A. Verify port 3105 released
    try {
      await assertPortAvailable(QA_PORT);
    } catch (err) {
      cleanupErrors.push(new Error(`Cleanup verification failed: Port ${QA_PORT} was not released: ${(err as Error).message}`));
    }

    // B. Verify port 9226 released
    try {
      await assertPortAvailable(CHROME_DEBUG_PORT);
    } catch (err) {
      cleanupErrors.push(new Error(`Cleanup verification failed: Port ${CHROME_DEBUG_PORT} was not released: ${(err as Error).message}`));
    }

    // C. Verify Chrome temp profile removed
    if (tempChromeProfile && fs.existsSync(tempChromeProfile)) {
      cleanupErrors.push(new Error(`Cleanup verification failed: Chrome profile ${tempChromeProfile} still exists`));
    }

    // E. Verify evidence temp directory removed
    if (evidenceDir && fs.existsSync(evidenceDir)) {
      cleanupErrors.push(new Error(`Cleanup verification failed: Evidence temp directory ${evidenceDir} still exists`));
    }

    if (cleanupErrors.length > 0) {
      throw new Error(`Resource cleanup failed with ${cleanupErrors.length} error(s):\n${cleanupErrors.map(e => e.message).join("\n")}`);
    }
  });

  // ============================================================
  // Test Cases
  // ============================================================

  it("1. Mobile Viewport Contract: 375x667 exact runtime dimensions and zero horizontal overflow", async () => {
    await navigateAndWait(`http://localhost:${QA_PORT}`);
    const actual = await setViewport(375, 667, true);

    const horizontalOverflow = actual.scrollWidth > actual.innerWidth;
    viewportMatrix.push({
      viewport: "Mobile",
      requested: { width: 375, height: 667 },
      actual,
      horizontalOverflow,
    });

    assert.strictEqual(actual.innerWidth, 375, "window.innerWidth must be exactly 375");
    assert.strictEqual(actual.innerHeight, 667, "window.innerHeight must be exactly 667");
    assert.ok(actual.clientWidth <= 375, "document.documentElement.clientWidth must be <= 375");
    assert.ok(!horizontalOverflow, "Mobile must produce zero horizontal overflow");

    await captureScreenshot("homepage-mobile-375x667.png", 375, 667);
  });

  it("2. Tablet Viewport Contract: 768x1024 exact runtime dimensions and zero horizontal overflow", async () => {
    await navigateAndWait(`http://localhost:${QA_PORT}`);
    const actual = await setViewport(768, 1024, true);

    const horizontalOverflow = actual.scrollWidth > actual.innerWidth;
    viewportMatrix.push({
      viewport: "Tablet",
      requested: { width: 768, height: 1024 },
      actual,
      horizontalOverflow,
    });

    assert.strictEqual(actual.innerWidth, 768, "window.innerWidth must be exactly 768");
    assert.strictEqual(actual.innerHeight, 1024, "window.innerHeight must be exactly 1024");
    assert.ok(actual.clientWidth <= 768, "document.documentElement.clientWidth must be <= 768");
    assert.ok(!horizontalOverflow, "Tablet must produce zero horizontal overflow");

    await captureScreenshot("homepage-tablet-768x1024.png", 768, 1024);
  });

  it("3. Desktop Viewport Contract: 1280x800 exact runtime dimensions and zero horizontal overflow", async () => {
    await navigateAndWait(`http://localhost:${QA_PORT}`);
    const actual = await setViewport(1280, 800, false);

    const horizontalOverflow = actual.scrollWidth > actual.innerWidth;
    viewportMatrix.push({
      viewport: "Desktop",
      requested: { width: 1280, height: 800 },
      actual,
      horizontalOverflow,
    });

    assert.strictEqual(actual.innerWidth, 1280, "window.innerWidth must be exactly 1280");
    assert.strictEqual(actual.innerHeight, 800, "window.innerHeight must be exactly 800");
    assert.ok(actual.clientWidth <= 1280, "document.documentElement.clientWidth must be <= 1280");
    assert.ok(!horizontalOverflow, "Desktop must produce zero horizontal overflow");

    await captureScreenshot("homepage-desktop-1280x800.png", 1280, 800);
  });

  it("4. Public ProductCard: Structural network lazy loading for multi-image carousel", async () => {
    requestedUrls.length = 0;

    await setViewport(1280, 800, false);
    await navigateAndWait(`http://localhost:${QA_PORT}/shop`, 1500);

    const isImageRequested = (imageName: string) =>
      requestedUrls.some((u) => {
        const decoded = decodeURIComponent(u);
        return decoded.includes(imageName);
      });

    // Primary image (/images/products/bodyspray.jpg) MUST be requested initially
    assert.ok(isImageRequested("bodyspray.jpg"), "Primary gallery asset must be requested initially");

    // Secondary images MUST NOT be requested initially
    assert.ok(
      !isImageRequested("cleanser.jpg"),
      "Secondary image 2 must NOT be requested on initial card render"
    );
    assert.ok(
      !isImageRequested("honey.jpg"),
      "Secondary image 3 must NOT be requested on initial card render"
    );
    assert.ok(
      !isImageRequested("sunscreen.jpg"),
      "Secondary image 4 must NOT be requested on initial card render"
    );

    // Interact with Next Image button on QA Multi Image Product card
    await evaluateInPage(`
      (() => {
        const headings = Array.from(document.querySelectorAll('h3, h2, h4'));
        const h = headings.find(el => el.textContent.trim() === 'QA Multi Image Product');
        const card = h ? h.closest('div.group') : null;
        if (!card) throw new Error('Multi image card not found');
        const nextBtn = card.querySelector('button[aria-label="Next image"]');
        if (!nextBtn) throw new Error('Next image button not found on card');
        nextBtn.click();
      })()
    `);

    await new Promise((r) => setTimeout(r, 800));

    // Secondary image 2 (cleanser.jpg) MUST now be requested
    assert.ok(
      isImageRequested("cleanser.jpg"),
      "Next requested slide image (cleanser.jpg) must be fetched after Next click"
    );

    // Later secondary images (honey.jpg, sunscreen.jpg) must remain unfetched
    assert.ok(
      !isImageRequested("honey.jpg"),
      "Later secondary image 3 must remain unfetched after only 1 Next click"
    );
    assert.ok(
      !isImageRequested("sunscreen.jpg"),
      "Later secondary image 4 must remain unfetched after only 1 Next click"
    );

    await captureScreenshot("shop-gallery-desktop-1280x800.png", 1280, 800);
  });

  it("5. ProductCard Customer Acceptance: Hierarchy, relational eyebrow, literal Taka, no dollar, no numeric stock, single OOS badge", async () => {
    await setViewport(1280, 800, false);
    await navigateAndWait(`http://localhost:${QA_PORT}/shop`, 1000);

    const cardAudit = await evaluateInPage<{
      multiImageCard: {
        hasTitle: boolean;
        eyebrow: string;
        hasDollar: boolean;
        hasTaka: boolean;
        hasNumericStock: boolean;
        hasCarouselControls: boolean;
      };
      oosCard: {
        hasTitle: boolean;
        badgeCount: number;
        ctaLabel: string;
        ctaDisabled: boolean;
        hasDollar: boolean;
        hasTaka: boolean;
        hasDuplicateOosInCta: boolean;
      };
      singleImageCard: {
        hasCarouselControls: boolean;
      };
    }>(`
      (() => {
        const findCard = (name) => {
          const headings = Array.from(document.querySelectorAll('h3, h2, h4'));
          const h = headings.find(el => el.textContent.trim() === name);
          return h ? h.closest('div.group') : null;
        };

        const multi = findCard('QA Multi Image Product');
        const oos = findCard('QA Out of Stock Product');
        const single = findCard('QA Normal Product');

        // Scoped eyebrow search inside multi card
        const paragraphs = Array.from(multi ? multi.querySelectorAll('p') : []);
        const eyebrowEl = paragraphs.find(p => p.className.includes('uppercase') || p.className.includes('tracking') || p.textContent.includes('QA Haircare'));
        const multiEyebrow = eyebrowEl ? eyebrowEl.textContent.trim() : (paragraphs[0]?.textContent?.trim() || '');

        return {
          multiImageCard: {
            hasTitle: Boolean(multi && multi.querySelector('h3')?.textContent?.includes('QA Multi Image Product')),
            eyebrow: multiEyebrow,
            hasDollar: Boolean(multi && multi.textContent.includes('$')),
            hasTaka: Boolean(multi && multi.textContent.includes('৳')),
            hasNumericStock: Boolean(multi && /Stock:\\s*\\d+/i.test(multi.textContent)),
            hasCarouselControls: Boolean(multi && multi.querySelector('button[aria-label="Next image"]'))
          },
          oosCard: {
            hasTitle: Boolean(oos && oos.querySelector('h3')?.textContent?.includes('QA Out of Stock Product')),
            badgeCount: oos ? Array.from(oos.querySelectorAll('span')).filter(s => s.textContent.trim() === 'Out of Stock').length : 0,
            ctaLabel: oos ? (oos.querySelector('button:not([aria-label])')?.textContent?.trim() || '') : '',
            ctaDisabled: oos ? Boolean(oos.querySelector('button:not([aria-label])')?.disabled) : false,
            hasDollar: Boolean(oos && oos.textContent.includes('$')),
            hasTaka: Boolean(oos && oos.textContent.includes('৳')),
            hasDuplicateOosInCta: Boolean(oos && oos.querySelector('button:not([aria-label])')?.textContent?.includes('Out of Stock'))
          },
          singleImageCard: {
            hasCarouselControls: Boolean(single && single.querySelector('button[aria-label="Next image"]'))
          }
        };
      })()
    `);

    // Multi image card checks
    assert.ok(cardAudit.multiImageCard.hasTitle, "Product name rendered as title");
    assert.strictEqual(
      cardAudit.multiImageCard.eyebrow,
      "QA Haircare",
      "ProductCard relational customer-safe eyebrow must resolve to 'QA Haircare'"
    );
    assert.ok(!cardAudit.multiImageCard.hasDollar, "Product card price must contain NO dollar sign ($)");
    assert.ok(cardAudit.multiImageCard.hasTaka, "Product card price must contain literal Bangladesh Taka sign (৳)");
    assert.ok(!cardAudit.multiImageCard.hasNumericStock, "Product card must NOT show customer-visible numeric 'Stock:'");
    assert.ok(cardAudit.multiImageCard.hasCarouselControls, "Multi-image card must expose carousel controls");

    // Single image card checks
    assert.ok(!cardAudit.singleImageCard.hasCarouselControls, "Single-image card must NOT have carousel controls");

    // OOS card checks
    assert.ok(cardAudit.oosCard.hasTitle, "OOS Product name rendered as title");
    assert.strictEqual(cardAudit.oosCard.badgeCount, 1, "OOS product card must have exactly ONE 'Out of Stock' badge");
    assert.strictEqual(cardAudit.oosCard.ctaLabel, "Add to Cart", "OOS CTA label must remain 'Add to Cart'");
    assert.ok(cardAudit.oosCard.ctaDisabled, "OOS CTA must be disabled");
    assert.ok(!cardAudit.oosCard.hasDuplicateOosInCta, "OOS CTA must not contain duplicate 'Out of Stock' text");
    assert.ok(!cardAudit.oosCard.hasDollar, "OOS card price must contain NO dollar sign");
    assert.ok(cardAudit.oosCard.hasTaka, "OOS card price must contain literal Taka sign");
  });

  it("6. Desktop Frame Stability & Hover: Geometry preserved with zero horizontal overflow", async () => {
    await setViewport(1280, 800, false);
    await navigateAndWait(`http://localhost:${QA_PORT}/shop`, 1000);

    const initialGeometry = await evaluateInPage<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>(`
      (() => {
        const headings = Array.from(document.querySelectorAll('h3, h2, h4'));
        const h = headings.find(el => el.textContent.trim() === 'QA Multi Image Product');
        const target = h ? h.closest('div.group') : null;
        if (!target) throw new Error('Multi image card not found');
        const rect = target.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()
    `);

    // Hover mouse over card
    await sendCdp("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: Math.round(initialGeometry.x + initialGeometry.width / 2),
      y: Math.round(initialGeometry.y + initialGeometry.height / 2),
    });

    await new Promise((r) => setTimeout(r, 400));

    const hoveredGeometry = await evaluateInPage<{
      x: number;
      y: number;
      width: number;
      height: number;
      scrollWidth: number;
      innerWidth: number;
    }>(`
      (() => {
        const headings = Array.from(document.querySelectorAll('h3, h2, h4'));
        const h = headings.find(el => el.textContent.trim() === 'QA Multi Image Product');
        const target = h ? h.closest('div.group') : null;
        if (!target) throw new Error('Multi image card not found');
        const rect = target.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth
        };
      })()
    `);

    // Reset mouse
    await sendCdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });

    assert.ok(
      Math.abs(hoveredGeometry.width - initialGeometry.width) < 1,
      "Card frame width must remain unchanged under hover"
    );
    assert.ok(
      Math.abs(hoveredGeometry.height - initialGeometry.height) < 1,
      "Card frame height must remain unchanged under hover"
    );
    assert.ok(
      Math.abs(hoveredGeometry.x - initialGeometry.x) < 1,
      "Card frame X position must remain unchanged under hover"
    );
    assert.ok(
      hoveredGeometry.scrollWidth <= hoveredGeometry.innerWidth,
      "Hover must not create horizontal overflow"
    );
  });

  it("7. Desktop Navigation 1280x800: Hierarchy, first 4 primary, grouped More panel, keyboard reachability, direct category navigation", async () => {
    await setViewport(1280, 800, false);
    await navigateAndWait(`http://localhost:${QA_PORT}`, 1000);

    const navAudit = await evaluateInPage<{
      desktopNavVisible: boolean;
      hamburgerHidden: boolean;
      primaryCategoryLinks: string[];
      hasMoreButton: boolean;
      overflowCategoryLinks: string[];
      zeroSubcategoryHasNoSubIndicator: boolean;
      hasCanonicalSubcategoryLink: boolean;
      allCategoryText: string;
    }>(`
      (() => {
        const header = document.querySelector('header');
        const desktopNav = header?.querySelector('nav');
        const hamburger = header?.querySelector('button[aria-label="Open menu"]');

        const primaryLinks = Array.from(desktopNav?.querySelectorAll(':scope > div.relative > a[href^="/shop?category="]') || [])
          .map(a => a.textContent.trim());

        const moreBtn = Array.from(desktopNav?.querySelectorAll('button') || [])
          .find(b => b.textContent.includes('More'));

        const moreContainer = moreBtn?.parentElement;
        const overflowLinks = Array.from(moreContainer?.querySelectorAll('a[href^="/shop?category="]') || [])
          .map(a => a.textContent.trim());

        // Check category 2 (QA Skincare - zero subcategories)
        const skincareItem = Array.from(desktopNav?.querySelectorAll(':scope > div.relative') || [])
          .find(div => div.textContent.includes('QA Skincare'));
        const skincareSubSvg = skincareItem?.querySelector('svg');

        // Check canonical subcategory link
        const subcategoryLinks = Array.from(desktopNav?.querySelectorAll('a[href*="subcategory="]') || []);
        const hasCanonical = subcategoryLinks.some(a => {
          const href = a.getAttribute('href') || '';
          return href.includes('category=qa-fragrances') && href.includes('subcategory=qa-perfume-oil');
        });

        return {
          desktopNavVisible: Boolean(desktopNav && getComputedStyle(desktopNav).display !== 'none'),
          hamburgerHidden: Boolean(!hamburger || getComputedStyle(hamburger).display === 'none'),
          primaryCategoryLinks: primaryLinks,
          hasMoreButton: Boolean(moreBtn),
          overflowCategoryLinks: overflowLinks,
          zeroSubcategoryHasNoSubIndicator: Boolean(!skincareSubSvg),
          hasCanonicalSubcategoryLink: hasCanonical,
          allCategoryText: desktopNav?.textContent || ''
        };
      })()
    `);

    assert.ok(navAudit.desktopNavVisible, "Desktop navigation must be visible at 1280x800");
    assert.ok(navAudit.hamburgerHidden, "Mobile hamburger button must be hidden at 1280x800");

    // Exact primary category hierarchy
    assert.deepStrictEqual(
      navAudit.primaryCategoryLinks,
      ["QA Fragrances", "QA Skincare", "QA Haircare", "QA Bodycare"],
      "First 4 active categories must be primary direct links"
    );

    // Exact overflow category hierarchy
    assert.deepStrictEqual(
      navAudit.overflowCategoryLinks,
      ["QA Cosmetics", "QA Essentials"],
      "Overflow active categories must be grouped into More panel"
    );

    // Inactive category absent
    assert.ok(!navAudit.allCategoryText.includes("QA Inactive Cat"), "Inactive category must be completely absent");

    assert.ok(navAudit.hasMoreButton, "More button must exist when active categories > 4");
    assert.ok(navAudit.zeroSubcategoryHasNoSubIndicator, "Zero-subcategory category must NOT have submenu arrow indicator");
    assert.ok(navAudit.hasCanonicalSubcategoryLink, "Subcategory link must include canonical category and subcategory params");

    // Keyboard focus accessibility: focus the More button and verify More dropdown opens
    await evaluateInPage(`
      (() => {
        const moreBtn = Array.from(document.querySelectorAll('header nav button'))
          .find(b => b.textContent.includes('More'));
        moreBtn?.focus();
      })()
    `);

    await new Promise((r) => setTimeout(r, 200));

    const isMoreVisibleOnFocus = await evaluateInPage<boolean>(`
      (() => {
        const moreBtn = Array.from(document.querySelectorAll('header nav button'))
          .find(b => b.textContent.includes('More'));
        const moreContainer = moreBtn?.parentElement;
        const panel = moreContainer?.querySelector('div.absolute');
        return Boolean(panel && (getComputedStyle(panel).visibility === 'visible' || panel.classList.contains('group-focus-within:visible')));
      })()
    `);

    assert.ok(isMoreVisibleOnFocus, "More panel must be reachable and visible via keyboard focus-within");
    await captureScreenshot("navbar-more-desktop-1280x800.png", 1280, 800);

    // Perform ACTUAL direct category-link navigation in Chrome
    await evaluateInPage(`
      (() => {
        const desktopNav = document.querySelector('header nav');
        const skinLink = Array.from(desktopNav?.querySelectorAll('a') || [])
          .find(a => a.textContent.trim() === 'QA Skincare');
        if (!skinLink) throw new Error('QA Skincare link not found');
        skinLink.click();
      })()
    `);

    await new Promise((r) => setTimeout(r, 1200));

    const currentNavUrl = await evaluateInPage<string>("window.location.href");
    assert.ok(
      currentNavUrl.includes("category=qa-skincare"),
      "Clicking QA Skincare top-level category link must navigate to category=qa-skincare"
    );

    // Return to QA homepage for subsequent tests
    await navigateAndWait(`http://localhost:${QA_PORT}`, 1000);
  });

  it("8. Mobile Navigation Contract: Drawer, direct category link navigation, two-control disclosure, drawer close after navigation", async () => {
    await setViewport(375, 667, true);
    await navigateAndWait(`http://localhost:${QA_PORT}`, 1000);

    // Open hamburger
    await evaluateInPage(`
      document.querySelector('button[aria-label="Open menu"]')?.click();
    `);
    await new Promise((r) => setTimeout(r, 400));

    const drawerOpenMobile = await evaluateInPage<boolean>(`
      Boolean(document.querySelector('aside')?.textContent?.includes('All Products'))
    `);
    assert.ok(drawerOpenMobile, "Mobile hamburger click must open navigation drawer");

    // A. Verify direct category Link exists & B. Verify separate disclosure button exists & C. Before disclosure: aria-expanded=false
    const disclosureAudit = await evaluateInPage<{
      hasDirectCategoryLink: boolean;
      categoryHref: string;
      hasDisclosureButton: boolean;
      initialExpanded: boolean;
      ariaControls: string;
      hasZeroSubDisclosure: boolean;
    }>(`
      (() => {
        const aside = document.querySelector('aside');
        const fragRow = Array.from(aside?.querySelectorAll('div.border-b') || [])
          .find(d => d.textContent.includes('QA Fragrances'));

        const catLink = fragRow?.querySelector('a[href^="/shop?category="]');
        const discBtn = fragRow?.querySelector('button[aria-controls]');

        const skinRow = Array.from(aside?.querySelectorAll('div.border-b') || [])
          .find(d => d.textContent.includes('QA Skincare'));
        const skinDiscBtn = skinRow?.querySelector('button[aria-controls]');

        return {
          hasDirectCategoryLink: Boolean(catLink),
          categoryHref: catLink?.getAttribute('href') || '',
          hasDisclosureButton: Boolean(discBtn),
          initialExpanded: discBtn?.getAttribute('aria-expanded') === 'true',
          ariaControls: discBtn?.getAttribute('aria-controls') || '',
          hasZeroSubDisclosure: Boolean(skinDiscBtn)
        };
      })()
    `);

    assert.ok(disclosureAudit.hasDirectCategoryLink, "Direct category link must exist in mobile drawer");
    assert.ok(disclosureAudit.categoryHref.includes("qa-fragrances"), "Category link navigates to canonical category");
    assert.ok(disclosureAudit.hasDisclosureButton, "Separate disclosure button must exist for category with subcategories");
    assert.strictEqual(disclosureAudit.initialExpanded, false, "Initial aria-expanded must be false before disclosure click");
    assert.ok(!disclosureAudit.hasZeroSubDisclosure, "Zero-subcategory category must NOT have disclosure button");

    // D. Click disclosure: URL unchanged, aria-expanded=true, aria-controls non-empty, controlled container exists
    const urlBeforeDisclosure = await evaluateInPage<string>("window.location.href");
    await evaluateInPage(`
      (() => {
        const aside = document.querySelector('aside');
        const fragRow = Array.from(aside?.querySelectorAll('div.border-b') || [])
          .find(d => d.textContent.includes('QA Fragrances'));
        fragRow?.querySelector('button[aria-controls]')?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    const urlAfterDisclosure = await evaluateInPage<string>("window.location.href");
    assert.strictEqual(urlBeforeDisclosure, urlAfterDisclosure, "Clicking disclosure button must NOT change the URL");

    const disclosureState = await evaluateInPage<{
      expanded: boolean;
      controlsId: string;
      controlsExist: boolean;
      hasExpectedSubcategories: boolean;
    }>(`
      (() => {
        const aside = document.querySelector('aside');
        const fragRow = Array.from(aside?.querySelectorAll('div.border-b') || [])
          .find(d => d.textContent.includes('QA Fragrances'));
        const discBtn = fragRow?.querySelector('button[aria-controls]');
        const expanded = discBtn?.getAttribute('aria-expanded') === 'true';
        const controlsId = discBtn?.getAttribute('aria-controls') || '';
        const container = controlsId ? document.getElementById(controlsId) : null;
        const subLinks = container ? Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href') || '') : [];
        const hasExpectedSub = subLinks.some(h => h.includes('qa-perfume-oil'));
        return {
          expanded,
          controlsId,
          controlsExist: Boolean(container),
          hasExpectedSubcategories: hasExpectedSub
        };
      })()
    `);

    assert.ok(disclosureState.expanded, "aria-expanded must toggle to true after first click");
    assert.ok(disclosureState.controlsId.length > 0, "aria-controls attribute must be non-empty");
    assert.ok(disclosureState.controlsExist, "Controlled container matching aria-controls must exist in DOM");
    assert.ok(disclosureState.hasExpectedSubcategories, "Controlled container must contain expected active subcategories");

    await captureScreenshot("navbar-drawer-mobile-375x667.png", 375, 667);

    // E. Click disclosure AGAIN: aria-expanded=false, controlled container closes
    await evaluateInPage(`
      (() => {
        const aside = document.querySelector('aside');
        const fragRow = Array.from(aside?.querySelectorAll('div.border-b') || [])
          .find(d => d.textContent.includes('QA Fragrances'));
        fragRow?.querySelector('button[aria-controls]')?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    const secondClickState = await evaluateInPage<{
      expanded: boolean;
      containerVisible: boolean;
    }>(`
      (() => {
        const aside = document.querySelector('aside');
        const fragRow = Array.from(aside?.querySelectorAll('div.border-b') || [])
          .find(d => d.textContent.includes('QA Fragrances'));
        const discBtn = fragRow?.querySelector('button[aria-controls]');
        const controlsId = discBtn?.getAttribute('aria-controls') || '';
        const container = controlsId ? document.getElementById(controlsId) : null;
        return {
          expanded: discBtn?.getAttribute('aria-expanded') === 'true',
          containerVisible: Boolean(container && getComputedStyle(container).display !== 'none')
        };
      })()
    `);

    assert.strictEqual(secondClickState.expanded, false, "aria-expanded must be false after second click");
    assert.strictEqual(secondClickState.containerVisible, false, "Controlled container must close after second click");

    // F. Click the DIRECT category Link itself: navigates to /shop?category=qa-fragrances and closes drawer
    await evaluateInPage(`
      (() => {
        const aside = document.querySelector('aside');
        const fragRow = Array.from(aside?.querySelectorAll('div.border-b') || [])
          .find(d => d.textContent.includes('QA Fragrances'));
        const catLink = fragRow?.querySelector('a[href^="/shop?category="]');
        catLink?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1200));

    const postDirectNavUrl = await evaluateInPage<string>("window.location.href");
    assert.ok(
      postDirectNavUrl.includes("/shop?category=qa-fragrances"),
      "Direct category link must navigate to /shop?category=qa-fragrances"
    );

    const drawerClosedAfterNav = await evaluateInPage<boolean>(`
      Boolean(!document.querySelector('aside'))
    `);
    assert.ok(drawerClosedAfterNav, "Drawer must be closed after direct category link navigation");
  });

  it("9. Tablet Two-Control Contract: Hamburger, no dead zone, separate Link and disclosure", async () => {
    // Exact 768x1024 tablet viewport
    await setViewport(768, 1024, true);
    await navigateAndWait(`http://localhost:${QA_PORT}`, 1000);

    const tabletNavState = await evaluateInPage<{
      hamburgerVisible: boolean;
      desktopNavHidden: boolean;
    }>(`
      (() => {
        const header = document.querySelector('header');
        const hamburger = header?.querySelector('button[aria-label="Open menu"]');
        const desktopNav = header?.querySelector('nav');
        return {
          hamburgerVisible: Boolean(hamburger && getComputedStyle(hamburger).display !== 'none'),
          desktopNavHidden: Boolean(!desktopNav || getComputedStyle(desktopNav).display === 'none')
        };
      })()
    `);

    assert.ok(tabletNavState.hamburgerVisible, "Hamburger button must remain active on tablet (768px)");
    assert.ok(tabletNavState.desktopNavHidden, "Desktop horizontal nav must remain hidden on tablet (768px)");

    // Open drawer on tablet
    await evaluateInPage(`
      document.querySelector('button[aria-label="Open menu"]')?.click();
    `);
    await new Promise((r) => setTimeout(r, 400));

    // Verify direct Link + disclosure button on tablet
    const tabletDrawerAudit = await evaluateInPage<{
      hasDirectLink: boolean;
      hasDisclosure: boolean;
      initialExpanded: boolean;
    }>(`
      (() => {
        const aside = document.querySelector('aside');
        const fragRow = Array.from(aside?.querySelectorAll('div.border-b') || [])
          .find(d => d.textContent.includes('QA Fragrances'));
        const catLink = fragRow?.querySelector('a[href^="/shop?category="]');
        const discBtn = fragRow?.querySelector('button[aria-controls]');
        return {
          hasDirectLink: Boolean(catLink),
          hasDisclosure: Boolean(discBtn),
          initialExpanded: discBtn?.getAttribute('aria-expanded') === 'true'
        };
      })()
    `);

    assert.ok(tabletDrawerAudit.hasDirectLink, "Tablet drawer must have direct category Link");
    assert.ok(tabletDrawerAudit.hasDisclosure, "Tablet drawer must have separate disclosure button");
    assert.strictEqual(tabletDrawerAudit.initialExpanded, false, "Initial aria-expanded is false on tablet");

    // Click disclosure on tablet
    const urlBefore = await evaluateInPage<string>("window.location.href");
    await evaluateInPage(`
      (() => {
        const aside = document.querySelector('aside');
        const fragRow = Array.from(aside?.querySelectorAll('div.border-b') || [])
          .find(d => d.textContent.includes('QA Fragrances'));
        fragRow?.querySelector('button[aria-controls]')?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    const urlAfter = await evaluateInPage<string>("window.location.href");
    assert.strictEqual(urlBefore, urlAfter, "Tablet disclosure click must NOT change URL");

    const tabletExpandedState = await evaluateInPage<{
      expanded: boolean;
      hasControlsContainer: boolean;
    }>(`
      (() => {
        const aside = document.querySelector('aside');
        const fragRow = Array.from(aside?.querySelectorAll('div.border-b') || [])
          .find(d => d.textContent.includes('QA Fragrances'));
        const discBtn = fragRow?.querySelector('button[aria-controls]');
        const controlsId = discBtn?.getAttribute('aria-controls') || '';
        const container = controlsId ? document.getElementById(controlsId) : null;
        return {
          expanded: discBtn?.getAttribute('aria-expanded') === 'true',
          hasControlsContainer: Boolean(container)
        };
      })()
    `);

    assert.ok(tabletExpandedState.expanded, "Tablet disclosure toggles aria-expanded to true");
    assert.ok(tabletExpandedState.hasControlsContainer, "Tablet disclosure reveals matching subcategory container");

    // Close drawer
    await evaluateInPage(`
      document.querySelector('button[aria-label="Close menu"]')?.click();
    `);
    await new Promise((r) => setTimeout(r, 300));
  });

  it("10. SafeMobileBottomNav: Real-browser mobile bottom navigation presentation and menu usability", async () => {
    await setViewport(375, 667, true);
    await navigateAndWait(`http://localhost:${QA_PORT}`, 1000);

    const bottomNavAudit = await evaluateInPage<{
      navExists: boolean;
      navVisible: boolean;
      homeHref: string;
      hasMenuButton: boolean;
      cartHref: string;
      searchHref: string;
      accountHref: string;
    }>(`
      (() => {
        const nav = document.getElementById('ph-real-bottom-nav');
        if (!nav) return { navExists: false, navVisible: false, homeHref: '', hasMenuButton: false, cartHref: '', searchHref: '', accountHref: '' };

        const home = nav.querySelector('a[href="/"]');
        const menuBtn = Array.from(nav.querySelectorAll('button')).find(b => b.textContent.includes('MENU'));
        const cart = nav.querySelector('a[href="/cart"]');
        const search = nav.querySelector('a[href*="focus=search"]');
        const account = nav.querySelector('a[href="/login"]');

        const rect = nav.getBoundingClientRect();
        const visible = getComputedStyle(nav).display !== 'none' && rect.height > 0;

        return {
          navExists: true,
          navVisible: visible,
          homeHref: home?.getAttribute('href') || '',
          hasMenuButton: Boolean(menuBtn),
          cartHref: cart?.getAttribute('href') || '',
          searchHref: search?.getAttribute('href') || '',
          accountHref: account?.getAttribute('href') || ''
        };
      })()
    `);

    assert.ok(bottomNavAudit.navExists, "SafeMobileBottomNav (#ph-real-bottom-nav) must exist in DOM");
    assert.ok(bottomNavAudit.navVisible, "SafeMobileBottomNav must be visible at 375x667");
    assert.strictEqual(bottomNavAudit.homeHref, "/", "HOME link points to '/'");
    assert.ok(bottomNavAudit.hasMenuButton, "MENU button exists in bottom nav");
    assert.strictEqual(bottomNavAudit.cartHref, "/cart", "CART link points to '/cart'");
    assert.ok(bottomNavAudit.searchHref.includes("/shop?focus=search"), "SEARCH link points to '/shop?focus=search'");
    assert.strictEqual(bottomNavAudit.accountHref, "/login", "ACCOUNT link points to '/login'");

    // Click MENU button to verify bottom-nav menu overlay opens
    await evaluateInPage(`
      (() => {
        const nav = document.getElementById('ph-real-bottom-nav');
        const menuBtn = Array.from(nav?.querySelectorAll('button') || []).find(b => b.textContent.includes('MENU'));
        menuBtn?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 400));

    const menuOpen = await evaluateInPage<boolean>(`
      Boolean(document.querySelector('aside')?.textContent?.includes('All Products'))
    `);
    assert.ok(menuOpen, "Bottom nav MENU button opens bottom-nav category menu overlay");

    // Close menu overlay via × button
    await evaluateInPage(`
      (() => {
        const closeBtn = Array.from(document.querySelectorAll('aside button')).find(b => b.textContent.includes('×'));
        closeBtn?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));
  });

  it("11. Tablet Product Grid: Computes to 2 columns on /shop at 768x1024", async () => {
    await setViewport(768, 1024, true);
    await navigateAndWait(`http://localhost:${QA_PORT}/shop`, 1000);

    const gridInfo = await evaluateInPage<{
      cardCount: number;
      card1X: number;
      card2X: number;
      card1Y: number;
      card2Y: number;
      scrollWidth: number;
      innerWidth: number;
    }>(`
      (() => {
        const headings = Array.from(document.querySelectorAll('h3, h2, h4'));
        const cards = headings.map(h => h.closest('div.group')).filter(Boolean);
        if (cards.length < 2) return { cardCount: cards.length, card1X: 0, card2X: 0, card1Y: 0, card2Y: 0, scrollWidth: 0, innerWidth: 0 };
        const rect1 = cards[0].getBoundingClientRect();
        const rect2 = cards[1].getBoundingClientRect();
        return {
          cardCount: cards.length,
          card1X: rect1.x,
          card2X: rect2.x,
          card1Y: rect1.y,
          card2Y: rect2.y,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth
        };
      })()
    `);

    assert.ok(gridInfo.cardCount >= 2, "Shop page must display at least 2 product cards");
    assert.ok(gridInfo.card2X > gridInfo.card1X, "Card 2 must be positioned horizontally to the right of Card 1 (2 columns)");
    assert.ok(Math.abs(gridInfo.card2Y - gridInfo.card1Y) < 10, "Card 1 and Card 2 must be on the same vertical row in 2-column grid");
    assert.ok(gridInfo.scrollWidth <= gridInfo.innerWidth, "Tablet shop grid must produce zero horizontal overflow");

    await captureScreenshot("shop-gallery-tablet-768x1024.png", 768, 1024);
  });

  it("12. Product Detail Shared Gallery & Commerce Preservation: True 768x1024, URL authority, variant override, fallback, price/stock/quantity/cart", async () => {
    // Set EXACT 768x1024 viewport before navigating & assertions
    const actualDims = await setViewport(768, 1024, true);
    assert.strictEqual(actualDims.innerWidth, 768, "window.innerWidth must be exactly 768");
    assert.strictEqual(actualDims.innerHeight, 1024, "window.innerHeight must be exactly 1024");
    assert.ok(actualDims.scrollWidth <= actualDims.innerWidth, "Tablet product detail must produce zero horizontal overflow");

    await navigateAndWait(`http://localhost:${QA_PORT}/product/${variantProductId}`, 1200);

    // Verify Base Gallery Authority & ordered thumbnail URLs
    const baseGalleryAudit = await evaluateInPage<{
      thumbnailCount: number;
      thumbnailLabels: string[];
      thumbnailUrls: string[];
      variantCount: number;
    }>(`
      (() => {
        const thumbContainer = document.querySelector('div[aria-label="Product image gallery"]');
        const thumbButtons = Array.from(thumbContainer?.querySelectorAll('button') || []);
        const labels = thumbButtons.map(b => b.getAttribute('aria-label') || '');
        const urls = thumbButtons.map(b => {
          const img = b.querySelector('img');
          return decodeURIComponent(img?.getAttribute('src') || '');
        });

        const variants = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.includes('Luxury'));

        return {
          thumbnailCount: thumbButtons.length,
          thumbnailLabels: labels,
          thumbnailUrls: urls,
          variantCount: variants.length
        };
      })()
    `);

    assert.strictEqual(baseGalleryAudit.thumbnailCount, 3, "Product detail must render 3 base gallery thumbnails");
    assert.strictEqual(baseGalleryAudit.thumbnailLabels[0], "Show product image 1 of 3");
    assert.strictEqual(baseGalleryAudit.thumbnailLabels[1], "Show product image 2 of 3");
    assert.strictEqual(baseGalleryAudit.thumbnailLabels[2], "Show product image 3 of 3");

    // Ordered base authority verification
    assert.ok(baseGalleryAudit.thumbnailUrls[0].includes("skincare.jpg"), "Thumbnail 1 must be skincare.jpg");
    assert.ok(baseGalleryAudit.thumbnailUrls[1].includes("haircare.jpg"), "Thumbnail 2 must be haircare.jpg");
    assert.ok(baseGalleryAudit.thumbnailUrls[2].includes("bodycare.jpg"), "Thumbnail 3 must be bodycare.jpg");

    // Click base image 2 (haircare.jpg)
    await evaluateInPage(`
      (() => {
        const thumbContainer = document.querySelector('div[aria-label="Product image gallery"]');
        const thumbButtons = Array.from(thumbContainer?.querySelectorAll('button') || []);
        thumbButtons[1]?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    const image2Main = await evaluateInPage<string>(`
      decodeURIComponent(document.querySelector('section img')?.getAttribute('src') || '')
    `);
    assert.ok(image2Main.includes("haircare.jpg"), "Clicking thumbnail 2 updates main preview to base image 2");

    // Select Variant with image (50ml Luxury)
    await evaluateInPage(`
      (() => {
        const variantButtons = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.includes('50ml Luxury'));
        variantButtons[0]?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    const variantOverrideMain = await evaluateInPage<string>(`
      decodeURIComponent(document.querySelector('section img')?.getAttribute('src') || '')
    `);
    assert.ok(
      variantOverrideMain.includes("cosmetics.jpg"),
      "Selecting variant with image overrides main preview with variant image (cosmetics.jpg)"
    );

    // Verify thumbnail URLs remain exactly the same 3 base images; cosmetics.jpg NOT present in base thumbnails
    const baseThumbsAfterVariant = await evaluateInPage<string[]>(`
      Array.from(document.querySelectorAll('div[aria-label="Product image gallery"] button img')).map(img =>
        decodeURIComponent(img.getAttribute('src') || '')
      )
    `);
    assert.strictEqual(baseThumbsAfterVariant.length, 3, "Base thumbnails count remains 3");
    assert.ok(baseThumbsAfterVariant[0].includes("skincare.jpg"), "Base thumbnail 1 remains skincare.jpg");
    assert.ok(baseThumbsAfterVariant[1].includes("haircare.jpg"), "Base thumbnail 2 remains haircare.jpg");
    assert.ok(baseThumbsAfterVariant[2].includes("bodycare.jpg"), "Base thumbnail 3 remains bodycare.jpg");
    assert.ok(
      !baseThumbsAfterVariant.some(url => url.includes("cosmetics.jpg")),
      "Variant asset cosmetics.jpg must NOT be present in any base thumbnail"
    );

    // Select Variant without image (100ml Luxury) -> returns to currently selected base image 2 (haircare.jpg)
    await evaluateInPage(`
      (() => {
        const variantButtons = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.includes('100ml Luxury'));
        variantButtons[0]?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    const fallbackMain = await evaluateInPage<string>(`
      decodeURIComponent(document.querySelector('section img')?.getAttribute('src') || '')
    `);
    assert.ok(
      fallbackMain.includes("haircare.jpg"),
      "Selecting variant without image returns preview to currently selected base image 2 (not reset to image 1)"
    );

    // Commerce preservation assertions
    const commerceAudit = await evaluateInPage<{
      price100ml: string;
      inStockText: string;
      qtyInitial: string;
      canAddToCart: boolean;
    }>(`
      (() => {
        const priceText = document.querySelector('p.text-3xl.font-semibold')?.textContent?.trim() || '';
        const inStockSpan = Array.from(document.querySelectorAll('span')).find(s => s.textContent.includes('In Stock'));
        const qtySpan = document.querySelector('span.min-w-12')?.textContent?.trim() || '';
        const addBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('ADD TO CART'));

        return {
          price100ml: priceText,
          inStockText: inStockSpan?.textContent?.trim() || '',
          qtyInitial: qtySpan,
          canAddToCart: Boolean(addBtn && !addBtn.disabled)
        };
      })()
    `);

    assert.ok(commerceAudit.price100ml.includes("2500"), "100ml Luxury price presents fixture price ৳2500");
    assert.ok(commerceAudit.inStockText.includes("10"), "Stocked variant presents stock count");
    assert.strictEqual(commerceAudit.qtyInitial, "1", "Initial quantity is 1");
    assert.ok(commerceAudit.canAddToCart, "Stocked variant Add to Cart button is enabled");

    // Quantity controls: increment and decrement
    await evaluateInPage(`
      (() => {
        const plusBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '+');
        plusBtn?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 200));

    const qtyAfterPlus = await evaluateInPage<string>(`
      document.querySelector('span.min-w-12')?.textContent?.trim() || ''
    `);
    assert.strictEqual(qtyAfterPlus, "2", "Quantity control increments to 2");

    await evaluateInPage(`
      (() => {
        const minusBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '-');
        minusBtn?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 200));

    const qtyAfterMinus = await evaluateInPage<string>(`
      document.querySelector('span.min-w-12')?.textContent?.trim() || ''
    `);
    assert.strictEqual(qtyAfterMinus, "1", "Quantity control decrements back to 1");

    // Add to Cart usability: click Add to Cart
    await evaluateInPage(`
      (() => {
        const addBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('ADD TO CART'));
        addBtn?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 200));

    const addedText = await evaluateInPage<string>(`
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('ADDED'))?.textContent?.trim() || ''
    `);
    assert.ok(addedText.includes("ADDED"), "Add to Cart triggers successfully and displays ADDED feedback");

    // Capture screenshot at TRUE 768x1024 viewport
    await captureScreenshot("product-detail-gallery-tablet-768x1024.png", 768, 1024);
  });

  it("13. Admin Product Edit Gallery: 1-image boundaries, 4-image boundaries, Primary badge, reorder persistence, mirror sync", async () => {
    await setViewport(1280, 800, false);

    // Perform real admin login
    await navigateAndWait(`http://localhost:${QA_PORT}/admin/login`, 1000);

    const loginRes = await evaluateInPage<{ success: boolean; message: string }>(`
      (async () => {
        const res = await fetch('/api/admin-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            email: '${ephemeralAdminEmail}',
            password: '${ephemeralAdminPassword}'
          })
        });
        return await res.json();
      })()
    `);

    assert.ok(loginRes.success, "Real admin login authentication must succeed");

    // A. Verify 1-image fixture boundaries
    await navigateAndWait(`http://localhost:${QA_PORT}/admin/products/${adminSingleImageProductId}/edit`, 1200);

    const singleAudit = await evaluateInPage<{
      galleryCount: number;
      hasPrimary: boolean;
      removeDisabled: boolean;
    }>(`
      (() => {
        const galleryCard = Array.from(document.querySelectorAll('div')).find(d => d.textContent.includes('Product Gallery (1 to 4 images)'));
        const moveUpButtons = Array.from(galleryCard?.querySelectorAll('button[aria-label="Move image up"]') || []);
        const removeButtons = Array.from(galleryCard?.querySelectorAll('button[aria-label="Remove image"]') || []);

        return {
          galleryCount: moveUpButtons.length,
          hasPrimary: Boolean(galleryCard?.textContent?.includes('Primary')),
          removeDisabled: Boolean(removeButtons[0]?.disabled)
        };
      })()
    `);

    assert.strictEqual(singleAudit.galleryCount, 1, "Single-image product edit gallery must load 1 image");
    assert.ok(singleAudit.hasPrimary, "Single image must have Primary badge");
    assert.ok(singleAudit.removeDisabled, "Remove button must be disabled for 1-image gallery fixture");

    // B. Verify 4-image fixture boundaries & reorder persistence
    await navigateAndWait(`http://localhost:${QA_PORT}/admin/products/${adminReorderProductId}/edit`, 1200);

    const editAudit = await evaluateInPage<{
      galleryCount: number;
      firstIsPrimary: boolean;
      moveUp0Disabled: boolean;
      moveDownLastDisabled: boolean;
      addDisabled: boolean;
      maxImagesText: boolean;
    }>(`
      (() => {
        const galleryCard = Array.from(document.querySelectorAll('div')).find(d => d.textContent.includes('Product Gallery (1 to 4 images)'));
        const moveUpButtons = Array.from(galleryCard?.querySelectorAll('button[aria-label="Move image up"]') || []);
        const moveDownButtons = Array.from(galleryCard?.querySelectorAll('button[aria-label="Move image down"]') || []);
        const addInput = galleryCard?.querySelector('input[type="file"]');

        return {
          galleryCount: moveUpButtons.length,
          firstIsPrimary: Boolean(galleryCard?.textContent?.includes('Primary')),
          moveUp0Disabled: Boolean(moveUpButtons[0]?.disabled),
          moveDownLastDisabled: Boolean(moveDownButtons[moveDownButtons.length - 1]?.disabled),
          addDisabled: Boolean(addInput?.disabled),
          maxImagesText: Boolean(galleryCard?.textContent?.includes('Maximum 4 images reached'))
        };
      })()
    `);

    assert.strictEqual(editAudit.galleryCount, 4, "Admin edit gallery must load all 4 images");
    assert.ok(editAudit.firstIsPrimary, "First gallery image must be labeled Primary");
    assert.ok(editAudit.moveUp0Disabled, "Move Up must be disabled at index 0");
    assert.ok(editAudit.moveDownLastDisabled, "Move Down must be disabled at the last index");
    assert.ok(editAudit.addDisabled, "Add image control must be disabled when gallery has 4 images");
    assert.ok(editAudit.maxImagesText, "Maximum 4 images reached notice must be visible");

    // Perform Move Down on first image (swap image 1 and image 2)
    await evaluateInPage(`
      (() => {
        const moveDownBtn = document.querySelector('button[aria-label="Move image down"]');
        moveDownBtn?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    // Submit form / Save
    await evaluateInPage(`
      (() => {
        const submitBtn = document.querySelector('form button[type="submit"]');
        submitBtn?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1200));

    // Reload page to verify persistence in UI
    await navigateAndWait(`http://localhost:${QA_PORT}/admin/products/${adminReorderProductId}/edit`, 1200);

    // Verify in database: position 1 is now bodycare.jpg, Product.image mirror is bodycare.jpg
    const dbRows = await dbClient.query(`
      SELECT pi.url, pi."sortOrder", p.image AS mirror
      FROM "ProductImage" pi
      JOIN "Product" p ON p.id = pi."productId"
      WHERE pi."productId" = ${adminReorderProductId}
      ORDER BY pi."sortOrder" ASC;
    `);

    assert.strictEqual(dbRows.rows.length, 4, "4 gallery rows must remain in DB");
    assert.strictEqual(dbRows.rows[0].url, "/images/categories/bodycare.jpg", "Position 1 is now bodycare.jpg after reorder");
    assert.strictEqual(dbRows.rows[1].url, "/images/categories/skincare.jpg", "Position 2 is now skincare.jpg after reorder");
    assert.strictEqual(dbRows.rows[0].mirror, "/images/categories/bodycare.jpg", "Product.image mirror must equal position 1");

    await captureScreenshot("admin-gallery-desktop-1280x800.png", 1280, 800);
  });

  it("14. Admin Metadata-Only Non-Mutation: Database row count, URLs, and sortOrder byte-equal after non-gallery edit", async () => {
    const beforeRows = await dbClient.query(`
      SELECT pi.id, pi.url, pi."sortOrder", p.image AS mirror, p.name, p.description
      FROM "ProductImage" pi
      JOIN "Product" p ON p.id = pi."productId"
      WHERE pi."productId" = ${adminMetadataProductId}
      ORDER BY pi."sortOrder" ASC;
    `);

    await navigateAndWait(`http://localhost:${QA_PORT}/admin/products/${adminMetadataProductId}/edit`, 1200);

    // Modify description field using React prototype value setter
    await evaluateInPage(`
      (() => {
        const descArea = document.querySelector('textarea[name="description"]');
        if (!descArea) throw new Error('Description textarea not found');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) {
          setter.call(descArea, 'Updated description without touching gallery');
        } else {
          descArea.value = 'Updated description without touching gallery';
        }
        descArea.dispatchEvent(new Event('input', { bubbles: true }));
        descArea.dispatchEvent(new Event('change', { bubbles: true }));
        const submitBtn = document.querySelector('form button[type="submit"]');
        submitBtn?.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1200));

    const afterRows = await dbClient.query(`
      SELECT pi.id, pi.url, pi."sortOrder", p.image AS mirror, p.name, p.description
      FROM "ProductImage" pi
      JOIN "Product" p ON p.id = pi."productId"
      WHERE pi."productId" = ${adminMetadataProductId}
      ORDER BY pi."sortOrder" ASC;
    `);

    assert.strictEqual(afterRows.rows.length, beforeRows.rows.length, "Gallery row count must not change");
    assert.strictEqual(afterRows.rows[0].url, beforeRows.rows[0].url, "Gallery URL 1 must remain identical");
    assert.strictEqual(afterRows.rows[1].url, beforeRows.rows[1].url, "Gallery URL 2 must remain identical");
    assert.strictEqual(afterRows.rows[0].sortOrder, beforeRows.rows[0].sortOrder, "Gallery sortOrder 1 must remain identical");
    assert.strictEqual(afterRows.rows[1].sortOrder, beforeRows.rows[1].sortOrder, "Gallery sortOrder 2 must remain identical");
    assert.strictEqual(afterRows.rows[0].mirror, beforeRows.rows[0].mirror, "Product.image mirror must remain identical");
    assert.strictEqual(
      afterRows.rows[0].description,
      "Updated description without touching gallery",
      "Metadata description must update"
    );
  });

  it("15. Browser Console & Page Error Gate: 0 blocking errors, 0 hydration errors across all surfaces", async () => {
    assert.strictEqual(consoleErrors.length, 0, `consoleErrors must be 0 (found ${consoleErrors.length})`);
    assert.strictEqual(uncaughtExceptions.length, 0, `uncaughtExceptions must be 0 (found ${uncaughtExceptions.length})`);
  });

  it("16. Screenshot Matrix & Evidence Packaging: Sanitized evidence, 0 secret findings, ZIP created in Downloads", async () => {
    // 1. Write sanitized JSON metadata files
    fs.writeFileSync(
      path.join(evidenceDir, "viewport-matrix.json"),
      JSON.stringify(viewportMatrix, null, 2),
      "utf8"
    );

    fs.writeFileSync(
      path.join(evidenceDir, "screenshot-matrix.json"),
      JSON.stringify(screenshotMatrix, null, 2),
      "utf8"
    );

    fs.writeFileSync(
      path.join(evidenceDir, "console-errors.json"),
      JSON.stringify({ consoleErrors, uncaughtExceptions }, null, 2),
      "utf8"
    );

    fs.writeFileSync(
      path.join(evidenceDir, "network-telemetry.json"),
      JSON.stringify(
        {
          totalRequestsCaptured: requestedUrls.length,
          galleryAssetRequests: requestedUrls.filter((u) => u.includes("images/")),
        },
        null,
        2
      ),
      "utf8"
    );

    const acceptanceSummary = {
      task: "Task 11 — Real Browser Responsive QA & Evidence",
      timestamp: new Date().toISOString(),
      qaOrigin: `http://localhost:${QA_PORT}`,
      chromeVersion: "Chrome/152.0.7977.75",
      cdpProtocol: "Native Node WebSocket",
      viewportsTested: ["375x667", "768x1024", "1280x800"],
      totalScreenshots: fs.readdirSync(evidenceDir).filter((f) => f.endsWith(".png")).length,
      horizontalOverflowTotal: viewportMatrix.filter((v) => v.horizontalOverflow).length,
      blockingConsoleErrors: consoleErrors.length,
      uncaughtExceptions: uncaughtExceptions.length,
      hydrationErrors: consoleErrors.filter((e) => /hydration/i.test(e)).length,
    };

    fs.writeFileSync(
      path.join(evidenceDir, "acceptance-summary.json"),
      JSON.stringify(acceptanceSummary, null, 2),
      "utf8"
    );

    // 2. Pre-ZIP Secret Scan
    const preScan = scanDirectoryForSecrets(evidenceDir);
    assert.strictEqual(preScan.totalFindings, 0, `ACTUAL_SECRET_FINDINGS must be 0 (found ${preScan.totalFindings})`);

    // 3. Package Evidence ZIP into Downloads
    const downloadsZipPath = path.join(os.homedir(), "Downloads", "pure-haven-storefront-ux-evidence.zip");
    if (fs.existsSync(downloadsZipPath)) {
      fs.unlinkSync(downloadsZipPath);
    }

    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${evidenceDir}\\*' -DestinationPath '${downloadsZipPath}' -Force`,
      ],
      { stdio: "pipe" }
    );

    assert.ok(fs.existsSync(downloadsZipPath), "Evidence ZIP must be created in user Downloads folder");

    // 4. Post-ZIP Secret Scan on extracted archive
    const tempExtractDir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-zip-audit-"));
    try {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -Path '${downloadsZipPath}' -DestinationPath '${tempExtractDir}' -Force`,
        ],
        { stdio: "pipe" }
      );

      const postScan = scanDirectoryForSecrets(tempExtractDir);
      assert.strictEqual(postScan.totalFindings, 0, `FINAL_ZIP_SECRET_FINDINGS must be 0 (found ${postScan.totalFindings})`);
    } finally {
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
    }
  });

  it("17. Secret Scanner Synthetic Canary & Benign In-Memory Audit", () => {
    const canaries: Array<{ label: string; snippet: string; expectedCategory: string }> = [
      {
        label: "Authorization Basic header",
        snippet: "Authorization: Basic ZmFrZTpmYWtl",
        expectedCategory: "authorization-header",
      },
      {
        label: "Authorization Custom header",
        snippet: "Authorization: Custom fake-auth-token",
        expectedCategory: "authorization-header",
      },
      {
        label: "Unquoted PASSWORD env assignment",
        snippet: "PASSWORD=fake-unquoted-password",
        expectedCategory: "env-assignment",
      },
      {
        label: "Unquoted OPENAI_API_KEY env assignment",
        snippet: "OPENAI_API_KEY=fake-api-key",
        expectedCategory: "env-assignment",
      },
      {
        label: "Unquoted ADMIN_SESSION_SECRET env assignment",
        snippet: "ADMIN_SESSION_SECRET=fake-admin-secret",
        expectedCategory: "env-assignment",
      },
      {
        label: "recoveryToken key-value",
        snippet: "recoveryToken=fake-recovery-token",
        expectedCategory: "token-hash-material",
      },
      {
        label: "passwordResetTokenHash key-value",
        snippet: "passwordResetTokenHash=fake-reset-hash",
        expectedCategory: "token-hash-material",
      },
      {
        label: "verificationToken key-value",
        snippet: "verificationToken=fake-verification-token",
        expectedCategory: "token-hash-material",
      },
      {
        label: "sessionTokenHash key-value",
        snippet: "sessionTokenHash=fake-session-hash",
        expectedCategory: "token-hash-material",
      },
      {
        label: "Cookie with session token",
        snippet: "Cookie: pure_haven_admin_session=fake-cookie",
        expectedCategory: "cookie-header",
      },
      {
        label: "Private key block",
        snippet: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
        expectedCategory: "private-key",
      },
    ];

    for (const canary of canaries) {
      const detected = detectSecretCategories(canary.snippet);
      assert.ok(
        detected.includes(canary.expectedCategory),
        `Canary '${canary.label}' must trigger category '${canary.expectedCategory}', got: ${detected.join(", ")}`
      );
    }

    // Prove benign prose is NOT flagged
    const benignProse = "Password reset verification flow passed with no secret evidence.";
    const benignDetected = detectSecretCategories(benignProse);
    assert.deepStrictEqual(
      benignDetected,
      [],
      `Benign prose must trigger 0 secret findings, got: ${benignDetected.join(", ")}`
    );
  });
});
