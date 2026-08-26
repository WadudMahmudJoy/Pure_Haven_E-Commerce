/**
 * Customer Registration Route (Phase 3 Wave B)
 *
 * POST /api/customer-auth/register
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateSameOrigin } from "@/lib/csrf";
import { consumeRateLimit } from "@/lib/rateLimit";
import {
  getRateLimitClientKey,
  CUSTOMER_REGISTER_MAX_ATTEMPTS_PER_CLIENT,
  CUSTOMER_REGISTER_WINDOW_SECONDS,
  CUSTOMER_REGISTER_GLOBAL_MAX_ATTEMPTS,
  CUSTOMER_REGISTER_GLOBAL_WINDOW_SECONDS,
} from "@/lib/rateLimitPolicy";
import {
  classifyIdentifier,
  hashCustomerPassword,
  CUSTOMER_PASSWORD_MIN_LENGTH,
  CUSTOMER_PASSWORD_MAX_LENGTH,
} from "@/lib/customerAuth";
import {
  createCustomerSession,
  setCustomerSessionCookie,
  SafeUser,
} from "@/lib/customerSession";

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
  const clientRateKey = `customer_register_client:${clientIp}`;
  const globalRateKey = "customer_register_global";

  // Check global process CPU safety limit
  const globalLimit = consumeRateLimit(
    globalRateKey,
    CUSTOMER_REGISTER_GLOBAL_MAX_ATTEMPTS,
    CUSTOMER_REGISTER_GLOBAL_WINDOW_SECONDS * 1000
  );
  if (!globalLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        message: "Registration is temporarily throttled. Please try again later.",
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
    CUSTOMER_REGISTER_MAX_ATTEMPTS_PER_CLIENT,
    CUSTOMER_REGISTER_WINDOW_SECONDS * 1000
  );
  if (!clientLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        message: "Too many registration attempts. Please try again later.",
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

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const rawIdentifier =
    typeof body?.identifier === "string"
      ? body.identifier
      : typeof body?.email === "string" && body.email.trim()
      ? body.email
      : typeof body?.phone === "string" && body.phone.trim()
      ? body.phone
      : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!name || name.length < 2 || name.length > 100) {
    return NextResponse.json(
      { success: false, message: "Name must be between 2 and 100 characters." },
      { status: 400 }
    );
  }

  if (
    !password ||
    password.length < CUSTOMER_PASSWORD_MIN_LENGTH ||
    password.length > CUSTOMER_PASSWORD_MAX_LENGTH
  ) {
    return NextResponse.json(
      {
        success: false,
        message: `Password must be between ${CUSTOMER_PASSWORD_MIN_LENGTH} and ${CUSTOMER_PASSWORD_MAX_LENGTH} characters.`,
      },
      { status: 400 }
    );
  }

  const parsedId = classifyIdentifier(rawIdentifier);
  if (parsedId.type === "INVALID") {
    return NextResponse.json(
      {
        success: false,
        message:
          "Please enter a valid email address or Bangladeshi phone number (e.g. 01711223344).",
      },
      { status: 400 }
    );
  }

  // 4. Asynchronous Password Hashing
  let passwordHash: string;
  try {
    passwordHash = await hashCustomerPassword(password);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to secure password.";
    return NextResponse.json(
      { success: false, message: errorMsg },
      { status: 400 }
    );
  }

  // 5. Database Insertion & Duplicate Conflict Handling
  const email = parsedId.type === "EMAIL" ? parsedId.value : null;
  const normalizedPhone = parsedId.type === "PHONE" ? parsedId.value : null;

  try {
    const user = await prisma.user.create({
      data: {
        name,
        email,
        normalizedPhone,
        passwordHash,
        isActive: true,
      },
    });

    // 6. Create immediate authenticated CustomerSession
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
        message: "Account created successfully.",
        user: safeUser,
      },
      { status: 201 }
    );

    setCustomerSessionCookie(res, rawToken);
    return res;
  } catch (err: unknown) {
    const errObj = err as { code?: string; message?: string };
    // Catch PostgreSQL unique constraint violation
    if (
      errObj?.code === "P2002" ||
      (typeof errObj?.message === "string" &&
        errObj.message.includes("unique constraint"))
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "An account with this email or phone number already exists.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: "Failed to create account. Please try again.",
      },
      { status: 500 }
    );
  }
}
