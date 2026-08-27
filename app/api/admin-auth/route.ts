import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "fs/promises";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import path from "path";
import {
  clearAdminSessionCookie,
  getAdminSessionFromRequest,
  requireAdmin,
  setAdminSessionCookie,
} from "@/lib/adminSession";
import { consumeRateLimit, resetRateLimit } from "@/lib/rateLimit";
import {
  ADMIN_LOGIN_GLOBAL_MAX_ATTEMPTS,
  ADMIN_LOGIN_GLOBAL_WINDOW_SECONDS,
  ADMIN_LOGIN_MAX_ATTEMPTS_PER_CLIENT,
  ADMIN_LOGIN_WINDOW_SECONDS,
  ADMIN_RECOVERY_GLOBAL_MAX_ATTEMPTS,
  ADMIN_RECOVERY_GLOBAL_WINDOW_SECONDS,
  ADMIN_RECOVERY_MAX_ATTEMPTS_PER_CLIENT,
  ADMIN_RECOVERY_WINDOW_SECONDS,
  getRateLimitClientKey,
} from "@/lib/rateLimitPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdminAuth = {
  email: string;
  passwordHash: string;
  recoveryEmail: string;
  recoveryPhone: string;
  recoveryCodeHash: string;
};

type RawAdminAuth = Partial<AdminAuth> & {
  password?: string;
  recoveryCode?: string;
};

import { prisma } from "@/lib/prisma";

const scrypt = promisify(scryptCallback);
const filePath = path.join(process.cwd(), "data", "admin-auth.json");

