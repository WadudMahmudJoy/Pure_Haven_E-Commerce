import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CustomerUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
};

const usersFile = path.join(process.cwd(), "data", "customer-users.json");
const customerCookieName = "pure_haven_customer_auth";

async function readUsers(): Promise<CustomerUser[]> {
  await mkdir(path.dirname(usersFile), { recursive: true });

  try {
    const raw = await readFile(usersFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    await writeFile(usersFile, "[]", "utf8");
    return [];
  }
}

async function writeUsers(users: CustomerUser[]) {
  await mkdir(path.dirname(usersFile), { recursive: true });
  await writeFile(usersFile, JSON.stringify(users, null, 2), "utf8");
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password: string, salt: string, storedHash: string) {
  const incoming = Buffer.from(hashPassword(password, salt), "hex");
  const stored = Buffer.from(storedHash, "hex");

  if (incoming.length !== stored.length) return false;
  return timingSafeEqual(incoming, stored);
}

function sanitizePhone(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function publicUser(user: CustomerUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    createdAt: user.createdAt,
  };
}

function readCookie(req: Request, name: string) {
  const cookieHeader = req.headers.get("cookie") || "";
  const cookies = cookieHeader.split(";").map((part) => part.trim());

  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.split("=");

    if (key === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return "";
}

export async function GET(req: Request) {
  try {
    const customerId = readCookie(req, customerCookieName);

    if (!customerId) {
      return NextResponse.json(
        { success: false, authenticated: false, user: null },
        { status: 401 }
      );
    }

    const users = await readUsers();
    const user = users.find((item) => item.id === customerId);

    if (!user) {
      const res = NextResponse.json(
        { success: false, authenticated: false, user: null },
        { status: 401 }
      );

      res.cookies.set(customerCookieName, "", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });

      return res;
    }

    return NextResponse.json({
      success: true,
      authenticated: true,
      user: publicUser(user),
    });
  } catch {
    return NextResponse.json(
      { success: false, authenticated: false, message: "Could not read customer session." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mode = String(body.mode || "").trim();

    const users = await readUsers();

    if (mode === "register") {
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const phone = sanitizePhone(String(body.phone || "").trim());
      const password = String(body.password || "");
      const confirmPassword = String(body.confirmPassword || "");

      if (!name || !email || !phone || !password || !confirmPassword) {
        return NextResponse.json(
          { success: false, message: "All registration fields are required." },
          { status: 400 }
        );
      }

      if (!email.includes("@")) {
        return NextResponse.json(
          { success: false, message: "Please enter a valid email address." },
          { status: 400 }
        );
      }

      if (phone.length < 11) {
        return NextResponse.json(
          { success: false, message: "Please enter a valid phone number." },
          { status: 400 }
        );
      }

      if (password.length < 6) {
        return NextResponse.json(
          { success: false, message: "Password must be at least 6 characters." },
          { status: 400 }
        );
      }

      if (password !== confirmPassword) {
        return NextResponse.json(
          { success: false, message: "Password and confirm password do not match." },
          { status: 400 }
        );
      }

      const alreadyExists = users.some(
        (user) => user.email === email || sanitizePhone(user.phone) === phone
      );

      if (alreadyExists) {
        return NextResponse.json(
          { success: false, message: "An account already exists with this email or phone." },
          { status: 409 }
        );
      }

      const salt = randomBytes(16).toString("hex");

      const newUser: CustomerUser = {
        id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        email,
        phone,
        passwordHash: hashPassword(password, salt),
        passwordSalt: salt,
        createdAt: new Date().toISOString(),
      };

      users.push(newUser);
      await writeUsers(users);

      return NextResponse.json({
        success: true,
        message: "Registration successful. You can now login.",
      });
    }

    if (mode === "login") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");

      if (!email || !password) {
        return NextResponse.json(
          { success: false, message: "Email and password are required." },
          { status: 400 }
        );
      }

      const user = users.find((item) => item.email === email);

      if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
        return NextResponse.json(
          { success: false, message: "Invalid email or password." },
          { status: 401 }
        );
      }

      const res = NextResponse.json({
        success: true,
        message: "Login successful.",
        user: publicUser(user),
      });

      res.cookies.set(customerCookieName, user.id, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });

      return res;
    }

    if (mode === "logout") {
      const res = NextResponse.json({
        success: true,
        message: "Logged out successfully.",
      });

      res.cookies.set(customerCookieName, "", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });

      return res;
    }

    return NextResponse.json(
      { success: false, message: "Invalid auth request." },
      { status: 400 }
    );
  } catch {
    return NextResponse.json(
      { success: false, message: "Customer authentication failed." },
      { status: 500 }
    );
  }
}
