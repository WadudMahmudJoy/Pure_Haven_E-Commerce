/**
 * Customer Email Verification Confirm Route (Phase 3 Wave D)
 *
 * POST /api/customer-auth/email-verification/confirm
 */

import { NextResponse } from "next/server";
import { validateSameOrigin } from "@/lib/csrf";
import { consumeRateLimit } from "@/lib/rateLimit";
import { getRateLimitClientKey } from "@/lib/rateLimitPolicy";
import { consumeEmailVerificationToken } from "@/lib/customerAuthTokens";

export async function POST(req: Request) {
  // 1. Same-Origin Guard
  const csrf = validateSameOrigin(req);
  if (!csrf.valid) {
    return NextResponse.json(
      { success: false, message: "Cross-origin request blocked." },
      { status: 403 }
    );
  }

  // 2. Client Rate Limiting (10 attempts / 15 minutes)
  const clientKey = getRateLimitClientKey(req);
  const clientRes = consumeRateLimit(`email_verify_confirm:client:${clientKey}`, 10, 900 * 1000);
  if (!clientRes.allowed) {
    return NextResponse.json(
      { success: false, message: "Too many confirmation attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(clientRes.retryAfterSeconds) } }
    );
  }

  let body: { token?: string } = {};
  try {
    body = (await req.json()) as { token?: string };
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid request payload." },
      { status: 400 }
    );
  }

  const rawToken = typeof body.token === "string" ? body.token.trim() : "";
  if (!rawToken) {
    return NextResponse.json(
      { success: false, message: "Verification token is required." },
      { status: 400 }
    );
  }

  try {
    const result = await consumeEmailVerificationToken(rawToken);
    if (!result.success) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired verification link." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Email verified successfully.",
    });
  } catch (error) {
    console.error("Email verification confirm error:", error);
    return NextResponse.json(
      { success: false, message: "Unable to verify email. Please try again." },
      { status: 500 }
    );
  }
}
