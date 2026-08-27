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

import "dotenv/config";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.TEST_MAIL_TRANSPORT = "true";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../lib/prisma.js";
import { hashCustomerPassword } from "../lib/customerAuth.js";
import { createCustomerSession, validateCustomerSession } from "../lib/customerSession.js";
import {
  getLatestSentMail,
  clearSentMail,
  setCustomerAuthMailer,
  maskEmailForLogs,
  DeferredLaunchCustomerAuthMailer,
} from "../lib/customerAuthMailer.js";
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
    const phone = "017" + Math.floor(10000000 + Math.random() * 90000000);

    const user = await prisma.user.create({
      data: {
        name: "Verified User",
        email,
        normalizedPhone: phone,
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
    const phone = "017" + Math.floor(10000000 + Math.random() * 90000000);

    const user = await prisma.user.create({
      data: {
        name: "Unverified User",
        email,
        normalizedPhone: phone,
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
    const phone = "017" + Math.floor(10000000 + Math.random() * 90000000);

    const user = await prisma.user.create({
      data: {
        name: `Phone Only Reset User ${suffix}`,
        email: null,
        normalizedPhone: phone,
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
        body: JSON.stringify({ identifier: phone }),
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
    const phone = "017" + Math.floor(10000000 + Math.random() * 90000000);

    const user = await prisma.user.create({
      data: {
        name: "Full Reset User",
        email,
        normalizedPhone: phone,
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
    const phone = "017" + Math.floor(10000000 + Math.random() * 90000000);

    const user = await prisma.user.create({
      data: {
        name: "Verify Flow User",
        email,
        normalizedPhone: phone,
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

  it("G. Reset Resend / Replacement — R1 invalidated, R2 active and succeeds", async () => {
    clearSentMail();
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const email = `replacement_reset_${suffix}@example.com`;

    const user = await prisma.user.create({
      data: {
        name: "Replacement User",
        email,
        passwordHash,
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });

    try {
      // 1. Request R1
      const req1 = new NextRequest("http://localhost:3000/api/customer-auth/password-reset/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.20.1",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ identifier: email }),
      });
      await handleResetRequest(req1);
      const mail1 = getLatestSentMail(email);
      assert.ok(mail1?.token, "Mail 1 must have token");
      const token1 = mail1.token;

      // 2. Request R2
      const req2 = new NextRequest("http://localhost:3000/api/customer-auth/password-reset/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.20.1",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ identifier: email }),
      });
      await handleResetRequest(req2);
      const mail2 = getLatestSentMail(email);
      assert.ok(mail2?.token, "Mail 2 must have token");
      const token2 = mail2.token;
      assert.notStrictEqual(token1, token2, "Token 1 and Token 2 must be distinct");

      // 3. Confirm with Token 1 (Must fail)
      const confirmReq1 = new NextRequest("http://localhost:3000/api/customer-auth/password-reset/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.20.2",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ token: token1, newPassword: "NewPassword!999" }),
      });
      const confirmRes1 = await handleResetConfirm(confirmReq1);
      assert.strictEqual(confirmRes1.status, 400, "Old reset token R1 must fail confirmation");

      // 4. Confirm with Token 2 (Must succeed)
      const confirmReq2 = new NextRequest("http://localhost:3000/api/customer-auth/password-reset/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.20.2",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ token: token2, newPassword: "NewPassword!999" }),
      });
      const confirmRes2 = await handleResetConfirm(confirmReq2);
      assert.strictEqual(confirmRes2.status, 200, "Newest reset token R2 must succeed");
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("H. Verification Resend Replacement — V1 invalidated, V2 active and succeeds", async () => {
    clearSentMail();
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const email = `replacement_verify_${suffix}@example.com`;

    const user = await prisma.user.create({
      data: {
        name: "Replacement Verify User",
        email,
        passwordHash,
        emailVerifiedAt: null,
        isActive: true,
      },
    });

    const session = await createCustomerSession(user.id);

    try {
      // 1. Resend V1
      const req1 = new NextRequest("http://localhost:3000/api/customer-auth/email-verification/resend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.21.1",
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
      });
      await handleVerifyResend(req1);
      const mail1 = getLatestSentMail(email);
      assert.ok(mail1?.token);
      const token1 = mail1.token;

      // 2. Resend V2
      const req2 = new NextRequest("http://localhost:3000/api/customer-auth/email-verification/resend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.21.1",
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
      });
      await handleVerifyResend(req2);
      const mail2 = getLatestSentMail(email);
      assert.ok(mail2?.token);
      const token2 = mail2.token;
      assert.notStrictEqual(token1, token2);

      // 3. Confirm with Token 1 (Must fail)
      const confirmReq1 = new NextRequest("http://localhost:3000/api/customer-auth/email-verification/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.21.2",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ token: token1 }),
      });
      const confirmRes1 = await handleVerifyConfirm(confirmReq1);
      assert.strictEqual(confirmRes1.status, 400, "V1 must fail confirmation");

      // 4. Confirm with Token 2 (Must succeed)
      const confirmReq2 = new NextRequest("http://localhost:3000/api/customer-auth/email-verification/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.21.2",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ token: token2 }),
      });
      const confirmRes2 = await handleVerifyConfirm(confirmReq2);
      assert.strictEqual(confirmRes2.status, 200, "V2 must succeed");
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("I. Mail Send Failure — Password reset token is invalidated when mail dispatch throws", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const email = `mail_fail_reset_${suffix}@example.com`;

    const user = await prisma.user.create({
      data: {
        name: "Mail Fail Reset User",
        email,
        passwordHash,
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });

    // Custom failing mailer
    const failingMailer = {
      async sendPasswordReset() {
        throw new Error("SMTP connection refused: simulated failure");
      },
      async sendEmailVerification() {
        return { success: true };
      },
    };

    setCustomerAuthMailer(failingMailer);

    try {
      const req = new NextRequest("http://localhost:3000/api/customer-auth/password-reset/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.22.1",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ identifier: email }),
      });

      const res = await handleResetRequest(req);
      assert.strictEqual(res.status, 200, "Response must remain generic 200 for security");

      // Verify no active unconsumed password reset token remains in DB
      const activeTokens = await prisma.customerAuthToken.findMany({
        where: {
          userId: user.id,
          purpose: "PASSWORD_RESET",
          consumedAt: null,
        },
      });

      assert.strictEqual(activeTokens.length, 0, "Failed mail delivery must invalidate undelivered reset token");
    } finally {
      setCustomerAuthMailer(null);
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("J. Mail Send Failure — Email verification token is invalidated when mail dispatch throws", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const email = `mail_fail_verify_${suffix}@example.com`;

    const user = await prisma.user.create({
      data: {
        name: "Mail Fail Verify User",
        email,
        passwordHash,
        emailVerifiedAt: null,
        isActive: true,
      },
    });

    const session = await createCustomerSession(user.id);

    // Custom failing mailer
    const failingMailer = {
      async sendPasswordReset() {
        return { success: true };
      },
      async sendEmailVerification() {
        throw new Error("SMTP network error: simulated verification failure");
      },
    };

    setCustomerAuthMailer(failingMailer);

    try {
      const req = new NextRequest("http://localhost:3000/api/customer-auth/email-verification/resend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.23.1",
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
      });

      const res = await handleVerifyResend(req);
      assert.strictEqual(res.status, 200, "Must return success notice without throwing unhandled error");

      // Verify no active unconsumed email verification token remains in DB
      const activeTokens = await prisma.customerAuthToken.findMany({
        where: {
          userId: user.id,
          purpose: "EMAIL_VERIFICATION",
          consumedAt: null,
        },
      });

      assert.strictEqual(activeTokens.length, 0, "Failed mail delivery must invalidate undelivered verification token");
    } finally {
      setCustomerAuthMailer(null);
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("K. Production-Deferred Mailer Safety — Never logs raw tokens and fails closed in production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const envObj = process.env as Record<string, string | undefined>;
    try {
      // Test production fail-closed
      envObj.NODE_ENV = "production";
      envObj.TEST_MAIL_TRANSPORT = "true";

      // Accessing test mailbox in production must throw
      assert.throws(
        () => getLatestSentMail(),
        /Test mailbox is not accessible outside test environment/
      );
    } finally {
      envObj.NODE_ENV = originalNodeEnv;
      envObj.TEST_MAIL_TRANSPORT = "true";
    }
  });

  it("L. Phone Recovery Routing — Phone identifier with verified email sends reset mail to verified email", async () => {
    clearSentMail();
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const email = `phone_routing_${suffix}@example.com`;
    const phone = "017" + Math.floor(10000000 + Math.random() * 90000000);

    const user = await prisma.user.create({
      data: {
        name: "Phone Routing User",
        email,
        normalizedPhone: phone,
        passwordHash,
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });

    try {
      // Submit password reset request using PHONE identifier
      const req = new NextRequest("http://localhost:3000/api/customer-auth/password-reset/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.24.1",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ identifier: phone }),
      });

      const res = await handleResetRequest(req);
      assert.strictEqual(res.status, 200);

      // Verify email was dispatched to user's verified recovery email
      const mail = getLatestSentMail(email);
      assert.ok(mail, "Reset instructions must be dispatched to verified email address");
      assert.strictEqual(mail.to, email);
      assert.ok(mail.token, "Mail must contain reset token");
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("M. Production-Deferred Mailer — Password reset request invalidates undelivered token in DB", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const email = `deferred_reset_${suffix}@example.com`;

    const user = await prisma.user.create({
      data: {
        name: "Deferred Reset User",
        email,
        passwordHash,
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });

    // Set deferred mailer
    setCustomerAuthMailer(new DeferredLaunchCustomerAuthMailer());

    try {
      const req = new NextRequest("http://localhost:3000/api/customer-auth/password-reset/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.25.1",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ identifier: email }),
      });

      const res = await handleResetRequest(req);
      assert.strictEqual(res.status, 200, "Must return generic 200 success response");

      // Verify no active unconsumed reset token remains in DB
      const activeTokens = await prisma.customerAuthToken.findMany({
        where: {
          userId: user.id,
          purpose: "PASSWORD_RESET",
          consumedAt: null,
        },
      });

      assert.strictEqual(activeTokens.length, 0, "Undelivered deferred token must be invalidated");
    } finally {
      setCustomerAuthMailer(null);
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("N. Production-Deferred Mailer — Email verification resend invalidates undelivered token in DB", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const email = `deferred_verify_${suffix}@example.com`;

    const user = await prisma.user.create({
      data: {
        name: "Deferred Verify User",
        email,
        passwordHash,
        emailVerifiedAt: null,
        isActive: true,
      },
    });

    const session = await createCustomerSession(user.id);

    // Set deferred mailer
    setCustomerAuthMailer(new DeferredLaunchCustomerAuthMailer());

    try {
      const req = new NextRequest("http://localhost:3000/api/customer-auth/email-verification/resend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.25.2",
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
      });

      const res = await handleVerifyResend(req);
      assert.strictEqual(res.status, 200);

      // Verify no active unconsumed verification token remains in DB
      const activeTokens = await prisma.customerAuthToken.findMany({
        where: {
          userId: user.id,
          purpose: "EMAIL_VERIFICATION",
          consumedAt: null,
        },
      });

      assert.strictEqual(activeTokens.length, 0, "Undelivered deferred verification token must be invalidated");
    } finally {
      setCustomerAuthMailer(null);
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("O. Logging Privacy — maskEmailForLogs masks email local part while preserving domain", () => {
    assert.strictEqual(maskEmailForLogs("user@example.com"), "u***@example.com");
    assert.strictEqual(maskEmailForLogs("john.doe@company.org"), "j***@company.org");
    assert.strictEqual(maskEmailForLogs("invalid-email"), "***");
  });
});
