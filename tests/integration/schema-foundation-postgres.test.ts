/**
 * Real PostgreSQL Schema & Constraint Integrity Tests — Phase 3 Wave A
 *
 * Verifies real PostgreSQL constraint and referential integrity against DATABASE_URL_TEST:
 *   A. User with email only succeeds
 *   B. User with normalizedPhone only succeeds
 *   C. User with neither identifier fails CHECK constraint (user_has_at_least_one_identifier)
 *   D. Uppercase/noncanonical email fails lowercase CHECK constraint (user_email_must_be_canonical_lowercase)
 *   E. Duplicate email fails DB uniqueness
 *   F. Duplicate canonical phone fails DB uniqueness
 *   G. CustomerSession.tokenHash duplicate fails uniqueness
 *   H. CustomerAuthToken.tokenHash duplicate fails uniqueness
 *   I. Order.userId may be null (Guest orders)
 *   J. Order.userId valid User relation succeeds
 *   K. User with owned Order cannot be cascade-deleted (onDelete: Restrict)
 *   L. Existing guest-style Order rows remain compatible
 *
 * Run with:
 *   node -e "const { execSync } = require('node:child_process'); execSync('npx tsx --test tests/integration/schema-foundation-postgres.test.ts', { env: { ...process.env, DATABASE_URL_TEST: 'postgresql://purehaven_test:test_isolated_secret_pass_123@127.0.0.1:55499/pure_haven_phase2_test?schema=public' }, stdio: 'inherit' });"
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { validateTestDatabaseSafety } from "./db-safety";

const { Pool } = pg;

const safety = validateTestDatabaseSafety();

describe(
  "Wave A — Real PostgreSQL Schema & Constraint Integrity",
  {
    skip:
      !safety.safe &&
      "TEST_DATABASE_REQUIRED: Set DATABASE_URL_TEST to run real PostgreSQL concurrency tests",
  },
  () => {
    let pool: pg.Pool;
    let prismaTest: PrismaClient;

    before(async () => {
      if (!safety.safe) {
        return;
      }
      const testUrl = process.env.DATABASE_URL_TEST!;

    pool = new Pool({ connectionString: testUrl });
    const adapter = new PrismaPg({ connectionString: testUrl });
    prismaTest = new PrismaClient({ adapter });
    await prismaTest.$connect();


    // Apply the Wave A migration SQL directly if not already applied
    const migrationSql = `
      DO $$ BEGIN
        CREATE TYPE "AuthTokenPurpose" AS ENUM ('PASSWORD_RESET', 'EMAIL_VERIFICATION');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;

      ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "userId" TEXT;

      CREATE TABLE IF NOT EXISTS "User" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "email" TEXT,
        "normalizedPhone" TEXT,
        "passwordHash" TEXT NOT NULL,
        "emailVerifiedAt" TIMESTAMP(3),
        "phoneVerifiedAt" TIMESTAMP(3),
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "User_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE IF NOT EXISTS "CustomerSession" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "tokenHash" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "revokedAt" TIMESTAMP(3),
        "userAgent" TEXT,
        "ipAddress" TEXT,
        CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE IF NOT EXISTS "CustomerAuthToken" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "purpose" "AuthTokenPurpose" NOT NULL,
        "tokenHash" TEXT NOT NULL,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "consumedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CustomerAuthToken_pkey" PRIMARY KEY ("id")
      );

      CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
      CREATE UNIQUE INDEX IF NOT EXISTS "User_normalizedPhone_key" ON "User"("normalizedPhone");
      CREATE UNIQUE INDEX IF NOT EXISTS "CustomerSession_tokenHash_key" ON "CustomerSession"("tokenHash");
      CREATE INDEX IF NOT EXISTS "CustomerSession_userId_idx" ON "CustomerSession"("userId");
      CREATE INDEX IF NOT EXISTS "CustomerSession_expiresAt_idx" ON "CustomerSession"("expiresAt");
      CREATE INDEX IF NOT EXISTS "CustomerSession_revokedAt_idx" ON "CustomerSession"("revokedAt");
      CREATE UNIQUE INDEX IF NOT EXISTS "CustomerAuthToken_tokenHash_key" ON "CustomerAuthToken"("tokenHash");
      CREATE INDEX IF NOT EXISTS "CustomerAuthToken_userId_purpose_idx" ON "CustomerAuthToken"("userId", "purpose");
      CREATE INDEX IF NOT EXISTS "CustomerAuthToken_expiresAt_idx" ON "CustomerAuthToken"("expiresAt");
      CREATE INDEX IF NOT EXISTS "CustomerAuthToken_consumedAt_idx" ON "CustomerAuthToken"("consumedAt");
      CREATE INDEX IF NOT EXISTS "Order_userId_idx" ON "Order"("userId");

      DO $$ BEGIN
        ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;

      DO $$ BEGIN
        ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;

      DO $$ BEGIN
        ALTER TABLE "CustomerAuthToken" ADD CONSTRAINT "CustomerAuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;

      DO $$ BEGIN
        ALTER TABLE "User" ADD CONSTRAINT "user_has_at_least_one_identifier" CHECK ("email" IS NOT NULL OR "normalizedPhone" IS NOT NULL);
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;

      DO $$ BEGIN
        ALTER TABLE "User" ADD CONSTRAINT "user_email_must_be_canonical_lowercase" CHECK ("email" IS NULL OR "email" = lower("email"));
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `;

    await pool.query(migrationSql);
  });

  after(async () => {
    if (prismaTest) await prismaTest.$disconnect();
    if (pool) await pool.end();
  });

  it("A. User with email only succeeds", async () => {
    const suffix = Math.random().toString(36).substring(2, 8);
    const user = await prismaTest.user.create({
      data: {
        name: "Email Only User",
        email: `email_${suffix}@example.com`,
        normalizedPhone: null,
        passwordHash: "scrypt$dummyhash",
      },
    });

    assert.ok(user.id);
    assert.strictEqual(user.email, `email_${suffix}@example.com`);
    assert.strictEqual(user.normalizedPhone, null);

    await prismaTest.user.delete({ where: { id: user.id } });
  });

  it("B. User with normalizedPhone only succeeds", async () => {
    const suffix = Math.floor(10000000 + Math.random() * 90000000);
    const phone = `017${suffix}`.slice(0, 11);
    const user = await prismaTest.user.create({
      data: {
        name: "Phone Only User",
        email: null,
        normalizedPhone: phone,
        passwordHash: "scrypt$dummyhash",
      },
    });

    assert.ok(user.id);
    assert.strictEqual(user.normalizedPhone, phone);
    assert.strictEqual(user.email, null);

    await prismaTest.user.delete({ where: { id: user.id } });
  });

  it("C. User with neither identifier fails CHECK constraint (user_has_at_least_one_identifier)", async () => {
    await assert.rejects(
      () =>
        prismaTest.user.create({
          data: {
            name: "No Identifier User",
            email: null,
            normalizedPhone: null,
            passwordHash: "scrypt$dummyhash",
          },
        }),
      (err: any) => {
        return (
          err.message.includes("user_has_at_least_one_identifier") ||
          err.message.includes("check constraint") ||
          err.code === "23514"
        );
      }
    );
  });

  it("D. Uppercase/noncanonical email fails lowercase CHECK constraint (user_email_must_be_canonical_lowercase)", async () => {
    const suffix = Math.random().toString(36).substring(2, 8);
    await assert.rejects(
      () =>
        prismaTest.user.create({
          data: {
            name: "Uppercase User",
            email: `UPPER_${suffix}@EXAMPLE.COM`,
            normalizedPhone: null,
            passwordHash: "scrypt$dummyhash",
          },
        }),
      (err: any) => {
        return (
          err.message.includes("user_email_must_be_canonical_lowercase") ||
          err.message.includes("check constraint") ||
          err.code === "23514"
        );
      }
    );
  });

  it("E. Duplicate email fails DB uniqueness", async () => {
    const suffix = Math.random().toString(36).substring(2, 8);
    const email = `dup_${suffix}@example.com`;

    const user1 = await prismaTest.user.create({
      data: {
        name: "User One",
        email,
        normalizedPhone: null,
        passwordHash: "scrypt$dummyhash1",
      },
    });

    await assert.rejects(
      () =>
        prismaTest.user.create({
          data: {
            name: "User Two",
            email,
            normalizedPhone: null,
            passwordHash: "scrypt$dummyhash2",
          },
        }),
      (err: any) => {
        return err.code === "P2002" || err.message.includes("unique constraint");
      }
    );

    await prismaTest.user.delete({ where: { id: user1.id } });
  });

  it("F. Duplicate canonical phone fails DB uniqueness", async () => {
    const suffix = Math.floor(10000000 + Math.random() * 90000000);
    const phone = `018${suffix}`.slice(0, 11);

    const user1 = await prismaTest.user.create({
      data: {
        name: "Phone User One",
        email: null,
        normalizedPhone: phone,
        passwordHash: "scrypt$dummyhash1",
      },
    });

    await assert.rejects(
      () =>
        prismaTest.user.create({
          data: {
            name: "Phone User Two",
            email: null,
            normalizedPhone: phone,
            passwordHash: "scrypt$dummyhash2",
          },
        }),
      (err: any) => {
        return err.code === "P2002" || err.message.includes("unique constraint");
      }
    );

    await prismaTest.user.delete({ where: { id: user1.id } });
  });

  it("G. CustomerSession.tokenHash duplicate fails uniqueness", async () => {
    const suffix = Math.random().toString(36).substring(2, 8);
    const user = await prismaTest.user.create({
      data: {
        name: "Session User",
        email: `sess_${suffix}@example.com`,
        normalizedPhone: null,
        passwordHash: "scrypt$dummyhash",
      },
    });

    const tokenHash = `hash_${suffix}_${Math.random().toString(36).slice(2)}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const session1 = await prismaTest.customerSession.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    await assert.rejects(
      () =>
        prismaTest.customerSession.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt,
          },
        }),
      (err: any) => {
        return err.code === "P2002" || err.message.includes("unique constraint");
      }
    );

    await prismaTest.customerSession.delete({ where: { id: session1.id } });
    await prismaTest.user.delete({ where: { id: user.id } });
  });

  it("H. CustomerAuthToken.tokenHash duplicate fails uniqueness", async () => {
    const suffix = Math.random().toString(36).substring(2, 8);
    const user = await prismaTest.user.create({
      data: {
        name: "Token User",
        email: `tok_${suffix}@example.com`,
        normalizedPhone: null,
        passwordHash: "scrypt$dummyhash",
      },
    });

    const tokenHash = `tokhash_${suffix}_${Math.random().toString(36).slice(2)}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const authTok1 = await prismaTest.customerAuthToken.create({
      data: {
        userId: user.id,
        purpose: "PASSWORD_RESET",
        tokenHash,
        expiresAt,
      },
    });

    await assert.rejects(
      () =>
        prismaTest.customerAuthToken.create({
          data: {
            userId: user.id,
            purpose: "PASSWORD_RESET",
            tokenHash,
            expiresAt,
          },
        }),
      (err: any) => {
        return err.code === "P2002" || err.message.includes("unique constraint");
      }
    );

    await prismaTest.customerAuthToken.delete({ where: { id: authTok1.id } });
    await prismaTest.user.delete({ where: { id: user.id } });
  });

  it("I. Order.userId may be null (Guest orders)", async () => {
    const suffix = Math.random().toString(36).substring(2, 8);
    const guestOrder = await prismaTest.order.create({
      data: {
        orderId: `PH-GST-${suffix}`,
        customerName: "Guest Buyer",
        customerPhone: "01700000000",
        customerCity: "Dhaka",
        customerAddress: "Guest Address",
        subtotal: 100,
        deliveryFee: 60,
        total: 160,
        status: "pending",
        paymentMethod: "COD",
        userId: null,
      },
    });

    assert.ok(guestOrder.id);
    assert.strictEqual(guestOrder.userId, null);

    await prismaTest.order.delete({ where: { id: guestOrder.id } });
  });

  it("J. Order.userId valid User relation succeeds", async () => {
    const suffix = Math.random().toString(36).substring(2, 8);
    const user = await prismaTest.user.create({
      data: {
        name: "Order Owner",
        email: `owner_${suffix}@example.com`,
        normalizedPhone: null,
        passwordHash: "scrypt$dummyhash",
      },
    });

    const userOrder = await prismaTest.order.create({
      data: {
        orderId: `PH-OWN-${suffix}`,
        customerName: "Order Owner",
        customerPhone: "01711111111",
        customerCity: "Dhaka",
        customerAddress: "Owner Address",
        subtotal: 200,
        deliveryFee: 60,
        total: 260,
        status: "pending",
        paymentMethod: "COD",
        userId: user.id,
      },
    });

    assert.ok(userOrder.id);
    assert.strictEqual(userOrder.userId, user.id);

    const loaded = await prismaTest.order.findUnique({
      where: { id: userOrder.id },
      include: { user: true },
    });
    assert.strictEqual(loaded?.user?.id, user.id);

    await prismaTest.order.delete({ where: { id: userOrder.id } });
    await prismaTest.user.delete({ where: { id: user.id } });
  });

  it("K. User with owned Order cannot be cascade-deleted (onDelete: Restrict)", async () => {
    const suffix = Math.random().toString(36).substring(2, 8);
    const user = await prismaTest.user.create({
      data: {
        name: "Protected User",
        email: `prot_${suffix}@example.com`,
        normalizedPhone: null,
        passwordHash: "scrypt$dummyhash",
      },
    });

    const userOrder = await prismaTest.order.create({
      data: {
        orderId: `PH-PROT-${suffix}`,
        customerName: "Protected User",
        customerPhone: "01722222222",
        customerCity: "Dhaka",
        customerAddress: "Protected Address",
        subtotal: 300,
        deliveryFee: 60,
        total: 360,
        status: "pending",
        paymentMethod: "COD",
        userId: user.id,
      },
    });

    // Attempting to delete User while owned Order exists must fail with Restrict foreign key violation
    await assert.rejects(
      () => prismaTest.user.delete({ where: { id: user.id } }),
      (err: any) => {
        return (
          err.code === "P2003" ||
          err.message.includes("Foreign key constraint violated") ||
          err.message.includes("violates foreign key constraint")
        );
      }
    );

    // Clean up order first, then user
    await prismaTest.order.delete({ where: { id: userOrder.id } });
    await prismaTest.user.delete({ where: { id: user.id } });
  });

  it("L. Existing guest-style Order rows remain compatible and queryable", async () => {
    const suffix = Math.random().toString(36).substring(2, 8);
    const order = await prismaTest.order.create({
      data: {
        orderId: `PH-COMPAT-${suffix}`,
        customerName: "Legacy Customer",
        customerPhone: "01733333333",
        customerCity: "Chittagong",
        customerAddress: "Chittagong Address",
        subtotal: 500,
        deliveryFee: 120,
        total: 620,
        status: "pending",
        paymentMethod: "bKash",
      },
    });

    const found = await prismaTest.order.findUnique({
      where: { orderId: `PH-COMPAT-${suffix}` },
      include: { user: true },
    });

    assert.ok(found);
    assert.strictEqual(found?.userId, null);
    assert.strictEqual(found?.user, null);
    assert.strictEqual(found?.customerName, "Legacy Customer");

    await prismaTest.order.delete({ where: { id: order.id } });
  });
});
