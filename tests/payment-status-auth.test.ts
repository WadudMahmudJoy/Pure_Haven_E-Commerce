/**
 * Authorization regression test — PATCH /api/orders/payment-status
 *
 * Exercises the REAL production PATCH handler directly (no HTTP server,
 * no mocking of auth logic) and verifies the authorization contract in
 * both directions:
 *
 *   Unauthorized requests  -> HTTP 401  (CASES 1-3)
 *   Valid admin session    -> HTTP 400  (CASE 4, body-validation fires
 *                                        before any Prisma query)
 *
 * NON-DESTRUCTIVE GUARANTEE:
 *   Every request body is {} (no orderId, no id, no paymentStatus).
 *   The handler's body-validation guard fires before prisma.order.findFirst()
 *   or prisma.order.update() can be reached. No database read or write can
 *   occur under any code path reachable from these test inputs.
 *
 * Run with:
 *   npx tsx --test tests/payment-status-auth.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { PATCH } from "../app/api/orders/payment-status/route";
import {
  createAdminSessionToken,
  ADMIN_SESSION_COOKIE,
} from "../lib/adminSession";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Request that mimics a PATCH to /api/orders/payment-status.
 *
 * Body is deliberately empty (no orderId, no id, no paymentStatus) so that
 * regardless of the auth outcome, execution halts at the body-validation
 * guard before any Prisma query can execute.
 */
function makeRequest(cookieHeader?: string): Request {
  return new Request("http://localhost:3000/api/orders/payment-status", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    // Empty body — no orderId, no id, no paymentStatus.
    // Guarantees no DB mutation even if auth check is bypassed.
    body: JSON.stringify({}),
  });
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

test("CASE 1 — No cookie: PATCH must return 401", async () => {
  const req = makeRequest(); // no Cookie header at all
  const res = await PATCH(req);

  assert.strictEqual(
    res.status,
    401,
    `Expected HTTP 401 (Unauthorized) but got ${res.status}. ` +
      `A non-401 response means an unauthenticated request bypassed auth.`
  );

  const body = await res.json();
  assert.strictEqual(
    body.success,
    false,
    `Expected success:false in body, got: ${JSON.stringify(body)}`
  );
});

test("CASE 2 — Forged cookie substring: PATCH must return 401", async () => {
  // A cookie whose name matches the session cookie name but whose value is
  // arbitrary plaintext with no valid HMAC signature. The authorization guard
  // must reject this with 401 — the mere presence of the cookie name is not
  // sufficient for access.
  const req = makeRequest("pure_haven_admin_session=FORGED_NO_CRYPTO");
  const res = await PATCH(req);

  assert.strictEqual(
    res.status,
    401,
    `Expected HTTP 401 (Unauthorized) but got ${res.status}. ` +
      `A non-401 response means a forged cookie substring bypassed auth.`
  );

  const body = await res.json();
  assert.strictEqual(
    body.success,
    false,
    `Expected success:false in body, got: ${JSON.stringify(body)}`
  );
});

test("CASE 3 — Malformed signed-looking token: PATCH must return 401", async () => {
  // A structurally plausible token (base64url.base64url format) whose HMAC
  // signature does not match the payload. requireAdmin() must verify the
  // signature cryptographically and reject this with 401.
  const fakePayload = Buffer.from(
    JSON.stringify({ sub: "attacker@evil.com", iat: 1, exp: 9999999999 }),
    "utf8"
  ).toString("base64url");
  const fakeSignature = Buffer.from("invalidsignature", "utf8").toString(
    "base64url"
  );
  const malformedToken = `${fakePayload}.${fakeSignature}`;

  const req = makeRequest(`pure_haven_admin_session=${malformedToken}`);
  const res = await PATCH(req);

  assert.strictEqual(
    res.status,
    401,
    `Expected HTTP 401 (Unauthorized) but got ${res.status}. ` +
      `A non-401 response means a tampered token bypassed auth.`
  );

  const body = await res.json();
  assert.strictEqual(
    body.success,
    false,
    `Expected success:false in body, got: ${JSON.stringify(body)}`
  );
});

test("CASE 4 — Valid admin session: PATCH must NOT return 401", async () => {
  // Generate a cryptographically valid session token using the real production
  // helper. No secret is hard-coded here; createAdminSessionToken() reads
  // ADMIN_SESSION_SECRET from the environment (or its documented fallback),
  // exactly as the route's requireAdmin() guard does. Both sides use the
  // same key source, so this test is self-consistent without exposing secrets.
  //
  // The body is still deliberately empty ({}) so the handler halts at the
  // body-validation guard ("Order id is required." -> HTTP 400) before
  // prisma.order.findFirst() or prisma.order.update() can be reached.
  // No database read or write occurs.
  //
  // Purpose: prove that a legitimate admin session passes authentication and
  // reaches normal business-logic validation — i.e., the authorization guard
  // does NOT over-reject valid credentials.
  const token = createAdminSessionToken("admin-regression@pure-haven.test");
  const req = makeRequest(`${ADMIN_SESSION_COOKIE}=${token}`);
  const res = await PATCH(req);

  assert.notStrictEqual(
    res.status,
    401,
    `Expected any status other than 401, but got 401. ` +
      `A valid admin session must not be rejected by the authorization guard.`
  );

  // The empty body triggers body-validation: "Order id is required." -> 400.
  // Assert this stable contract so any regression on auth OR body-validation
  // produces an immediately informative failure.
  assert.strictEqual(
    res.status,
    400,
    `Expected HTTP 400 (body-validation) but got ${res.status}. ` +
      `Auth passed but an unexpected status was returned.`
  );

  const body = await res.json();
  assert.strictEqual(
    body.success,
    false,
    `Expected success:false in body, got: ${JSON.stringify(body)}`
  );
  assert.strictEqual(
    body.message,
    "Order id is required.",
    `Expected body-validation message "Order id is required." but got: "${body.message}"`
  );
});
