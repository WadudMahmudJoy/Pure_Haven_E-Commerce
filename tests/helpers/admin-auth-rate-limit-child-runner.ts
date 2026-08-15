import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

// ---------------------------------------------------------------------------
// ESM-safe path resolution
// ---------------------------------------------------------------------------
const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const projectRoot = path.resolve(currentDir, "../..");

// ---------------------------------------------------------------------------
// Pre-import guardrails
// ---------------------------------------------------------------------------
const currentCwd = process.cwd();
const normalizedCwd = path.resolve(currentCwd);
const normalizedProjectRoot = path.resolve(projectRoot);
const normalizedTmpDir = path.resolve(os.tmpdir());

// 1. process.cwd() must NOT be the project root
if (normalizedCwd === normalizedProjectRoot) {
  console.error("GUARDRAIL FAILURE: child process cwd is equal to projectRoot");
  process.exit(99);
}

// 2. process.cwd() must be inside OS temp directory
if (!normalizedCwd.startsWith(normalizedTmpDir)) {
  console.error("GUARDRAIL FAILURE: child process cwd is not in OS temp directory");
  process.exit(99);
}

// 3. Basename/path must contain the test prefix
if (!normalizedCwd.includes("ph-admin-rate-limit-test-")) {
  console.error("GUARDRAIL FAILURE: child process cwd does not contain test prefix ph-admin-rate-limit-test-");
  process.exit(99);
}

// 4. Temporary auth path must NOT equal real project auth path
const tempAuthPath = path.join(currentCwd, "data", "admin-auth.json");
const realAuthPath = path.join(projectRoot, "data", "admin-auth.json");
if (path.resolve(tempAuthPath) === path.resolve(realAuthPath)) {
  console.error("GUARDRAIL FAILURE: temp auth path matches real project auth path");
  process.exit(99);
}

// 5. Temporary auth path must resolve strictly underneath child cwd
const normalizedTempAuthPath = path.resolve(tempAuthPath);
if (!normalizedTempAuthPath.startsWith(normalizedCwd)) {
  console.error("GUARDRAIL FAILURE: temp auth path escapes child cwd");
  process.exit(99);
}

// ---------------------------------------------------------------------------
// Deterministic Scrypt Instrumentation
// Intercepts crypto.scrypt before app/api/admin-auth/route.ts is imported
// ---------------------------------------------------------------------------
let totalScryptCalls = 0;
const require = createRequire(import.meta.url);
const cjsCrypto = require("node:crypto");
const originalScrypt = cjsCrypto.scrypt;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
cjsCrypto.scrypt = function (this: unknown, ...args: any[]) {
  totalScryptCalls++;
  return originalScrypt.apply(this, args);
};

// Propagate CJS mutation to ESM named imports (e.g. import { scrypt } from "crypto")
syncBuiltinESMExports();

// ---------------------------------------------------------------------------
// Synthetic Auth Credential Setup
// ---------------------------------------------------------------------------
const scrypt = promisify(scryptCallback);

async function hashSecret(secret: string, salt = randomBytes(16).toString("hex")) {
  const key = (await scrypt(secret, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString("hex")}`;
}

export const SYNTHETIC_ADMIN_EMAIL = "synthetic-admin@test.invalid";
export const SYNTHETIC_ADMIN_PASSWORD = "CorrectSyntheticPassword123!";
export const SYNTHETIC_RECOVERY_CODE = "SYNTHETIC-RECOVERY-999";

let initialAuthFileContent = "";

async function ensureSyntheticAuthFile() {
  fs.mkdirSync(path.dirname(tempAuthPath), { recursive: true });
  const passwordHash = await hashSecret(SYNTHETIC_ADMIN_PASSWORD);
  const recoveryCodeHash = await hashSecret(SYNTHETIC_RECOVERY_CODE);

  initialAuthFileContent = JSON.stringify(
    {
      email: SYNTHETIC_ADMIN_EMAIL,
      passwordHash,
      recoveryEmail: "recovery@test.invalid",
      recoveryPhone: "01700000000",
      recoveryCodeHash,
    },
    null,
    2
  );

  fs.writeFileSync(tempAuthPath, initialAuthFileContent, "utf8");
}

await ensureSyntheticAuthFile();

// Reset counter so setup hashing does not inflate test request metrics
totalScryptCalls = 0;

// ---------------------------------------------------------------------------
// Dynamic import of the production route AFTER scrypt interception & guardrails
// ---------------------------------------------------------------------------
const { POST, PATCH } = await import("../../app/api/admin-auth/route");

// ---------------------------------------------------------------------------
// Action execution types
// ---------------------------------------------------------------------------
export type RequestStep = {
  method: "POST" | "PATCH";
  body: Record<string, unknown>;
  clientIp?: string;
};

export type ChildPayload = {
  scenario: string;
  steps: RequestStep[];
};

export type StepResult = {
  stepIndex: number;
  status: number;
  success: boolean;
  message: string;
  retryAfter: string | null;
  hasSessionCookie: boolean;
  scryptCallsBefore: number;
  scryptCallsAfter: number;
  scryptCallDelta: number;
  authFileUnchanged: boolean;
};

async function main() {
  const rawArg = process.argv[2];
  if (!rawArg) {
    console.error("No input payload provided to child runner");
    process.exit(1);
  }

  const payload = JSON.parse(rawArg) as ChildPayload;
  const results: StepResult[] = [];

  for (let i = 0; i < payload.steps.length; i++) {
    const step = payload.steps[i];
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (step.clientIp) {
      headers["x-forwarded-for"] = step.clientIp;
      headers["x-real-ip"] = step.clientIp;
    }

    const req = new Request("http://localhost:3000/api/admin-auth", {
      method: step.method,
      headers,
      body: JSON.stringify(step.body),
    });

    const callsBefore = totalScryptCalls;

    let res: Response;
    if (step.method === "POST") {
      res = await POST(req);
    } else {
      res = await PATCH(req);
    }

    const callsAfter = totalScryptCalls;
    const callDelta = callsAfter - callsBefore;

    const status = res.status;
    const retryAfter = res.headers.get("retry-after");
    const setCookie = res.headers.get("set-cookie") || "";
    const hasSessionCookie = setCookie.includes("pure_haven_admin_session=");

    let data: { success?: boolean; message?: string } | null = null;
    try {
      data = await res.json();
    } catch {
      // Non-JSON response
    }

    let authFileUnchanged = true;
    try {
      const currentContent = fs.readFileSync(tempAuthPath, "utf8");
      authFileUnchanged = currentContent === initialAuthFileContent;
    } catch {
      authFileUnchanged = false;
    }

    results.push({
      stepIndex: i,
      status,
      success: data?.success ?? false,
      message: data?.message ?? "",
      retryAfter,
      hasSessionCookie,
      scryptCallsBefore: callsBefore,
      scryptCallsAfter: callsAfter,
      scryptCallDelta: callDelta,
      authFileUnchanged,
    });
  }

  console.log(JSON.stringify({ scenario: payload.scenario, results }));
}

await main();
