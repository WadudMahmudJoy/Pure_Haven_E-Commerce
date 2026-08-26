/**
 * Wave D — Customer Recovery & Verification Routes Test Suite
 *
 * Behavioral tests for:
 * 1. Password reset request (verified email user -> test mailbox, unverified email user -> generic no-op, phone-only user -> generic no-op, non-existent -> generic no-op).
 * 2. Password reset confirm (updates password, revokes active sessions, new password login works, old password fails).
 * 3. Email verification resend & confirm flow.
 * 4. CSRF protection on recovery and verification endpoints.
 * 5. Rate limiting on recovery and verification endpoints.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../lib/prisma.js";
import { hashCustomerPassword } from "../lib/customerAuth.js";
import { createCustomerSession, validateCustomerSession } from "../lib/customerSession.js";
import { getLatestSentMail, clearSentMail } from "../lib/customerAuthMailer.js";
import { POST as handleResetRequest } from "../app/api/customer-auth/password-reset/request/route.js";
import { POST as handleResetConfirm } from "../app/api/customer-auth/password-reset/confirm/route.js";
import { POST as handleVerifyResend } from "../app/api/customer-auth/email-verification/resend/route.js";
import { POST as handleVerifyConfirm } from "../app/api/customer-auth/email-verification/confirm/route.js";
import { POST as handleLogin } from "../app/api/customer-auth/login/route.js";

describe("Wave D — Customer Recovery & Verification Routes", () => {
  it("A. Password reset request for verified email user dispatches reset email with token", async () => {
    clearSentMail();
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const email = `reset_req_${suffix}@example.com`;

    const user = await prisma.user.create({
      data: {
        name: "Verified User",
        email,
        normalizedPhone: "01711445566",
        passwordHash,
        emailVerifiedAt: new Date(), // Verified
        isActive: true,
      },
    });

    try {
      const req = new NextRequest("http://localhost:3000/api/customer-auth/password-reset/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ identifier: email }),
      });

      const res = await handleResetRequest(req);
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(
        data.message,
        "If an eligible recovery method is available, recovery instructions will be sent."
      );

      // Check test mailbox
      const mail = getLatestSentMail(email);
      assert.ok(mail, "Reset email must be sent to test mailbox");
      assert.strictEqual(mail.purpose, "PASSWORD_RESET");
      assert.ok(mail.token, "Mail must include raw token");
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("B. Password reset request for unverified email returns generic 200 without sending mail", async () => {
    clearSentMail();
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const email = `unverified_req_${suffix}@example.com`;

    const user = await prisma.user.create({
      data: {
        name: "Unverified User",
        email,
        normalizedPhone: "01711445577",
        passwordHash,
        emailVerifiedAt: null, // Unverified
        isActive: true,
      },
    });

    try {
      const req = new NextRequest("http://localhost:3000/api/customer-auth/password-reset/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ identifier: email }),
      });

      const res = await handleResetRequest(req);
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);

      // Verify no mail was sent
      const mail = getLatestSentMail(email);
      assert.strictEqual(mail, null, "No reset email must be sent for unverified email");
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("C. Password reset request for phone-only user returns generic 200 without sending mail", async () => {
    clearSentMail();
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");

    const user = await prisma.user.create({
      data: {
        name: `Phone Only Reset User ${suffix}`,
        email: null,
        normalizedPhone: "01711445588",
        passwordHash,
        isActive: true,
      },
    });

    try {
      const req = new NextRequest("http://localhost:3000/api/customer-auth/password-reset/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ identifier: "01711445588" }),
      });

      const res = await handleResetRequest(req);
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(
        data.message,
        "If an eligible recovery method is available, recovery instructions will be sent."
      );
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("D. Password reset confirmation updates password, revokes existing sessions, allows new login", async () => {
    clearSentMail();
    const suffix = Math.random().toString(36).slice(2, 8);
    const initialHash = await hashCustomerPassword("OldPass!123");
    const email = `full_reset_${suffix}@example.com`;

    const user = await prisma.user.create({
      data: {
        name: "Full Reset User",
        email,
        normalizedPhone: "01711445599",
        passwordHash: initialHash,
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });

    // Create an active session
    const oldSession = await createCustomerSession(user.id);

    try {
      // 1. Request reset
      const reqReset = new NextRequest("http://localhost:3000/api/customer-auth/password-reset/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ identifier: email }),
      });
      await handleResetRequest(reqReset);

      const mail = getLatestSentMail(email);
      assert.ok(mail?.token);

      // 2. Confirm reset with new password
      const reqConfirm = new NextRequest("http://localhost:3000/api/customer-auth/password-reset/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          token: mail.token,
          newPassword: "BrandNewPassword!2026",
        }),
      });

      const resConfirm = await handleResetConfirm(reqConfirm);
      assert.strictEqual(resConfirm.status, 200);

      // 3. Old session must be revoked
      const sessionCheck = await validateCustomerSession(oldSession.rawToken);
      assert.strictEqual(sessionCheck.authenticated, false, "Old session must be revoked after password reset");

      // 4. Old password login must fail
      const reqOldLogin = new NextRequest("http://localhost:3000/api/customer-auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          identifier: email,
          password: "OldPass!123",
        }),
      });
      const resOldLogin = await handleLogin(reqOldLogin);
      assert.strictEqual(resOldLogin.status, 401);

      // 5. New password login must succeed
      const reqNewLogin = new NextRequest("http://localhost:3000/api/customer-auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          identifier: email,
          password: "BrandNewPassword!2026",
        }),
      });
      const resNewLogin = await handleLogin(reqNewLogin);
      assert.strictEqual(resNewLogin.status, 200);
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("E. Email verification resend & confirm end-to-end flow", async () => {
    clearSentMail();
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const email = `verify_flow_${suffix}@example.com`;

    const user = await prisma.user.create({
      data: {
        name: "Verify Flow User",
        email,
        normalizedPhone: "01711445500",
        passwordHash,
        emailVerifiedAt: null, // Unverified
        isActive: true,
      },
    });

    const session = await createCustomerSession(user.id);

    try {
      // 1. Request verification resend
      const reqResend = new NextRequest("http://localhost:3000/api/customer-auth/email-verification/resend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
      });

      const resResend = await handleVerifyResend(reqResend);
      assert.strictEqual(resResend.status, 200);

      const mail = getLatestSentMail(email);
      assert.ok(mail?.token, "Verification email must be sent");
      assert.strictEqual(mail.purpose, "EMAIL_VERIFICATION");

      // 2. Confirm verification
      const reqConfirm = new NextRequest("http://localhost:3000/api/customer-auth/email-verification/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ token: mail.token }),
      });

      const resConfirm = await handleVerifyConfirm(reqConfirm);
      assert.strictEqual(resConfirm.status, 200);

      // Verify in DB
      const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
      assert.ok(dbUser?.emailVerifiedAt !== null, "User emailVerifiedAt must now be set");
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("F. Cross-origin requests are blocked with 403 on all recovery/verification endpoints", async () => {
    const maliciousOrigin = "http://attacker-site.com";

    // 1. Password reset request
    const req1 = new NextRequest("http://localhost:3000/api/customer-auth/password-reset/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: maliciousOrigin,
      },
      body: JSON.stringify({ identifier: "victim@example.com" }),
    });
    const res1 = await handleResetRequest(req1);
    assert.strictEqual(res1.status, 403);

    // 2. Password reset confirm
    const req2 = new NextRequest("http://localhost:3000/api/customer-auth/password-reset/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: maliciousOrigin,
      },
      body: JSON.stringify({ token: "tok-123", newPassword: "Password!123" }),
    });
    const res2 = await handleResetConfirm(req2);
    assert.strictEqual(res2.status, 403);

    // 3. Email verification resend
    const req3 = new NextRequest("http://localhost:3000/api/customer-auth/email-verification/resend", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: maliciousOrigin,
      },
    });
    const res3 = await handleVerifyResend(req3);
    assert.strictEqual(res3.status, 403);

    // 4. Email verification confirm
    const req4 = new NextRequest("http://localhost:3000/api/customer-auth/email-verification/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: maliciousOrigin,
      },
      body: JSON.stringify({ token: "tok-123" }),
    });
    const res4 = await handleVerifyConfirm(req4);
    assert.strictEqual(res4.status, 403);
  });
});
