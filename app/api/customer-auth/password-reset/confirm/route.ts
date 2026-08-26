/**
 * Customer Password Reset Confirmation Route (Phase 3 Wave D)
 *
 * POST /api/customer-auth/password-reset/confirm
 */

import { NextResponse } from "next/server";
import { validateSameOrigin } from "@/lib/csrf";
import { consumeRateLimit } from "@/lib/rateLimit";
import { getRateLimitClientKey } from "@/lib/rateLimitPolicy";
import {
  hashCustomerPassword,
  CUSTOMER_PASSWORD_MIN_LENGTH,
  CUSTOMER_PASSWORD_MAX_LENGTH,
} from "@/lib/customerAuth";
import { consumePasswordResetToken } from "@/lib/customerAuthTokens";

export async function POST(req: Request) {
  // 1. Same-Origin Guard
  const csrf = validateSameOrigin(req);
  if (!csrf.valid) {
    return NextResponse.json(
      { success: false, message: "Cross-origin request blocked." },
      { status: 403 }
    );
  }

  // 2. Client Rate Limiting (5 attempts / 15 minutes)
  const clientKey = getRateLimitClientKey(req);
  const clientRes = consumeRateLimit(`pwd_reset_confirm:client:${clientKey}`, 5, 900 * 1000);
  if (!clientRes.allowed) {
    return NextResponse.json(
      { success: false, message: "Too many confirmation attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(clientRes.retryAfterSeconds) } }
    );
  }

  let body: { token?: string; newPassword?: string } = {};
  try {
    body = (await req.json()) as { token?: string; newPassword?: string };
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid request payload." },
      { status: 400 }
    );
  }

  const rawToken = typeof body.token === "string" ? body.token.trim() : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!rawToken) {
    return NextResponse.json(
      { success: false, message: "Reset token is required." },
      { status: 400 }
    );
  }

  // Password validation (8–128 characters, never trimmed)
  if (
    !newPassword ||
    newPassword.length < CUSTOMER_PASSWORD_MIN_LENGTH ||
    newPassword.length > CUSTOMER_PASSWORD_MAX_LENGTH
  ) {
    return NextResponse.json(
      {
        success: false,
        message: `Password must be between ${CUSTOMER_PASSWORD_MIN_LENGTH} and ${CUSTOMER_PASSWORD_MAX_LENGTH} characters.`,
      },
      { status: 400 }
    );
  }

  try {
    const newPasswordHash = await hashCustomerPassword(newPassword);
    const result = await consumePasswordResetToken(rawToken, newPasswordHash);

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired reset token." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Password updated successfully. Please log in with your new password.",
    });
  } catch (error) {
    console.error("Password reset confirm error:", error);
    return NextResponse.json(
      { success: false, message: "Unable to reset password. Please try again." },
      { status: 500 }
    );
  }
}
