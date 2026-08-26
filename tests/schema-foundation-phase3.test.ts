/**
 * Schema Foundation Contract Tests — Phase 3 Wave A
 *
 * Verifies that the Prisma schema defines the complete, approved Phase-3 foundation:
 *   1. User model exists with required fields and unique nullable identifiers
 *   2. User model does not include redundant indexes or role enums
 *   3. CustomerSession model exists with tokenHash @unique and onDelete: Cascade
 *   4. AuthTokenPurpose enum and CustomerAuthToken model exist
 *   5. Order model has nullable userId with onDelete: Restrict and index
 *
 * Run with:
 *   npx tsx --test tests/schema-foundation-phase3.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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

function extractEnum(schema: string, enumName: string): string {
  const regex = new RegExp(`enum\\s+${enumName}\\s+\\{([\\s\\S]*?)\\}`, "m");
  const match = schema.match(regex);
  if (!match) {
    throw new Error(`Enum "${enumName}" not found in schema.prisma`);
  }
  return match[1];
}

test("Phase 3 Schema Foundation — User Model Contract", () => {
  const schema = readPrismaSchema();
  const userModel = extractModel(schema, "User");

  assert.match(userModel, /id\s+String\s+@id\s+@default\(cuid\(\)\)/, "User must have cuid id");
  assert.match(userModel, /name\s+String/, "User must have name");
  assert.match(userModel, /email\s+String\?\s+@unique/, "User must have nullable unique email");
  assert.match(userModel, /normalizedPhone\s+String\?\s+@unique/, "User must have nullable unique normalizedPhone");
  assert.match(userModel, /passwordHash\s+String/, "User must have passwordHash");
  assert.match(userModel, /emailVerifiedAt\s+DateTime\?/, "User must have nullable emailVerifiedAt");
  assert.match(userModel, /phoneVerifiedAt\s+DateTime\?/, "User must have nullable phoneVerifiedAt");
  assert.match(userModel, /isActive\s+Boolean\s+@default\(true\)/, "User must have isActive default true");
  assert.match(userModel, /createdAt\s+DateTime\s+@default\(now\(\)\)/, "User must have createdAt");
  assert.match(userModel, /updatedAt\s+DateTime\s+@updatedAt/, "User must have updatedAt");

  // Relations
  assert.match(userModel, /orders\s+Order\[\]/, "User must relate to Order[]");
  assert.match(userModel, /sessions\s+CustomerSession\[\]/, "User must relate to CustomerSession[]");
  assert.match(userModel, /authTokens\s+CustomerAuthToken\[\]/, "User must relate to CustomerAuthToken[]");

  // Redundant indexes check (Must NOT exist)
  assert.doesNotMatch(userModel, /@@index\(\[email\]\)/, "Must not have redundant @@index([email])");
  assert.doesNotMatch(userModel, /@@index\(\[normalizedPhone\]\)/, "Must not have redundant @@index([normalizedPhone])");
  assert.doesNotMatch(userModel, /@@index\(\[isActive\]\)/, "Must not have redundant @@index([isActive])");
});

test("Phase 3 Schema Foundation — CustomerSession Model Contract", () => {
  const schema = readPrismaSchema();
  const sessionModel = extractModel(schema, "CustomerSession");

  assert.match(sessionModel, /id\s+String\s+@id\s+@default\(cuid\(\)\)/, "CustomerSession must have cuid id");
  assert.match(sessionModel, /userId\s+String/, "CustomerSession must have userId");
  assert.match(sessionModel, /tokenHash\s+String\s+@unique/, "CustomerSession must have unique tokenHash");
  assert.match(sessionModel, /createdAt\s+DateTime\s+@default\(now\(\)\)/, "CustomerSession must have createdAt");
  assert.match(sessionModel, /expiresAt\s+DateTime/, "CustomerSession must have expiresAt");
  assert.match(sessionModel, /revokedAt\s+DateTime\?/, "CustomerSession must have nullable revokedAt");
  assert.match(sessionModel, /userAgent\s+String\?/, "CustomerSession must have nullable userAgent");
  assert.match(sessionModel, /ipAddress\s+String\?/, "CustomerSession must have nullable ipAddress");

  assert.match(
    sessionModel,
    /user\s+User\s+@relation\(fields:\s*\[userId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/,
    "CustomerSession must cascade delete on user deletion"
  );

  assert.match(sessionModel, /@@index\(\[userId\]\)/, "CustomerSession must index userId");
  assert.match(sessionModel, /@@index\(\[expiresAt\]\)/, "CustomerSession must index expiresAt");
  assert.match(sessionModel, /@@index\(\[revokedAt\]\)/, "CustomerSession must index revokedAt");
});

test("Phase 3 Schema Foundation — CustomerAuthToken Model Contract", () => {
  const schema = readPrismaSchema();
  const tokenModel = extractModel(schema, "CustomerAuthToken");
  const purposeEnum = extractEnum(schema, "AuthTokenPurpose");

  assert.match(purposeEnum, /PASSWORD_RESET/, "AuthTokenPurpose must include PASSWORD_RESET");
  assert.match(purposeEnum, /EMAIL_VERIFICATION/, "AuthTokenPurpose must include EMAIL_VERIFICATION");

  assert.match(tokenModel, /id\s+String\s+@id\s+@default\(cuid\(\)\)/, "CustomerAuthToken must have cuid id");
  assert.match(tokenModel, /userId\s+String/, "CustomerAuthToken must have userId");
  assert.match(tokenModel, /purpose\s+AuthTokenPurpose/, "CustomerAuthToken must have purpose");
  assert.match(tokenModel, /tokenHash\s+String\s+@unique/, "CustomerAuthToken must have unique tokenHash");
  assert.match(tokenModel, /expiresAt\s+DateTime/, "CustomerAuthToken must have expiresAt");
  assert.match(tokenModel, /consumedAt\s+DateTime\?/, "CustomerAuthToken must have nullable consumedAt");
  assert.match(tokenModel, /createdAt\s+DateTime\s+@default\(now\(\)\)/, "CustomerAuthToken must have createdAt");

  assert.match(
    tokenModel,
    /user\s+User\s+@relation\(fields:\s*\[userId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/,
    "CustomerAuthToken must cascade delete on user deletion"
  );

  assert.match(tokenModel, /@@index\(\[userId,\s*purpose\]\)/, "CustomerAuthToken must index [userId, purpose]");
  assert.match(tokenModel, /@@index\(\[expiresAt\]\)/, "CustomerAuthToken must index expiresAt");
  assert.match(tokenModel, /@@index\(\[consumedAt\]\)/, "CustomerAuthToken must index consumedAt");
});

test("Phase 3 Schema Foundation — Order Model User Relation", () => {
  const schema = readPrismaSchema();
  const orderModel = extractModel(schema, "Order");

  assert.match(orderModel, /userId\s+String\?/, "Order model must have nullable userId");
  assert.match(
    orderModel,
    /user\s+User\?\s+@relation\(fields:\s*\[userId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict\)/,
    "Order model must define relation to User with onDelete: Restrict"
  );
  assert.match(orderModel, /@@index\(\[userId\]\)/, "Order model must index userId");
});
