import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

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
if (!normalizedCwd.includes("ph-admin-test-")) {
  console.error("GUARDRAIL FAILURE: child process cwd does not contain test prefix ph-admin-test-");
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
// Dynamic import of the production route & session helper AFTER guardrails pass
// ---------------------------------------------------------------------------
const { POST, PATCH, PUT } = await import("../../app/api/admin-auth/route");
const { createAdminSessionToken, ADMIN_SESSION_COOKIE } = await import(
  "../../lib/adminSession"
);

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------
type ChildInput = {
  action: "login" | "recovery-reset" | "settings-update";
  body: Record<string, unknown>;
  initialFileContent?: string;
};

async function main() {
  const rawArg = process.argv[2];
  if (!rawArg) {
    console.error("No input payload provided to child runner");
    process.exit(1);
  }

  const payload = JSON.parse(rawArg) as ChildInput;
  let res: Response;

  if (payload.action === "login") {
    const req = new Request("http://localhost:3000/api/admin-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload.body),
    });
    res = await POST(req);
  } else if (payload.action === "recovery-reset") {
    const req = new Request("http://localhost:3000/api/admin-auth", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload.body),
    });
    res = await PATCH(req);
  } else if (payload.action === "settings-update") {
    // Generate a valid admin session using the random test secret in process.env
    const token = createAdminSessionToken("test-admin@test.local");
    const req = new Request("http://localhost:3000/api/admin-auth", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        cookie: `${ADMIN_SESSION_COOKIE}=${token}`,
      },
      body: JSON.stringify(payload.body),
    });
    res = await PUT(req);
  } else {
    console.error(`Unsupported child runner action: ${String(payload.action)}`);
    process.exit(1);
  }

  const status = res.status;
  const setCookie = res.headers.get("set-cookie") || "";
  const hasSessionCookie = setCookie.includes("pure_haven_admin_session=");

  let data: { success?: boolean; message?: string } | null = null;
  try {
    data = await res.json();
  } catch {
    // Ignore JSON parse failure on non-JSON responses
  }

  const authFileExistsAfter = fs.existsSync(tempAuthPath);
  let authFileUnchanged = false;
  if (authFileExistsAfter && payload.initialFileContent !== undefined) {
    try {
      const currentContent = fs.readFileSync(tempAuthPath, "utf8");
      authFileUnchanged = currentContent === payload.initialFileContent;
    } catch {
      authFileUnchanged = false;
    }
  }

  const output = {
    status,
    success: data?.success ?? false,
    message: data?.message ?? "",
    hasSessionCookie,
    authFileExistsAfter,
    authFileUnchanged,
  };

  console.log(JSON.stringify(output));
}

await main();
