/**
 * Return-To Safe URL Sanitizer
 *
 * Ensures returnTo redirect destinations are strictly local/relative paths
 * preventing Open Redirect vulnerabilities (CWE-601).
 */

export function sanitizeReturnTo(
  returnTo: string | null | undefined,
  fallback = "/customer/dashboard"
): string {
  if (!returnTo || typeof returnTo !== "string") {
    return fallback;
  }

  const trimmed = returnTo.trim();

  // Reject empty, non-root-relative, protocol-relative (//), backslash (/\), or absolute (://) URLs
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\") ||
    trimmed.startsWith("/\\\\") ||
    trimmed.includes("://")
  ) {
    return fallback;
  }

  // Reject javascript:, data:, vbscript: schemes embedded in path
  const lower = trimmed.toLowerCase();
  if (
    lower.includes("javascript:") ||
    lower.includes("data:") ||
    lower.includes("vbscript:")
  ) {
    return fallback;
  }

  // Reject control characters or newlines
  if (/[\r\n\t\0]/.test(trimmed)) {
    return fallback;
  }

  return trimmed;
}
