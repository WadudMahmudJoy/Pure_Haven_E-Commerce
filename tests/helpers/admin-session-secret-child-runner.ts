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
    | "proxy-valid"
    | "proxy-mutated-sig"
    | "proxy-truncated-sig"
    | "proxy-extended-sig"
    | "proxy-malformed-sig"
    | "proxy-expired-token";
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
  } else if (payload.action === "proxy-mutated-sig") {
    // CASE 10: valid token with exactly one character of the signature mutated
    const validToken = createAdminSessionToken("valid-admin@test.invalid");
    const dotIndex = validToken.indexOf(".");
    const tokenPayload = validToken.slice(0, dotIndex);
    const tokenSig = validToken.slice(dotIndex + 1);
    // Flip the first character to a different base64url character
    const firstChar = tokenSig[0];
    const replacementChar = firstChar === "A" ? "B" : "A";
    const mutatedSig = replacementChar + tokenSig.slice(1);
    const mutatedToken = `${tokenPayload}.${mutatedSig}`;
    const req10 = new NextRequest("http://localhost/admin", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${mutatedToken}` },
    });
    const res10 = await proxy(req10);
    const loc10 = res10.headers.get("location") || "";
    output = {
      action: "proxy-mutated-sig",
      redirectedToLogin: res10.status === 307 && loc10.includes("/admin/login"),
      middlewareAllowed:
        res10.headers.get("x-middleware-next") === "1" ||
        (res10.status === 200 && !res10.headers.get("location")),
      status: res10.status,
    };
  } else if (payload.action === "proxy-truncated-sig") {
    // CASE 11: valid token with its signature truncated by one character
    const validToken = createAdminSessionToken("valid-admin@test.invalid");
    const dotIndex = validToken.indexOf(".");
    const tokenPayload = validToken.slice(0, dotIndex);
    const tokenSig = validToken.slice(dotIndex + 1);
    const truncatedToken = `${tokenPayload}.${tokenSig.slice(0, -1)}`;
    const req11 = new NextRequest("http://localhost/admin", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${truncatedToken}` },
    });
    const res11 = await proxy(req11);
    const loc11 = res11.headers.get("location") || "";
    output = {
      action: "proxy-truncated-sig",
      redirectedToLogin: res11.status === 307 && loc11.includes("/admin/login"),
      middlewareAllowed:
        res11.headers.get("x-middleware-next") === "1" ||
        (res11.status === 200 && !res11.headers.get("location")),
      status: res11.status,
    };
  } else if (payload.action === "proxy-extended-sig") {
    // CASE 12: valid token with one extra base64url character appended to the signature
    const validToken = createAdminSessionToken("valid-admin@test.invalid");
    const dotIndex = validToken.indexOf(".");
    const tokenPayload = validToken.slice(0, dotIndex);
    const tokenSig = validToken.slice(dotIndex + 1);
    const extendedToken = `${tokenPayload}.${tokenSig}A`;
    const req12 = new NextRequest("http://localhost/admin", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${extendedToken}` },
    });
    const res12 = await proxy(req12);
    const loc12 = res12.headers.get("location") || "";
    output = {
      action: "proxy-extended-sig",
      redirectedToLogin: res12.status === 307 && loc12.includes("/admin/login"),
      middlewareAllowed:
        res12.headers.get("x-middleware-next") === "1" ||
        (res12.status === 200 && !res12.headers.get("location")),
      status: res12.status,
    };
  } else if (payload.action === "proxy-malformed-sig") {
    // CASE 13: valid payload paired with a signature containing characters
    // outside the base64url alphabet (tildes are not in [A-Za-z0-9\-_])
    const validToken = createAdminSessionToken("valid-admin@test.invalid");
    const dotIndex = validToken.indexOf(".");
    const tokenPayload = validToken.slice(0, dotIndex);
    const malformedToken = `${tokenPayload}.~~~~invalid~~~~`;
    const req13 = new NextRequest("http://localhost/admin", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${malformedToken}` },
    });
    const res13 = await proxy(req13);
    const loc13 = res13.headers.get("location") || "";
    output = {
      action: "proxy-malformed-sig",
      redirectedToLogin: res13.status === 307 && loc13.includes("/admin/login"),
      middlewareAllowed:
        res13.headers.get("x-middleware-next") === "1" ||
        (res13.status === 200 && !res13.headers.get("location")),
      status: res13.status,
    };
  } else if (payload.action === "proxy-expired-token") {
    // CASE 14: correctly signed token whose exp is in the past.
    // Signed independently in test code using the test-only secret from env.
    const testSecret = process.env.ADMIN_SESSION_SECRET;
    if (!testSecret) {
      console.error("ADMIN_SESSION_SECRET not set for proxy-expired-token case");
      process.exit(1);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const expiredPayload = Buffer.from(
      JSON.stringify({
        sub: "expired-admin@test.invalid",
        iat: nowSec - 7200, // issued 2 hours ago
        exp: nowSec - 3600, // expired 1 hour ago
      }),
      "utf8"
    ).toString("base64url");
    const expiredSig = createHmac("sha256", testSecret)
      .update(expiredPayload)
      .digest("base64url");
    const expiredToken = `${expiredPayload}.${expiredSig}`;
    const req14 = new NextRequest("http://localhost/admin", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${expiredToken}` },
    });
    const res14 = await proxy(req14);
    const loc14 = res14.headers.get("location") || "";
    output = {
      action: "proxy-expired-token",
      redirectedToLogin: res14.status === 307 && loc14.includes("/admin/login"),
      middlewareAllowed:
        res14.headers.get("x-middleware-next") === "1" ||
        (res14.status === 200 && !res14.headers.get("location")),
      status: res14.status,
    };
  } else {
    console.error(`Unsupported action: ${String(payload.action)}`);
    process.exit(1);
  }

  console.log(JSON.stringify(output));
}

await main();
