/**
 * Customer Login Route (Phase 3 Wave B)
 *
 * POST /api/customer-auth/login
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateSameOrigin } from "@/lib/csrf";
import { consumeRateLimit, resetRateLimit } from "@/lib/rateLimit";
import {
  getRateLimitClientKey,
  CUSTOMER_LOGIN_MAX_ATTEMPTS_PER_CLIENT,
  CUSTOMER_LOGIN_WINDOW_SECONDS,
  CUSTOMER_LOGIN_GLOBAL_MAX_ATTEMPTS,
  CUSTOMER_LOGIN_GLOBAL_WINDOW_SECONDS,
} from "@/lib/rateLimitPolicy";
import {
  classifyIdentifier,
  verifyCustomerPassword,
} from "@/lib/customerAuth";
import {
  createCustomerSession,
  setCustomerSessionCookie,
  SafeUser,
} from "@/lib/customerSession";

const DUMMY_SCRYPT_HASH =
  "scrypt$N=16384,r=8,p=1$0123456789abcdef0123456789abcdef$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export async function POST(req: Request) {
  // 1. CSRF / Same-Origin Validation
  const csrf = validateSameOrigin(req);
  if (!csrf.valid) {
    return NextResponse.json(
      { success: false, message: "Cross-origin request blocked." },
      { status: 403 }
    );
  }

  // 2. Pre-Scrypt Rate Limiting
  const clientIp = getRateLimitClientKey(req);
  const clientRateKey = `customer_login_client:${clientIp}`;
  const globalRateKey = "customer_login_global";

  // Check global process CPU safety limit
  const globalLimit = consumeRateLimit(
    globalRateKey,
    CUSTOMER_LOGIN_GLOBAL_MAX_ATTEMPTS,
    CUSTOMER_LOGIN_GLOBAL_WINDOW_SECONDS * 1000
  );
  if (!globalLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        message: "Login is temporarily throttled. Please try again later.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(globalLimit.retryAfterSeconds) },
      }
    );
  }

  // Check per-client rate limit
  const clientLimit = consumeRateLimit(
    clientRateKey,
    CUSTOMER_LOGIN_MAX_ATTEMPTS_PER_CLIENT,
    CUSTOMER_LOGIN_WINDOW_SECONDS * 1000
  );
  if (!clientLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        message: "Too many login attempts. Please try again later.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(clientLimit.retryAfterSeconds) },
      }
    );
  }

  // 3. Body Parsing
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid request payload." },
      { status: 400 }
    );
  }

  const rawIdentifier =
    typeof body?.identifier === "string"
      ? body.identifier
      : typeof body?.email === "string" && body.email.trim()
      ? body.email
      : typeof body?.phone === "string" && body.phone.trim()
      ? body.phone
      : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!rawIdentifier || !password) {
    // Perform dummy scrypt computation to match timing
    await verifyCustomerPassword(password || "dummy", DUMMY_SCRYPT_HASH);
    return NextResponse.json(
      { success: false, message: "Email/phone or password is incorrect." },
      { status: 401 }
    );
  }

  // 4. Identifier Classification
  const parsedId = classifyIdentifier(rawIdentifier);
  if (parsedId.type === "INVALID") {
    await verifyCustomerPassword(password, DUMMY_SCRYPT_HASH);
    return NextResponse.json(
      { success: false, message: "Email/phone or password is incorrect." },
      { status: 401 }
    );
  }

  // 5. Database Lookup
  const user =
    parsedId.type === "EMAIL"
      ? await prisma.user.findUnique({ where: { email: parsedId.value } })
      : await prisma.user.findUnique({ where: { normalizedPhone: parsedId.value } });

  // Account does not exist or is disabled
  if (!user || !user.isActive) {
    await verifyCustomerPassword(password, DUMMY_SCRYPT_HASH);
    return NextResponse.json(
      { success: false, message: "Email/phone or password is incorrect." },
      { status: 401 }
    );
  }

  // 6. Verify Password
  const passwordMatches = await verifyCustomerPassword(
    password,
    user.passwordHash
  );

  if (!passwordMatches) {
    return NextResponse.json(
      { success: false, message: "Email/phone or password is incorrect." },
      { status: 401 }
    );
  }

  // 7. Successful Authentication
  // Reset per-client failure bucket (does not reset global CPU limiter)
  resetRateLimit(clientRateKey);

  // Create fresh CustomerSession
  const { rawToken } = await createCustomerSession(user.id);

  const safeUser: SafeUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    normalizedPhone: user.normalizedPhone,
    emailVerifiedAt: user.emailVerifiedAt,
    phoneVerifiedAt: user.phoneVerifiedAt,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };

  const res = NextResponse.json(
    {
      success: true,
      message: "Logged in successfully.",
      user: safeUser,
    },
    { status: 200 }
  );

  setCustomerSessionCookie(res, rawToken);
  return res;
}
