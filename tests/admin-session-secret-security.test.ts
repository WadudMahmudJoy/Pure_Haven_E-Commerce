/**
 * RED regression test — Predictable ADMIN_SESSION_SECRET vulnerability
 *
 * Vulnerability confirmed:
 *   Both lib/adminSession.ts and proxy.ts fall back to a known hard-coded
 *   development secret ("pure-haven-dev-change-this-secret") when
 *   ADMIN_SESSION_SECRET is absent or empty.
 *
 * Intended secure policy:
 *   - Missing ADMIN_SESSION_SECRET -> Refuse to sign tokens, reject forged tokens, block proxy access
 *   - Empty ADMIN_SESSION_SECRET -> Refuse to sign tokens, reject forged tokens, block proxy access
 *   - Hard-coded fallback secret must be completely removed from production code.
 *   - Configured, non-empty ADMIN_SESSION_SECRET -> Normal session creation, verification, and proxy access work.
 *
 * SECRET SAFETY GUARANTEE:
 *   - The parent test never modifies or inspects the real environment secret.
 *   - Each case runs in an isolated child process with an explicitly constructed
 *     environment (ADMIN_SESSION_SECRET deleted, set to empty, or set to a random test secret).
 *   - Attacker tokens are forged independently in test code using the historical
 *     fallback key, proving the trust boundary failure.
 *
 * Run with:
 *   npx tsx --test tests/admin-session-secret-security.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// ESM-safe project path setup
// ---------------------------------------------------------------------------
const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const projectRoot = path.resolve(currentDir, "..");
const tsxCli = path.resolve(projectRoot, "node_modules/tsx/dist/cli.mjs");
const tsconfigPath = path.resolve(projectRoot, "tsconfig.json");
const childRunnerPath = path.resolve(
  projectRoot,
  "tests/helpers/admin-session-secret-child-runner.ts"
);

type CreateSessionResult = {
  action: "create-session";
  succeeded: boolean;
  threw: boolean;
};

type RequireAdminResult = {
  action: "require-admin-forged" | "require-admin-valid";
  authorized: boolean;
  status: number;
};

type ProxyResult = {
  action: "proxy-forged" | "proxy-valid";
  redirectedToLogin: boolean;
  middlewareAllowed: boolean;
  status: number;
};

function runSecretChild(
  action:
    | "create-session"
    | "require-admin-forged"
    | "proxy-forged"
    | "require-admin-valid"
    | "proxy-valid"
    | "proxy-mutated-sig"
    | "proxy-truncated-sig"
    | "proxy-extended-sig"
    | "proxy-malformed-sig"
    | "proxy-expired-token",
  secretMode: "absent" | "empty" | "configured"
) {
  const childEnv = { ...process.env };
  if (secretMode === "absent") {
    delete childEnv.ADMIN_SESSION_SECRET;
  } else if (secretMode === "empty") {
    childEnv.ADMIN_SESSION_SECRET = "";
  } else {
    // Generate a fresh, random test-only secret for positive control verification
    childEnv.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
  }

  const res = spawnSync(
    process.execPath,
    [
      tsxCli,
      "--tsconfig",
      tsconfigPath,
      childRunnerPath,
      JSON.stringify({ action }),
    ],
    {
      cwd: projectRoot,
      env: childEnv,
      encoding: "utf8",
      timeout: 10000,
    }
  );

  if (res.error) {
    throw new Error(`Child process failed to launch: ${res.error.message}`);
  }

  if (res.status !== 0) {
    throw new Error(
      `Child process exited with code ${String(res.status)}:\nStderr: ${res.stderr}\nStdout: ${res.stdout}`
    );
  }

  const rawOut = res.stdout.trim();
  try {
    return JSON.parse(rawOut);
  } catch (err) {
    throw new Error(
      `Failed to parse child output as JSON:\nRaw output: "${rawOut}"\nStderr: ${res.stderr}\nError: ${String(err)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Missing Secret Cases (ADMIN_SESSION_SECRET absent) — NEGATIVE SECURITY
// ---------------------------------------------------------------------------

test("CASE 1 — Missing secret must prevent token signing", () => {
  const result = runSecretChild("create-session", "absent") as CreateSessionResult;

  assert.strictEqual(
    result.succeeded,
    false,
    "Vulnerability confirmed: createAdminSessionToken signed a token using the fallback secret when ADMIN_SESSION_SECRET was absent"
  );
});

test("CASE 2 — Missing secret must reject fallback-forged token at requireAdmin", () => {
  const result = runSecretChild("require-admin-forged", "absent") as RequireAdminResult;

  assert.strictEqual(
    result.authorized,
    false,
    "Vulnerability confirmed: requireAdmin authorized a forged token signed with the fallback secret when ADMIN_SESSION_SECRET was absent"
  );

  assert.strictEqual(
    result.status,
    401,
    `Expected HTTP 401 Unauthorized for forged token, but got HTTP ${result.status}`
  );
});

test("CASE 3 — Missing secret must reject fallback-forged token in proxy.ts", () => {
  const result = runSecretChild("proxy-forged", "absent") as ProxyResult;

  assert.strictEqual(
    result.middlewareAllowed,
    false,
    "Vulnerability confirmed: proxy.ts allowed access to protected admin route using fallback-forged token when ADMIN_SESSION_SECRET was absent"
  );

  assert.strictEqual(
    result.redirectedToLogin,
    true,
    "Expected proxy.ts to redirect unauthorized request to /admin/login"
  );
});

// ---------------------------------------------------------------------------
// Empty Secret Cases (ADMIN_SESSION_SECRET="") — NEGATIVE SECURITY
// ---------------------------------------------------------------------------

test("CASE 4 — Empty secret must prevent token signing", () => {
  const result = runSecretChild("create-session", "empty") as CreateSessionResult;

  assert.strictEqual(
    result.succeeded,
    false,
    "Vulnerability confirmed: createAdminSessionToken signed a token using the fallback secret when ADMIN_SESSION_SECRET was empty string"
  );
});

test("CASE 5 — Empty secret must reject fallback-forged token at requireAdmin", () => {
  const result = runSecretChild("require-admin-forged", "empty") as RequireAdminResult;

  assert.strictEqual(
    result.authorized,
    false,
    "Vulnerability confirmed: requireAdmin authorized a forged token signed with the fallback secret when ADMIN_SESSION_SECRET was empty string"
  );

  assert.strictEqual(
    result.status,
    401,
    `Expected HTTP 401 Unauthorized for forged token, but got HTTP ${result.status}`
  );
});

test("CASE 6 — Empty secret must reject fallback-forged token in proxy.ts", () => {
  const result = runSecretChild("proxy-forged", "empty") as ProxyResult;

  assert.strictEqual(
    result.middlewareAllowed,
    false,
    "Vulnerability confirmed: proxy.ts allowed access to protected admin route using fallback-forged token when ADMIN_SESSION_SECRET was empty string"
  );

  assert.strictEqual(
    result.redirectedToLogin,
    true,
    "Expected proxy.ts to redirect unauthorized request to /admin/login"
  );
});

// ---------------------------------------------------------------------------
// Configured Secret Cases (ADMIN_SESSION_SECRET=<valid>) — POSITIVE CONTROLS
// ---------------------------------------------------------------------------

test("CASE 7 — Configured secret must allow token creation", () => {
  const result = runSecretChild("create-session", "configured") as CreateSessionResult;

  assert.strictEqual(
    result.succeeded,
    true,
    "Expected createAdminSessionToken to succeed when ADMIN_SESSION_SECRET is configured"
  );

  assert.strictEqual(
    result.threw,
    false,
    "createAdminSessionToken threw unexpectedly when ADMIN_SESSION_SECRET was configured"
  );
});

test("CASE 8 — Configured secret must allow requireAdmin authentication", () => {
  const result = runSecretChild("require-admin-valid", "configured") as RequireAdminResult;

  assert.strictEqual(
    result.authorized,
    true,
    "Expected requireAdmin to authorize valid token when ADMIN_SESSION_SECRET is configured"
  );

  assert.strictEqual(
    result.status,
    200,
    `Expected HTTP 200 (authorized) for valid token, but got HTTP ${result.status}`
  );
});

test("CASE 9 — Configured secret must allow proxy access", () => {
  const result = runSecretChild("proxy-valid", "configured") as ProxyResult;

  assert.strictEqual(
    result.middlewareAllowed,
    true,
    "Expected proxy.ts to allow access to protected admin route when ADMIN_SESSION_SECRET is configured"
  );

  assert.strictEqual(
    result.redirectedToLogin,
    false,
    "Expected proxy.ts not to redirect valid admin request to /admin/login"
  );
});

// ---------------------------------------------------------------------------
// Task 3C Characterization: Proxy Signature Validation Boundary
// These cases pass against the current implementation and guard the refactor.
// ---------------------------------------------------------------------------

test("CASE 10 — Mutated valid signature must be rejected by proxy", () => {
  const result = runSecretChild("proxy-mutated-sig", "configured") as ProxyResult;

  assert.strictEqual(
    result.middlewareAllowed,
    false,
    "proxy.ts must reject a token whose signature has one character mutated"
  );

  assert.strictEqual(
    result.redirectedToLogin,
    true,
    "Expected proxy.ts to redirect to /admin/login when signature is mutated"
  );
});

test("CASE 11 — Truncated signature must be rejected by proxy", () => {
  const result = runSecretChild("proxy-truncated-sig", "configured") as ProxyResult;

  assert.strictEqual(
    result.middlewareAllowed,
    false,
    "proxy.ts must reject a token whose signature is shorter than the expected HMAC length"
  );

  assert.strictEqual(
    result.redirectedToLogin,
    true,
    "Expected proxy.ts to redirect to /admin/login when signature is truncated"
  );
});

test("CASE 12 — Extended signature must be rejected by proxy", () => {
  const result = runSecretChild("proxy-extended-sig", "configured") as ProxyResult;

  assert.strictEqual(
    result.middlewareAllowed,
    false,
    "proxy.ts must reject a token whose signature has one extra character appended"
  );

  assert.strictEqual(
    result.redirectedToLogin,
    true,
    "Expected proxy.ts to redirect to /admin/login when signature is extended"
  );
});

test("CASE 13 — Malformed base64url signature must be rejected by proxy", () => {
  const result = runSecretChild("proxy-malformed-sig", "configured") as ProxyResult;

  assert.strictEqual(
    result.middlewareAllowed,
    false,
    "proxy.ts must deny access when the signature contains characters outside the base64url alphabet"
  );

  assert.strictEqual(
    result.redirectedToLogin,
    true,
    "Expected proxy.ts to redirect to /admin/login when signature is not valid base64url"
  );
});

test("CASE 14 — Correctly signed but expired token must be rejected by proxy", () => {
  const result = runSecretChild("proxy-expired-token", "configured") as ProxyResult;

  assert.strictEqual(
    result.middlewareAllowed,
    false,
    "proxy.ts must reject a legitimately signed token whose exp field is in the past"
  );

  assert.strictEqual(
    result.redirectedToLogin,
    true,
    "Expected proxy.ts to redirect to /admin/login for an expired but correctly signed token"
  );
});
