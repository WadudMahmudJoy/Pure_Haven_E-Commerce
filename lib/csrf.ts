/**
 * Server-Side Same-Origin CSRF Guard (Phase 3 Wave B)
 *
 * Authoritative implementation compliant with:
 * docs/superpowers/specs/2026-08-26-phase3-customer-authentication-design.md
 * docs/superpowers/plans/2026-08-26-phase3-customer-authentication-implementation-plan.md
 */

export interface CsrfValidationResult {
  valid: boolean;
  reason?: string;
}

const DEFAULT_DEV_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3005",
  "http://127.0.0.1:3005",
];

function normalizeOrigin(urlOrOrigin: string): string | null {
  try {
    const parsed = new URL(urlOrOrigin);
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Validates that an incoming state-changing HTTP request originates from a trusted same-origin source.
 * Authority: process.env.APP_ORIGIN.
 * In production: fails closed if APP_ORIGIN is missing or invalid.
 */
export function validateSameOrigin(request: Request): CsrfValidationResult {
  const method = request.method.toUpperCase();

  // Safe idempotent methods do not require origin validation
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return { valid: true };
  }

  const isProduction = process.env.NODE_ENV === "production";
  const configuredAppOrigin = process.env.APP_ORIGIN ? normalizeOrigin(process.env.APP_ORIGIN) : null;

  if (isProduction && !configuredAppOrigin) {
    return {
      valid: false,
      reason: "APP_ORIGIN is not configured in production. Request blocked for security.",
    };
  }

  const allowedOrigins = new Set<string>();
  if (configuredAppOrigin) {
    allowedOrigins.add(configuredAppOrigin);
  }

  // In non-production, include explicit local development allowlist
  if (!isProduction) {
    for (const devOrigin of DEFAULT_DEV_ALLOWED_ORIGINS) {
      allowedOrigins.add(devOrigin);
    }
  }

  // 1. Inspect Origin header
  const originHeader = request.headers.get("origin");
  if (originHeader) {
    const candidateOrigin = normalizeOrigin(originHeader);
    if (candidateOrigin && allowedOrigins.has(candidateOrigin)) {
      return { valid: true };
    }
    return {
      valid: false,
      reason: `Origin mismatch: ${originHeader} is not in allowed origins.`,
    };
  }

  // 2. Fallback to Referer header if Origin is absent
  const refererHeader = request.headers.get("referer");
  if (refererHeader) {
    const candidateOrigin = normalizeOrigin(refererHeader);
    if (candidateOrigin && allowedOrigins.has(candidateOrigin)) {
      return { valid: true };
    }
    return {
      valid: false,
      reason: `Referer origin mismatch: ${refererHeader} is not in allowed origins.`,
    };
  }

  // 3. Reject if both Origin and Referer are missing on unsafe mutation
  return {
    valid: false,
    reason: "Missing Origin and Referer headers on state-changing request.",
  };
}
