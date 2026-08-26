/**
 * Customer Session Read Route (Phase 3 Wave B)
 *
 * GET /api/customer-auth/session
 */

import { NextResponse } from "next/server";
import {
  getCustomerSessionTokenFromRequest,
  validateCustomerSession,
} from "@/lib/customerSession";

export async function GET(req: Request) {
  const rawToken = getCustomerSessionTokenFromRequest(req);

  if (!rawToken) {
    return NextResponse.json(
      { authenticated: false, user: null },
      { status: 200 }
    );
  }

  const result = await validateCustomerSession(rawToken);

  if (!result.authenticated || !result.user) {
    return NextResponse.json(
      { authenticated: false, user: null },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      authenticated: true,
      user: result.user,
    },
    { status: 200 }
  );
}
