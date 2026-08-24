/**
 * Schema Foundation Contract Tests — Wave A (Task 1)
 *
 * Verifies that the Prisma schema and migration define the complete, approved Phase-2 foundation:
 *   1. Order has nullable unique submissionToken
 *   2. Order has paymentRecord relation
 *   3. OrderItem has reservation and returnItems relations
 *   4. InventoryReservation exists with required fields and unique orderItemId
 *   5. InventoryReservation does NOT contain variantLabel
 *   6. PaymentRecord exists with authoritative state and refund/COD metadata
 *   7. PaymentRecord does NOT duplicate refundState or evidenceDeadlineAt
 *   8. PaymentEvidenceAttempt uses normalizedProvider and normalizedTrxId
 *   9. ReturnItem physicalReturnAt is nullable DateTime? without default
 *   10. Migration SQL enforces partial unique index on (normalizedProvider, normalizedTrxId)
 *   11. Migration SQL creates physicalReturnAt as nullable without CURRENT_TIMESTAMP default
 *
 * Run with:
 *   npx tsx --test tests/schema-foundation.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readPrismaSchema(): string {
  const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
  return fs.readFileSync(schemaPath, "utf8");
}

function readMigrationSql(): string {
  const migrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260824183206_phase2_foundation",
    "migration.sql"
  );
  return fs.readFileSync(migrationPath, "utf8");
}

function extractModel(schema: string, modelName: string): string {
  const regex = new RegExp(`model\\s+${modelName}\\s+\\{([\\s\\S]*?)\\}`, "m");
  const match = schema.match(regex);
  if (!match) {
    throw new Error(`Model "${modelName}" not found in schema.prisma`);
  }
  return match[1];
}

test("Schema Foundation — Order Model Extensions", () => {
  const schema = readPrismaSchema();
  const orderModel = extractModel(schema, "Order");

  // 1. submissionToken String? @unique
  assert.match(
    orderModel,
    /submissionToken\s+String\?\s+@unique/,
    "Order model must have nullable unique submissionToken"
  );

  // 2. Relation to PaymentRecord
  assert.match(
    orderModel,
    /paymentRecord\s+PaymentRecord\?/,
    "Order model must define optional 1-to-1 relation to PaymentRecord"
  );
});

test("Schema Foundation — OrderItem Model Relations", () => {
  const schema = readPrismaSchema();
  const itemModel = extractModel(schema, "OrderItem");

  // 1. Relation to InventoryReservation
  assert.match(
    itemModel,
    /reservation\s+InventoryReservation\?/,
    "OrderItem model must define optional 1-to-1 relation to InventoryReservation"
  );

  // 2. Relation to ReturnItem
  assert.match(
    itemModel,
    /returnItems\s+ReturnItem\[\]/,
    "OrderItem model must define 1-to-many relation to ReturnItem"
  );
});

test("Schema Foundation — InventoryReservation Model Contract", () => {
  const schema = readPrismaSchema();
  const resModel = extractModel(schema, "InventoryReservation");

  // Required Fields
  assert.match(resModel, /id\s+Int\s+@id\s+@default\(autoincrement\(\)\)/);
  assert.match(resModel, /orderItemId\s+Int\s+@unique/, "orderItemId must be uniquely constrained");
  assert.match(resModel, /orderId\s+String/);
  assert.match(resModel, /productId\s+Int/);
  assert.match(resModel, /variantId\s+Int\?/);
  assert.match(resModel, /quantity\s+Int/);
  assert.match(resModel, /status\s+String/);
  assert.match(resModel, /reservedAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(resModel, /evidenceDeadlineAt\s+DateTime\?/);
  assert.match(resModel, /releasedAt\s+DateTime\?/);
  assert.match(resModel, /releaseReason\s+String\?/);
  assert.match(resModel, /fulfilledAt\s+DateTime\?/);
  assert.match(resModel, /createdAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(resModel, /updatedAt\s+DateTime\s+@updatedAt/);

  // Relation to OrderItem
  assert.match(
    resModel,
    /orderItem\s+OrderItem\s+@relation\(fields:\s*\[orderItemId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/
  );

  // Invariants: Must NOT contain variantLabel
  assert.doesNotMatch(
    resModel,
    /variantLabel/,
    "InventoryReservation must NOT contain variantLabel (display snapshot only)"
  );
});

test("Schema Foundation — PaymentRecord Model Contract", () => {
  const schema = readPrismaSchema();
  const payModel = extractModel(schema, "PaymentRecord");

  // Required Fields
  assert.match(payModel, /id\s+Int\s+@id\s+@default\(autoincrement\(\)\)/);
  assert.match(payModel, /orderId\s+String\s+@unique/);
  assert.match(payModel, /method\s+String/);
  assert.match(payModel, /state\s+String/);
  assert.match(payModel, /provider\s+String\?/);
  assert.match(payModel, /verifiedAt\s+DateTime\?/);
  assert.match(payModel, /verifiedBy\s+String\?/);
  assert.match(payModel, /rejectionNote\s+String\?/);

  // Refund Metadata
  assert.match(payModel, /refundAmount\s+Float\?/);
  assert.match(payModel, /refundRequiredAt\s+DateTime\?/);
  assert.match(payModel, /refundProcessingAt\s+DateTime\?/);
  assert.match(payModel, /refundedAt\s+DateTime\?/);
  assert.match(payModel, /refundNote\s+String\?/);

  // COD Settlement Metadata
  assert.match(payModel, /codSettlementState\s+String\?/);
  assert.match(payModel, /codSettledAt\s+DateTime\?/);
  assert.match(payModel, /codSettlementNote\s+String\?/);

  // Relations
  assert.match(
    payModel,
    /order\s+Order\s+@relation\(fields:\s*\[orderId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/
  );
  assert.match(payModel, /evidenceAttempts\s+PaymentEvidenceAttempt\[\]/);

  // Invariants: Must NOT duplicate refundState or evidenceDeadlineAt
  assert.doesNotMatch(
    payModel,
    /refundState/,
    "PaymentRecord must NOT contain a duplicate refundState column (state is authoritative)"
  );
  assert.doesNotMatch(
    payModel,
    /evidenceDeadlineAt/,
    "PaymentRecord must NOT duplicate evidenceDeadlineAt (owned by InventoryReservation)"
  );
});

test("Schema Foundation — PaymentEvidenceAttempt Model Contract", () => {
  const schema = readPrismaSchema();
  const attemptModel = extractModel(schema, "PaymentEvidenceAttempt");

  // Required Fields
  assert.match(attemptModel, /id\s+Int\s+@id\s+@default\(autoincrement\(\)\)/);
  assert.match(attemptModel, /paymentRecordId\s+Int/);
  assert.match(
    attemptModel,
    /normalizedProvider\s+String/,
    "PaymentEvidenceAttempt must use normalizedProvider for anti-replay identity"
  );
  assert.match(attemptModel, /senderNumber\s+String/);
  assert.match(attemptModel, /trxId\s+String/);
  assert.match(
    attemptModel,
    /normalizedTrxId\s+String/,
    "PaymentEvidenceAttempt must use normalizedTrxId for anti-replay identity"
  );
  assert.match(attemptModel, /submittedAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(attemptModel, /state\s+String/);
  assert.match(attemptModel, /verifiedAt\s+DateTime\?/);
  assert.match(attemptModel, /verifiedBy\s+String\?/);
  assert.match(attemptModel, /rejectionNote\s+String\?/);

  // Relation
  assert.match(
    attemptModel,
    /paymentRecord\s+PaymentRecord\s+@relation\(fields:\s*\[paymentRecordId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/
  );
});

test("Schema Foundation — ReturnItem Model Contract", () => {
  const schema = readPrismaSchema();
  const returnModel = extractModel(schema, "ReturnItem");

  // Required Fields
  assert.match(returnModel, /id\s+Int\s+@id\s+@default\(autoincrement\(\)\)/);
  assert.match(returnModel, /orderId\s+String/);
  assert.match(returnModel, /orderItemId\s+Int/);
  assert.match(returnModel, /productId\s+Int\?/);
  assert.match(returnModel, /variantId\s+Int\?/);
  assert.match(returnModel, /quantity\s+Int/);
  assert.match(returnModel, /disposition\s+String/);

  // physicalReturnAt must be nullable DateTime? without default
  assert.match(
    returnModel,
    /physicalReturnAt\s+DateTime\?/,
    "physicalReturnAt must be nullable DateTime? to distinguish unreceived return intent from verified physical intake"
  );
  assert.doesNotMatch(
    returnModel,
    /physicalReturnAt\s+DateTime\?\s+@default/,
    "physicalReturnAt must NOT have a default value"
  );

  assert.match(returnModel, /restockedAt\s+DateTime\?/);
  assert.match(returnModel, /adminNote\s+String\?/);

  // Relation
  assert.match(
    returnModel,
    /orderItem\s+OrderItem\s+@relation\(fields:\s*\[orderItemId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/
  );
});

test("Schema Foundation — Migration SQL Anti-Replay and Physical Receipt Semantics", () => {
  const sql = readMigrationSql();

  // Partial unique index on (normalizedProvider, normalizedTrxId)
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "idx_payment_evidence_active_claim"\s+ON "PaymentEvidenceAttempt"\s*\("normalizedProvider",\s*"normalizedTrxId"\)\s+WHERE "state" IN \('PENDING_REVIEW', 'ACCEPTED'\);/,
    "Migration SQL must define partial unique index using normalizedProvider and normalizedTrxId"
  );

  // physicalReturnAt in ReturnItem table must be nullable without DEFAULT CURRENT_TIMESTAMP
  assert.match(
    sql,
    /"physicalReturnAt"\s+TIMESTAMP\(3\),/,
    "Migration SQL ReturnItem table must define physicalReturnAt as nullable TIMESTAMP(3) without default"
  );
  assert.doesNotMatch(
    sql,
    /"physicalReturnAt"\s+TIMESTAMP\(3\)\s+NOT NULL\s+DEFAULT CURRENT_TIMESTAMP/,
    "Migration SQL must NOT make physicalReturnAt NOT NULL DEFAULT CURRENT_TIMESTAMP"
  );
});
