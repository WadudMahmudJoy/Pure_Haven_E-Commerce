/**
 * Rate Limiting Policy and Configuration Constants (Phase 1)
 *
 * Security policies for admin authentication and order creation abuse mitigation.
 */

import { isIP } from "node:net";

// Per-Client Admin Login
export const ADMIN_LOGIN_MAX_ATTEMPTS_PER_CLIENT = 5;
export const ADMIN_LOGIN_WINDOW_SECONDS = 900; // 15 minutes

// Per-Client Admin Recovery
export const ADMIN_RECOVERY_MAX_ATTEMPTS_PER_CLIENT = 3;
export const ADMIN_RECOVERY_WINDOW_SECONDS = 900; // 15 minutes

// Process-Global Login CPU Safety Valve
export const ADMIN_LOGIN_GLOBAL_MAX_ATTEMPTS = 60;
export const ADMIN_LOGIN_GLOBAL_WINDOW_SECONDS = 60; // 60 seconds

// Process-Global Recovery CPU Safety Valve
export const ADMIN_RECOVERY_GLOBAL_MAX_ATTEMPTS = 30;
export const ADMIN_RECOVERY_GLOBAL_WINDOW_SECONDS = 60; // 60 seconds

// Order Creation Throttling
export const ORDER_CREATION_MAX_REQUESTS_PER_CLIENT = 10;
export const ORDER_CREATION_WINDOW_SECONDS = 60; // 60 seconds

/**
 * Validates and normalizes an IP candidate string using standard Node.js IP parsing.
 */
function normalizeIpCandidate(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) {
    return null;
  }
  return isIP(trimmed) !== 0 ? trimmed : null;
}

/**
 * Best-effort extraction of client identifier for application-layer rate limiting.
 *
 * NOTE: The reliability of proxy-derived client identity depends on deployment
 * topology / trusted reverse proxy configuration. This is a Phase-1 application
 * control and does not replace network-level perimeter protection.
 */
export function getRateLimitClientKey(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor && typeof forwardedFor === "string") {
    // Extract and validate first client candidate from comma-separated proxy chain
    const firstCandidate = forwardedFor.split(",")[0];
    const normalized = normalizeIpCandidate(firstCandidate);
    if (normalized) {
      return normalized;
    }
  }

  const realIp = normalizeIpCandidate(req.headers.get("x-real-ip"));
  if (realIp) {
    return realIp;
  }

  const cfIp = normalizeIpCandidate(req.headers.get("cf-connecting-ip"));
  if (cfIp) {
    return cfIp;
  }

  return "unknown-client";
}
