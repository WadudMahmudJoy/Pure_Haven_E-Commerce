/**
 * Phase 4 Server-Authoritative Money Utilities
 * Provides deterministic fixed-point rounding, validation, exact cent calculations,
 * and eliminates JavaScript IEEE-754 floating-point arithmetic authority.
 */

import { DEFAULT_DELIVERY_FEE } from "./commerceConstants";
import { Prisma } from "@/generated/prisma/client";

function parseStringToCents(str: string, fieldName: string): number {
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw new Error(`${fieldName} must be a finite number`);
  }
  const isNegative = str.startsWith("-");
  const abs = isNegative ? str.slice(1) : str;
  const parts = abs.split(".");
  const whole = parseInt(parts[0], 10);
  let frac = 0;
  if (parts.length > 1) {
    const fracStr = parts[1].padEnd(2, "0").slice(0, 2);
    frac = parseInt(fracStr, 10);
    if (parts[1].length > 2 && parseInt(parts[1][2], 10) >= 5) {
      frac += 1;
    }
  }
  const cents = whole * 100 + frac;
  return isNegative ? -cents : cents;
}

/**
 * Converts a monetary numeric value, Prisma Decimal, or numeric string to integer cents.
 */
export function toCents(value: unknown, fieldName = "Money value"): number {
  if (value === null || value === undefined || typeof value === "boolean") {
    throw new Error(`${fieldName} must be a finite number`);
  }

  if (typeof value === "object" && value !== null && "toFixed" in value) {
    return parseStringToCents(String(value).trim(), fieldName);
  }

  if (typeof value === "string") {
    return parseStringToCents(value.trim(), fieldName);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${fieldName} must be a finite number`);
    }
    return Math.round(value * 100);
  }

  const str = String(value).trim();
  return parseStringToCents(str, fieldName);
}

/**
 * Converts integer cents back to a 2-decimal-place standard number.
 */
export function centsToMoney(cents: number): number {
  return cents / 100;
}

/**
 * Converts a monetary input to a Prisma Decimal instance.
 */
export function toPrismaDecimal(value: unknown, fieldName = "Money value"): Prisma.Decimal {
  const cents = toCents(value, fieldName);
  return new Prisma.Decimal((cents / 100).toFixed(2));
}

/**
 * Normalizes an unknown numeric input to a 2-decimal-place number using exact cent rounding.
 * Throws if value is null, undefined, NaN, or non-finite.
 */
export function normalizeMoney(value: unknown, fieldName = "Money value"): number {
  const cents = toCents(value, fieldName);
  return cents / 100;
}

/**
 * Validates and normalizes a non-negative money amount using exact cents.
 * Throws if value is negative, null, undefined, or non-finite.
 */
export function requireNonNegativeMoney(value: unknown, fieldName = "Money value"): number {
  if (value === null || value === undefined || typeof value === "boolean") {
    throw new Error(`${fieldName} must be a non-negative finite number`);
  }

  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`${fieldName} must be a non-negative finite number`);
  }

  const cents = Math.round(num * 100);
  if (cents < 0) {
    throw new Error(`${fieldName} must be a non-negative finite number`);
  }

  return cents / 100;
}

/**
 * Calculates server-authoritative subtotal, delivery fee, and total using exact integer cents.
 */
export function calculateOrderTotals(
  items: Array<{ price: number | Prisma.Decimal; quantity: number }>,
  deliveryFee: number | Prisma.Decimal = DEFAULT_DELIVERY_FEE
): { subtotal: number; deliveryFee: number; total: number } {
  const feeCents = toCents(deliveryFee, "Delivery fee");
  if (feeCents < 0) {
    throw new Error("Delivery fee must be a non-negative finite number");
  }

  let subtotalCents = 0;
  for (const item of items) {
    const itemPriceCents = toCents(item.price, "Item price");
    if (itemPriceCents < 0) {
      throw new Error("Item price must be a non-negative finite number");
    }
    const itemQty = Math.max(1, Math.floor(Number(item.quantity) || 1));
    subtotalCents += itemPriceCents * itemQty;
  }

  const totalCents = subtotalCents + feeCents;

  return {
    subtotal: subtotalCents / 100,
    deliveryFee: feeCents / 100,
    total: totalCents / 100,
  };
}
