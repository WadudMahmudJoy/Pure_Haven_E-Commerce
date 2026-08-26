/**
 * Customer Auth Token Service (Phase 3 Wave D)
 *
 * Manages opaque single-use tokens for:
 * 1. PASSWORD_RESET (30-minute expiry, revokes all sessions on confirm)
 * 2. EMAIL_VERIFICATION (24-hour expiry, sets emailVerifiedAt on confirm)
 *
 * Security Invariants:
 * - Tokens stored as SHA-256 hashes at rest.
 * - Single-use consumption enforced atomically in PostgreSQL transactions.
 * - Prior unconsumed tokens for the same user & purpose are invalidated when a new token is requested.
 */

import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const PASSWORD_RESET_TOKEN_EXPIRY_MINUTES = 30;
export const EMAIL_VERIFICATION_TOKEN_EXPIRY_HOURS = 24;

export function hashAuthToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateRawAuthToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Creates a new PASSWORD_RESET token for a user.
 * Atomically invalidates any existing unconsumed PASSWORD_RESET tokens for this user.
 */
export async function createPasswordResetToken(userId: string): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateRawAuthToken();
  const tokenHash = hashAuthToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    // Invalidate existing active reset tokens for this user
    await tx.customerAuthToken.updateMany({
      where: {
        userId,
        purpose: "PASSWORD_RESET",
        consumedAt: null,
      },
      data: {
        consumedAt: now,
      },
    });

    // Create new token
    await tx.customerAuthToken.create({
      data: {
        userId,
        purpose: "PASSWORD_RESET",
        tokenHash,
        expiresAt,
        consumedAt: null,
      },
    });
  });

  return { rawToken, expiresAt };
}

/**
 * Consumes a PASSWORD_RESET token, updates User.passwordHash, and revokes all active sessions for the user.
 * Atomically enforces single-use.
 */
export async function consumePasswordResetToken(
  rawToken: string,
  newPasswordHash: string
): Promise<{ success: boolean; error?: string; userId?: string }> {
  const tokenHash = hashAuthToken(rawToken);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    // Find active unconsumed unexpired token
    const token = await tx.customerAuthToken.findFirst({
      where: {
        tokenHash,
        purpose: "PASSWORD_RESET",
        consumedAt: null,
        expiresAt: { gt: now },
      },
      include: { user: true },
    });

    if (!token || !token.user || !token.user.isActive) {
      return { success: false, error: "INVALID_OR_EXPIRED_TOKEN" };
    }

    // 1. Atomic claim: exactly one winner can update consumedAt from null
    const claimRes = await tx.customerAuthToken.updateMany({
      where: {
        id: token.id,
        consumedAt: null,
      },
      data: { consumedAt: now },
    });

    if (claimRes.count === 0) {
      return { success: false, error: "INVALID_OR_EXPIRED_TOKEN" };
    }

    // 2. Update user passwordHash
    await tx.user.update({
      where: { id: token.userId },
      data: { passwordHash: newPasswordHash },
    });

    // 3. Revoke all active customer sessions for this user across all devices
    await tx.customerSession.updateMany({
      where: {
        userId: token.userId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });

    return { success: true, userId: token.userId };
  });
}

/**
 * Creates a new EMAIL_VERIFICATION token for a user.
 * Atomically invalidates any existing unconsumed EMAIL_VERIFICATION tokens for this user.
 */
export async function createEmailVerificationToken(userId: string): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateRawAuthToken();
  const tokenHash = hashAuthToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    // Invalidate existing active verification tokens for this user
    await tx.customerAuthToken.updateMany({
      where: {
        userId,
        purpose: "EMAIL_VERIFICATION",
        consumedAt: null,
      },
      data: {
        consumedAt: now,
      },
    });

    // Create new token
    await tx.customerAuthToken.create({
      data: {
        userId,
        purpose: "EMAIL_VERIFICATION",
        tokenHash,
        expiresAt,
        consumedAt: null,
      },
    });
  });

  return { rawToken, expiresAt };
}

/**
 * Consumes an EMAIL_VERIFICATION token and sets User.emailVerifiedAt = now.
 * Atomically enforces single-use.
 */
export async function consumeEmailVerificationToken(
  rawToken: string
): Promise<{ success: boolean; error?: string; userId?: string }> {
  const tokenHash = hashAuthToken(rawToken);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const token = await tx.customerAuthToken.findFirst({
      where: {
        tokenHash,
        purpose: "EMAIL_VERIFICATION",
        consumedAt: null,
        expiresAt: { gt: now },
      },
      include: { user: true },
    });

    if (!token || !token.user || !token.user.isActive || !token.user.email) {
      return { success: false, error: "INVALID_OR_EXPIRED_TOKEN" };
    }

    // 1. Atomic claim: exactly one winner can update consumedAt from null
    const claimRes = await tx.customerAuthToken.updateMany({
      where: {
        id: token.id,
        consumedAt: null,
      },
      data: { consumedAt: now },
    });

    if (claimRes.count === 0) {
      return { success: false, error: "INVALID_OR_EXPIRED_TOKEN" };
    }

    // 2. Set emailVerifiedAt = now
    await tx.user.update({
      where: { id: token.userId },
      data: { emailVerifiedAt: now },
    });

    return { success: true, userId: token.userId };
  });
}

/**
 * Invalidates all active tokens for a user (e.g. when changing email or identity).
 */
export async function invalidateUserAuthTokens(
  userId: string,
  purposes?: ("PASSWORD_RESET" | "EMAIL_VERIFICATION")[]
): Promise<void> {
  const now = new Date();
  await prisma.customerAuthToken.updateMany({
    where: {
      userId,
      consumedAt: null,
      ...(purposes && purposes.length > 0 ? { purpose: { in: purposes } } : {}),
    },
    data: {
      consumedAt: now,
    },
  });
}
