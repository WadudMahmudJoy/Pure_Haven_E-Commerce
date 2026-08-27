/**
 * Real PostgreSQL Customer Auth Concurrency & Race Condition Test Suite (Phase 3 Wave D)
 *
 * Runs exclusively against DATABASE_URL_TEST.
 * Validates real B-tree uniqueness, atomic transactions, single-use token consumption,
 * session revocation, and race condition linearization under concurrent load.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../lib/prisma.js";
import { validateTestDatabaseSafety } from "./db-safety.js";
import { hashCustomerPassword } from "../../lib/customerAuth.js";
import {
  createPasswordResetToken,
  consumePasswordResetToken,
  createEmailVerificationToken,
  consumeEmailVerificationToken,
} from "../../lib/customerAuthTokens.js";
import { createCustomerSession, validateCustomerSession } from "../../lib/customerSession.js";
import { POST as handleIdentity } from "../../app/api/customer-auth/identity/route.js";
import { POST as handleVerifyConfirm } from "../../app/api/customer-auth/email-verification/confirm/route.js";
import { POST as handleResetConfirm } from "../../app/api/customer-auth/password-reset/confirm/route.js";
import { POST as handleLogin } from "../../app/api/customer-auth/login/route.js";
import { GET as handleCustomerOrders } from "../../app/api/customer-orders/route.js";

const safety = validateTestDatabaseSafety();

describe(
  "Wave D — Real PostgreSQL Customer Auth Concurrency & Integrity",
  {
    skip:
      !safety.safe &&
      "TEST_DATABASE_REQUIRED: Set DATABASE_URL_TEST to run real PostgreSQL concurrency tests",
  },
  () => {

  it("1. Concurrent Password Reset Confirmation Race — Exactly one winner consumes token and updates password", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("OldPassword!123");

    const user = await prisma.user.create({
      data: {
        name: "Concurrent Reset User",
        email: `concurrent_reset_${suffix}@example.com`,
        normalizedPhone: "01711556611",
        passwordHash,
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });

    const resetToken = await createPasswordResetToken(user.id);
    const newHash = await hashCustomerPassword("NewPassword!999");

    try {
      // Dispatch 2 concurrent confirmations with the exact same token
      const [res1, res2] = await Promise.all([
        consumePasswordResetToken(resetToken.rawToken, newHash),
        consumePasswordResetToken(resetToken.rawToken, newHash),
      ]);

      const successes = [res1, res2].filter((r) => r.success);
      const failures = [res1, res2].filter((r) => !r.success);

      assert.strictEqual(successes.length, 1, "Exactly ONE concurrent reset confirm must succeed");
      assert.strictEqual(failures.length, 1, "Competing contender must fail closed");

      // Verify token in DB is consumed
      const dbTokens = await prisma.customerAuthToken.findMany({
        where: { userId: user.id, purpose: "PASSWORD_RESET" },
      });
      assert.strictEqual(dbTokens.length, 1);
      assert.ok(dbTokens[0].consumedAt !== null, "Token must be marked consumed");
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("2. Concurrent Email Verification Confirmation Race — Exactly one winner claims token", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");

    const user = await prisma.user.create({
      data: {
        name: "Concurrent Verify User",
        email: `concurrent_verify_${suffix}@example.com`,
        normalizedPhone: "01711556622",
        passwordHash,
        emailVerifiedAt: null,
        isActive: true,
      },
    });

    const token = await createEmailVerificationToken(user.id);

    try {
      const [res1, res2] = await Promise.all([
        consumeEmailVerificationToken(token.rawToken),
        consumeEmailVerificationToken(token.rawToken),
      ]);

      const successes = [res1, res2].filter((r) => r.success);
      const failures = [res1, res2].filter((r) => !r.success);

      assert.strictEqual(successes.length, 1, "Exactly ONE verification claim must succeed");
      assert.strictEqual(failures.length, 1, "Competing claim must fail");

      const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
      assert.ok(dbUser?.emailVerifiedAt !== null);
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("3. Password Reset revokes ALL active multi-device sessions in single transaction", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Pass12345!");

    const user = await prisma.user.create({
      data: {
        name: "Multi Session User",
        email: `multisession_${suffix}@example.com`,
        normalizedPhone: "01711556633",
        passwordHash,
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });

    // 3 active sessions across different devices
    const s1 = await createCustomerSession(user.id);
    const s2 = await createCustomerSession(user.id);
    const s3 = await createCustomerSession(user.id);

    const resetToken = await createPasswordResetToken(user.id);
    const newHash = await hashCustomerPassword("NewPass9999!");

    try {
      const res = await consumePasswordResetToken(resetToken.rawToken, newHash);
      assert.strictEqual(res.success, true);

      // Verify all 3 sessions are revoked
      const [v1, v2, v3] = await Promise.all([
        validateCustomerSession(s1.rawToken),
        validateCustomerSession(s2.rawToken),
        validateCustomerSession(s3.rawToken),
      ]);

      assert.strictEqual(v1.authenticated, false);
      assert.strictEqual(v2.authenticated, false);
      assert.strictEqual(v3.authenticated, false);
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("4. Concurrent Duplicate Second Email Claim — Exactly ONE winner attaches email, other returns 409", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const contestedEmail = `contested_${suffix}@example.com`;

    const userA = await prisma.user.create({
      data: {
        name: "Contender A",
        email: null,
        normalizedPhone: "01711556644",
        passwordHash,
        isActive: true,
      },
    });

    const userB = await prisma.user.create({
      data: {
        name: "Contender B",
        email: null,
        normalizedPhone: "01711556655",
        passwordHash,
        isActive: true,
      },
    });

    const sessionA = await createCustomerSession(userA.id);
    const sessionB = await createCustomerSession(userB.id);

    try {
      const reqA = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.10.1",
          cookie: `pure_haven_customer_session=${sessionA.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          action: "ADD_EMAIL",
          currentPassword: "Password!123",
          newEmail: contestedEmail,
        }),
      });

      const reqB = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.10.2",
          cookie: `pure_haven_customer_session=${sessionB.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          action: "ADD_EMAIL",
          currentPassword: "Password!123",
          newEmail: contestedEmail,
        }),
      });

      const [resA, resB] = await Promise.all([handleIdentity(reqA), handleIdentity(reqB)]);

      const statuses = [resA.status, resB.status].sort();
      assert.deepStrictEqual(
        statuses,
        [200, 409],
        `Concurrent email attachment must produce exactly one 200 and one 409, got ${JSON.stringify(statuses)}`
      );

      // Verify DB state: exactly one user owns the email
      const count = await prisma.user.count({ where: { email: contestedEmail } });
      assert.strictEqual(count, 1, "Exactly one User row may have the contested email");
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } }).catch(() => {});
    }
  });

  it("5. Concurrent Equivalent Phone Format Claim — Formats (+880 vs 01) resolve to same canonical and collide safely", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");

    const userA = await prisma.user.create({
      data: {
        name: "Phone Contender A",
        email: `phone_contender_a_${suffix}@example.com`,
        normalizedPhone: null,
        passwordHash,
        isActive: true,
      },
    });

    const userB = await prisma.user.create({
      data: {
        name: "Phone Contender B",
        email: `phone_contender_b_${suffix}@example.com`,
        normalizedPhone: null,
        passwordHash,
        isActive: true,
      },
    });

    const sessionA = await createCustomerSession(userA.id);
    const sessionB = await createCustomerSession(userB.id);

    try {
      // User A submits formatted: +880 1711-667788
      const reqA = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.11.1",
          cookie: `pure_haven_customer_session=${sessionA.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          action: "ADD_PHONE",
          currentPassword: "Password!123",
          newPhone: "+880 1711-667788",
        }),
      });

      // User B submits local: 01711667788
      const reqB = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.11.2",
          cookie: `pure_haven_customer_session=${sessionB.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          action: "ADD_PHONE",
          currentPassword: "Password!123",
          newPhone: "01711667788",
        }),
      });

      const [resA, resB] = await Promise.all([handleIdentity(reqA), handleIdentity(reqB)]);

      const statuses = [resA.status, resB.status].sort();
      assert.deepStrictEqual(
        statuses,
        [200, 409],
        `Concurrent equivalent phone attachment must produce exactly one 200 and one 409, got ${JSON.stringify(statuses)}`
      );

      const count = await prisma.user.count({ where: { normalizedPhone: "01711667788" } });
      assert.strictEqual(count, 1, "Exactly one User row may have canonical phone 01711667788");
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } }).catch(() => {});
    }
  });

  it("6. Sequential Old Verification Token cannot verify newly changed email", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const oldEmail = `seq_old_${suffix}@example.com`;
    const newEmail = `seq_new_${suffix}@example.com`;

    const user = await prisma.user.create({
      data: {
        name: "Seq Email User",
        email: oldEmail,
        passwordHash,
        emailVerifiedAt: null,
        isActive: true,
      },
    });

    const tokenOld = await createEmailVerificationToken(user.id);
    const session = await createCustomerSession(user.id);

    try {
      // 1. CHANGE EMAIL to newEmail
      const changeReq = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.30.1",
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          action: "CHANGE_EMAIL",
          currentPassword: "Password!123",
          newEmail,
        }),
      });

      const changeRes = await handleIdentity(changeReq);
      assert.strictEqual(changeRes.status, 200);

      // 2. Attempt verification with T-old
      const verifyReq = new NextRequest("http://localhost:3000/api/customer-auth/email-verification/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.30.2",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ token: tokenOld.rawToken }),
      });

      const verifyRes = await handleVerifyConfirm(verifyReq);
      assert.strictEqual(verifyRes.status, 400, "Old token T-old must fail verification after email change");

      // 3. Verify DB state: newEmail remains unverified
      const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
      assert.strictEqual(dbUser?.email, newEmail);
      assert.strictEqual(dbUser?.emailVerifiedAt, null, "newEmail must remain unverified");
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("7. Concurrent Old Verification Token Confirm vs Email Change — new email NEVER inherits verification", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const oldEmail = `race_old_${suffix}@example.com`;
    const newEmail = `race_new_${suffix}@example.com`;

    const user = await prisma.user.create({
      data: {
        name: "Race Email User",
        email: oldEmail,
        passwordHash,
        emailVerifiedAt: null,
        isActive: true,
      },
    });

    const tokenOld = await createEmailVerificationToken(user.id);
    const session = await createCustomerSession(user.id);

    try {
      const confirmReq = new NextRequest("http://localhost:3000/api/customer-auth/email-verification/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.31.1",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ token: tokenOld.rawToken }),
      });

      const changeReq = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.31.2",
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          action: "CHANGE_EMAIL",
          currentPassword: "Password!123",
          newEmail,
        }),
      });

      // Execute concurrently
      const [confirmRes, changeRes] = await Promise.all([
        handleVerifyConfirm(confirmReq),
        handleIdentity(changeReq),
      ]);

      assert.ok([200, 400].includes(confirmRes.status));
      assert.strictEqual(changeRes.status, 200);

      // Verify invariant: newEmail MUST NOT be verified by T-old
      const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
      assert.strictEqual(dbUser?.email, newEmail);
      assert.strictEqual(
        dbUser?.emailVerifiedAt,
        null,
        "CRITICAL INVARIANT: new email must NEVER be verified by old token"
      );
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("8. Stale Reset Token Invalid After Email Change — R-old fails confirmation", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const oldEmail = `stale_reset_old_${suffix}@example.com`;
    const newEmail = `stale_reset_new_${suffix}@example.com`;

    const user = await prisma.user.create({
      data: {
        name: "Stale Reset User",
        email: oldEmail,
        passwordHash,
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });

    const resetOld = await createPasswordResetToken(user.id);
    const session = await createCustomerSession(user.id);

    try {
      // User changes email to newEmail
      const changeReq = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.32.1",
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          action: "CHANGE_EMAIL",
          currentPassword: "Password!123",
          newEmail,
        }),
      });
      const changeRes = await handleIdentity(changeReq);
      assert.strictEqual(changeRes.status, 200);

      // Attempt to confirm password reset with R-old
      const confirmReq = new NextRequest("http://localhost:3000/api/customer-auth/password-reset/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.32.2",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          token: resetOld.rawToken,
          newPassword: "AttackerNewPass!123",
        }),
      });

      const confirmRes = await handleResetConfirm(confirmReq);
      assert.strictEqual(confirmRes.status, 400, "Stale reset token R-old must fail reset confirmation");
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("9. Changed Identifier Login Semantics — Old identifier fails, new identifier succeeds", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const oldEmail = `login_old_${suffix}@example.com`;
    const newEmail = `login_new_${suffix}@example.com`;
    const oldPhone = "01711778811";
    const newPhone = "01711778822";

    const user = await prisma.user.create({
      data: {
        name: "Login Semantics User",
        email: oldEmail,
        normalizedPhone: oldPhone,
        passwordHash,
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });

    const session = await createCustomerSession(user.id);

    try {
      // 1. Change email to newEmail
      const emailChangeReq = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.33.1",
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          action: "CHANGE_EMAIL",
          currentPassword: "Password!123",
          newEmail,
        }),
      });
      await handleIdentity(emailChangeReq);

      // 2. Change phone to newPhone
      const phoneChangeReq = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.33.2",
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          action: "CHANGE_PHONE",
          currentPassword: "Password!123",
          newPhone: `+880 ${newPhone.slice(1)}`,
        }),
      });
      const phoneChangeRes = await handleIdentity(phoneChangeReq);
      assert.strictEqual(phoneChangeRes.status, 200, "Phone change must succeed");

      // 3. Test Old Email Login (Must fail 401)
      const oldEmailLoginReq = new NextRequest("http://localhost:3000/api/customer-auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.33.3",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ identifier: oldEmail, password: "Password!123" }),
      });
      const oldEmailRes = await handleLogin(oldEmailLoginReq);
      assert.strictEqual(oldEmailRes.status, 401, "Old email login must fail");

      // 4. Test Old Phone Login (Must fail 401)
      const oldPhoneLoginReq = new NextRequest("http://localhost:3000/api/customer-auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.33.4",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ identifier: oldPhone, password: "Password!123" }),
      });
      const oldPhoneRes = await handleLogin(oldPhoneLoginReq);
      assert.strictEqual(oldPhoneRes.status, 401, "Old phone login must fail");

      // 5. Test New Email Login (Must succeed 200)
      const newEmailLoginReq = new NextRequest("http://localhost:3000/api/customer-auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.33.5",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ identifier: newEmail, password: "Password!123" }),
      });
      const newEmailRes = await handleLogin(newEmailLoginReq);
      assert.strictEqual(newEmailRes.status, 200, "New email login must succeed");

      // 6. Test New Phone Login (Must succeed 200)
      const newPhoneLoginReq = new NextRequest("http://localhost:3000/api/customer-auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.33.6",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ identifier: newPhone, password: "Password!123" }),
      });
      const newPhoneRes = await handleLogin(newPhoneLoginReq);
      assert.strictEqual(newPhoneRes.status, 200, "New phone login must succeed");
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("10. Historical Guest Orders Remain Unlinked After Identity Change", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const phone = "01711889900";
    const initialEmail = `initial_${suffix}@example.com`;
    const targetEmail = `target_${suffix}@example.com`;

    // 1. Create a historical guest order (userId = null) matching phone & targetEmail
    const guestOrder = await prisma.order.create({
      data: {
        orderId: `PH-GUEST-${suffix.toUpperCase()}`,
        customerName: "Historical Guest",
        customerPhone: phone,
        customerAddress: "Dhaka",
        customerCity: "Dhaka",
        subtotal: 1000,
        deliveryFee: 100,
        total: 1100,
        status: "confirmed",
        paymentMethod: "cod",
        paymentStatus: "PENDING",
        userId: null,
      },
    });

    // 2. Create user with initialEmail and no phone
    const user = await prisma.user.create({
      data: {
        name: "Order Isolation User",
        email: initialEmail,
        normalizedPhone: null,
        passwordHash,
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });

    const session = await createCustomerSession(user.id);

    try {
      // 3. User adds the phone matching the guest order
      const addPhoneReq = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.34.1",
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          action: "ADD_PHONE",
          currentPassword: "Password!123",
          newPhone: phone,
        }),
      });
      const addPhoneRes = await handleIdentity(addPhoneReq);
      assert.strictEqual(addPhoneRes.status, 200);

      // 4. User changes email to targetEmail
      const changeEmailReq = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.99.34.2",
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          action: "CHANGE_EMAIL",
          currentPassword: "Password!123",
          newEmail: targetEmail,
        }),
      });
      const changeEmailRes = await handleIdentity(changeEmailReq);
      assert.strictEqual(changeEmailRes.status, 200);

      // 5. Verify Order.userId in database is STILL null
      const refreshedOrder = await prisma.order.findUnique({ where: { id: guestOrder.id } });
      assert.strictEqual(refreshedOrder?.userId, null, "Historical Order.userId must remain null");

      // 6. Verify GET /api/customer-orders returns 0 orders for this user
      const ordersReq = new NextRequest("http://localhost:3000/api/customer-orders", {
        method: "GET",
        headers: {
          cookie: `pure_haven_customer_session=${session.rawToken}`,
        },
      });
      const ordersRes = await handleCustomerOrders(ordersReq);
      assert.strictEqual(ordersRes.status, 200);
      const ordersData = await ordersRes.json();
      assert.deepStrictEqual(ordersData.orders, [], "Historical guest orders must NOT be returned to user");
    } finally {
      await prisma.order.delete({ where: { id: guestOrder.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });
});
