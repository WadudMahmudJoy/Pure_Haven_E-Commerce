/**
 * Customer Password Reset Request Route (Phase 3 Wave D)
 *
 * POST /api/customer-auth/password-reset/request
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateSameOrigin } from "@/lib/csrf";
import { consumeRateLimit } from "@/lib/rateLimit";
import {
  getRateLimitClientKey,
  CUSTOMER_PASSWORD_RESET_MAX_ATTEMPTS_PER_CLIENT,
  CUSTOMER_PASSWORD_RESET_MAX_ATTEMPTS_PER_TARGET,
  CUSTOMER_PASSWORD_RESET_WINDOW_SECONDS,
  CUSTOMER_PASSWORD_RESET_GLOBAL_MAX_ATTEMPTS,
  CUSTOMER_PASSWORD_RESET_GLOBAL_WINDOW_SECONDS,
} from "@/lib/rateLimitPolicy";
import { classifyIdentifier } from "@/lib/customerAuth";
import { createPasswordResetToken, invalidateUserAuthTokens } from "@/lib/customerAuthTokens";
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

  // 2. Client & Global Rate Limiting
  const clientKey = getRateLimitClientKey(req);
  const globalRes = consumeRateLimit(
    "pwd_reset:global",
    CUSTOMER_PASSWORD_RESET_GLOBAL_MAX_ATTEMPTS,
    CUSTOMER_PASSWORD_RESET_GLOBAL_WINDOW_SECONDS * 1000
  );
  if (!globalRes.allowed) {
    return NextResponse.json(
      { success: false, message: "Too many recovery requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(globalRes.retryAfterSeconds) } }
    );
  }

  const clientRes = consumeRateLimit(
    `pwd_reset:client:${clientKey}`,
    CUSTOMER_PASSWORD_RESET_MAX_ATTEMPTS_PER_CLIENT,
    CUSTOMER_PASSWORD_RESET_WINDOW_SECONDS * 1000
  );
  if (!clientRes.allowed) {
    return NextResponse.json(
      { success: false, message: "Too many recovery requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(clientRes.retryAfterSeconds) } }
    );
  }

  const genericSuccessMessage =
    "If an eligible recovery method is available, recovery instructions will be sent.";

  let body: { identifier?: string } = {};
  try {
    body = (await req.json()) as { identifier?: string };
  } catch {
    return NextResponse.json({ success: true, message: genericSuccessMessage });
  }

  const rawIdentifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  if (!rawIdentifier) {
    return NextResponse.json({ success: true, message: genericSuccessMessage });
  }

  const classified = classifyIdentifier(rawIdentifier);
  if (classified.type === "INVALID") {
    return NextResponse.json({ success: true, message: genericSuccessMessage });
  }

  // Target-specific rate limiting
  const targetRes = consumeRateLimit(
    `pwd_reset:target:${classified.value}`,
    CUSTOMER_PASSWORD_RESET_MAX_ATTEMPTS_PER_TARGET,
    CUSTOMER_PASSWORD_RESET_WINDOW_SECONDS * 1000
  );
  if (!targetRes.allowed) {
    return NextResponse.json(
      { success: false, message: "Too many recovery requests for this account. Please try again later." },
      { status: 429, headers: { "Retry-After": String(targetRes.retryAfterSeconds) } }
    );
  }

  // Find user by normalized email or phone
  const user = await prisma.user.findFirst({
    where:
      classified.type === "EMAIL"
        ? { email: classified.value, isActive: true }
        : { normalizedPhone: classified.value, isActive: true },
  });

  if (!user) {
    return NextResponse.json({ success: true, message: genericSuccessMessage });
  }

  // Email recovery eligibility rule:
  // User.email exists AND User.emailVerifiedAt != null
  if (!user.email || !user.emailVerifiedAt) {
    return NextResponse.json({ success: true, message: genericSuccessMessage });
  }

  // Issue token inside DB transaction
  let rawToken: string;
  let expiresAt: Date;
  try {
    const tokenResult = await createPasswordResetToken(user.id);
    rawToken = tokenResult.rawToken;
    expiresAt = tokenResult.expiresAt;
  } catch (error) {
    console.error("Failed to create password reset token:", error);
    return NextResponse.json({ success: true, message: genericSuccessMessage });
  }

  // Dispatch email AFTER transaction commit
  const mailer = getCustomerAuthMailer();
  const origin = process.env.APP_ORIGIN || "http://localhost:3000";
  const actionUrl = `${origin}/reset-password?token=${encodeURIComponent(rawToken)}`;

  try {
    const sendResult = await mailer.sendPasswordReset({
      to: user.email,
      token: rawToken,
      expiresAt,
      actionUrl,
    });

    if (!sendResult.success) {
      // Invalidate the undelivered token
      await invalidateUserAuthTokens(user.id, ["PASSWORD_RESET"]);
    }
  } catch (mailError) {
    console.error("Mail dispatch failed during password reset:", mailError);
    await invalidateUserAuthTokens(user.id, ["PASSWORD_RESET"]).catch(() => {});
  }

  return NextResponse.json({ success: true, message: genericSuccessMessage });
}
