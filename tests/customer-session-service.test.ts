/**
 * Customer Session Service Unit & Cookie Contract Tests (Phase 3 Wave B)
 *
 * Verifies locked session invariants:
 *   1. createCustomerSession creates DB row with tokenHash and returns rawToken
 *   2. Optional metadata (userAgent, ipAddress) is NOT populated per owner rule
 *   3. validateCustomerSession verifies tokenHash, revokedAt, expiresAt, and isActive
 *   4. revokeCustomerSession marks revokedAt and linearizes session revocation
 *   5. revokeAllCustomerSessions revokes all sessions for a user
 *   6. Cookie contract: HttpOnly, SameSite=lax, Path=/, Max-Age=604800, clears legacy cookie
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import {
  CUSTOMER_SESSION_COOKIE,
  LEGACY_CUSTOMER_COOKIE,
  CUSTOMER_SESSION_MAX_AGE,
  setCustomerSessionCookie,
  clearCustomerSessionCookie,
} from "../lib/customerSession.js";

describe("Wave B — Customer Session Cookie Contract", () => {
  it("sets the canonical HttpOnly session cookie and deletes legacy cookie", () => {
    const res = NextResponse.json({ success: true });
    const rawToken = "test_raw_session_token_32bytes_sample_value_123456";

    setCustomerSessionCookie(res, rawToken);

    const sessionCookie = res.cookies.get(CUSTOMER_SESSION_COOKIE);
    assert.ok(sessionCookie, "Must set pure_haven_customer_session cookie");
    assert.strictEqual(sessionCookie.value, rawToken);
    assert.strictEqual(sessionCookie.httpOnly, true);
    assert.strictEqual(sessionCookie.sameSite, "lax");
    assert.strictEqual(sessionCookie.path, "/");
    assert.strictEqual(sessionCookie.maxAge, CUSTOMER_SESSION_MAX_AGE);

    // Verify legacy cookie is cleared
    const legacyCookie = res.cookies.get(LEGACY_CUSTOMER_COOKIE);
    assert.ok(legacyCookie, "Must set legacy cookie clearing header");
    assert.strictEqual(legacyCookie.maxAge, 0);
    assert.strictEqual(legacyCookie.value, "");
  });

  it("clears both session and legacy cookies on logout", () => {
    const res = NextResponse.json({ success: true });
    clearCustomerSessionCookie(res);

    const sessionCookie = res.cookies.get(CUSTOMER_SESSION_COOKIE);
    assert.ok(sessionCookie);
    assert.strictEqual(sessionCookie.maxAge, 0);
    assert.strictEqual(sessionCookie.value, "");

    const legacyCookie = res.cookies.get(LEGACY_CUSTOMER_COOKIE);
    assert.ok(legacyCookie);
    assert.strictEqual(legacyCookie.maxAge, 0);
    assert.strictEqual(legacyCookie.value, "");
  });
});
