/**
 * Phase 2 Server-Authoritative Money Utilities
 * Provides deterministic float-era rounding, validation, and order aggregation.
 */

import { DEFAULT_DELIVERY_FEE } from "./commerceConstants";

/**
 * Normalizes an unknown numeric input to a 2-decimal-place float.
 * Throws if value is null, undefined, NaN, or non-finite.
 */
export function normalizeMoney(value: unknown, fieldName = "Money value"): number {
  if (value === null || value === undefined || typeof value === "boolean") {
    throw new Error(`${fieldName} must be a finite number`);
  }

  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`${fieldName} must be a finite number`);
  }

  return Math.round(num * 100) / 100;
}

/**
 * Validates and normalizes a non-negative money amount.
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

  const rounded = Math.round(num * 100) / 100;
  if (rounded < 0) {
    throw new Error(`${fieldName} must be a non-negative finite number`);
  }

  return rounded;
}

/**
 * Calculates server-authoritative subtotal, delivery fee, and total.
 */
export function calculateOrderTotals(
  items: Array<{ price: number; quantity: number }>,
  deliveryFee: number = DEFAULT_DELIVERY_FEE
): { subtotal: number; deliveryFee: number; total: number } {
  const normalizedFee = requireNonNegativeMoney(deliveryFee, "Delivery fee");

  let subtotal = 0;
  for (const item of items) {
    const itemPrice = requireNonNegativeMoney(item.price, "Item price");
    const itemQty = Math.max(1, Math.floor(Number(item.quantity) || 1));
    subtotal = Math.round((subtotal + itemPrice * itemQty) * 100) / 100;
  }

  const total = Math.round((subtotal + normalizedFee) * 100) / 100;

  return {
    subtotal,
    deliveryFee: normalizedFee,
    total,
  };
}
