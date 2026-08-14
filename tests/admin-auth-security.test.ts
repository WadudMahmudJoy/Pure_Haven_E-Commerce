/**
 * RED regression test — Admin default credentials vulnerability
 *
 * Vulnerability confirmed:
 *   app/api/admin-auth/route.ts manufactures and accepts known source-code
 *   default admin credentials/recovery data ("admin@example.com", "admin123", "123456")
 *   when the credential store is missing, malformed, or incomplete.
 *
 * Intended secure policy:
 *   - Missing credential store -> Fail closed (503/500), no session cookie, no file created
 *   - Malformed credential store -> Fail closed (500), no session cookie, file unchanged
 *   - Missing password field -> Fail closed, default password rejected
 *   - Missing recovery code -> Fail closed, default recovery code rejected
 *
 * REAL-FILE SAFETY GUARANTEE:
 *   - The parent process NEVER imports app/api/admin-auth/route.ts.
 *   - The parent process NEVER changes its process.cwd().
 *   - Every test runs in an isolated child process whose cwd is set to a unique
 *     temporary directory (os.tmpdir()/ph-admin-test-*) BEFORE the route is imported.
 *   - The real project file (<projectRoot>/data/admin-auth.json) is never read,
 *     written, modified, or accessed.
 *
 * Run with:
 *   npx tsx --test tests/admin-auth-security.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// ESM-safe project path setup
// ---------------------------------------------------------------------------
const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const projectRoot = path.resolve(currentDir, "..");
const tsxCli = path.resolve(projectRoot, "node_modules/tsx/dist/cli.mjs");
const tsconfigPath = path.resolve(projectRoot, "tsconfig.json");
const childRunnerPath = path.resolve(projectRoot, "tests/helpers/admin-auth-child-runner.ts");

type ChildResult = {
  status: number;
  success: boolean;
  message: string;
  hasSessionCookie: boolean;
  authFileExistsAfter: boolean;
  authFileUnchanged: boolean;
};

type ChildRunnerOptions = {
  tempDir: string;
  action: "login" | "recovery-reset" | "settings-update";
  body: Record<string, unknown>;
  initialFileContent?: string;
};

function runChildAuth(options: ChildRunnerOptions): ChildResult {
  // Generate random test-only session secret to isolate from environment/fallback secrets
  const randomSecret = randomBytes(32).toString("hex");

  const childPayload = {
    action: options.action,
    body: options.body,
    initialFileContent: options.initialFileContent,
  };

  const res = spawnSync(
    process.execPath,
    [
      tsxCli,
      "--tsconfig",
      tsconfigPath,
      childRunnerPath,
      JSON.stringify(childPayload),
    ],
    {
      cwd: options.tempDir,
      env: {
        ...process.env,
        ADMIN_SESSION_SECRET: randomSecret,
      },
      encoding: "utf8",
      timeout: 10000,
    }
  );

  if (res.error) {
    throw new Error(`Child process failed to launch: ${res.error.message}`);
  }

  if (res.status === 99) {
    throw new Error(`Child process ABORTED by pre-import safety guardrail:\n${res.stderr || res.stdout}`);
  }

  if (res.status !== 0) {
    throw new Error(`Child process exited with code ${String(res.status)}:\nStderr: ${res.stderr}\nStdout: ${res.stdout}`);
  }

  const rawOut = res.stdout.trim();
  try {
    return JSON.parse(rawOut) as ChildResult;
  } catch (err) {
    throw new Error(`Failed to parse child runner stdout as JSON:\nRaw output: "${rawOut}"\nStderr: ${res.stderr}\nParse error: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Test Cases
// ---------------------------------------------------------------------------

test("CASE 1 — Missing credential store: default credentials must NOT be accepted or auto-created", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-admin-test-case1-"));

  try {
    const result = runChildAuth({
      tempDir,
      action: "login",
      body: {
        email: "admin@example.com",
        password: "admin123",
      },
    });

    // Primary trust-boundary assertions:
    assert.notStrictEqual(
      result.status,
      200,
      `Vulnerability confirmed: route accepted default credentials with HTTP ${result.status} on missing auth store`
    );

    assert.strictEqual(
      result.hasSessionCookie,
      false,
      "Vulnerability confirmed: route issued an admin session cookie for default credentials on missing auth store"
    );

    assert.strictEqual(
      result.authFileExistsAfter,
      false,
      "Vulnerability confirmed: route auto-created a default credential file on disk when auth store was missing"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CASE 2 — Malformed credential store: invalid JSON must NOT be overwritten with defaults or authenticated", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-admin-test-case2-"));
  const tempAuthDir = path.join(tempDir, "data");
  const tempAuthFile = path.join(tempAuthDir, "admin-auth.json");
  const malformedContent = '{\n  "corrupted_json": true,\n  "invalid_syntax\n';

  fs.mkdirSync(tempAuthDir, { recursive: true });
  fs.writeFileSync(tempAuthFile, malformedContent, "utf8");

  try {
    const result = runChildAuth({
      tempDir,
      action: "login",
      body: {
        email: "admin@example.com",
        password: "admin123",
      },
      initialFileContent: malformedContent,
    });

    assert.notStrictEqual(
      result.status,
      200,
      `Vulnerability confirmed: route accepted default credentials with HTTP ${result.status} on malformed auth store`
    );

    assert.strictEqual(
      result.hasSessionCookie,
      false,
      "Vulnerability confirmed: route issued an admin session cookie on malformed auth store"
    );

    assert.strictEqual(
      result.authFileUnchanged,
      true,
      "Vulnerability confirmed: route overwrote malformed auth store with default credentials on disk"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CASE 3 — Missing password field: historical default password must NOT be substituted", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-admin-test-case3-"));
  const tempAuthDir = path.join(tempDir, "data");
  const tempAuthFile = path.join(tempAuthDir, "admin-auth.json");

  // Incomplete store: email present, but NO password / passwordHash
  const incompleteAuth = JSON.stringify(
    {
      email: "synthetic-admin@test.local",
      recoveryEmail: "recovery@test.local",
    },
    null,
    2
  );

  fs.mkdirSync(tempAuthDir, { recursive: true });
  fs.writeFileSync(tempAuthFile, incompleteAuth, "utf8");

  try {
    const result = runChildAuth({
      tempDir,
      action: "login",
      body: {
        email: "synthetic-admin@test.local",
        password: "admin123", // historical source fallback password
      },
    });

    assert.notStrictEqual(
      result.status,
      200,
      `Vulnerability confirmed: route accepted default password "admin123" with HTTP ${result.status} when password field was missing`
    );

    assert.strictEqual(
      result.hasSessionCookie,
      false,
      "Vulnerability confirmed: route issued an admin session cookie via fallback password substitution"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CASE 4 — Missing recovery code: historical default recovery code must NOT be substituted", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-admin-test-case4-"));
  const tempAuthDir = path.join(tempDir, "data");
  const tempAuthFile = path.join(tempAuthDir, "admin-auth.json");

  // Incomplete store: email and existing password present, but NO recoveryCode / recoveryCodeHash
  const incompleteAuth = JSON.stringify(
    {
      email: "recovery-test@test.local",
      password: "SyntheticExistingPassword123!",
    },
    null,
    2
  );

  fs.mkdirSync(tempAuthDir, { recursive: true });
  fs.writeFileSync(tempAuthFile, incompleteAuth, "utf8");

  try {
    const result = runChildAuth({
      tempDir,
      action: "recovery-reset",
      body: {
        email: "recovery-test@test.local",
        recoveryCode: "123456", // historical source fallback recovery code
        newPassword: "NewSyntheticPassword999!",
      },
    });

    assert.notStrictEqual(
      result.status,
      200,
      `Vulnerability confirmed: route accepted default recovery code "123456" with HTTP ${result.status} when recovery code was missing`
    );

    assert.strictEqual(
      result.hasSessionCookie,
      false,
      "Vulnerability confirmed: route issued an admin session cookie via fallback recovery code substitution"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CASE 5 — Missing credential store: PUT update with valid session must fail closed without creating auth file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-admin-test-case5-"));

  try {
    const result = runChildAuth({
      tempDir,
      action: "settings-update",
      body: {
        email: "new-admin@test.local",
        recoveryEmail: "recovery@test.local",
        recoveryPhone: "01700000000",
        newPassword: "NewSecurePassword123!",
      },
    });

    // Secure policy: uninitialized store must fail closed on PUT (503)
    assert.strictEqual(
      result.status,
      503,
      `Expected HTTP 503 (uninitialized store) on PUT, but got HTTP ${result.status}`
    );

    assert.strictEqual(
      result.success,
      false,
      `Expected success: false on uninitialized PUT, but got: ${JSON.stringify(result)}`
    );

    assert.strictEqual(
      result.authFileExistsAfter,
      false,
      "Vulnerability confirmed: PUT request created data/admin-auth.json when store was uninitialized"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

