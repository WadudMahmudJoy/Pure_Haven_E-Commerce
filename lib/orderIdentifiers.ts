/**
 * Phase 2 Public Order Identifier Generation & Collision Retry
 *
 * Implements 64-bit cryptographic randomness formatted as:
 *   PH-YYYYMMDD-XXXXXXXXXXXXX (13-character Crockford Base32 suffix)
 */

import crypto from "node:crypto";
import { MAX_ORDER_ID_COLLISION_RETRIES } from "./commerceConstants";

export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Encodes an 8-byte buffer (64 bits) into exactly 13 canonical Crockford Base32 characters.
 */
export function encodeCrockfordBase32(buffer: Buffer): string {
  if (buffer.length < 8) {
    throw new Error("Buffer must be at least 8 bytes (64 bits)");
  }

  let value = buffer.readBigUInt64BE(0);
  const chars = new Array<string>(13);

  for (let i = 12; i >= 0; i--) {
    const remainder = Number(value & 31n);
    chars[i] = CROCKFORD_ALPHABET[remainder];
    value >>= 5n;
  }

  return chars.join("");
}

/**
 * Generates a strong public order identifier using CSPRNG.
 * Format: PH-YYYYMMDD-XXXXXXXXXXXXX
 */
export function generateOrderId(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  const randomBytes = crypto.randomBytes(8);
  const suffix = encodeCrockfordBase32(randomBytes);

  return `PH-${yyyy}${mm}${dd}-${suffix}`;
}

/**
 * Checks if a thrown Prisma error is a P2002 unique constraint violation targeting `orderId`.
 */
export function isOrderIdUniqueCollision(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; meta?: { target?: string[] | string } };
  if (err.code !== "P2002") return false;

  const target = err.meta?.target;
  if (Array.isArray(target)) {
    return target.includes("orderId");
  }
  if (typeof target === "string") {
    return target.includes("orderId");
  }
  return false;
}

/**
 * Executes an order creation operation with in-transaction collision retry.
 * Retries only on genuine orderId P2002 collisions up to maxRetries times.
 */
export async function withOrderIdRetry<T>(
  operation: (orderId: string) => Promise<T>,
  maxRetries: number = MAX_ORDER_ID_COLLISION_RETRIES
): Promise<T> {
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    const orderId = generateOrderId();

    try {
      return await operation(orderId);
    } catch (error) {
      if (isOrderIdUniqueCollision(error) && attempt < maxRetries) {
        // Genuine orderId collision: retry with fresh orderId
        continue;
      }
      if (isOrderIdUniqueCollision(error)) {
        throw new Error("Failed to generate a unique order identifier. Please try again.");
      }
      // Re-throw non-orderId errors immediately (e.g. submissionToken collision)
      throw error;
    }
  }

  throw new Error("Failed to generate a unique order identifier. Please try again.");
}
