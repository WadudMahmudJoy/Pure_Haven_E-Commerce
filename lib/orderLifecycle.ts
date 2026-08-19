/**
 * Pure Server-Authoritative Fulfillment State Machine & Validation
 *
 * Implements the lifecycle graph, reason codes, normalization, and transition checks
 * for orders. Contains no external dependencies on frameworks, databases, or UI.
 */

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "delivery_failed",
  "return_in_transit",
  "return_received",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const CANCELLATION_REASONS = [
  "customer_requested",
  "customer_unreachable",
  "invalid_contact",
  "suspected_fake_order",
  "merchant_stockout",
  "merchant_error",
  "system_timeout",
  "other",
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const DELIVERY_FAILURE_REASONS = [
  "customer_unreachable",
  "customer_refused",
  "invalid_address",
  "courier_failure",
  "courier_damage",
  "other",
] as const;

export type DeliveryFailureReason = (typeof DELIVERY_FAILURE_REASONS)[number];

const TRANSITION_GRAPH: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["out_for_delivery"],
  out_for_delivery: ["delivered", "delivery_failed"],
  delivery_failed: ["return_in_transit"],
  return_in_transit: ["return_received"],
  delivered: [],
  cancelled: [],
  return_received: [],
};

export function normalizeOrderStatus(value: unknown): OrderStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (ORDER_STATUSES as readonly string[]).includes(normalized)
    ? (normalized as OrderStatus)
    : null;
}

export function normalizeCancellationReason(value: unknown): CancellationReason | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (CANCELLATION_REASONS as readonly string[]).includes(normalized)
    ? (normalized as CancellationReason)
    : null;
}

export function normalizeDeliveryFailureReason(value: unknown): DeliveryFailureReason | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (DELIVERY_FAILURE_REASONS as readonly string[]).includes(normalized)
    ? (normalized as DeliveryFailureReason)
    : null;
}

export function getAllowedNextStatuses(current: OrderStatus): readonly OrderStatus[] {
  return TRANSITION_GRAPH[current] ?? [];
}

export function canCancelOrder(current: OrderStatus): boolean {
  return TRANSITION_GRAPH[current]?.includes("cancelled") ?? false;
}

export function validateOrderTransition(
  current: OrderStatus,
  next: OrderStatus
):
  | { allowed: true; noop: boolean }
  | {
      allowed: false;
      reason: "forbidden_transition";
      message: string;
    } {
  if (current === next) {
    return { allowed: true, noop: true };
  }

  const allowedNext = TRANSITION_GRAPH[current];
  if (!allowedNext || !allowedNext.includes(next)) {
    return {
      allowed: false,
      reason: "forbidden_transition",
      message: `Cannot transition order status from '${current}' to '${next}'. Allowed next statuses: [${(allowedNext || []).join(", ")}].`,
    };
  }

  return { allowed: true, noop: false };
}
