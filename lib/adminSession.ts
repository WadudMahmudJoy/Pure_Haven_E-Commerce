import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

export const ADMIN_SESSION_COOKIE = "pure_haven_admin_session";
export const LEGACY_ADMIN_COOKIE = "pure_haven_admin_auth";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function getSessionSecret(): string | null {
  const secret = process.env.ADMIN_SESSION_SECRET;
  return secret ? secret : null;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseCookies(cookieHeader: string | null) {
  const cookies = new Map<string, string>();
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) continue;
    cookies.set(rawName, decodeURIComponent(rawValue.join("=")));
  }

  return cookies;
}

export function createAdminSessionToken(email: string) {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is not configured.");
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: email,
      iat: now,
      exp: now + SESSION_MAX_AGE_SECONDS,
    })
  );
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyAdminSessionToken(token?: string | null) {
  if (!token || !token.includes(".")) return null;

  const secret = getSessionSecret();
  if (!secret) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload, secret))) return null;

  try {
    const data = JSON.parse(base64UrlDecode(payload));
    if (!data?.sub || typeof data.sub !== "string") return null;
    if (!data?.exp || Date.now() / 1000 > Number(data.exp)) return null;
    return { email: data.sub as string };
  } catch {
    return null;
  }
}

export function getAdminSessionFromRequest(req: Request) {
  const cookies = parseCookies(req.headers.get("cookie"));
  return verifyAdminSessionToken(cookies.get(ADMIN_SESSION_COOKIE));
}

export function requireAdmin(req: Request) {
  const session = getAdminSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Admin login required." },
      { status: 401 }
    );
  }
  return null;
}

export function setAdminSessionCookie(res: NextResponse, email: string) {
  res.cookies.set(ADMIN_SESSION_COOKIE, createAdminSessionToken(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  res.cookies.set(LEGACY_ADMIN_COOKIE, "", {
    path: "/",
    maxAge: 0,
  });
}

export function clearAdminSessionCookie(res: NextResponse) {
  res.cookies.set(ADMIN_SESSION_COOKIE, "", {
    path: "/",
    maxAge: 0,
  });

  res.cookies.set(LEGACY_ADMIN_COOKIE, "", {
    path: "/",
    maxAge: 0,
  });
}
