/**
 * Unit test — Rate Limiting Policy and Client Identity Validation
 *
 * Verifies that getRateLimitClientKey():
 *   - Correctly extracts valid IPv4 and IPv6 addresses from proxy headers
 *   - Rejects non-IP / malformed strings (e.g. "banana", "attacker-controlled-key")
 *   - Advances to fallback headers (x-real-ip, cf-connecting-ip) when a preceding header is malformed
 *   - Returns "unknown-client" when no valid IP candidate exists
 *
 * Run with:
 *   npx tsx --test tests/rate-limit-policy.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { getRateLimitClientKey } from "../lib/rateLimitPolicy";

function createMockRequest(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/test", {
    headers: new Headers(headers),
  });
}

test("CASE 1 — A valid IPv4 first candidate in x-forwarded-for is returned", () => {
  const req = createMockRequest({
    "x-forwarded-for": "198.51.100.10, 10.0.0.1",
  });
  const key = getRateLimitClientKey(req);
  assert.strictEqual(key, "198.51.100.10");
});

test("CASE 2 — A valid IPv6 client candidate is accepted", () => {
  const req = createMockRequest({
    "x-forwarded-for": "2001:db8::1, 10.0.0.1",
  });
  const key = getRateLimitClientKey(req);
  assert.strictEqual(key, "2001:db8::1");
});

test("CASE 3 — Malformed x-forwarded-for is rejected and falls back to valid alternative header", () => {
  const req = createMockRequest({
    "x-forwarded-for": "attacker-controlled-key",
    "x-real-ip": "203.0.113.20",
  });
  const key = getRateLimitClientKey(req);
  assert.strictEqual(
    key,
    "203.0.113.20",
    `Vulnerability confirmed: malformed x-forwarded-for was accepted as client identity (got "${key}" instead of falling back to x-real-ip "203.0.113.20")`
  );
});

test("CASE 4 — Malformed or oversized candidates across available headers fall back to unknown-client", () => {
  const bananaReq = createMockRequest({
    "x-forwarded-for": "banana",
  });
  assert.strictEqual(getRateLimitClientKey(bananaReq), "unknown-client");

  const whitespaceReq = createMockRequest({
    "x-forwarded-for": "    ",
    "x-real-ip": "   ",
  });
  assert.strictEqual(getRateLimitClientKey(whitespaceReq), "unknown-client");

  const oversizedReq = createMockRequest({
    "x-forwarded-for": "198.51.100.1".repeat(20),
  });
  assert.strictEqual(getRateLimitClientKey(oversizedReq), "unknown-client");
});

test("CASE 5 — No usable identity headers fall back to unknown-client", () => {
  const emptyReq = createMockRequest({});
  assert.strictEqual(getRateLimitClientKey(emptyReq), "unknown-client");
});
