/**
 * Customer Logout Route (Phase 3 Wave B)
 *
 * POST /api/customer-auth/logout
 */

import { NextResponse } from "next/server";
import { validateSameOrigin } from "@/lib/csrf";
import {
  getCustomerSessionTokenFromRequest,
  revokeCustomerSession,
  clearCustomerSessionCookie,
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

  // 2. Read Session Token
  const rawToken = getCustomerSessionTokenFromRequest(req);

  // 3. Linearization point: Revoke session in PostgreSQL
  if (rawToken) {
    await revokeCustomerSession(rawToken);
  }

  // 4. Construct Response & Clear Cookies
  const res = NextResponse.json(
    { success: true, message: "Logged out successfully." },
    { status: 200 }
  );

  clearCustomerSessionCookie(res);
  return res;
}
