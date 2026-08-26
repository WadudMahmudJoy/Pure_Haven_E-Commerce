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

describe("Wave D — Real PostgreSQL Customer Auth Concurrency & Integrity", () => {
  before(async () => {
    const safety = validateTestDatabaseSafety();
    assert.strictEqual(safety.safe, true, `Database safety check failed: ${safety.reason}`);
  });

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
});
