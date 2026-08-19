/**
 * Order UI Presentation & Decision Helpers
 *
 * Provides pure, reusable helpers for client & admin UI:
 *   - Status labels and badge class mappings
 *   - Cancellation & delivery-failure reason labels and client validation
 *   - Customer active-order semantics
 *   - Admin next-status derivation from server lifecycle rules
 */

import {
  normalizeOrderStatus,
  normalizeCancellationReason,
  normalizeDeliveryFailureReason,
  getAllowedNextStatuses,
  type OrderStatus,
  type CancellationReason,
  type DeliveryFailureReason,
} from "./orderLifecycle";

export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  "pending",
  "confirmed",
  "processing",
  "shipped",
  "out_for_delivery",
  "delivery_failed",
  "return_in_transit",
] as const;

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  "delivered",
  "cancelled",
  "return_received",
] as const;

export function isOrderActive(status: unknown): boolean {
  const normalized = normalizeOrderStatus(status);
  if (!normalized) return false;
  return (ACTIVE_ORDER_STATUSES as readonly string[]).includes(normalized);
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  delivery_failed: "Delivery Failed",
  return_in_transit: "Return in Transit",
  return_received: "Return Received",
};

export function getOrderStatusLabel(status: unknown): string {
  const normalized = normalizeOrderStatus(status);
  if (normalized) {
    return ORDER_STATUS_LABELS[normalized];
  }
  if (typeof status === "string" && status.trim().length > 0) {
    const raw = status.trim();
    return raw
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return "Unknown";
}

export const CANCELLATION_REASON_LABELS: Record<CancellationReason, string> = {
  customer_requested: "Customer Requested",
  customer_unreachable: "Customer Unreachable",
  invalid_contact: "Invalid Contact Details",
  suspected_fake_order: "Suspected Fake Order",
  merchant_stockout: "Merchant Out of Stock",
  merchant_error: "Merchant Error",
  system_timeout: "Payment / Verification Timeout",
  other: "Other (Specify Reason)",
};

export function getCancellationReasonLabel(reason: unknown): string {
  const normalized = normalizeCancellationReason(reason);
  if (normalized) {
    return CANCELLATION_REASON_LABELS[normalized];
  }
  if (typeof reason === "string" && reason.trim().length > 0) {
    return reason.trim();
  }
  return "Unknown Reason";
}

export const DELIVERY_FAILURE_REASON_LABELS: Record<DeliveryFailureReason, string> = {
  customer_unreachable: "Customer Unreachable",
  customer_refused: "Customer Refused Delivery",
  invalid_address: "Invalid Delivery Address",
  courier_failure: "Courier Delivery Failure",
  courier_damage: "Parcel Damaged in Transit",
  other: "Other (Specify Reason)",
};

export function getDeliveryFailureReasonLabel(reason: unknown): string {
  const normalized = normalizeDeliveryFailureReason(reason);
  if (normalized) {
    return DELIVERY_FAILURE_REASON_LABELS[normalized];
  }
  if (typeof reason === "string" && reason.trim().length > 0) {
    return reason.trim();
  }
  return "Unknown Reason";
}

export function getAdminNextStatusOptions(currentStatus: unknown): OrderStatus[] {
  const normalized = normalizeOrderStatus(currentStatus);
  if (!normalized) return [];
  return [...getAllowedNextStatuses(normalized)];
}

export function validateCancellationInput(
  reason: unknown,
  note: unknown
):
  | { valid: true; reason: CancellationReason; note: string | null }
  | { valid: false; error: string } {
  const normalizedReason = normalizeCancellationReason(reason);
  if (!normalizedReason) {
    return {
      valid: false,
      error: "A valid cancellation reason must be selected.",
    };
  }

  const normalizedNote = typeof note === "string" ? note.trim() : "";
  if (normalizedReason === "other" && normalizedNote.length === 0) {
    return {
      valid: false,
      error: "A non-empty note is required when cancellation reason is 'other'.",
    };
  }

  return {
    valid: true,
    reason: normalizedReason,
    note: normalizedNote.length > 0 ? normalizedNote : null,
  };
}

export function validateDeliveryFailureInput(
  reason: unknown,
  note: unknown
):
  | { valid: true; reason: DeliveryFailureReason; note: string | null }
  | { valid: false; error: string } {
  const normalizedReason = normalizeDeliveryFailureReason(reason);
  if (!normalizedReason) {
    return {
      valid: false,
      error: "A valid delivery failure reason must be selected.",
    };
  }

  const normalizedNote = typeof note === "string" ? note.trim() : "";
  if (normalizedReason === "other" && normalizedNote.length === 0) {
    return {
      valid: false,
      error: "A non-empty note is required when delivery failure reason is 'other'.",
    };
  }

  return {
    valid: true,
    reason: normalizedReason,
    note: normalizedNote.length > 0 ? normalizedNote : null,
  };
}

export function getOrderStatusBadgeClass(status: unknown): string {
  const normalized = normalizeOrderStatus(status);
  switch (normalized) {
    case "delivered":
    case "return_received":
      return "border-green-200 bg-green-50 text-green-700";
    case "cancelled":
    case "delivery_failed":
      return "border-red-200 bg-red-50 text-red-700";
    case "shipped":
    case "out_for_delivery":
      return "border-purple-200 bg-purple-50 text-purple-700";
    case "processing":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "confirmed":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "return_in_transit":
      return "border-orange-200 bg-orange-50 text-orange-700";
    case "pending":
    default:
      return "border-yellow-200 bg-yellow-50 text-yellow-700";
  }
}
