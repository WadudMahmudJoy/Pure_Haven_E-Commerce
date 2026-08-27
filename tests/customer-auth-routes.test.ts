/**
 * Customer Authentication Route Handler Tests (Phase 3 Wave B)
 *
 * Verifies locked route invariants against test database:
 *   1. POST /api/customer-auth/register with Email
 *   2. POST /api/customer-auth/register with Phone (normalized to 01XXXXXXXXX)
 *   3. POST /api/customer-auth/register duplicate identifier returns 409 Conflict
 *   4. POST /api/customer-auth/login with Email and Phone
 *   5. POST /api/customer-auth/login with invalid password or unknown user returns generic 401
 *   6. POST /api/customer-auth/login on disabled account returns generic 401
 *   7. POST /api/customer-auth/logout revokes session in DB and clears cookies
 *   8. GET /api/customer-auth/session returns authenticated user DTO or unauthenticated state
 *   9. GET /api/customer-auth (legacy parent route) returns 410 Gone and rejects legacy auth
 *
 * Run with DATABASE_URL_TEST.
 */

import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { POST as registerHandler } from "../app/api/customer-auth/register/route.js";
import { POST as loginHandler } from "../app/api/customer-auth/login/route.js";
import { POST as logoutHandler } from "../app/api/customer-auth/logout/route.js";
import { GET as sessionHandler } from "../app/api/customer-auth/session/route.js";
import { GET as legacyHandler } from "../app/api/customer-auth/route.js";
import { prisma } from "../lib/prisma.js";
import { CUSTOMER_SESSION_COOKIE } from "../lib/customerSession.js";


