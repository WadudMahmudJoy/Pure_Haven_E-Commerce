/**
 * Phase 2 Inventory Service
 * Manages atomic guarded stock reservations, conditional updates, and reservation records.
 */

import { PrismaClient } from "@/generated/prisma/client";

export class InventoryConflictError extends Error {
  code = "INSUFFICIENT_STOCK";
  productId: number;
  variantId: number | null;

  constructor(productId: number, variantId: number | null = null, message?: string) {
    super(message || "Insufficient stock for requested item");
    this.name = "InventoryConflictError";
    this.productId = productId;
    this.variantId = variantId;
  }
}

export class InventoryIntegrityError extends Error {
  code = "INVENTORY_INTEGRITY_ERROR";

  constructor(message?: string) {
    super(message || "Inventory integrity violation: parent product stock aggregate out of sync");
    this.name = "InventoryIntegrityError";
  }
}

export type ReserveItemInput = {
  id: number; // OrderItem.id
  orderId: string;
  productId: number;
  variantId?: number | null;
  quantity: number;
};

export type ReserveOptions = {
  evidenceDeadlineAt?: Date | null;
  reservationTimestamp?: Date;
};

type DbClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export type InventoryReservationRecord = {
  id: number;
  orderItemId: number;
  orderId: string;
  productId: number;
  variantId: number | null;
  quantity: number;
  status: string;
  reservedAt: Date;
  evidenceDeadlineAt: Date | null;
};

/**
 * Atomically reserves inventory for an array of order items inside a transaction.
 *
 * For non-variant items:
 *   - Updates Product where stock >= qty (decrement qty).
 *   - If count === 0 => throws InventoryConflictError.
 *
 * For variant items:
 *   - Updates ProductVariant where id = variantId AND productId = parentId AND stock >= qty (decrement qty).
 *   - If count === 0 => throws InventoryConflictError.
 *   - Updates parent Product aggregate mirror where id = parentId AND stock >= qty (decrement qty).
 *   - If count === 0 => throws InventoryIntegrityError.
 *
 * Creates an InventoryReservation row for each OrderItem with status "RESERVED".
 */
export async function reserveOrderInventory(
  tx: DbClient,
  items: ReserveItemInput[],
  options?: ReserveOptions
): Promise<InventoryReservationRecord[]> {
  const reservationTimestamp = options?.reservationTimestamp ?? new Date();
  const evidenceDeadlineAt = options?.evidenceDeadlineAt ?? null;
  const createdReservations: InventoryReservationRecord[] = [];

  for (const item of items) {
    const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));

    if (item.variantId) {
      // 1. Guarded variant stock decrement
      const variantResult = await tx.productVariant.updateMany({
        where: {
          id: item.variantId,
          productId: item.productId,
          stock: { gte: qty },
        },
        data: {
          stock: { decrement: qty },
        },
      });

      if (variantResult.count === 0) {
        throw new InventoryConflictError(
          item.productId,
          item.variantId,
          `Insufficient stock for variant ID ${item.variantId}`
        );
      }

      // 2. Guarded product aggregate mirror decrement
      const productResult = await tx.product.updateMany({
        where: {
          id: item.productId,
          stock: { gte: qty },
        },
        data: {
          stock: { decrement: qty },
        },
      });

      if (productResult.count === 0) {
        throw new InventoryIntegrityError(
          `Parent product ${item.productId} stock aggregate out of sync with variant stock`
        );
      }
    } else {
      // Guarded non-variant product stock decrement
      const productResult = await tx.product.updateMany({
        where: {
          id: item.productId,
          stock: { gte: qty },
        },
        data: {
          stock: { decrement: qty },
        },
      });

      if (productResult.count === 0) {
        throw new InventoryConflictError(
          item.productId,
          null,
          `Insufficient stock for product ID ${item.productId}`
        );
      }
    }

    // 3. Create InventoryReservation record for this OrderItem
    const reservation = await tx.inventoryReservation.create({
      data: {
        orderItemId: item.id,
        orderId: item.orderId,
        productId: item.productId,
        variantId: item.variantId ?? null,
        quantity: qty,
        status: "RESERVED",
        reservedAt: reservationTimestamp,
        evidenceDeadlineAt,
      },
    });

    createdReservations.push(reservation);
  }

  return createdReservations;
}
