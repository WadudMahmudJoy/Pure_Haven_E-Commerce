/**
 * Legacy Customer Authentication Route — Retired (Phase 3 Wave B)
 *
 * This route previously authenticated users via insecure flat-file lookups
 * and unsigned raw user-ID cookies (`pure_haven_customer_auth`).
 *
 * It is now permanently retired. All customer authentication operations
 * must use the dedicated modular endpoints:
 *   - POST /api/customer-auth/register
 *   - POST /api/customer-auth/login
 *   - POST /api/customer-auth/logout
 *   - GET  /api/customer-auth/session
 */

import { NextResponse } from "next/server";
import { clearCustomerSessionCookie } from "@/lib/customerSession";

function retiredResponse() {
  const res = NextResponse.json(
    {
      success: false,
      authenticated: false,
      user: null,
      message:
        "The legacy customer authentication endpoint has been retired. Please use /api/customer-auth/login, /register, /logout, or /session.",
    },
    { status: 410 }
  );

  clearCustomerSessionCookie(res);
  return res;
}

export async function GET() {
  return retiredResponse();
}

export async function POST() {
  return retiredResponse();
}

export async function PUT() {
  return retiredResponse();
}

export async function DELETE() {
  return retiredResponse();
}
