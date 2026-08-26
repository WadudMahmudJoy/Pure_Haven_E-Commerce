/**
 * Customer Second Identifier Management Route (Phase 3 Wave D)
 *
 * POST /api/customer-auth/identity
 * Actions: ADD_EMAIL, CHANGE_EMAIL, ADD_PHONE, CHANGE_PHONE
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateSameOrigin } from "@/lib/csrf";
import { consumeRateLimit } from "@/lib/rateLimit";
import {
  getRateLimitClientKey,
  CUSTOMER_IDENTITY_MUTATION_MAX_ATTEMPTS_PER_CLIENT,
  CUSTOMER_IDENTITY_MUTATION_WINDOW_SECONDS,
} from "@/lib/rateLimitPolicy";
import {
  getCustomerSessionTokenFromRequest,
  validateCustomerSession,
} from "@/lib/customerSession";
import {
  normalizeEmail,
  parseAndNormalizePhone,
  verifyCustomerPassword,
} from "@/lib/customerAuth";

interface IdentityMutationBody {
  action?: "ADD_EMAIL" | "CHANGE_EMAIL" | "ADD_PHONE" | "CHANGE_PHONE";
  currentPassword?: string;
  newEmail?: string;
  newPhone?: string;
}

export async function POST(req: Request) {
  // 1. Same-Origin Guard
  const csrf = validateSameOrigin(req);
  if (!csrf.valid) {
    return NextResponse.json(
      { success: false, message: "Cross-origin request blocked." },
      { status: 403 }
    );
  }

  // 2. Client Rate Limiting
  const clientKey = getRateLimitClientKey(req);
  const clientRes = consumeRateLimit(
    `identity_mutate:client:${clientKey}`,
    CUSTOMER_IDENTITY_MUTATION_MAX_ATTEMPTS_PER_CLIENT,
    CUSTOMER_IDENTITY_MUTATION_WINDOW_SECONDS * 1000
  );
  if (!clientRes.allowed) {
    return NextResponse.json(
      { success: false, message: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(clientRes.retryAfterSeconds) } }
    );
  }

  // 3. Authenticated Session Guard
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

  let body: IdentityMutationBody = {};
  try {
    body = (await req.json()) as IdentityMutationBody;
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid request payload." },
      { status: 400 }
    );
  }

  const action = body.action;
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";

  if (!action || !["ADD_EMAIL", "CHANGE_EMAIL", "ADD_PHONE", "CHANGE_PHONE"].includes(action)) {
    return NextResponse.json(
      { success: false, message: "Invalid action specified." },
      { status: 400 }
    );
  }

  if (!currentPassword) {
    return NextResponse.json(
      { success: false, message: "Current password is required to update account details." },
      { status: 400 }
    );
  }

  // Fetch full user record from database to verify passwordHash
  const user = await prisma.user.findUnique({
    where: { id: sessionResult.user.id },
  });

  if (!user || !user.isActive) {
    return NextResponse.json(
      { success: false, message: "User account is unavailable." },
      { status: 401 }
    );
  }

  // Verify current password
  const isPasswordValid = await verifyCustomerPassword(currentPassword, user.passwordHash);
  if (!isPasswordValid) {
    return NextResponse.json(
      { success: false, message: "Current password is incorrect." },
      { status: 401 }
    );
  }

  // Handle ADD_EMAIL and CHANGE_EMAIL
  if (action === "ADD_EMAIL" || action === "CHANGE_EMAIL") {
    const rawEmail = typeof body.newEmail === "string" ? body.newEmail : "";
    const canonicalEmail = normalizeEmail(rawEmail);

    if (!canonicalEmail) {
      return NextResponse.json(
        { success: false, message: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    if (user.email === canonicalEmail) {
      return NextResponse.json(
        { success: false, message: "This email address is already assigned to your account." },
        { status: 400 }
      );
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Enforce uniqueness
        const existing = await tx.user.findUnique({
          where: { email: canonicalEmail },
        });
        if (existing && existing.id !== user.id) {
          throw new Error("EMAIL_IN_USE");
        }

        // Invalidate old verification & reset tokens for this user
        const now = new Date();
        await tx.customerAuthToken.updateMany({
          where: {
            userId: user.id,
            consumedAt: null,
          },
          data: {
            consumedAt: now,
          },
        });

        // Update user email
        await tx.user.update({
          where: { id: user.id },
          data: {
            email: canonicalEmail,
            emailVerifiedAt: null, // Reset verification status
          },
        });
      });

      return NextResponse.json({
        success: true,
        message:
          action === "ADD_EMAIL"
            ? "Email added successfully."
            : "Email changed successfully. You will need to verify your new email.",
        email: canonicalEmail,
        emailVerified: false,
      });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.message === "EMAIL_IN_USE" || err?.code === "P2002") {
        return NextResponse.json(
          { success: false, message: "This email address is already in use by another account." },
          { status: 409 }
        );
      }
      console.error("Identity email mutation error:", error);
      return NextResponse.json(
        { success: false, message: "Unable to update email address. Please try again." },
        { status: 500 }
      );
    }
  }

  // Handle ADD_PHONE and CHANGE_PHONE
  if (action === "ADD_PHONE" || action === "CHANGE_PHONE") {
    const rawPhone = typeof body.newPhone === "string" ? body.newPhone : "";
    const canonicalPhone = parseAndNormalizePhone(rawPhone);

    if (!canonicalPhone) {
      return NextResponse.json(
        { success: false, message: "Please enter a valid Bangladeshi phone number." },
        { status: 400 }
      );
    }

    if (user.normalizedPhone === canonicalPhone) {
      return NextResponse.json(
        { success: false, message: "This phone number is already assigned to your account." },
        { status: 400 }
      );
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Enforce uniqueness
        const existing = await tx.user.findUnique({
          where: { normalizedPhone: canonicalPhone },
        });
        if (existing && existing.id !== user.id) {
          throw new Error("PHONE_IN_USE");
        }

        // Update user phone
        await tx.user.update({
          where: { id: user.id },
          data: {
            normalizedPhone: canonicalPhone,
            phoneVerifiedAt: null,
          },
        });
      });

      return NextResponse.json({
        success: true,
        message:
          action === "ADD_PHONE"
            ? "Phone number added successfully."
            : "Phone number changed successfully.",
        phone: canonicalPhone,
      });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.message === "PHONE_IN_USE" || err?.code === "P2002") {
        return NextResponse.json(
          { success: false, message: "This phone number is already in use by another account." },
          { status: 409 }
        );
      }
      console.error("Identity phone mutation error:", error);
      return NextResponse.json(
        { success: false, message: "Unable to update phone number. Please try again." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { success: false, message: "Invalid action specified." },
    { status: 400 }
  );
}
