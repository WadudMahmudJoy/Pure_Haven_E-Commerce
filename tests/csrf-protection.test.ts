/**
 * CSRF / Same-Origin Foundation Tests (Phase 3 Wave B)
 *
 * Verifies locked CSRF invariants:
 *   1. Authority is process.env.APP_ORIGIN
 *   2. Unsafe methods (POST, PUT, PATCH, DELETE) require exact Origin/Referer match
 *   3. Safe methods (GET, HEAD, OPTIONS) pass through
 *   4. Missing Origin/Referer on unsafe requests is rejected
 *   5. Production without APP_ORIGIN fails closed
 *   6. Host, X-Forwarded-Host, and NEXT_PUBLIC_* cannot establish trust
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { validateSameOrigin } from "../lib/csrf.js";

describe("Wave B — CSRF Same-Origin Foundation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.APP_ORIGIN = "https://purehavenbd.com";
    delete (process.env as any).NODE_ENV;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("permits safe HTTP methods (GET, HEAD, OPTIONS) without origin headers", () => {
    const getReq = new Request("https://purehavenbd.com/api/test", { method: "GET" });
    assert.strictEqual(validateSameOrigin(getReq).valid, true);

    const headReq = new Request("https://purehavenbd.com/api/test", { method: "HEAD" });
    assert.strictEqual(validateSameOrigin(headReq).valid, true);

    const optionsReq = new Request("https://purehavenbd.com/api/test", { method: "OPTIONS" });
    assert.strictEqual(validateSameOrigin(optionsReq).valid, true);
  });

  it("accepts unsafe requests (POST, PUT, PATCH, DELETE) with exact Origin matching APP_ORIGIN", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const req = new Request("https://purehavenbd.com/api/test", {
        method,
        headers: { origin: "https://purehavenbd.com" },
      });
      const res = validateSameOrigin(req);
      assert.strictEqual(res.valid, true, `Method ${method} with matching Origin must be valid`);
    }
  });

  it("rejects unsafe requests with mismatched Origin header (403)", () => {
    const req = new Request("https://purehavenbd.com/api/test", {
      method: "POST",
      headers: { origin: "https://evil-attacker.com" },
    });
    const res = validateSameOrigin(req);
    assert.strictEqual(res.valid, false);
    assert.match(res.reason || "", /Origin mismatch/i);
  });

  it("falls back to Referer when Origin is absent and matches trusted origin", () => {
    const req = new Request("https://purehavenbd.com/api/test", {
      method: "POST",
      headers: { referer: "https://purehavenbd.com/checkout" },
    });
    const res = validateSameOrigin(req);
    assert.strictEqual(res.valid, true);
  });

  it("rejects unsafe requests when Referer origin is mismatched", () => {
    const req = new Request("https://purehavenbd.com/api/test", {
      method: "POST",
      headers: { referer: "https://attacker.com/some/path" },
    });
    const res = validateSameOrigin(req);
    assert.strictEqual(res.valid, false);
  });

  it("rejects unsafe requests when both Origin and Referer are missing", () => {
    const req = new Request("https://purehavenbd.com/api/test", {
      method: "POST",
    });
    const res = validateSameOrigin(req);
    assert.strictEqual(res.valid, false);
    assert.match(res.reason || "", /Missing Origin and Referer/i);
  });

  it("fails closed in production when APP_ORIGIN is missing or invalid", () => {
    (process.env as any).NODE_ENV = "production";
    delete process.env.APP_ORIGIN;

    const req = new Request("https://purehavenbd.com/api/test", {
      method: "POST",
      headers: { origin: "https://purehavenbd.com" },
    });
    const res = validateSameOrigin(req);
    assert.strictEqual(res.valid, false);
    assert.match(res.reason || "", /APP_ORIGIN is not configured/i);
  });

  it("does NOT derive trust from Host, X-Forwarded-Host, or NEXT_PUBLIC_* variables", () => {
    process.env.APP_ORIGIN = "https://purehavenbd.com";
    process.env.NEXT_PUBLIC_APP_URL = "https://forged-public-url.com";

    const req = new Request("https://purehavenbd.com/api/test", {
      method: "POST",
      headers: {
        host: "forged-host.com",
        "x-forwarded-host": "forged-forwarded.com",
        origin: "https://forged-host.com",
      },
    });

    const res = validateSameOrigin(req);
    assert.strictEqual(res.valid, false, "Must not trust Host or X-Forwarded-Host over APP_ORIGIN");
  });
});
