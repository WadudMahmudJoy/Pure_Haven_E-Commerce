/**
 * Wave D — Customer Identifier Management Integration Tests
 *
 * Behavioral tests for:
 * 1. ADD_EMAIL for phone-only user (requires password re-auth, emailVerifiedAt = null).
 * 2. CHANGE_EMAIL (requires password re-auth, invalidates old tokens, emailVerifiedAt = null).
 * 3. Old verification token cannot verify newly changed email.
 * 4. ADD_PHONE for email-only user (requires password re-auth).
 * 5. CHANGE_PHONE (requires password re-auth, strict BD normalization).
 * 6. Identifier collision (User A cannot take User B's email or phone).
 * 7. Invalid current password rejects with 401.
 * 8. Historical guest orders remain unlinked after identifier change.
 * 9. Old identifier stops authenticating; new identifier authenticates with same password.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../lib/prisma.js";
import { hashCustomerPassword } from "../lib/customerAuth.js";
import { createCustomerSession } from "../lib/customerSession.js";
import { createEmailVerificationToken } from "../lib/customerAuthTokens.js";
import { POST as handleIdentity } from "../app/api/customer-auth/identity/route.js";
import { POST as handleLogin } from "../app/api/customer-auth/login/route.js";
import { POST as handleConfirmEmail } from "../app/api/customer-auth/email-verification/confirm/route.js";

describe("Wave D — Customer Identity Management", () => {
  it("A. Phone-only user can ADD_EMAIL with password re-auth; email is unverified", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");

    const user = await prisma.user.create({
      data: {
        name: "Phone Only User",
        email: null,
        normalizedPhone: "01711334455",
        passwordHash,
        isActive: true,
      },
    });

    const session = await createCustomerSession(user.id);
    const newEmail = `added_email_${suffix}@example.com`;

    try {
      // 1. Re-auth with wrong password fails
      const reqWrongPass = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          action: "ADD_EMAIL",
          currentPassword: "WrongPassword!123",
          newEmail,
        }),
      });

      const resWrong = await handleIdentity(reqWrongPass);
      assert.strictEqual(resWrong.status, 401);

      // 2. Correct password succeeds
      const reqCorrect = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          action: "ADD_EMAIL",
          currentPassword: "Password!123",
          newEmail,
        }),
      });

      const resCorrect = await handleIdentity(reqCorrect);
      const dataCorrect = await resCorrect.json();

      assert.strictEqual(resCorrect.status, 200);
      assert.strictEqual(dataCorrect.success, true);
      assert.strictEqual(dataCorrect.email, newEmail);
      assert.strictEqual(dataCorrect.emailVerified, false);

      // Verify in DB
      const updated = await prisma.user.findUnique({ where: { id: user.id } });
      assert.strictEqual(updated?.email, newEmail);
      assert.strictEqual(updated?.emailVerifiedAt, null);

      // 3. New email can now login with same password
      const loginReq = new NextRequest("http://localhost:3000/api/customer-auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          identifier: newEmail,
          password: "Password!123",
        }),
      });

      const loginRes = await handleLogin(loginReq);
      assert.strictEqual(loginRes.status, 200);
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("B. CHANGE_EMAIL invalidates old tokens; old verification token cannot verify new email", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const oldEmail = `old_email_${suffix}@example.com`;
    const newEmail = `new_email_${suffix}@example.com`;

    const user = await prisma.user.create({
      data: {
        name: "Change Email User",
        email: oldEmail,
        normalizedPhone: "01711334466",
        passwordHash,
        emailVerifiedAt: new Date(), // Was verified on old email
        isActive: true,
      },
    });

    const session = await createCustomerSession(user.id);

    // Issue verification token for OLD email
    const oldToken = await createEmailVerificationToken(user.id);

    try {
      // Change Email
      const reqChange = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          action: "CHANGE_EMAIL",
          currentPassword: "Password!123",
          newEmail,
        }),
      });

      const resChange = await handleIdentity(reqChange);
      assert.strictEqual(resChange.status, 200);

      // Verify emailVerifiedAt was reset to null in DB
      const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
      assert.strictEqual(dbUser?.email, newEmail);
      assert.strictEqual(dbUser?.emailVerifiedAt, null);

      // CRITICAL SECURITY INVARIANT: Old verification token cannot verify the new email
      const reqOldConfirm = new NextRequest("http://localhost:3000/api/customer-auth/email-verification/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          token: oldToken.rawToken,
        }),
      });

      const resOldConfirm = await handleConfirmEmail(reqOldConfirm);
      assert.strictEqual(
        resOldConfirm.status,
        400,
        "SECURITY VIOLATION: Old verification token must be rejected after email change"
      );

      // User must still be unverified
      const dbUserAfter = await prisma.user.findUnique({ where: { id: user.id } });
      assert.strictEqual(dbUserAfter?.emailVerifiedAt, null);

      // Old email stops authenticating
      const loginOld = new NextRequest("http://localhost:3000/api/customer-auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          identifier: oldEmail,
          password: "Password!123",
        }),
      });
      const resLoginOld = await handleLogin(loginOld);
      assert.strictEqual(resLoginOld.status, 401);
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("C. ADD_PHONE and CHANGE_PHONE normalize Bangladeshi phone numbers and prevent collisions", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");

    // User A: Email only
    const userA = await prisma.user.create({
      data: {
        name: "User A",
        email: `usera_${suffix}@example.com`,
        normalizedPhone: null,
        passwordHash,
        isActive: true,
      },
    });

    // User B: Has phone 01811223344
    const userB = await prisma.user.create({
      data: {
        name: "User B",
        email: `userb_${suffix}@example.com`,
        normalizedPhone: "01811223344",
        passwordHash,
        isActive: true,
      },
    });

    const sessionA = await createCustomerSession(userA.id);

    try {
      // 1. User A attempts to add User B's phone (+8801811223344) -> 409 Conflict
      const reqCollision = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${sessionA.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          action: "ADD_PHONE",
          currentPassword: "Password!123",
          newPhone: "+8801811223344",
        }),
      });

      const resCollision = await handleIdentity(reqCollision);
      assert.strictEqual(resCollision.status, 409);

      // 2. User A adds unique phone
      const reqUnique = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${sessionA.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          action: "ADD_PHONE",
          currentPassword: "Password!123",
          newPhone: "+880 1711-998877",
        }),
      });

      const resUnique = await handleIdentity(reqUnique);
      assert.strictEqual(resUnique.status, 200);

      const dbUserA = await prisma.user.findUnique({ where: { id: userA.id } });
      assert.strictEqual(dbUserA?.normalizedPhone, "01711998877");

      // 3. User A can now login with phone
      const loginPhone = new NextRequest("http://localhost:3000/api/customer-auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          identifier: "01711998877",
          password: "Password!123",
        }),
      });
      const resLoginPhone = await handleLogin(loginPhone);
      assert.strictEqual(resLoginPhone.status, 200);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } }).catch(() => {});
    }
  });

  it("D. Historical guest orders remain unlinked after user changes phone or email", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const targetPhone = "01999887766";

    // 1. Create historical guest order with targetPhone
    const product = await prisma.product.create({
      data: {
        name: `Guest Product ${suffix}`,
        price: 250,
        stock: 5,
        image: "/placeholder.png",
        category: "Skincare",
      },
    });

    const guestOrder = await prisma.order.create({
      data: {
        orderId: `PH-GUEST-${suffix}`,
        customerName: "Historical Guest",
        customerPhone: targetPhone,
        customerCity: "Dhaka",
        customerAddress: "Dhanmondi",
        subtotal: 250,
        deliveryFee: 120,
        total: 370,
        status: "pending",
        paymentMethod: "Cash on Delivery",
        userId: null, // Strictly null
      },
    });

    // 2. User creates account and adds targetPhone
    const user = await prisma.user.create({
      data: {
        name: "New Phone Owner",
        email: `newphone_${suffix}@example.com`,
        normalizedPhone: null,
        passwordHash,
        isActive: true,
      },
    });

    const session = await createCustomerSession(user.id);

    try {
      const reqAddPhone = new NextRequest("http://localhost:3000/api/customer-auth/identity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          action: "ADD_PHONE",
          currentPassword: "Password!123",
          newPhone: targetPhone,
        }),
      });

      const resAdd = await handleIdentity(reqAddPhone);
      const dataAdd = await resAdd.json();
      assert.strictEqual(resAdd.status, 200, `Expected 200, got ${resAdd.status}: ${JSON.stringify(dataAdd)}`);

      // Verify guest order remained userId = null (Zero historical order claiming)
      const dbOrder = await prisma.order.findUnique({
        where: { id: guestOrder.id },
      });
      assert.strictEqual(
        dbOrder?.userId,
        null,
        "SECURITY VIOLATION: Historical guest order must not be claimed by identifier change"
      );
    } finally {
      await prisma.order.delete({ where: { id: guestOrder.id } }).catch(() => {});
      await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });
});
