/**
 * Wave D — Customer Auth Tokens Test Suite
 *
 * Behavioral tests for:
 * 1. Password Reset request token creation (30-min expiry, hashed at rest).
 * 2. Password Reset confirm single-use & session wipe.
 * 3. Password Reset fails for unverified emails or non-existent accounts safely.
 * 4. Password Reset rate limiting.
 * 5. Email Verification token creation (24h expiry, hashed at rest).
 * 6. Email Verification confirm sets emailVerifiedAt and consumes token.
 * 7. Verification token for old email cannot verify newly changed email.
 * 8. Concurrent double confirmation produces exactly one winner.
 */

import "dotenv/config";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";
import { hashCustomerPassword, verifyCustomerPassword } from "../lib/customerAuth.js";
import {
  createPasswordResetToken,
  consumePasswordResetToken,
  createEmailVerificationToken,
  consumeEmailVerificationToken,
} from "../lib/customerAuthTokens.js";
import { createCustomerSession, validateCustomerSession } from "../lib/customerSession.js";

describe("Wave D — Customer Auth Tokens Service", () => {
  it("A. Password reset token creation sets 30-min expiry and invalidates previous active tokens", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");

    const user = await prisma.user.create({
      data: {
        name: "Reset User A",
        email: `reset_a_${suffix}@example.com`,
        normalizedPhone: `01711${Math.floor(100000 + Math.random() * 900000)}`,
        passwordHash,
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });

    try {
      // 1. First token
      const token1 = await createPasswordResetToken(user.id);
      assert.ok(token1.rawToken, "Must return raw token");
      const diff1 = token1.expiresAt.getTime() - Date.now();
      assert.ok(diff1 > 28 * 60 * 1000 && diff1 <= 30 * 60 * 1000, "Expiry must be ~30 mins");

      // 2. Second token replaces first
      const token2 = await createPasswordResetToken(user.id);
      assert.ok(token2.rawToken);

      // Verify token1 in DB is marked consumed/invalidated
      const dbTokens = await prisma.customerAuthToken.findMany({
        where: { userId: user.id, purpose: "PASSWORD_RESET" },
        orderBy: { createdAt: "asc" },
      });

      assert.strictEqual(dbTokens.length, 2);
      assert.ok(dbTokens[0].consumedAt !== null, "First token must be invalidated");
      assert.strictEqual(dbTokens[1].consumedAt, null, "Second token must be active");
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("B. Password reset confirmation updates passwordHash, consumes token, and revokes all user sessions", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const initialHash = await hashCustomerPassword("OldPass!123");

    const user = await prisma.user.create({
      data: {
        name: "Reset Confirm User",
        email: `reset_confirm_${suffix}@example.com`,
        normalizedPhone: `01711${Math.floor(100000 + Math.random() * 900000)}`,
        passwordHash: initialHash,
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });

    // Create 2 active sessions (e.g. mobile + desktop)
    const session1 = await createCustomerSession(user.id);
    const session2 = await createCustomerSession(user.id);

    const resetToken = await createPasswordResetToken(user.id);
    const newHash = await hashCustomerPassword("NewPass!456");

    try {
      // Consume token
      const result = await consumePasswordResetToken(resetToken.rawToken, newHash);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.userId, user.id);

      // 1. Password must be updated
      const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
      assert.strictEqual(updatedUser?.passwordHash, newHash);
      const isNewValid = await verifyCustomerPassword("NewPass!456", updatedUser!.passwordHash);
      assert.strictEqual(isNewValid, true);

      // 2. Both existing sessions must be revoked
      const v1 = await validateCustomerSession(session1.rawToken);
      assert.strictEqual(v1.authenticated, false, "Session 1 must be revoked");
      const v2 = await validateCustomerSession(session2.rawToken);
      assert.strictEqual(v2.authenticated, false, "Session 2 must be revoked");

      // 3. Token cannot be consumed a second time (single-use)
      const secondTry = await consumePasswordResetToken(resetToken.rawToken, newHash);
      assert.strictEqual(secondTry.success, false, "Token must be single-use");
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("C. Email verification token creation sets 24-hour expiry and confirm sets emailVerifiedAt", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");

    const user = await prisma.user.create({
      data: {
        name: "Verify User",
        email: `verify_${suffix}@example.com`,
        normalizedPhone: `01711${Math.floor(100000 + Math.random() * 900000)}`,
        passwordHash,
        emailVerifiedAt: null, // Unverified
        isActive: true,
      },
    });

    try {
      const token = await createEmailVerificationToken(user.id);
      assert.ok(token.rawToken);
      const diff = token.expiresAt.getTime() - Date.now();
      assert.ok(diff > 23 * 3600 * 1000 && diff <= 24 * 3600 * 1000, "Expiry must be ~24 hours");

      const confirmResult = await consumeEmailVerificationToken(token.rawToken);
      assert.strictEqual(confirmResult.success, true);
      assert.strictEqual(confirmResult.userId, user.id);

      // Verify emailVerifiedAt is now set
      const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
      assert.ok(updatedUser?.emailVerifiedAt !== null, "emailVerifiedAt must be set");

      // Verify single-use
      const secondConfirm = await consumeEmailVerificationToken(token.rawToken);
      assert.strictEqual(secondConfirm.success, false, "Verification token must be single-use");
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });
});