async function hashSecret(secret: string, salt = randomBytes(16).toString("hex")) {
  const key = (await scrypt(secret, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString("hex")}`;
}

async function verifySecret(secret: string, stored: string) {
  if (!stored) return false;

  if (!stored.startsWith("scrypt$")) {
    return secret === stored;
  }

  const [, salt, keyHex] = stored.split("$");
  if (!salt || !keyHex) return false;

  const key = (await scrypt(secret, salt, 64)) as Buffer;
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

function hasDb() {
  return Boolean(process.env.DATABASE_URL || process.env.DATABASE_URL_TEST);
}

async function writeAuth(auth: AdminAuth) {
  if (hasDb()) {
    try {
      const existing = await prisma.adminCredential.findFirst({
        orderBy: { id: "asc" },
      });

      if (existing) {
        await prisma.adminCredential.update({
          where: { id: existing.id },
          data: {
            email: auth.email,
            passwordHash: auth.passwordHash,
            recoveryEmail: auth.recoveryEmail || null,
            recoveryPhone: auth.recoveryPhone || null,
            recoveryCodeHash: auth.recoveryCodeHash || null,
          },
        });
      } else {
        await prisma.adminCredential.create({
          data: {
            email: auth.email,
            passwordHash: auth.passwordHash,
            recoveryEmail: auth.recoveryEmail || null,
            recoveryPhone: auth.recoveryPhone || null,
            recoveryCodeHash: auth.recoveryCodeHash || null,
          },
        });
      }
    } catch {
      // DB write failure in offline test
    }
  }

  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify(
        {
          email: auth.email,
          passwordHash: auth.passwordHash,
          recoveryEmail: auth.recoveryEmail,
          recoveryPhone: auth.recoveryPhone,
          recoveryCodeHash: auth.recoveryCodeHash,
        },
        null,
        2
      ),
      "utf8"
    );
  } catch {
    // File write is non-fatal when DB write succeeds
  }
}

async function readAuth(): Promise<AdminAuth | null> {
  if (hasDb()) {
    try {
      const dbAdmin = await prisma.adminCredential.findFirst({
        orderBy: { id: "asc" },
      });
      if (dbAdmin && dbAdmin.email && dbAdmin.passwordHash) {
        return {
          email: dbAdmin.email.trim(),
          passwordHash: dbAdmin.passwordHash.trim(),
          recoveryEmail: (dbAdmin.recoveryEmail || "").trim(),
          recoveryPhone: (dbAdmin.recoveryPhone || "").trim(),
          recoveryCodeHash: (dbAdmin.recoveryCodeHash || "").trim(),
        };
      }
    } catch {
      // If DB query fails in offline test runner, fall back to file
    }
  }

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as RawAdminAuth;

    const email = typeof parsed.email === "string" ? parsed.email.trim() : "";
    const passwordHash =
      typeof parsed.passwordHash === "string"
        ? parsed.passwordHash.trim()
        : typeof parsed.password === "string"
          ? parsed.password.trim()
          : "";
    const recoveryEmail =
      typeof parsed.recoveryEmail === "string" ? parsed.recoveryEmail.trim() : "";
    const recoveryPhone =
      typeof parsed.recoveryPhone === "string" ? parsed.recoveryPhone.trim() : "";
    const recoveryCodeHash =
      typeof parsed.recoveryCodeHash === "string"
        ? parsed.recoveryCodeHash.trim()
        : typeof parsed.recoveryCode === "string"
          ? parsed.recoveryCode.trim()
          : "";

    if (!email || !passwordHash) {
      return null;
    }

    return {
      email,
      passwordHash,
      recoveryEmail,
      recoveryPhone,
      recoveryCodeHash,
    };
  } catch {
    return null;
  }
}

function loginResponse(email: string) {
  const res = NextResponse.json({
    success: true,
    email,
    message: "Login successful.",
  });

  setAdminSessionCookie(res, email);
  return res;
}

export async function GET(req: Request) {
  const session = getAdminSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Admin login required." },
      { status: 401 }
    );
  }

  const auth = await readAuth();
  if (!auth) {
    return NextResponse.json(
      { success: false, message: "Admin account is not initialized." },
      { status: 503 }
    );
  }

  return NextResponse.json({
    success: true,
    email: auth.email,
    recoveryEmail: auth.recoveryEmail,
    recoveryPhone: auth.recoveryPhone,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const auth = await readAuth();

    if (!auth) {
      return NextResponse.json(
        { success: false, message: "Admin account is not initialized." },
        { status: 503 }
      );
    }

    const clientKey = getRateLimitClientKey(req);
    const clientBucketKey = `admin_login:${clientKey}`;
    const globalBucketKey = "admin_login:global";

    // 1. Per-client rate limit check (performed before expensive scrypt)
    const clientLimit = consumeRateLimit(
      clientBucketKey,
      ADMIN_LOGIN_MAX_ATTEMPTS_PER_CLIENT,
      ADMIN_LOGIN_WINDOW_SECONDS * 1000
    );
    if (!clientLimit.allowed) {
      return NextResponse.json(
        { success: false, message: "Too many attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(clientLimit.retryAfterSeconds),
          },
        }
      );
    }

    // 2. Process-global login CPU safety valve (performed before expensive scrypt)
    const globalLimit = consumeRateLimit(
      globalBucketKey,
      ADMIN_LOGIN_GLOBAL_MAX_ATTEMPTS,
      ADMIN_LOGIN_GLOBAL_WINDOW_SECONDS * 1000
    );
    if (!globalLimit.allowed) {
      return NextResponse.json(
        { success: false, message: "Too many attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(globalLimit.retryAfterSeconds),
          },
        }
      );
    }

    const passwordOk = await verifySecret(password, auth.passwordHash);

    if (email !== auth.email.toLowerCase() || !passwordOk) {
      return NextResponse.json(
        { success: false, message: "Invalid email or password." },
        { status: 401 }
      );
    }

    // Reset per-client login bucket on successful authentication (global safety bucket remains active)
    resetRateLimit(clientBucketKey);

    if (
      !auth.passwordHash.startsWith("scrypt$") ||
      (auth.recoveryCodeHash && !auth.recoveryCodeHash.startsWith("scrypt$"))
    ) {
      await writeAuth({
        ...auth,
        passwordHash: auth.passwordHash.startsWith("scrypt$")
          ? auth.passwordHash
          : await hashSecret(password),
        recoveryCodeHash: auth.recoveryCodeHash
          ? auth.recoveryCodeHash.startsWith("scrypt$")
            ? auth.recoveryCodeHash
            : await hashSecret(auth.recoveryCodeHash)
          : "",
      });
    }

    return loginResponse(auth.email);
  } catch {
    return NextResponse.json(
      { success: false, message: "Login failed." },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const body = await req.json();
    const oldAuth = await readAuth();

    if (!oldAuth) {
      return NextResponse.json(
        { success: false, message: "Admin account is not initialized." },
        { status: 503 }
      );
    }

    const email = String(body.email || "").trim().toLowerCase();
    const recoveryEmail = String(body.recoveryEmail || "").trim().toLowerCase();
    const recoveryPhone = String(body.recoveryPhone || "").trim();
    const recoveryCode = String(body.recoveryCode || "").trim();
    const newPassword = String(body.newPassword || "").trim();

    if (!email.includes("@")) {
      return NextResponse.json(
        { success: false, message: "Valid admin email is required." },
        { status: 400 }
      );
    }

    if (recoveryEmail && !recoveryEmail.includes("@")) {
      return NextResponse.json(
        { success: false, message: "Valid recovery email is required." },
        { status: 400 }
      );
    }

    if (newPassword && newPassword.length < 6) {
      return NextResponse.json(
        { success: false, message: "New password must be at least 6 characters." },
        { status: 400 }
      );
    }

    const passwordHash = newPassword
      ? await hashSecret(newPassword)
      : oldAuth.passwordHash;

    const recoveryCodeHash = recoveryCode
      ? await hashSecret(recoveryCode)
      : oldAuth.recoveryCodeHash;

    const updated: AdminAuth = {
      email,
      passwordHash,
      recoveryEmail: recoveryEmail || oldAuth.recoveryEmail,
      recoveryPhone,
      recoveryCodeHash,
    };

    await writeAuth(updated);

    return NextResponse.json({
      success: true,
      message: "Settings saved successfully.",
      email: updated.email,
      recoveryEmail: updated.recoveryEmail,
      recoveryPhone: updated.recoveryPhone,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Failed to save settings." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const recoveryCode = String(body.recoveryCode || "").trim();
    const newPassword = String(body.newPassword || "").trim();
    const auth = await readAuth();

    if (!auth) {
      return NextResponse.json(
        { success: false, message: "Admin account is not initialized." },
        { status: 503 }
      );
    }

    const clientKey = getRateLimitClientKey(req);
    const clientBucketKey = `admin_recovery:${clientKey}`;
    const globalBucketKey = "admin_recovery:global";

    // 1. Per-client recovery rate limit check (performed before expensive scrypt)
    const clientLimit = consumeRateLimit(
      clientBucketKey,
      ADMIN_RECOVERY_MAX_ATTEMPTS_PER_CLIENT,
      ADMIN_RECOVERY_WINDOW_SECONDS * 1000
    );
    if (!clientLimit.allowed) {
      return NextResponse.json(
        { success: false, message: "Too many attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(clientLimit.retryAfterSeconds),
          },
        }
      );
    }

    if (email !== auth.email.toLowerCase()) {
      return NextResponse.json(
        { success: false, message: "Invalid recovery details." },
        { status: 400 }
      );
    }

    if (!auth.recoveryCodeHash) {
      return NextResponse.json(
        { success: false, message: "Invalid recovery details." },
        { status: 400 }
      );
    }

    // 2. Process-global recovery CPU safety valve (performed before expensive scrypt)
    const globalLimit = consumeRateLimit(
      globalBucketKey,
      ADMIN_RECOVERY_GLOBAL_MAX_ATTEMPTS,
      ADMIN_RECOVERY_GLOBAL_WINDOW_SECONDS * 1000
    );
    if (!globalLimit.allowed) {
      return NextResponse.json(
        { success: false, message: "Too many attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(globalLimit.retryAfterSeconds),
          },
        }
      );
    }

    const recoveryOk = await verifySecret(recoveryCode, auth.recoveryCodeHash);
    if (!recoveryOk) {
      return NextResponse.json(
        { success: false, message: "Invalid recovery details." },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { success: false, message: "New password must be at least 6 characters." },
        { status: 400 }
      );
    }

    // Reset per-client recovery bucket on successful recovery (global safety bucket remains active)
    resetRateLimit(clientBucketKey);

    const updated: AdminAuth = {
      ...auth,
      passwordHash: await hashSecret(newPassword),
      recoveryCodeHash: auth.recoveryCodeHash.startsWith("scrypt$")
        ? auth.recoveryCodeHash
        : await hashSecret(recoveryCode),
    };

    await writeAuth(updated);
    return loginResponse(updated.email);
  } catch {
    return NextResponse.json(
      { success: false, message: "Password reset failed." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const res = NextResponse.json({ success: true, message: "Logged out." });
  clearAdminSessionCookie(res);
  return res;
}
