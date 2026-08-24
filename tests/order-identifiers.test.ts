/**
 * Order Identifiers Behavioral Tests — Wave B (Task 4)
 *
 * Verifies:
 *   1. Order ID format matches PH-YYYYMMDD-XXXXXXXXXXXXX
 *   2. Suffix is exactly 13 characters from canonical Crockford Base32 alphabet
 *   3. Deterministic byte-to-Crockford encoding
 *   4. CSPRNG randomness generation
 *   5. Collision retry handles P2002 orderId collision up to 5 times
 *   6. Collision retry rejects non-orderId P2002 collisions without retrying
 *   7. Exhaustion of 5 attempts throws controlled server error
 *
 * Run with:
 *   npx tsx --test tests/order-identifiers.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateOrderId,
  encodeCrockfordBase32,
  withOrderIdRetry,
  CROCKFORD_ALPHABET,
} from "@/lib/orderIdentifiers";

test("Task 4 — Order ID Format and Alphabet", () => {
  const fixedDate = new Date(2026, 7, 25); // Aug 25, 2026
  const orderId = generateOrderId(fixedDate);

  assert.strictEqual(orderId.length, 25, "Order ID length must be exactly 25 characters");
  assert.match(orderId, /^PH-20260825-[0-9A-HJKMNP-Z]{13}$/, "Order ID must match canonical format");

  // Verify alphabet does not include ambiguous characters (I, L, O, U)
  assert.strictEqual(CROCKFORD_ALPHABET.length, 32);
  assert.strictEqual(CROCKFORD_ALPHABET.includes("I"), false);
  assert.strictEqual(CROCKFORD_ALPHABET.includes("L"), false);
  assert.strictEqual(CROCKFORD_ALPHABET.includes("O"), false);
  assert.strictEqual(CROCKFORD_ALPHABET.includes("U"), false);
});

test("Task 4 — Deterministic Crockford Base32 Encoding", () => {
  const zeroBytes = Buffer.alloc(8, 0);
  assert.strictEqual(encodeCrockfordBase32(zeroBytes), "0000000000000");

  const maxBytes = Buffer.alloc(8, 0xff);
  assert.strictEqual(encodeCrockfordBase32(maxBytes), "FZZZZZZZZZZZZ");
});

test("Task 4 — CSPRNG Non-Determinism", () => {
  const id1 = generateOrderId();
  const id2 = generateOrderId();
  assert.notStrictEqual(id1, id2, "Consecutive IDs must be distinct");
});

test("Task 4 — Collision Retry on OrderId P2002", async () => {
  let attempts = 0;
  const passedIds: string[] = [];

  const result = await withOrderIdRetry(async (id) => {
    attempts++;
    passedIds.push(id);
    if (attempts === 1) {
      const err = new Error("Unique constraint failed on the fields: (`orderId`)") as any;
      err.code = "P2002";
      err.meta = { target: ["orderId"] };
      throw err;
    }
    return { success: true, orderId: id };
  }, 5);

  assert.strictEqual(attempts, 2, "Should retry once upon orderId collision");
  assert.strictEqual(result.success, true);
  assert.notStrictEqual(passedIds[0], passedIds[1], "Retried attempt must use a fresh orderId");
});

test("Task 4 — Non-orderId P2002 Collision Fails Fast (No Retry)", async () => {
  let attempts = 0;

  await assert.rejects(
    async () => {
      await withOrderIdRetry(async () => {
        attempts++;
        const err = new Error("Unique constraint failed on the fields: (`submissionToken`)") as any;
        err.code = "P2002";
        err.meta = { target: ["submissionToken"] };
        throw err;
      }, 5);
    },
    (err: any) => {
      assert.strictEqual(err.code, "P2002");
      return true;
    }
  );

  assert.strictEqual(attempts, 1, "Must NOT retry if collision is on submissionToken");
});

test("Task 4 — Collision Retry Exhaustion", async () => {
  let attempts = 0;

  await assert.rejects(
    async () => {
      await withOrderIdRetry(async () => {
        attempts++;
        const err = new Error("Unique constraint failed on the fields: (`orderId`)") as any;
        err.code = "P2002";
        err.meta = { target: ["orderId"] };
        throw err;
      }, 5);
    },
    /Failed to generate a unique order identifier/
  );

  assert.strictEqual(attempts, 5, "Must attempt exactly 5 times before failing");
});
