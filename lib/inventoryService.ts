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

export type ReleaseReservationOptions = {
  releaseReason?: string;
  releasedAt?: Date;
};

export type ReleaseReservationResult = {
  releasedCount: number;
};

/**
 * Exactly-once cancellation release and variant stock restoration.
 * Only the caller that atomically transitions a reservation from RESERVED -> RELEASED (count === 1)
 * owns the stock restoration entitlement.
 */
export async function releaseOrderReservation(
  tx: DbClient,
  orderId: string,
  options?: ReleaseReservationOptions
): Promise<ReleaseReservationResult> {
  const now = options?.releasedAt ?? new Date();
  const reason = options?.releaseReason ?? "ORDER_CANCELLED";

  // Query all reservations for this order (both RESERVED and non-RESERVED)
  const allReservations = await tx.inventoryReservation.findMany({
    where: {
      orderId,
    },
  });

  let releasedCount = 0;

  if (allReservations.length > 0) {
    // Modern Order: only active RESERVED reservations are eligible for release
    const reserved = allReservations.filter((r) => r.status === "RESERVED");

    for (const res of reserved) {
      // Exactly-once DB entitlement claim: only count === 1 owns the restoration!
      const updateResult = await tx.inventoryReservation.updateMany({
        where: {
          id: res.id,
          status: "RESERVED",
        },
        data: {
          status: "RELEASED",
          releasedAt: now,
          releaseReason: reason,
        },
      });

      if (updateResult.count === 1) {
        releasedCount++;

        if (res.variantId) {
          // Exact variant restoration
          const variant = await tx.productVariant.findUnique({
            where: { id: res.variantId },
          });

          if (!variant || variant.productId !== res.productId) {
            throw new InventoryIntegrityError(
              `Cannot restore stock for variant ID ${res.variantId}: exact variant no longer exists in catalog`
            );
          }

          await tx.productVariant.update({
            where: { id: res.variantId },
            data: { stock: { increment: res.quantity } },
          });

          await tx.product.update({
            where: { id: res.productId },
            data: { stock: { increment: res.quantity } },
          });
        } else {
          // Non-variant restoration
          await tx.product.update({
            where: { id: res.productId },
            data: { stock: { increment: res.quantity } },
          });
        }
      }
    }
  } else {
    // Legacy order compatibility: only if order has ZERO modern InventoryReservation rows at all
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });


    if (order && order.items && order.items.length > 0) {
      for (const item of order.items) {
        if (!item.productId) continue;

        if (item.variantId) {
          const variant = await tx.productVariant.findUnique({
            where: { id: item.variantId },
          });

          if (!variant || variant.productId !== item.productId) {
            throw new InventoryIntegrityError(
              `Cannot restore legacy stock for variant ID ${item.variantId}: exact variant no longer exists in catalog`
            );
          }

          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });

          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        } else {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }
    }
  }

  return { releasedCount };
}

export type FulfillReservationOptions = {
  fulfilledAt?: Date;
};

export type FulfillReservationResult = {
  fulfilledCount: number;
};

/**
 * Fulfills inventory reservations upon courier handoff (SHIPPED).
 * Moves status from RESERVED -> FULFILLED without changing sellable stock.
 */
export async function fulfillOrderReservation(
  tx: DbClient,
  orderId: string,
  options?: FulfillReservationOptions
): Promise<FulfillReservationResult> {
  const now = options?.fulfilledAt ?? new Date();

  const updateResult = await tx.inventoryReservation.updateMany({
    where: {
      orderId,
      status: "RESERVED",
    },
    data: {
      status: "FULFILLED",
      fulfilledAt: now,
    },
  });

  return { fulfilledCount: updateResult.count };
}

export type RestockReturnItemOptions = {
  restockedAt?: Date;
  adminNote?: string;
};

export type RestockReturnItemResult = {
  success: boolean;
  restockedCount: number;
  idempotent?: boolean;
  message?: string;
};

/**
 * Exactly-once stock restoration for an inspected, RESTOCKABLE ReturnItem.
 *
 * Requirements:
 *   - ReturnItem.physicalReturnAt must not be null (physically received).
 *   - ReturnItem.disposition must be "RESTOCKABLE".
 *   - ReturnItem.restockedAt must be null before this call.
 *
 * Uses guarded updateMany:
 *   WHERE id = returnItemId AND physicalReturnAt IS NOT NULL AND disposition = 'RESTOCKABLE' AND restockedAt IS NULL
 *
 * Only count === 1 owns the stock increment entitlement.
 * Repeated calls on an already-restocked item return idempotent success without double incrementing stock.
 */
export async function restockReturnItem(
  tx: DbClient,
  returnItemId: number,
  options?: RestockReturnItemOptions
): Promise<RestockReturnItemResult> {
  const now = options?.restockedAt ?? new Date();

  const returnItem = await tx.returnItem.findUnique({
    where: { id: returnItemId },
  });

  if (!returnItem) {
    return { success: false, restockedCount: 0, message: "Return item not found" };
  }

  if (!returnItem.physicalReturnAt) {
    return {
      success: false,
      restockedCount: 0,
      message: "Cannot restock item that has not been physically received (physicalReturnAt is null)",
    };
  }

  if (returnItem.disposition !== "RESTOCKABLE") {
    return {
      success: false,
      restockedCount: 0,
      message: `Cannot restock item with disposition '${returnItem.disposition}'. Must be 'RESTOCKABLE'`,
    };
  }

  // Idempotent check: if already restocked
  if (returnItem.restockedAt !== null) {
    return {
      success: true,
      restockedCount: 0,
      idempotent: true,
      message: "Return item was already restocked",
    };
  }

  // Atomic conditional claim: exactly one winner claims restockedAt
  const claim = await tx.returnItem.updateMany({
    where: {
      id: returnItemId,
      physicalReturnAt: { not: null },
      disposition: "RESTOCKABLE",
      restockedAt: null,
    },
    data: {
      restockedAt: now,
      ...(options?.adminNote ? { adminNote: options.adminNote } : {}),
    },
  });

  if (claim.count !== 1) {
    // Another concurrent process claimed the restock
    return {
      success: true,
      restockedCount: 0,
      idempotent: true,
      message: "Return item was already restocked concurrently",
    };
  }

  // Exactly-once stock increment
  const qty = returnItem.quantity;

  if (returnItem.variantId) {
    if (!returnItem.productId) {
      throw new InventoryIntegrityError(
        `Cannot restock return item ${returnItemId}: missing productId for variant ${returnItem.variantId}`
      );
    }

    const variant = await tx.productVariant.findUnique({
      where: { id: returnItem.variantId },
    });

    if (!variant || variant.productId !== returnItem.productId) {
      throw new InventoryIntegrityError(
        `Cannot restock variant ID ${returnItem.variantId}: exact variant no longer exists in catalog`
      );
    }

    await tx.productVariant.update({
      where: { id: returnItem.variantId },
      data: { stock: { increment: qty } },
    });

    await tx.product.update({
      where: { id: returnItem.productId },
      data: { stock: { increment: qty } },
    });
  } else if (returnItem.productId) {
    await tx.product.update({
      where: { id: returnItem.productId },
      data: { stock: { increment: qty } },
    });
  } else {
    throw new InventoryIntegrityError(
      `Cannot restock return item ${returnItemId}: neither productId nor variantId is present`
    );
  }

  return { success: true, restockedCount: 1 };
}
