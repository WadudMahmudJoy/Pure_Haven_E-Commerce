/**
 * Customer Session Service (Phase 3 Wave B)
 *
 * Authoritative database-backed session management compliant with:
 * docs/superpowers/specs/2026-08-26-phase3-customer-authentication-design.md
 * docs/superpowers/plans/2026-08-26-phase3-customer-authentication-implementation-plan.md
 */

import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { generateOpaqueAuthToken, hashOpaqueAuthToken } from "./customerAuth";

export const CUSTOMER_SESSION_COOKIE = "pure_haven_customer_session";
export const LEGACY_CUSTOMER_COOKIE = "pure_haven_customer_auth";
export const CUSTOMER_SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days (604,800 seconds)

export interface SafeUser {
  id: string;
  name: string;
  email: string | null;
  normalizedPhone: string | null;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionValidationResult {
  authenticated: boolean;
  user: SafeUser | null;
  session: { id: string; userId: string; expiresAt: Date } | null;
}

/**
 * Creates a new CustomerSession in PostgreSQL.
 * Per Owner Rule: userAgent and ipAddress are left null (OPTIONAL_METADATA_PRESENT_NOT_AUTHORITY).
 */
export async function createCustomerSession(
  userId: string
): Promise<{ session: { id: string; userId: string; expiresAt: Date }; rawToken: string }> {
  const { rawToken, tokenHash } = generateOpaqueAuthToken();
  const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_MAX_AGE * 1000);

  const session = await prisma.customerSession.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      userAgent: null,
      ipAddress: null,
    },
  });

  return {
    session: {
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
    },
    rawToken,
  };
}

/**
 * Validates a raw session token against PostgreSQL.
 * Requires: tokenHash match, revokedAt IS NULL, expiresAt > now, User.isActive === true.
 */
export async function validateCustomerSession(
  rawToken: string | null | undefined
): Promise<SessionValidationResult> {
  if (!rawToken || typeof rawToken !== "string" || !rawToken.trim()) {
    return { authenticated: false, user: null, session: null };
  }

  const tokenHash = hashOpaqueAuthToken(rawToken);

  const session = await prisma.customerSession.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) {
    return { authenticated: false, user: null, session: null };
  }

  // Linearization & expiration checks
  if (session.revokedAt !== null || session.expiresAt <= new Date()) {
    return { authenticated: false, user: null, session: null };
  }

  // Active user check
  if (!session.user || !session.user.isActive) {
    return { authenticated: false, user: null, session: null };
  }

  const safeUser: SafeUser = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    normalizedPhone: session.user.normalizedPhone,
    emailVerifiedAt: session.user.emailVerifiedAt,
    phoneVerifiedAt: session.user.phoneVerifiedAt,
    isActive: session.user.isActive,
    createdAt: session.user.createdAt,
    updatedAt: session.user.updatedAt,
  };

  return {
    authenticated: true,
    user: safeUser,
    session: {
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
    },
  };
}

/**
 * Linearization point for logout: marks session revokedAt = now() in PostgreSQL.
 */
export async function revokeCustomerSession(
  rawToken: string | null | undefined
): Promise<boolean> {
  if (!rawToken || typeof rawToken !== "string" || !rawToken.trim()) {
    return false;
  }

  const tokenHash = hashOpaqueAuthToken(rawToken);

  const updated = await prisma.customerSession.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return updated.count > 0;
}

/**
 * Revokes all active sessions for a user (e.g. on password reset or account disable).
 */
export async function revokeAllCustomerSessions(
  userId: string
): Promise<number> {
  if (!userId || typeof userId !== "string") {
    return 0;
  }

  const updated = await prisma.customerSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return updated.count;
}

/**
 * Extracts raw session token from the Request Cookie header.
 */
export function getCustomerSessionTokenFromRequest(
  req: Request
): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === CUSTOMER_SESSION_COOKIE) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return null;
}

/**
 * Sets the canonical HttpOnly session cookie and clears any legacy unsigned cookie.
 */
export function setCustomerSessionCookie(
  res: NextResponse,
  rawToken: string
): void {
  const isProduction = process.env.NODE_ENV === "production";

  res.cookies.set({
    name: CUSTOMER_SESSION_COOKIE,
    value: rawToken,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: CUSTOMER_SESSION_MAX_AGE,
    secure: isProduction,
  });

  // Clear legacy unsigned cookie
  res.cookies.set({
    name: LEGACY_CUSTOMER_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
    httpOnly: true,
  });
}

/**
 * Clears both current and legacy customer session cookies.
 */
export function clearCustomerSessionCookie(
  res: NextResponse
): void {
  res.cookies.set({
    name: CUSTOMER_SESSION_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
    httpOnly: true,
  });

  res.cookies.set({
    name: LEGACY_CUSTOMER_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
    httpOnly: true,
  });
}