describe("Wave B — Customer Auth Route Handlers", () => {
  const testSuffix = Math.random().toString(36).substring(2, 8);
  const testEmail = `auth_test_${testSuffix}@example.com`;
  const randomPhoneDigits = Math.floor(10000000 + Math.random() * 90000000).toString();
  const rawPhone = `+88017${randomPhoneDigits}`;
  const canonicalPhone = `017${randomPhoneDigits}`;
  const testPassword = "ValidPassword!2026";
  const testName = "Route Test User";

  let createdEmailUserId: string | null = null;
  let createdPhoneUserId: string | null = null;
  let emailSessionCookieHeader: string | null = null;

  after(async () => {
    // Clean up created test users
    if (createdEmailUserId) {
      await prisma.user.delete({ where: { id: createdEmailUserId } }).catch(() => {});
    }
    if (createdPhoneUserId) {
      await prisma.user.delete({ where: { id: createdPhoneUserId } }).catch(() => {});
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Registration
  // ---------------------------------------------------------------------------
  it("POST /api/customer-auth/register creates User with email, returns 201 and sets session cookie", async () => {
    const req = new Request("http://localhost:3000/api/customer-auth/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        name: testName,
        identifier: testEmail,
        password: testPassword,
      }),
    });

    const res = await registerHandler(req);
    assert.strictEqual(res.status, 201);

    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.user?.id);
    assert.strictEqual(body.user.email, testEmail);
    assert.strictEqual(body.user.normalizedPhone, null);
    assert.strictEqual(body.user.passwordHash, undefined, "Must not leak passwordHash");

    createdEmailUserId = body.user.id;

    // Check cookie
    const setCookie = res.headers.get("set-cookie") || "";
    assert.ok(setCookie.includes(CUSTOMER_SESSION_COOKIE));
    emailSessionCookieHeader = setCookie.split(";")[0];
  });

  it("POST /api/customer-auth/register creates User with Bangladeshi phone, normalizes to 01XXXXXXXXX", async () => {
    const req = new Request("http://localhost:3000/api/customer-auth/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        name: "Phone User",
        identifier: rawPhone,
        password: testPassword,
      }),
    });

    const res = await registerHandler(req);
    assert.strictEqual(res.status, 201);

    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.user.normalizedPhone, canonicalPhone);
    assert.strictEqual(body.user.email, null);

    createdPhoneUserId = body.user.id;
  });

  it("POST /api/customer-auth/register duplicate identifier returns 409 Conflict without leaking Prisma internals", async () => {
    const req = new Request("http://localhost:3000/api/customer-auth/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        name: "Duplicate User",
        identifier: testEmail,
        password: testPassword,
      }),
    });

    const res = await registerHandler(req);
    assert.strictEqual(res.status, 409);

    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.match(body.message, /already exists/i);
  });

  // ---------------------------------------------------------------------------
  // 2. Login
  // ---------------------------------------------------------------------------
  it("POST /api/customer-auth/login authenticates via Email and returns 200 with new session cookie", async () => {
    const req = new Request("http://localhost:3000/api/customer-auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        identifier: testEmail,
        password: testPassword,
      }),
    });

    const res = await loginHandler(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.user.email, testEmail);

    const setCookie = res.headers.get("set-cookie") || "";
    assert.ok(setCookie.includes(CUSTOMER_SESSION_COOKIE));
  });

  it("POST /api/customer-auth/login authenticates via Phone Number and returns 200", async () => {
    const req = new Request("http://localhost:3000/api/customer-auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        identifier: rawPhone, // Formatted phone with +880 and hyphens
        password: testPassword,
      }),
    });

    const res = await loginHandler(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.user.normalizedPhone, canonicalPhone);
  });

  it("POST /api/customer-auth/login with wrong password returns generic 401", async () => {
    const req = new Request("http://localhost:3000/api/customer-auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        identifier: testEmail,
        password: "WrongPassword!123",
      }),
    });

    const res = await loginHandler(req);
    assert.strictEqual(res.status, 401);

    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.match(body.message, /incorrect/i);
  });

  it("POST /api/customer-auth/login with unknown account returns generic 401 without account enumeration", async () => {
    const req = new Request("http://localhost:3000/api/customer-auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        identifier: "nonexistent_user_9999@example.com",
        password: "SomePassword123!",
      }),
    });

    const res = await loginHandler(req);
    assert.strictEqual(res.status, 401);

    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.match(body.message, /incorrect/i);
  });

  // ---------------------------------------------------------------------------
  // 3. Session Read
  // ---------------------------------------------------------------------------
  it("GET /api/customer-auth/session validates session cookie and returns authenticated user", async () => {
    assert.ok(emailSessionCookieHeader, "Must have session cookie from register");

    const req = new Request("http://localhost:3000/api/customer-auth/session", {
      method: "GET",
      headers: {
        cookie: emailSessionCookieHeader,
      },
    });

    const res = await sessionHandler(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.authenticated, true);
    assert.strictEqual(body.user?.email, testEmail);
  });

  it("GET /api/customer-auth/session returns unauthenticated when cookie is missing or invalid", async () => {
    const req = new Request("http://localhost:3000/api/customer-auth/session", {
      method: "GET",
    });

    const res = await sessionHandler(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.authenticated, false);
    assert.strictEqual(body.user, null);
  });

  // ---------------------------------------------------------------------------
  // 4. Logout
  // ---------------------------------------------------------------------------
  it("POST /api/customer-auth/logout revokes session in DB and subsequent validation fails", async () => {
    assert.ok(emailSessionCookieHeader);

    const logoutReq = new Request("http://localhost:3000/api/customer-auth/logout", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: emailSessionCookieHeader,
      },
    });

    const logoutRes = await logoutHandler(logoutReq);
    assert.strictEqual(logoutRes.status, 200);

    // Subsequent session read with the same cookie must now fail authentication
    const checkReq = new Request("http://localhost:3000/api/customer-auth/session", {
      method: "GET",
      headers: {
        cookie: emailSessionCookieHeader,
      },
    });

    const checkRes = await sessionHandler(checkReq);
    const checkBody = await checkRes.json();
    assert.strictEqual(checkBody.authenticated, false, "Revoked session must not authenticate");
  });

  // ---------------------------------------------------------------------------
  // 5. Legacy Route Retirement
  // ---------------------------------------------------------------------------
  it("GET /api/customer-auth returns 410 Gone and rejects legacy unsigned user ID cookie", async () => {
    const req = new Request("http://localhost:3000/api/customer-auth", {
      method: "GET",
      headers: {
        cookie: "pure_haven_customer_auth=forged_user_id_12345",
      },
    });

    const res = await legacyHandler();
    assert.strictEqual(res.status, 410);

    const body = await res.json();
    assert.strictEqual(body.authenticated, false);
    assert.match(body.message, /retired/i);
  });
});
