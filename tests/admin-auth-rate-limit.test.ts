/**
 * RED regression test — Admin auth rate-limiting and brute-force protection
 *
 * Security requirements:
 *   - Per-client Admin Login: max 5 failed attempts per 15-minute window per client key
 *   - Per-client Admin Recovery: max 3 failed attempts per 15-minute window per client key
 *   - Process-global Login CPU Safety: max 60 attempts per 60-second window process-wide
 *   - Process-global Recovery CPU Safety: max 30 attempts per 60-second window process-wide
 *   - Threshold crossing must return HTTP 429 with Retry-After header
 *   - Response must be generic: { success: false, message: "Too many attempts. Please try again later." }
 *   - Rate-limited requests must be rejected BEFORE expensive scrypt verification (scryptCallDelta === 0)
 *   - Successful login/reset must clear PER-CLIENT failure bucket (refreshing per-client quota)
 *   - Successful login/reset must NOT clear PROCESS-GLOBAL CPU safety bucket
 *   - Isolated per-client buckets must not interfere
 *
 * SAFETY GUARANTEES:
 *   - Runs exclusively in isolated child processes with unique OS temp directories.
 *   - Real data/admin-auth.json, .env, and .env.local are never read or modified.
 *   - Synthetic credentials only.
 *   - Deterministic scrypt call counting via syncBuiltinESMExports interception (NO timing measurements).
 *
 * Run with:
 *   npx tsx --test tests/admin-auth-rate-limit.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// ESM-safe paths
// ---------------------------------------------------------------------------
const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const projectRoot = path.resolve(currentDir, "..");
const tsxCli = path.resolve(projectRoot, "node_modules/tsx/dist/cli.mjs");
const tsconfigPath = path.resolve(projectRoot, "tsconfig.json");
const childRunnerPath = path.resolve(
  projectRoot,
  "tests/helpers/admin-auth-rate-limit-child-runner.ts"
);

// ---------------------------------------------------------------------------
// Final Named Policy Constants for Task 4
// ---------------------------------------------------------------------------
export const ADMIN_LOGIN_MAX_ATTEMPTS_PER_CLIENT = 5;
export const ADMIN_LOGIN_WINDOW_SECONDS = 900; // 15 min

export const ADMIN_RECOVERY_MAX_ATTEMPTS_PER_CLIENT = 3;
export const ADMIN_RECOVERY_WINDOW_SECONDS = 900; // 15 min

export const ADMIN_LOGIN_GLOBAL_MAX_ATTEMPTS = 60;
export const ADMIN_LOGIN_GLOBAL_WINDOW_SECONDS = 60; // 60s

export const ADMIN_RECOVERY_GLOBAL_MAX_ATTEMPTS = 30;
export const ADMIN_RECOVERY_GLOBAL_WINDOW_SECONDS = 60; // 60s

const SYNTHETIC_ADMIN_EMAIL = "synthetic-admin@test.invalid";
const SYNTHETIC_ADMIN_PASSWORD = "CorrectSyntheticPassword123!";
const SYNTHETIC_RECOVERY_CODE = "SYNTHETIC-RECOVERY-999";

type RequestStep = {
  method: "POST" | "PATCH";
  body: Record<string, unknown>;
  clientIp?: string;
};

type StepResult = {
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

type ChildRunnerOutput = {
  scenario: string;
  results: StepResult[];
};

function runChildScenario(
  scenario: string,
  steps: RequestStep[],
  options?: { omitRecoveryCodeHash?: boolean }
): StepResult[] {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "ph-admin-rate-limit-test-")
  );

  try {
    const childEnv = {
      ...process.env,
      ADMIN_SESSION_SECRET: "test-rate-limit-secret-key-12345678901234567890",
    };

    const res = spawnSync(
      process.execPath,
      [
        tsxCli,
        "--tsconfig",
        tsconfigPath,
        childRunnerPath,
        JSON.stringify({
          scenario,
          steps,
          omitRecoveryCodeHash: options?.omitRecoveryCodeHash,
        }),
      ],
      {
        cwd: tmpDir,
        env: childEnv,
        encoding: "utf8",
        timeout: 60000,
      }
    );

    if (res.error) {
      throw new Error(`Child process failed: ${res.error.message}`);
    }

    if (res.status !== 0) {
      throw new Error(
        `Child runner failed with code ${String(res.status)}:\nStderr: ${res.stderr}\nStdout: ${res.stdout}`
      );
    }

    const parsed = JSON.parse(res.stdout.trim()) as ChildRunnerOutput;
    return parsed.results;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// ADMIN LOGIN ROUTE TESTS
// ---------------------------------------------------------------------------

test("LOGIN CASE 1 — Legitimate attempts below threshold reach normal login logic and execute scrypt", () => {
  const steps: RequestStep[] = [
    {
      method: "POST",
      clientIp: "198.51.100.10",
      body: { email: SYNTHETIC_ADMIN_EMAIL, password: "WrongPassword1" },
    },
    {
      method: "POST",
      clientIp: "198.51.100.10",
      body: { email: SYNTHETIC_ADMIN_EMAIL, password: "WrongPassword2" },
    },
    {
      method: "POST",
      clientIp: "198.51.100.10",
      body: { email: SYNTHETIC_ADMIN_EMAIL, password: "WrongPassword3" },
    },
  ];

  const results = runChildScenario("login-below-threshold", steps);

  assert.strictEqual(results.length, 3);
  for (const r of results) {
    assert.strictEqual(
      r.status,
      401,
      `Expected HTTP 401 for attempt under rate limit, got HTTP ${String(r.status)}`
    );
    assert.strictEqual(r.hasSessionCookie, false);
    assert.ok(
      r.scryptCallDelta > 0,
      "Expected scrypt password verification to execute for normal under-threshold attempt"
    );
  }
});

test("LOGIN CASE 2 — Threshold crossing returns HTTP 429 with Retry-After and generic message", () => {
  const steps: RequestStep[] = [];
  const clientIp = "198.51.100.20";

  // 5 failed attempts (reaches per-client limit)
  for (let i = 0; i < ADMIN_LOGIN_MAX_ATTEMPTS_PER_CLIENT; i++) {
    steps.push({
      method: "POST",
      clientIp,
      body: { email: SYNTHETIC_ADMIN_EMAIL, password: `WrongPassword-${String(i)}` },
    });
  }

  // 6th attempt (exceeds limit)
  steps.push({
    method: "POST",
    clientIp,
    body: { email: SYNTHETIC_ADMIN_EMAIL, password: "WrongPassword-Excess" },
  });

  const results = runChildScenario("login-threshold-crossing", steps);
  const excessResult = results[ADMIN_LOGIN_MAX_ATTEMPTS_PER_CLIENT];

  assert.strictEqual(
    excessResult.status,
    429,
    `Vulnerability confirmed: request #6 after 5 failures was not rate-limited (got HTTP ${String(excessResult.status)} instead of 429)`
  );
  assert.strictEqual(
    excessResult.message,
    "Too many attempts. Please try again later.",
    "Expected generic rate limit message without account enumeration"
  );
  assert.ok(
    excessResult.retryAfter !== null && Number(excessResult.retryAfter) > 0,
    "Expected positive integer Retry-After header on 429 response"
  );
});

test("LOGIN CASE 3 — Rate-limited request is rejected BEFORE password scrypt verification (scryptCallDelta === 0)", () => {
  const steps: RequestStep[] = [];
  const clientIp = "198.51.100.30";

  // 5 failed attempts
  for (let i = 0; i < ADMIN_LOGIN_MAX_ATTEMPTS_PER_CLIENT; i++) {
    steps.push({
      method: "POST",
      clientIp,
      body: { email: SYNTHETIC_ADMIN_EMAIL, password: `WrongPassword-${String(i)}` },
    });
  }

  // 6th attempt supplies the CORRECT password.
  // Must return HTTP 429 AND scrypt must NOT be called (scryptCallDelta === 0).
  steps.push({
    method: "POST",
    clientIp,
    body: { email: SYNTHETIC_ADMIN_EMAIL, password: SYNTHETIC_ADMIN_PASSWORD },
  });

  const results = runChildScenario("login-pre-verification-rejection", steps);
  const attempt6 = results[ADMIN_LOGIN_MAX_ATTEMPTS_PER_CLIENT];

  assert.strictEqual(
    attempt6.status,
    429,
    `Vulnerability confirmed: request #6 was not rate-limited (got HTTP ${String(attempt6.status)}). Must reject with 429 before password verification.`
  );
  assert.strictEqual(
    attempt6.hasSessionCookie,
    false,
    "Rate-limited request must never issue a session cookie"
  );
  assert.strictEqual(
    attempt6.scryptCallDelta,
    0,
    `Vulnerability confirmed: scrypt was called ${String(attempt6.scryptCallDelta)} time(s) on a rate-limited request! Rate limiter must reject before scrypt.`
  );
});

test("LOGIN CASE 4 — Successful login resets the client's failure bucket and refreshes quota", () => {
  const clientIp = "198.51.100.40";
  const steps: RequestStep[] = [
    // 1. 4 wrong password attempts
    { method: "POST", clientIp, body: { email: SYNTHETIC_ADMIN_EMAIL, password: "Wrong1" } },
    { method: "POST", clientIp, body: { email: SYNTHETIC_ADMIN_EMAIL, password: "Wrong2" } },
    { method: "POST", clientIp, body: { email: SYNTHETIC_ADMIN_EMAIL, password: "Wrong3" } },
    { method: "POST", clientIp, body: { email: SYNTHETIC_ADMIN_EMAIL, password: "Wrong4" } },
    // 2. 1 correct attempt (attempt #5 inside quota) -> succeeds and resets bucket
    { method: "POST", clientIp, body: { email: SYNTHETIC_ADMIN_EMAIL, password: SYNTHETIC_ADMIN_PASSWORD } },
    // 3. 5 new wrong password attempts post-success (must all be allowed to reach auth logic -> 401)
    { method: "POST", clientIp, body: { email: SYNTHETIC_ADMIN_EMAIL, password: "PostSuccessWrong1" } },
    { method: "POST", clientIp, body: { email: SYNTHETIC_ADMIN_EMAIL, password: "PostSuccessWrong2" } },
    { method: "POST", clientIp, body: { email: SYNTHETIC_ADMIN_EMAIL, password: "PostSuccessWrong3" } },
    { method: "POST", clientIp, body: { email: SYNTHETIC_ADMIN_EMAIL, password: "PostSuccessWrong4" } },
    { method: "POST", clientIp, body: { email: SYNTHETIC_ADMIN_EMAIL, password: "PostSuccessWrong5" } },
    // 4. 6th post-success attempt -> must be rate-limited (HTTP 429)
    { method: "POST", clientIp, body: { email: SYNTHETIC_ADMIN_EMAIL, password: "PostSuccessWrong6-Excess" } },
  ];

  const results = runChildScenario("login-reset-on-success", steps);

  // First 4 failed attempts: 401
  for (let i = 0; i < 4; i++) {
    assert.strictEqual(results[i].status, 401);
  }

  // Attempt #5: valid login succeeds
  assert.strictEqual(results[4].status, 200);
  assert.strictEqual(results[4].hasSessionCookie, true);

  // Next 5 attempts: fresh quota allowed, each reaches auth -> 401
  for (let i = 5; i < 10; i++) {
    assert.strictEqual(
      results[i].status,
      401,
      `Expected post-reset attempt #${String(i - 4)} to reach auth logic (got HTTP ${String(results[i].status)})`
    );
    assert.ok(results[i].scryptCallDelta > 0, "Expected scrypt verification to execute");
  }

  // Attempt #11 (6th post-success): over quota -> 429
  const excessResult = results[10];
  assert.strictEqual(
    excessResult.status,
    429,
    `Vulnerability confirmed: 6th post-reset attempt was not rate-limited (got HTTP ${String(excessResult.status)} instead of 429)`
  );
  assert.ok(
    excessResult.retryAfter !== null && Number(excessResult.retryAfter) > 0,
    "Expected positive integer Retry-After header"
  );
  assert.strictEqual(
    excessResult.scryptCallDelta,
    0,
    "Rate-limited request must reject before scrypt"
  );
});

test("LOGIN CASE 5 — Different client limiter keys do not share the same per-client bucket", () => {
  const steps: RequestStep[] = [];
  const clientIpA = "198.51.100.51";
  const clientIpB = "198.51.100.52";

  // Exhaust client A (5 failures)
  for (let i = 0; i < ADMIN_LOGIN_MAX_ATTEMPTS_PER_CLIENT; i++) {
    steps.push({
      method: "POST",
      clientIp: clientIpA,
      body: { email: SYNTHETIC_ADMIN_EMAIL, password: `Wrong-${String(i)}` },
    });
  }

  // Client B makes 1 attempt — must not be affected by client A
  steps.push({
    method: "POST",
    clientIp: clientIpB,
    body: { email: SYNTHETIC_ADMIN_EMAIL, password: "WrongForB" },
  });

  const results = runChildScenario("login-client-isolation", steps);
  const clientBResult = results[results.length - 1];

  assert.strictEqual(
    clientBResult.status,
    401,
    `Expected client B to receive normal HTTP 401, but got HTTP ${String(clientBResult.status)}`
  );
});

// ---------------------------------------------------------------------------
// ADMIN RECOVERY ROUTE TESTS
// ---------------------------------------------------------------------------

test("RECOVERY CASE 1 — Legitimate attempts below threshold reach recovery verification and execute scrypt", () => {
  const steps: RequestStep[] = [
    {
      method: "PATCH",
      clientIp: "198.51.100.60",
      body: {
        email: SYNTHETIC_ADMIN_EMAIL,
        recoveryCode: "WRONG-CODE-1",
        newPassword: "NewValidPassword123!",
      },
    },
    {
      method: "PATCH",
      clientIp: "198.51.100.60",
      body: {
        email: SYNTHETIC_ADMIN_EMAIL,
        recoveryCode: "WRONG-CODE-2",
        newPassword: "NewValidPassword123!",
      },
    },
  ];

  const results = runChildScenario("recovery-below-threshold", steps);
  assert.strictEqual(results.length, 2);
  for (const r of results) {
    assert.strictEqual(
      r.status,
      400,
      `Expected HTTP 400 (Recovery code is wrong) for attempt under rate limit, got HTTP ${String(r.status)}`
    );
    assert.ok(
      r.scryptCallDelta > 0,
      "Expected scrypt recovery code verification to execute for normal under-threshold attempt"
    );
  }
});

test("RECOVERY CASE 2 — Threshold crossing returns HTTP 429 with Retry-After and generic message", () => {
  const steps: RequestStep[] = [];
  const clientIp = "198.51.100.70";

  // 3 failed attempts (reaches recovery limit)
  for (let i = 0; i < ADMIN_RECOVERY_MAX_ATTEMPTS_PER_CLIENT; i++) {
    steps.push({
      method: "PATCH",
      clientIp,
      body: {
        email: SYNTHETIC_ADMIN_EMAIL,
        recoveryCode: `WRONG-CODE-${String(i)}`,
        newPassword: "NewValidPassword123!",
      },
    });
  }

  // 4th attempt (exceeds limit)
  steps.push({
    method: "PATCH",
    clientIp,
    body: {
      email: SYNTHETIC_ADMIN_EMAIL,
      recoveryCode: "WRONG-CODE-EXCESS",
      newPassword: "NewValidPassword123!",
    },
  });

  const results = runChildScenario("recovery-threshold-crossing", steps);
  const excessResult = results[ADMIN_RECOVERY_MAX_ATTEMPTS_PER_CLIENT];

  assert.strictEqual(
    excessResult.status,
    429,
    `Vulnerability confirmed: recovery attempt #4 was not rate-limited (got HTTP ${String(excessResult.status)} instead of 429)`
  );
  assert.strictEqual(
    excessResult.message,
    "Too many attempts. Please try again later."
  );
  assert.ok(
    excessResult.retryAfter !== null && Number(excessResult.retryAfter) > 0,
    "Expected positive integer Retry-After header on 429 response"
  );
});

test("RECOVERY CASE 3 — Rate-limit denial occurs before expensive recovery-code scrypt verification (scryptCallDelta === 0)", () => {
  const steps: RequestStep[] = [];
  const clientIp = "198.51.100.80";

  // 3 failed attempts
  for (let i = 0; i < ADMIN_RECOVERY_MAX_ATTEMPTS_PER_CLIENT; i++) {
    steps.push({
      method: "PATCH",
      clientIp,
      body: {
        email: SYNTHETIC_ADMIN_EMAIL,
        recoveryCode: `WRONG-CODE-${String(i)}`,
        newPassword: "NewValidPassword123!",
      },
    });
  }

  // 4th attempt supplies the CORRECT recovery code.
  // Must STILL be rejected with HTTP 429 AND scrypt must NOT be called.
  steps.push({
    method: "PATCH",
    clientIp,
    body: {
      email: SYNTHETIC_ADMIN_EMAIL,
      recoveryCode: SYNTHETIC_RECOVERY_CODE,
      newPassword: "NewValidPassword123!",
    },
  });

  const results = runChildScenario("recovery-pre-verification-rejection", steps);
  const attempt4 = results[ADMIN_RECOVERY_MAX_ATTEMPTS_PER_CLIENT];

  assert.strictEqual(
    attempt4.status,
    429,
    `Vulnerability confirmed: recovery attempt #4 was not rate-limited (got HTTP ${String(attempt4.status)}). Must reject with 429 before recovery verification.`
  );
  assert.strictEqual(
    attempt4.scryptCallDelta,
    0,
    `Vulnerability confirmed: scrypt was called ${String(attempt4.scryptCallDelta)} time(s) on a rate-limited recovery request! Rate limiter must reject before scrypt.`
  );
  assert.strictEqual(
    attempt4.authFileUnchanged,
    true,
    "Credential store must not be modified by rate-limited recovery attempt"
  );
});

test("RECOVERY CASE 4 — Successful recovery/reset clears the failure bucket and refreshes quota", () => {
  const clientIp = "198.51.100.90";
  const newPass = "NewValidPassword123!";
  const steps: RequestStep[] = [
    // 1. 2 wrong recovery-code attempts
    {
      method: "PATCH",
      clientIp,
      body: {
        email: SYNTHETIC_ADMIN_EMAIL,
        recoveryCode: "WRONG-1",
        newPassword: newPass,
      },
    },
    {
      method: "PATCH",
      clientIp,
      body: {
        email: SYNTHETIC_ADMIN_EMAIL,
        recoveryCode: "WRONG-2",
        newPassword: newPass,
      },
    },
    // 2. 1 correct recovery attempt (attempt #3 inside quota) -> succeeds and resets bucket
    {
      method: "PATCH",
      clientIp,
      body: {
        email: SYNTHETIC_ADMIN_EMAIL,
        recoveryCode: SYNTHETIC_RECOVERY_CODE,
        newPassword: newPass,
      },
    },
    // 3. 3 new wrong recovery-code attempts post-success (must all reach verification -> 400)
    {
      method: "PATCH",
      clientIp,
      body: {
        email: SYNTHETIC_ADMIN_EMAIL,
        recoveryCode: "WRONG-POST-1",
        newPassword: "AnotherPassword123!",
      },
    },
    {
      method: "PATCH",
      clientIp,
      body: {
        email: SYNTHETIC_ADMIN_EMAIL,
        recoveryCode: "WRONG-POST-2",
        newPassword: "AnotherPassword123!",
      },
    },
    {
      method: "PATCH",
      clientIp,
      body: {
        email: SYNTHETIC_ADMIN_EMAIL,
        recoveryCode: "WRONG-POST-3",
        newPassword: "AnotherPassword123!",
      },
    },
    // 4. 4th post-success attempt -> must be rate-limited (HTTP 429)
    {
      method: "PATCH",
      clientIp,
      body: {
        email: SYNTHETIC_ADMIN_EMAIL,
        recoveryCode: "WRONG-POST-4-Excess",
        newPassword: "AnotherPassword123!",
      },
    },
  ];

  const results = runChildScenario("recovery-reset-on-success", steps);

  // First 2 failed attempts: 400
  assert.strictEqual(results[0].status, 400);
  assert.strictEqual(results[1].status, 400);

  // Attempt #3: valid recovery succeeds
  assert.strictEqual(results[2].status, 200);
  assert.strictEqual(results[2].hasSessionCookie, true);

  // Next 3 attempts: fresh quota allowed -> 400
  for (let i = 3; i < 6; i++) {
    assert.strictEqual(
      results[i].status,
      400,
      `Expected post-reset recovery attempt #${String(i - 2)} to reach verification (got HTTP ${String(results[i].status)})`
    );
    assert.ok(results[i].scryptCallDelta > 0, "Expected scrypt verification to execute");
  }

  // Attempt #7 (4th post-success): over quota -> 429
  const excessResult = results[6];
  assert.strictEqual(
    excessResult.status,
    429,
    `Vulnerability confirmed: 4th post-reset recovery attempt was not rate-limited (got HTTP ${String(excessResult.status)} instead of 429)`
  );
  assert.ok(
    excessResult.retryAfter !== null && Number(excessResult.retryAfter) > 0,
    "Expected positive integer Retry-After header"
  );
  assert.strictEqual(
    excessResult.scryptCallDelta,
    0,
    "Rate-limited request must reject before scrypt"
  );
});

// ---------------------------------------------------------------------------
// PROCESS-WIDE GLOBAL ADMIN SAFETY BUCKET TESTS
// ---------------------------------------------------------------------------

test("GLOBAL CASE 1 — Rotating synthetic client identities triggers global login CPU safety limit (60/60s) with pre-scrypt denial", () => {
  const steps: RequestStep[] = [];

  // Generate 60 requests with distinct synthetic client IPs up to global limit
  for (let i = 1; i <= ADMIN_LOGIN_GLOBAL_MAX_ATTEMPTS; i++) {
    steps.push({
      method: "POST",
      clientIp: `198.51.100.${String(i)}`,
      body: { email: SYNTHETIC_ADMIN_EMAIL, password: `RotatingWrong-${String(i)}` },
    });
  }

  // Attempt #61 with a fresh unseen client IP — must be blocked by the global safety bucket before scrypt
  steps.push({
    method: "POST",
    clientIp: "198.51.100.250",
    body: { email: SYNTHETIC_ADMIN_EMAIL, password: SYNTHETIC_ADMIN_PASSWORD },
  });

  const results = runChildScenario("global-login-safety-bucket", steps);
  const excessResult = results[ADMIN_LOGIN_GLOBAL_MAX_ATTEMPTS];

  assert.strictEqual(
    excessResult.status,
    429,
    `Vulnerability confirmed: global admin login limit (${String(ADMIN_LOGIN_GLOBAL_MAX_ATTEMPTS)}) was not enforced for rotating IPs (got HTTP ${String(excessResult.status)} instead of 429)`
  );
  assert.strictEqual(
    excessResult.message,
    "Too many attempts. Please try again later."
  );
  assert.strictEqual(
    excessResult.scryptCallDelta,
    0,
    `Vulnerability confirmed: scrypt was called on global over-limit request! Must reject before scrypt.`
  );
});

test("GLOBAL CASE 2 — Rotating synthetic client identities triggers global recovery CPU safety limit (30/60s) with pre-scrypt denial", () => {
  const steps: RequestStep[] = [];

  // Generate 30 requests with distinct synthetic client IPs up to global limit
  for (let i = 1; i <= ADMIN_RECOVERY_GLOBAL_MAX_ATTEMPTS; i++) {
    steps.push({
      method: "PATCH",
      clientIp: `198.51.100.${String(i)}`,
      body: {
        email: SYNTHETIC_ADMIN_EMAIL,
        recoveryCode: `WRONG-ROTATING-${String(i)}`,
        newPassword: "NewValidPassword123!",
      },
    });
  }

  // Attempt #31 with a fresh unseen client IP — must be blocked by global recovery bucket before scrypt
  steps.push({
    method: "PATCH",
    clientIp: "198.51.100.251",
    body: {
      email: SYNTHETIC_ADMIN_EMAIL,
      recoveryCode: SYNTHETIC_RECOVERY_CODE,
      newPassword: "NewValidPassword123!",
    },
  });

  const results = runChildScenario("global-recovery-safety-bucket", steps);
  const excessResult = results[ADMIN_RECOVERY_GLOBAL_MAX_ATTEMPTS];

  assert.strictEqual(
    excessResult.status,
    429,
    `Vulnerability confirmed: global admin recovery limit (${String(ADMIN_RECOVERY_GLOBAL_MAX_ATTEMPTS)}) was not enforced for rotating IPs (got HTTP ${String(excessResult.status)} instead of 429)`
  );
  assert.strictEqual(
    excessResult.message,
    "Too many attempts. Please try again later."
  );
  assert.strictEqual(
    excessResult.scryptCallDelta,
    0,
    `Vulnerability confirmed: scrypt was called on global over-limit recovery request! Must reject before scrypt.`
  );
});

test("GLOBAL CASE 3 — Legitimate successful login does NOT reset the process-global CPU safety bucket", () => {
  const steps: RequestStep[] = [];

  // 1. 59 wrong login attempts from 59 distinct synthetic client identities
  for (let i = 1; i <= ADMIN_LOGIN_GLOBAL_MAX_ATTEMPTS - 1; i++) {
    steps.push({
      method: "POST",
      clientIp: `198.51.100.${String(i)}`,
      body: { email: SYNTHETIC_ADMIN_EMAIL, password: `Wrong-${String(i)}` },
    });
  }

  // 2. Attempt #60 from a fresh client identity uses the CORRECT password -> 200
  steps.push({
    method: "POST",
    clientIp: "198.51.100.60",
    body: { email: SYNTHETIC_ADMIN_EMAIL, password: SYNTHETIC_ADMIN_PASSWORD },
  });

  // 3. Attempt #61 from another fresh client identity -> MUST be blocked by global limit (429)
  steps.push({
    method: "POST",
    clientIp: "198.51.100.61",
    body: { email: SYNTHETIC_ADMIN_EMAIL, password: "Wrong-PostGlobal" },
  });

  const results = runChildScenario("global-login-no-reset-on-success", steps);

  // Attempt #60 must succeed
  const attempt60 = results[ADMIN_LOGIN_GLOBAL_MAX_ATTEMPTS - 1];
  assert.strictEqual(
    attempt60.status,
    200,
    `Expected attempt #60 to succeed with valid password, got HTTP ${String(attempt60.status)}`
  );
  assert.strictEqual(attempt60.hasSessionCookie, true);
  assert.ok(attempt60.scryptCallDelta > 0);

  // Attempt #61 must be rejected by the global limit (proving success did not reset global budget)
  const attempt61 = results[ADMIN_LOGIN_GLOBAL_MAX_ATTEMPTS];
  assert.strictEqual(
    attempt61.status,
    429,
    `Vulnerability confirmed: global CPU safety bucket was cleared by a successful login! Attempt #61 got HTTP ${String(attempt61.status)} instead of 429.`
  );
  assert.ok(
    attempt61.retryAfter !== null && Number(attempt61.retryAfter) > 0,
    "Expected positive integer Retry-After header"
  );
  assert.strictEqual(
    attempt61.scryptCallDelta,
    0,
    "Rate-limited request must reject before scrypt"
  );
});

test("GLOBAL CASE 4 — Legitimate successful recovery does NOT reset the process-global recovery CPU safety bucket", () => {
  const steps: RequestStep[] = [];
  const newPass = "NewValidPassword123!";

  // 1. 29 wrong recovery attempts from 29 distinct synthetic client identities
  for (let i = 1; i <= ADMIN_RECOVERY_GLOBAL_MAX_ATTEMPTS - 1; i++) {
    steps.push({
      method: "PATCH",
      clientIp: `198.51.100.${String(i)}`,
      body: {
        email: SYNTHETIC_ADMIN_EMAIL,
        recoveryCode: `WRONG-ROTATING-${String(i)}`,
        newPassword: newPass,
      },
    });
  }

  // 2. Attempt #30 from a fresh client identity uses CORRECT recovery code -> 200
  steps.push({
    method: "PATCH",
    clientIp: "198.51.100.30",
    body: {
      email: SYNTHETIC_ADMIN_EMAIL,
      recoveryCode: SYNTHETIC_RECOVERY_CODE,
      newPassword: newPass,
    },
  });

  // 3. Attempt #31 from another fresh client identity -> MUST be blocked by global limit (429)
  steps.push({
    method: "PATCH",
    clientIp: "198.51.100.31",
    body: {
      email: SYNTHETIC_ADMIN_EMAIL,
      recoveryCode: "WRONG-ROTATING-EXCESS",
      newPassword: "AnotherPassword123!",
    },
  });

  const results = runChildScenario("global-recovery-no-reset-on-success", steps);

  // Attempt #30 must succeed
  const attempt30 = results[ADMIN_RECOVERY_GLOBAL_MAX_ATTEMPTS - 1];
  assert.strictEqual(
    attempt30.status,
    200,
    `Expected attempt #30 to succeed with valid recovery code, got HTTP ${String(attempt30.status)}`
  );
  assert.strictEqual(attempt30.hasSessionCookie, true);
  assert.ok(attempt30.scryptCallDelta > 0);

  // Attempt #31 must be rejected by the global limit (proving success did not reset global budget)
  const attempt31 = results[ADMIN_RECOVERY_GLOBAL_MAX_ATTEMPTS];
  assert.strictEqual(
    attempt31.status,
    429,
    `Vulnerability confirmed: global recovery CPU safety bucket was cleared by a successful recovery! Attempt #31 got HTTP ${String(attempt31.status)} instead of 429.`
  );
  assert.ok(
    attempt31.retryAfter !== null && Number(attempt31.retryAfter) > 0,
    "Expected positive integer Retry-After header"
  );
  assert.strictEqual(
    attempt31.scryptCallDelta,
    0,
    "Rate-limited request must reject before scrypt"
  );
});

test("GLOBAL CASE 5 — Cheap wrong-email recovery requests must NOT consume the global recovery CPU-safety bucket", () => {
  const steps: RequestStep[] = [];
  const wrongEmail = "wrong-admin@test.invalid";

  // 1. Send 30 PATCH requests from distinct synthetic client identities with mismatched email
  for (let i = 1; i <= ADMIN_RECOVERY_GLOBAL_MAX_ATTEMPTS; i++) {
    steps.push({
      method: "PATCH",
      clientIp: `198.51.100.${String(i)}`,
      body: {
        email: wrongEmail,
        recoveryCode: `WRONG-CODE-${String(i)}`,
        newPassword: "NewValidPassword123!",
      },
    });
  }

  // 2. Request #31 from a fresh client identity uses the CORRECT admin email, wrong recovery code
  steps.push({
    method: "PATCH",
    clientIp: "198.51.100.252",
    body: {
      email: SYNTHETIC_ADMIN_EMAIL,
      recoveryCode: "WRONG-CODE-31",
      newPassword: "NewValidPassword123!",
    },
  });

  const results = runChildScenario("global-recovery-cheap-requests-no-drain", steps);

  // Assert the 30 cheap wrong-email requests returned 400 without executing scrypt
  for (let i = 0; i < ADMIN_RECOVERY_GLOBAL_MAX_ATTEMPTS; i++) {
    assert.strictEqual(
      results[i].status,
      400,
      `Expected HTTP 400 for wrong-email recovery attempt #${String(i + 1)}`
    );
    assert.strictEqual(
      results[i].scryptCallDelta,
      0,
      `Expected scryptCallDelta === 0 for cheap wrong-email recovery attempt #${String(i + 1)}`
    );
  }

  // Assert request #31 is NOT rate limited and reaches scrypt verification
  const request31 = results[ADMIN_RECOVERY_GLOBAL_MAX_ATTEMPTS];
  assert.notStrictEqual(
    request31.status,
    429,
    "Vulnerability confirmed: 30 cheap wrong-email recovery requests drained the global recovery CPU safety bucket (request #31 was denied with HTTP 429)"
  );
  assert.strictEqual(
    request31.status,
    400,
    `Expected HTTP 400 (Recovery code is wrong), got HTTP ${String(request31.status)}`
  );
  assert.ok(
    request31.scryptCallDelta > 0,
    "Expected request #31 with valid email to reach recovery-code scrypt verification"
  );
});

test("RECOVERY ENUMERATION CASE 1 — Wrong email and wrong recovery code must return identical generic 400 responses", () => {
  const steps: RequestStep[] = [
    // Scenario A: Wrong admin email, valid formatted recovery code, valid new password
    {
      method: "PATCH",
      clientIp: "198.51.100.101",
      body: {
        email: "nonexistent-admin@test.invalid",
        recoveryCode: "SOME-RECOVERY-CODE",
        newPassword: "ValidNewPassword123!",
      },
    },
    // Scenario B: Correct admin email, wrong recovery code, valid new password
    {
      method: "PATCH",
      clientIp: "198.51.100.102",
      body: {
        email: SYNTHETIC_ADMIN_EMAIL,
        recoveryCode: "WRONG-RECOVERY-CODE",
        newPassword: "ValidNewPassword123!",
      },
    },
  ];

  const results = runChildScenario("recovery-account-enumeration-elimination", steps);

  const scenarioA = results[0];
  const scenarioB = results[1];

  // 1. Both must return HTTP 400
  assert.strictEqual(
    scenarioA.status,
    400,
    `Expected HTTP 400 for Scenario A (wrong email), got HTTP ${String(scenarioA.status)}`
  );
  assert.strictEqual(
    scenarioB.status,
    400,
    `Expected HTTP 400 for Scenario B (wrong recovery code), got HTTP ${String(scenarioB.status)}`
  );

  // 2. Both must return identical generic error messages
  assert.strictEqual(
    scenarioA.message,
    "Invalid recovery details.",
    `Expected Scenario A message to be "Invalid recovery details.", got "${scenarioA.message}"`
  );
  assert.strictEqual(
    scenarioB.message,
    "Invalid recovery details.",
    `Expected Scenario B message to be "Invalid recovery details.", got "${scenarioB.message}"`
  );
  assert.strictEqual(
    scenarioA.message,
    scenarioB.message,
    "Vulnerability confirmed: recovery error messages differed between wrong email and wrong recovery code (account enumeration)"
  );

  // 3. Cheap pre-scrypt rejection must be preserved for wrong email
  assert.strictEqual(
    scenarioA.scryptCallDelta,
    0,
    "Wrong-email recovery request must NOT execute scrypt"
  );

  // 4. Correct email + wrong recovery code must execute scrypt
  assert.ok(
    scenarioB.scryptCallDelta > 0,
    "Correct-email recovery request must execute scrypt verification"
  );
});

test("RECOVERY ENUMERATION CASE 2 — Unconfigured recovery code: wrong email and correct email must return identical generic 400 responses", () => {
  const steps: RequestStep[] = [
    // Scenario A: Wrong admin email, valid formatted recovery code, valid new password
    {
      method: "PATCH",
      clientIp: "198.51.100.201",
      body: {
        email: "nonexistent-admin@test.invalid",
        recoveryCode: "SOME-RECOVERY-CODE",
        newPassword: "ValidNewPassword123!",
      },
    },
    // Scenario B: Correct admin email, same recovery code, valid new password
    {
      method: "PATCH",
      clientIp: "198.51.100.202",
      body: {
        email: SYNTHETIC_ADMIN_EMAIL,
        recoveryCode: "SOME-RECOVERY-CODE",
        newPassword: "ValidNewPassword123!",
      },
    },
  ];

  // Run scenario in a child process where recoveryCodeHash is NOT configured
  const results = runChildScenario("recovery-unconfigured-enumeration-elimination", steps, {
    omitRecoveryCodeHash: true,
  });

  const scenarioA = results[0];
  const scenarioB = results[1];

  // 1. Both must return HTTP 400
  assert.strictEqual(
    scenarioA.status,
    400,
    `Expected HTTP 400 for Scenario A (wrong email), got HTTP ${String(scenarioA.status)}`
  );
  assert.strictEqual(
    scenarioB.status,
    400,
    `Expected HTTP 400 for Scenario B (correct email, unconfigured recovery), got HTTP ${String(scenarioB.status)}`
  );

  // 2. Both must return identical generic error messages
  assert.strictEqual(
    scenarioA.message,
    "Invalid recovery details.",
    `Expected Scenario A message to be "Invalid recovery details.", got "${scenarioA.message}"`
  );
  assert.strictEqual(
    scenarioB.message,
    "Invalid recovery details.",
    `Expected Scenario B message to be "Invalid recovery details.", got "${scenarioB.message}"`
  );
  assert.strictEqual(
    scenarioA.message,
    scenarioB.message,
    "Vulnerability confirmed: recovery error messages differed when recovery is unconfigured (account enumeration)"
  );

  // 3. Both must NOT execute scrypt
  assert.strictEqual(
    scenarioA.scryptCallDelta,
    0,
    "Wrong-email recovery request must NOT execute scrypt"
  );
  assert.strictEqual(
    scenarioB.scryptCallDelta,
    0,
    "Unconfigured-recovery request must NOT execute scrypt"
  );

  // 4. Credential store must remain unchanged
  assert.strictEqual(
    scenarioA.authFileUnchanged,
    true,
    "Auth store must not be modified by wrong email"
  );
  assert.strictEqual(
    scenarioB.authFileUnchanged,
    true,
    "Auth store must not be modified by unconfigured recovery attempt"
  );
});
