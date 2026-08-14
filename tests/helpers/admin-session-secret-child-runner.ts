import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// ESM-safe path resolution
// ---------------------------------------------------------------------------
// Runner operates in tests/helpers directory

// ---------------------------------------------------------------------------
// Historical fallback secret (used strictly as attacker-known input for test forgery)
// ---------------------------------------------------------------------------
const HISTORICAL_FALLBACK_SECRET = "pure-haven-dev-change-this-secret";

function forgeHistoricalFallbackToken(email = "attacker@test.invalid"): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: email,
      iat: now,
      exp: now + 60 * 60 * 24 * 7,
    }),
    "utf8"
  ).toString("base64url");
  const signature = createHmac("sha256", HISTORICAL_FALLBACK_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

// ---------------------------------------------------------------------------
// Dynamic import of production modules in isolated child environment
// ---------------------------------------------------------------------------
const { createAdminSessionToken, requireAdmin, ADMIN_SESSION_COOKIE } =
  await import("../../lib/adminSession");
const { proxy } = await import("../../proxy");

type ChildInput = {
  action:
    | "create-session"
    | "require-admin-forged"
    | "proxy-forged"
    | "require-admin-valid"
    | "proxy-valid";
};

async function main() {
  const rawArg = process.argv[2];
  if (!rawArg) {
    console.error("No action payload provided to child runner");
    process.exit(1);
  }

  const payload = JSON.parse(rawArg) as ChildInput;
  let output: Record<string, unknown>;

  if (payload.action === "create-session") {
    try {
      const token = createAdminSessionToken("synthetic-admin@test.invalid");
      const succeeded = typeof token === "string" && token.length > 0;
      output = {
        action: "create-session",
        succeeded,
        threw: false,
      };
    } catch {
      output = {
        action: "create-session",
        succeeded: false,
        threw: true,
      };
    }
  } else if (payload.action === "require-admin-forged") {
    const forgedToken = forgeHistoricalFallbackToken();
    const req = new Request("http://localhost:3000/api/test-protected", {
      headers: {
        cookie: `${ADMIN_SESSION_COOKIE}=${forgedToken}`,
      },
    });
    const res = requireAdmin(req);
    const authorized = res === null;
    const status = res ? res.status : 200;
    output = {
      action: "require-admin-forged",
      authorized,
      status,
    };
  } else if (payload.action === "proxy-forged") {
    const forgedToken = forgeHistoricalFallbackToken();
    const req = new NextRequest("http://localhost/admin", {
      headers: {
        cookie: `${ADMIN_SESSION_COOKIE}=${forgedToken}`,
      },
    });
    const res = await proxy(req);
    const location = res.headers.get("location") || "";
    const isRedirectToLogin = res.status === 307 && location.includes("/admin/login");
    const middlewareAllowed =
      res.headers.get("x-middleware-next") === "1" ||
      (res.status === 200 && !res.headers.get("location"));
    output = {
      action: "proxy-forged",
      redirectedToLogin: isRedirectToLogin,
      middlewareAllowed,
      status: res.status,
    };
  } else if (payload.action === "require-admin-valid") {
    const validToken = createAdminSessionToken("valid-admin@test.invalid");
    const req = new Request("http://localhost:3000/api/test-protected", {
      headers: {
        cookie: `${ADMIN_SESSION_COOKIE}=${validToken}`,
      },
    });
    const res = requireAdmin(req);
    const authorized = res === null;
    const status = res ? res.status : 200;
    output = {
      action: "require-admin-valid",
      authorized,
      status,
    };
  } else if (payload.action === "proxy-valid") {
    const validToken = createAdminSessionToken("valid-admin@test.invalid");
    const req = new NextRequest("http://localhost/admin", {
      headers: {
        cookie: `${ADMIN_SESSION_COOKIE}=${validToken}`,
      },
    });
    const res = await proxy(req);
    const location = res.headers.get("location") || "";
    const isRedirectToLogin = res.status === 307 && location.includes("/admin/login");
    const middlewareAllowed =
      res.headers.get("x-middleware-next") === "1" ||
      (res.status === 200 && !res.headers.get("location"));
    output = {
      action: "proxy-valid",
      redirectedToLogin: isRedirectToLogin,
      middlewareAllowed,
      status: res.status,
    };
  } else {
    console.error(`Unsupported action: ${String(payload.action)}`);
    process.exit(1);
  }

  console.log(JSON.stringify(output));
}

await main();
