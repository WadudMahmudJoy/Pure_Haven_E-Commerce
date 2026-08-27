import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST as handleLogin } from "../app/api/customer-auth/login/route.js";
import { POST as handleRegister } from "../app/api/customer-auth/register/route.js";
import { POST as handleResetRequest } from "../app/api/customer-auth/password-reset/request/route.js";
import { POST as handleResetConfirm } from "../app/api/customer-auth/password-reset/confirm/route.js";
import { POST as handleVerifyConfirm } from "../app/api/customer-auth/email-verification/confirm/route.js";
import { POST as handleIdentity } from "../app/api/customer-auth/identity/route.js";

describe("Wave E — Customer Error Contract & Data Leak Audit", () => {
  const forbiddenPatterns = [
    /P2002/i,
    /prisma/i,
    /syntax error/i,
    /stack/i,
    /tokenHash/i,
    /passwordHash/i,
    /SELECT\s+/i,
    /INSERT\s+/i,
    /UPDATE\s+/i,
    /DELETE\s+/i,
  ];

  async function assertNoLeaks(res: Response) {
    const text = await res.text();
    for (const pattern of forbiddenPatterns) {
      assert.strictEqual(
        pattern.test(text),
        false,
        `Response must not match forbidden leak pattern ${pattern}: ${text}`
      );
    }
  }

  it("A. Login with invalid credentials returns clean error without leaking internals", async () => {
    const req = new NextRequest("http://localhost:3000/api/customer-auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ identifier: "nonexistent@example.com", password: "wrong" }),
    });
    const res = await handleLogin(req);
    assert.strictEqual(res.status, 401);
    await assertNoLeaks(res);
  });

  it("B. Register with malformed inputs returns clean error", async () => {
    const req = new NextRequest("http://localhost:3000/api/customer-auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "", identifier: "invalid-ident", password: "123" }),
    });
    const res = await handleRegister(req);
    assert.strictEqual(res.status, 400);
    await assertNoLeaks(res);
  });

  it("C. Password reset confirm with invalid token returns clean generic error", async () => {
    const req = new NextRequest("http://localhost:3000/api/customer-auth/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ token: "invalid_token_123", newPassword: "NewPassword!123" }),
    });
    const res = await handleResetConfirm(req);
    assert.strictEqual(res.status, 400);
    await assertNoLeaks(res);
  });

  it("D. Email verification confirm with invalid token returns clean generic error", async () => {
    const req = new NextRequest("http://localhost:3000/api/customer-auth/email-verification/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ token: "invalid_verify_token_123" }),
    });
    const res = await handleVerifyConfirm(req);
    assert.strictEqual(res.status, 400);
    await assertNoLeaks(res);
  });

  it("E. Unauthenticated identity mutation returns clean 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ action: "ADD_EMAIL", currentPassword: "pass", newEmail: "test@example.com" }),
    });
    const res = await handleIdentity(req);
    assert.strictEqual(res.status, 401);
    await assertNoLeaks(res);
  });

  it("F. Password reset request with empty identifier returns clean enumeration-safe 200", async () => {
    const req = new NextRequest("http://localhost:3000/api/customer-auth/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ identifier: "" }),
    });
    const res = await handleResetRequest(req);
    assert.strictEqual(res.status, 200);
    await assertNoLeaks(res);
  });
});
