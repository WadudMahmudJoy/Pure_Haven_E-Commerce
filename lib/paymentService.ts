/**
 * Payment Service — Server-Authoritative Payment Lifecycle
 *
 * Implements:
 *   - Canonical PaymentRecord states & transitions
 *   - COD settlement states & transitions
 *   - Legacy payment vocabulary mapping
 *   - Evidence attempt normalization & validation helpers
 */

export const PAYMENT_STATES = [
  "AWAITING_PAYMENT",
  "VERIFICATION_PENDING",
  "PAID",
  "REJECTED",
  "FAILED",
  "REFUND_REQUIRED",
  "REFUND_PROCESSING",
  "REFUNDED",
] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];

export const COD_SETTLEMENT_STATES = [
  "NOT_APPLICABLE",
  "PENDING",
  "SETTLED",
  "DISPUTED",
] as const;

export type CodSettlementState = (typeof COD_SETTLEMENT_STATES)[number];

export const EVIDENCE_ATTEMPT_STATES = [
  "PENDING_REVIEW",
  "ACCEPTED",
  "REJECTED",
  "FAILED",
] as const;

export type EvidenceAttemptState = (typeof EVIDENCE_ATTEMPT_STATES)[number];

export function normalizePaymentState(value: unknown): PaymentState | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return (PAYMENT_STATES as readonly string[]).includes(upper) ? (upper as PaymentState) : null;
}

export function normalizeCodSettlementState(value: unknown): CodSettlementState | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return (COD_SETTLEMENT_STATES as readonly string[]).includes(upper) ? (upper as CodSettlementState) : null;
}

export function normalizeEvidenceAttemptState(value: unknown): EvidenceAttemptState | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return (EVIDENCE_ATTEMPT_STATES as readonly string[]).includes(upper) ? (upper as EvidenceAttemptState) : null;
}

export function normalizeProvider(provider: unknown): string | null {
  if (typeof provider !== "string") return null;
  const clean = provider.trim().toUpperCase();
  if (clean === "BKASH" || clean === "NAGAD") {
    return clean;
  }
  return clean ? clean : null;
}

export function normalizeTrxId(trxId: unknown): string | null {
  if (typeof trxId !== "string") return null;
  const clean = trxId.trim().toUpperCase();
  return clean.length > 0 ? clean : null;
}

export function sanitizePhone(value: unknown): string {
  if (typeof value !== "string") return "";
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("880") && digits.length === 13) {
    return `0${digits.slice(3)}`;
  }
  if (digits.length === 11 && digits.startsWith("01")) {
    return digits;
  }
  return digits;
}

export function mapLegacyPaymentStatus(status: string | null | undefined): PaymentState {
  if (!status) return "AWAITING_PAYMENT";
  const clean = status.trim().toLowerCase();

  switch (clean) {
    case "pending":
    case "unpaid":
    case "awaiting_payment":
      return "AWAITING_PAYMENT";
    case "verification_pending":
      return "VERIFICATION_PENDING";
    case "verified":
    case "paid":
      return "PAID";
    case "rejected":
      return "REJECTED";
    case "failed":
      return "FAILED";
    case "refund_required":
      return "REFUND_REQUIRED";
    case "refund_processing":
      return "REFUND_PROCESSING";
    case "refunded":
      return "REFUNDED";
    default:
      return "AWAITING_PAYMENT";
  }
}

export function mapCanonicalToLegacyStatus(state: PaymentState): string {
  switch (state) {
    case "AWAITING_PAYMENT":
      return "unpaid";
    case "VERIFICATION_PENDING":
      return "verification_pending";
    case "PAID":
      return "verified";
    case "REJECTED":
      return "rejected";
    case "FAILED":
      return "rejected";
    case "REFUND_REQUIRED":
    case "REFUND_PROCESSING":
    case "REFUNDED":
      return "refunded";
    default:
      return "unpaid";
  }
}

const ALLOWED_PAYMENT_TRANSITIONS: Record<PaymentState, readonly PaymentState[]> = {
  AWAITING_PAYMENT: ["VERIFICATION_PENDING", "PAID", "FAILED"],
  VERIFICATION_PENDING: ["PAID", "REJECTED", "REFUND_REQUIRED", "FAILED"],
  PAID: ["REFUND_REQUIRED"],
  REJECTED: ["VERIFICATION_PENDING", "REFUND_REQUIRED", "FAILED"],
  FAILED: ["REFUND_REQUIRED"],
  REFUND_REQUIRED: ["REFUND_PROCESSING"],
  REFUND_PROCESSING: ["REFUNDED"],
  REFUNDED: [],
};

export function validatePaymentTransition(
  currentStateRaw: unknown,
  targetStateRaw: unknown
): { allowed: boolean; reason?: string } {
  const current = normalizePaymentState(currentStateRaw);
  const target = normalizePaymentState(targetStateRaw);

  if (!current) {
    return { allowed: false, reason: `Unknown current payment state: ${String(currentStateRaw)}` };
  }
  if (!target) {
    return { allowed: false, reason: `Unknown target payment state: ${String(targetStateRaw)}` };
  }

  // Idempotent same-state transition
  if (current === target) {
    return { allowed: true };
  }

  const allowedNext = ALLOWED_PAYMENT_TRANSITIONS[current] ?? [];
  if (allowedNext.includes(target)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Payment transition from '${current}' to '${target}' is forbidden.`,
  };
}

const ALLOWED_COD_SETTLEMENT_TRANSITIONS: Record<CodSettlementState, readonly CodSettlementState[]> = {
  NOT_APPLICABLE: [],
  PENDING: ["SETTLED", "DISPUTED"],
  DISPUTED: ["SETTLED"],
  SETTLED: [],
};

export function validateCodSettlementTransition(
  currentStateRaw: unknown,
  targetStateRaw: unknown
): { allowed: boolean; reason?: string } {
  const current = normalizeCodSettlementState(currentStateRaw);
  const target = normalizeCodSettlementState(targetStateRaw);

  if (!current) {
    return { allowed: false, reason: `Unknown current COD settlement state: ${String(currentStateRaw)}` };
  }
  if (!target) {
    return { allowed: false, reason: `Unknown target COD settlement state: ${String(targetStateRaw)}` };
  }

  if (current === target) {
    return { allowed: true };
  }

  const allowedNext = ALLOWED_COD_SETTLEMENT_TRANSITIONS[current] ?? [];
  if (allowedNext.includes(target)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `COD settlement transition from '${current}' to '${target}' is forbidden.`,
  };
}
