/**
 * Customer Email Verification Resend Route (Phase 3 Wave D)
 *
 * POST /api/customer-auth/email-verification/resend
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateSameOrigin } from "@/lib/csrf";
import { consumeRateLimit } from "@/lib/rateLimit";
import {
  getRateLimitClientKey,
  CUSTOMER_EMAIL_VERIFICATION_MAX_ATTEMPTS_PER_CLIENT,
  CUSTOMER_EMAIL_VERIFICATION_MAX_ATTEMPTS_PER_TARGET,
  CUSTOMER_EMAIL_VERIFICATION_WINDOW_SECONDS,
  CUSTOMER_EMAIL_VERIFICATION_GLOBAL_MAX_ATTEMPTS,
  CUSTOMER_EMAIL_VERIFICATION_GLOBAL_WINDOW_SECONDS,
} from "@/lib/rateLimitPolicy";
import {
  getCustomerSessionTokenFromRequest,
  validateCustomerSession,
} from "@/lib/customerSession";
import {
  createEmailVerificationToken,
  invalidateUserAuthTokens,
} from "@/lib/customerAuthTokens";
import { getCustomerAuthMailer } from "@/lib/customerAuthMailer";

export async function POST(req: Request) {
  // 1. Same-Origin Guard
  const csrf = validateSameOrigin(req);
  if (!csrf.valid) {
    return NextResponse.json(
      { success: false, message: "Cross-origin request blocked." },
      { status: 403 }
    );
  }

  // 2. Authenticated Session Guard
  const rawToken = getCustomerSessionTokenFromRequest(req);
  if (!rawToken) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 }
    );
  }

  const sessionResult = await validateCustomerSession(rawToken);
  if (!sessionResult.authenticated || !sessionResult.user || !sessionResult.user.isActive) {
    return NextResponse.json(
      { success: false, message: "Authentication required or session expired." },
      { status: 401 }
    );
  }

  const user = sessionResult.user;

  if (!user.email) {
    return NextResponse.json(
      { success: false, message: "No email address is attached to this account." },
      { status: 400 }
    );
  }

  // Check if already verified
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, emailVerifiedAt: true, isActive: true },
  });

  if (!dbUser || !dbUser.isActive) {
    return NextResponse.json(
      { success: false, message: "User account is unavailable." },
      { status: 401 }
    );
  }

  if (dbUser.emailVerifiedAt) {
    return NextResponse.json({
      success: true,
      message: "Email is already verified.",
      alreadyVerified: true,
    });
  }

  // 3. Rate Limiting
  const clientKey = getRateLimitClientKey(req);
  const globalRes = consumeRateLimit(
    "email_verify:global",
    CUSTOMER_EMAIL_VERIFICATION_GLOBAL_MAX_ATTEMPTS,
    CUSTOMER_EMAIL_VERIFICATION_GLOBAL_WINDOW_SECONDS * 1000
  );
  if (!globalRes.allowed) {
    return NextResponse.json(
      { success: false, message: "Too many verification requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(globalRes.retryAfterSeconds) } }
    );
  }

  const clientRes = consumeRateLimit(
    `email_verify:client:${clientKey}`,
    CUSTOMER_EMAIL_VERIFICATION_MAX_ATTEMPTS_PER_CLIENT,
    CUSTOMER_EMAIL_VERIFICATION_WINDOW_SECONDS * 1000
  );
  if (!clientRes.allowed) {
    return NextResponse.json(
      { success: false, message: "Too many verification requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(clientRes.retryAfterSeconds) } }
    );
  }

  const targetRes = consumeRateLimit(
    `email_verify:user:${user.id}`,
    CUSTOMER_EMAIL_VERIFICATION_MAX_ATTEMPTS_PER_TARGET,
    CUSTOMER_EMAIL_VERIFICATION_WINDOW_SECONDS * 1000
  );
  if (!targetRes.allowed) {
    return NextResponse.json(
      { success: false, message: "Too many verification requests for this account. Please try again later." },
      { status: 429, headers: { "Retry-After": String(targetRes.retryAfterSeconds) } }
    );
  }

  // Create verification token inside DB transaction
  let rawVerificationToken: string;
  let expiresAt: Date;
  try {
    const tokenResult = await createEmailVerificationToken(user.id);
    rawVerificationToken = tokenResult.rawToken;
    expiresAt = tokenResult.expiresAt;
  } catch (error) {
    console.error("Failed to create email verification token:", error);
    return NextResponse.json(
      { success: false, message: "Unable to process verification request." },
      { status: 500 }
    );
  }

  // Dispatch email AFTER transaction commit
  const mailer = getCustomerAuthMailer();
  const origin = process.env.APP_ORIGIN || "http://localhost:3000";
  const actionUrl = `${origin}/verify-email?token=${encodeURIComponent(rawVerificationToken)}`;

  try {
    const sendResult = await mailer.sendEmailVerification({
      to: dbUser.email!,
      token: rawVerificationToken,
      expiresAt,
      actionUrl,
    });

    if (!sendResult.success) {
      await invalidateUserAuthTokens(user.id, ["EMAIL_VERIFICATION"]);
    }
  } catch (mailError) {
    console.error("Mail dispatch failed during email verification:", mailError);
    await invalidateUserAuthTokens(user.id, ["EMAIL_VERIFICATION"]).catch(() => {});
  }

  return NextResponse.json({
    success: true,
    message: "Verification link sent to your email.",
  });
}
