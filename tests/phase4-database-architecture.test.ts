/**
 * Phase 4 Database Architecture Contract Tests
 *
 * Verifies all 10 Owner-Approved Architectural Decisions (D1 - D10) & Invariants:
 *   D1: AdminCredential model exists, unique email, isolated from User
 *   D2: Decimal(12, 2) monetary types on Product, ProductVariant, Order, OrderItem, PaymentRecord
 *   D3: SiteBranding model with structured fields and singletonKey = "PRIMARY" unique invariant
 *   D4: Normalized FooterSettings + FooterLink with singletonKey = "PRIMARY" and FooterLinkGroup enum
 *   D5: Product.categoryId nullable foreign key relation to Category with authoritative write resolution
 *   D6: Product soft-delete fields (isActive, deletedAt) and ProductVariant.isActive
 *   D7: CustomerMessage model with CustomerMessageStatus enum
 *   D8: HomeSlide and HomePromo distinct models preserved with PromoKind enum
 *   D9: PaymentRecord canonical authority, order compatibility fields preserved
 *   D10: Complete incremental enum migration across all 11 bounded families
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  toCents,
  centsToMoney,
  toPrismaDecimal,
  normalizeMoney,
  requireNonNegativeMoney,
  calculateOrderTotals,
} from "../lib/money.js";
import { Prisma } from "../generated/prisma/client.js";

function readPrismaSchema(): string {
  const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
  return fs.readFileSync(schemaPath, "utf8");
}

function extractModel(schema: string, modelName: string): string {
  const regex = new RegExp(`model\\s+${modelName}\\s+\\{([\\s\\S]*?)\\}`, "m");
  const match = schema.match(regex);
  if (!match) {
    throw new Error(`Model "${modelName}" not found in schema.prisma`);
  }
  return match[1];
}

test("D1 — AdminCredential Authority Contract", () => {
  const schema = readPrismaSchema();
  const model = extractModel(schema, "AdminCredential");

  assert.match(model, /id\s+Int\s+@id\s+@default\(autoincrement\(\)\)/);
  assert.match(model, /email\s+String\s+@unique/);
  assert.match(model, /passwordHash\s+String/);
  assert.match(model, /recoveryEmail\s+String\?/);
  assert.match(model, /recoveryPhone\s+String\?/);
  assert.match(model, /recoveryCodeHash\s+String\?/);
  assert.match(model, /createdAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(model, /updatedAt\s+DateTime\s+@updatedAt/);

  // Strict domain separation: AdminCredential has no user relation
  assert.doesNotMatch(model, /user\s+User/i);
});

test("D2 — Monetary Decimal(12,2) Precision Contract", () => {
  const schema = readPrismaSchema();

  const product = extractModel(schema, "Product");
  assert.match(product, /price\s+Decimal\s+@db\.Decimal\(12,\s*2\)/);
  assert.match(product, /compareAtPrice\s+Decimal\?\s+@db\.Decimal\(12,\s*2\)/);

  const variant = extractModel(schema, "ProductVariant");
  assert.match(variant, /price\s+Decimal\s+@db\.Decimal\(12,\s*2\)/);

  const order = extractModel(schema, "Order");
  assert.match(order, /subtotal\s+Decimal\s+@db\.Decimal\(12,\s*2\)/);
  assert.match(order, /deliveryFee\s+Decimal\s+@db\.Decimal\(12,\s*2\)/);
  assert.match(order, /total\s+Decimal\s+@db\.Decimal\(12,\s*2\)/);

  const orderItem = extractModel(schema, "OrderItem");
  assert.match(orderItem, /price\s+Decimal\s+@db\.Decimal\(12,\s*2\)/);
  assert.match(orderItem, /compareAtPrice\s+Decimal\?\s+@db\.Decimal\(12,\s*2\)/);

  const paymentRecord = extractModel(schema, "PaymentRecord");
  assert.match(paymentRecord, /refundAmount\s+Decimal\?\s+@db\.Decimal\(12,\s*2\)/);
});

test("D3 — SiteBranding Model & DB Singleton Invariant", () => {
  const schema = readPrismaSchema();
  const model = extractModel(schema, "SiteBranding");

  assert.match(model, /singletonKey\s+String\s+@unique\s+@default\("PRIMARY"\)/);
  assert.match(model, /siteName\s+String\s+@default\("PURE"\)/);
  assert.match(model, /siteSubtitle\s+String\s+@default\("HAVEN BD"\)/);
  assert.match(model, /logoUrl\s+String\?/);
  assert.match(model, /updatedAt\s+DateTime\s+@updatedAt/);
});

test("D4 — Normalized FooterSettings & FooterLink Relational Contract", () => {
  const schema = readPrismaSchema();
  assert.match(schema, /enum\s+FooterLinkGroup\s+\{\s*QUICK_LINKS\s*CATEGORY_LINKS\s*POLICY_LINKS\s*\}/m);

  const footer = extractModel(schema, "FooterSettings");
  assert.match(footer, /singletonKey\s+String\s+@unique\s+@default\("PRIMARY"\)/);
  assert.match(footer, /links\s+FooterLink\[\]/);

  const link = extractModel(schema, "FooterLink");
  assert.match(link, /footerSettingsId\s+Int/);
  assert.match(link, /group\s+FooterLinkGroup/);
  assert.match(link, /label\s+String/);
  assert.match(link, /url\s+String/);
  assert.match(link, /sortOrder\s+Int\s+@default\(0\)/);
  assert.match(link, /isActive\s+Boolean\s+@default\(true\)/);
  assert.match(link, /footerSettings\s+FooterSettings\s+@relation\(fields:\s*\[footerSettingsId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
});

test("D5 — Product.categoryId Foreign Key Contract", () => {
  const schema = readPrismaSchema();
  const product = extractModel(schema, "Product");

  assert.match(product, /categoryId\s+Int\?/);
  assert.match(product, /categoryRel\s+Category\?\s+@relation\(fields:\s*\[categoryId\],\s*references:\s*\[id\],\s*onDelete:\s*SetNull\)/);
});

test("D6 — Product Lifecycle & Soft Delete Contract", () => {
  const schema = readPrismaSchema();

  const product = extractModel(schema, "Product");
  assert.match(product, /isActive\s+Boolean\s+@default\(true\)/);
  assert.match(product, /deletedAt\s+DateTime\?/);
  assert.match(product, /@@index\(\[isActive,\s*deletedAt\]\)/);

  const variant = extractModel(schema, "ProductVariant");
  assert.match(variant, /isActive\s+Boolean\s+@default\(true\)/);
  assert.match(variant, /@@index\(\[productId,\s*isActive\]\)/);
});

test("D7 — CustomerMessage Model & Status Enum Contract", () => {
  const schema = readPrismaSchema();
  assert.match(schema, /enum\s+CustomerMessageStatus\s+\{\s*new\s*seen\s*answered\s*closed\s*\}/m);

  const model = extractModel(schema, "CustomerMessage");
  assert.match(model, /name\s+String/);
  assert.match(model, /phone\s+String\?/);
  assert.match(model, /email\s+String\?/);
  assert.match(model, /message\s+String/);
  assert.match(model, /status\s+CustomerMessageStatus\s+@default\(new\)/);
});

test("D8 — Distinct HomePromo and HomeSlide Models Contract", () => {
  const schema = readPrismaSchema();
  assert.match(schema, /enum\s+PromoKind\s+\{\s*slider\s*wide\s*small\s*\}/m);

  const slide = extractModel(schema, "HomeSlide");
  assert.match(slide, /eyebrow\s+String/);
  assert.match(slide, /buttonText\s+String/);

  const promo = extractModel(schema, "HomePromo");
  assert.match(promo, /kind\s+PromoKind\s+@default\(slider\)/);
  assert.match(promo, /label\s+String/);
  assert.match(promo, /@@index\(\[isActive,\s*sortOrder\]\)/);
});

test("D9 — Order Payment Compatibility Fields Preserved", () => {
  const schema = readPrismaSchema();
  const order = extractModel(schema, "Order");

  assert.match(order, /paymentMethod\s+String/);
  assert.match(order, /paymentStatus\s+String/);
  assert.match(order, /paymentProvider\s+String\?/);
  assert.match(order, /paymentSenderNumber\s+String\?/);
  assert.match(order, /paymentTrxId\s+String\?/);
  assert.match(order, /paymentRecord\s+PaymentRecord\?/);
});

test("D10 — PostgreSQL Enum Inventory Contract", () => {
  const schema = readPrismaSchema();

  assert.match(schema, /enum\s+OrderStatus\s+\{/);
  assert.match(schema, /enum\s+CancellationReason\s+\{/);
  assert.match(schema, /enum\s+DeliveryFailureReason\s+\{/);
  assert.match(schema, /enum\s+ReservationStatus\s+\{/);
  assert.match(schema, /enum\s+ReservationReleaseReason\s+\{/);
  assert.match(schema, /enum\s+PaymentState\s+\{/);
  assert.match(schema, /enum\s+CodSettlementState\s+\{/);
  assert.match(schema, /enum\s+EvidenceAttemptState\s+\{/);
  assert.match(schema, /enum\s+ReturnDisposition\s+\{/);
  assert.match(schema, /enum\s+FooterLinkGroup\s+\{/);
  assert.match(schema, /enum\s+PromoKind\s+\{/);
  assert.match(schema, /enum\s+CustomerMessageStatus\s+\{/);
});

test("Exact Cent Arithmetic & Prisma.Decimal Precision", () => {
  const decimalPrice = new Prisma.Decimal("199.99");
  const totals = calculateOrderTotals(
    [
      { price: decimalPrice, quantity: 3 },
      { price: new Prisma.Decimal("50.05"), quantity: 2 },
    ],
    new Prisma.Decimal("120.00")
  );

  assert.strictEqual(totals.subtotal, 700.07);
  assert.strictEqual(totals.deliveryFee, 120.00);
  assert.strictEqual(totals.total, 820.07);

  const prismaDec = toPrismaDecimal("123.456");
  assert.strictEqual(prismaDec.toString(), "123.46");

  assert.strictEqual(toCents("0.01"), 1);
  assert.strictEqual(toCents("120.00"), 12000);
  assert.strictEqual(toCents("999.99"), 99999);
  assert.strictEqual(centsToMoney(99999), 999.99);
});

test("CHECK Constraints Migration SQL Verification", () => {
  const migrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260827220000_phase4_enums_and_constraints",
    "migration.sql"
  );
  const sql = fs.readFileSync(migrationPath, "utf8");

  assert.match(sql, /ALTER TABLE "Product" ADD CONSTRAINT "Product_stock_nonnegative" CHECK \("stock" >= 0\)/);
  assert.match(sql, /ALTER TABLE "Product" ADD CONSTRAINT "Product_price_nonnegative" CHECK \("price" >= 0\)/);
  assert.match(sql, /ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_stock_nonnegative" CHECK \("stock" >= 0\)/);
  assert.match(sql, /ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_price_nonnegative" CHECK \("price" >= 0\)/);
  assert.match(sql, /ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_positive" CHECK \("quantity" > 0\)/);
  assert.match(sql, /ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_quantity_positive" CHECK \("quantity" > 0\)/);
  assert.match(sql, /ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_quantity_positive" CHECK \("quantity" > 0\)/);
  assert.match(sql, /ALTER TABLE "Order" ADD CONSTRAINT "Order_subtotal_nonnegative" CHECK \("subtotal" >= 0\)/);
  assert.match(sql, /ALTER TABLE "Order" ADD CONSTRAINT "Order_total_nonnegative" CHECK \("total" >= 0\)/);
  assert.match(sql, /ALTER TABLE "User" ADD CONSTRAINT "User_identifier_check" CHECK/);
});

test("Singleton Authority Migration SQL Verification", () => {
  const migrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260827220000_phase4_enums_and_constraints",
    "migration.sql"
  );
  const sql = fs.readFileSync(migrationPath, "utf8");

  assert.match(sql, /ALTER TABLE "SiteBranding" ADD COLUMN "singletonKey" TEXT NOT NULL DEFAULT 'PRIMARY'/);
  assert.match(sql, /CREATE UNIQUE INDEX "SiteBranding_singletonKey_key" ON "SiteBranding"\("singletonKey"\)/);
  assert.match(sql, /ALTER TABLE "FooterSettings" ADD COLUMN "singletonKey" TEXT NOT NULL DEFAULT 'PRIMARY'/);
  assert.match(sql, /CREATE UNIQUE INDEX "FooterSettings_singletonKey_key" ON "FooterSettings"\("singletonKey"\)/);
});