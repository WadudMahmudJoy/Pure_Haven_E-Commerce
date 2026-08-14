import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ADMIN_SESSION_COOKIE = "pure_haven_admin_session";
const LOGIN_PATH = "/admin/login";

function getSessionSecret(): string | null {
  const secret = process.env.ADMIN_SESSION_SECRET;
  return secret ? secret : null;
}

function base64UrlToString(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

/**
 * Decodes an unpadded base64url string to its raw bytes.
 *
 * Returns null (fail-closed) when:
 *  - the input is empty
 *  - it contains characters outside the base64url alphabet [A-Za-z0-9\-_]
 *  - its length is structurally impossible (length % 4 === 1)
 *  - atob fails for any reason
 */
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!value) return null;

  // Reject any character outside the unpadded base64url alphabet
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;

  // A base64url string whose length % 4 === 1 cannot represent a valid
  // byte sequence regardless of padding (1 base64 digit encodes only 6 bits,
  // which is insufficient to form even one complete byte).
  if (value.length % 4 === 1) return null;

  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (base64.length % 4)) % 4;
    const padded = base64 + "=".repeat(padding);
    const binary = atob(padded);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function isValidAdminToken(token?: string) {
  if (!token || !token.includes(".")) return false;

  const secret = getSessionSecret();
  if (!secret) return false;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  // Decode the supplied signature to raw bytes; reject malformed input immediately.
  const signatureBytes = base64UrlToBytes(signature);
  if (!signatureBytes) return false;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const verified = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      encoder.encode(payload)
    );
    if (!verified) return false;

    const data = JSON.parse(base64UrlToString(payload));
    return Boolean(data?.sub && data?.exp && Date.now() / 1000 <= Number(data.exp));
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === LOGIN_PATH) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const isAdmin = await isValidAdminToken(token);

  if (!isAdmin) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = LOGIN_PATH;
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};

