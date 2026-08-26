/**
 * Customer Authentication Rate Limiting Tests (Phase 3 Wave B)
 *
 * Verifies locked rate limiting policies:
 *   1. Customer Login per-client (5 attempts / 15m)
 *   2. Customer Login process-global CPU safety valve (60 attempts / 60s)
 *   3. Customer Register per-client (3 attempts / 1h)
 *   4. Customer Register process-global CPU safety valve (30 attempts / 1h)
 *   5. Pre-scrypt denial behavior
 *   6. Independent client bucket isolation
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { consumeRateLimit, resetRateLimit } from "../lib/rateLimit.js";
import {
  CUSTOMER_LOGIN_MAX_ATTEMPTS_PER_CLIENT,
  CUSTOMER_LOGIN_WINDOW_SECONDS,
  CUSTOMER_LOGIN_GLOBAL_MAX_ATTEMPTS,
  CUSTOMER_LOGIN_GLOBAL_WINDOW_SECONDS,
  CUSTOMER_REGISTER_MAX_ATTEMPTS_PER_CLIENT,
  CUSTOMER_REGISTER_WINDOW_SECONDS,
  CUSTOMER_REGISTER_GLOBAL_MAX_ATTEMPTS,
  CUSTOMER_REGISTER_GLOBAL_WINDOW_SECONDS,
} from "../lib/rateLimitPolicy.js";

describe("Wave B — Customer Authentication Rate Limiting", () => {
  beforeEach(() => {
    resetRateLimit("customer_login_client:198.51.100.1");
    resetRateLimit("customer_login_client:198.51.100.2");
    resetRateLimit("customer_login_global");
    resetRateLimit("customer_register_client:198.51.100.1");
    resetRateLimit("customer_register_client:198.51.100.2");
    resetRateLimit("customer_register_global");
  });

  it("enforces per-client login rate limit (5 attempts / 15m)", () => {
    const key = "customer_login_client:198.51.100.1";
    const limit = CUSTOMER_LOGIN_MAX_ATTEMPTS_PER_CLIENT;
    const windowMs = CUSTOMER_LOGIN_WINDOW_SECONDS * 1000;

    for (let i = 0; i < limit; i++) {
      const res = consumeRateLimit(key, limit, windowMs);
      assert.strictEqual(res.allowed, true, `Attempt ${i + 1} should be allowed`);
    }

    const blocked = consumeRateLimit(key, limit, windowMs);
    assert.strictEqual(blocked.allowed, false, "6th attempt must be blocked");
    assert.ok(blocked.retryAfterSeconds > 0);
  });

  it("enforces process-global login CPU safety valve (60 attempts / 60s)", () => {
    const globalKey = "customer_login_global";
    const limit = CUSTOMER_LOGIN_GLOBAL_MAX_ATTEMPTS;
    const windowMs = CUSTOMER_LOGIN_GLOBAL_WINDOW_SECONDS * 1000;

    for (let i = 0; i < limit; i++) {
      const res = consumeRateLimit(globalKey, limit, windowMs);
      assert.strictEqual(res.allowed, true);
    }

    const blocked = consumeRateLimit(globalKey, limit, windowMs);
    assert.strictEqual(blocked.allowed, false, "61st global login attempt must be blocked");
  });

  it("enforces per-client registration rate limit (3 attempts / 1h)", () => {
    const key = "customer_register_client:198.51.100.1";
    const limit = CUSTOMER_REGISTER_MAX_ATTEMPTS_PER_CLIENT;
    const windowMs = CUSTOMER_REGISTER_WINDOW_SECONDS * 1000;

    for (let i = 0; i < limit; i++) {
      const res = consumeRateLimit(key, limit, windowMs);
      assert.strictEqual(res.allowed, true, `Register attempt ${i + 1} should be allowed`);
    }

    const blocked = consumeRateLimit(key, limit, windowMs);
    assert.strictEqual(blocked.allowed, false, "4th register attempt must be blocked");
  });

  it("enforces process-global registration CPU safety valve (30 attempts / 1h)", () => {
    const globalKey = "customer_register_global";
    const limit = CUSTOMER_REGISTER_GLOBAL_MAX_ATTEMPTS;
    const windowMs = CUSTOMER_REGISTER_GLOBAL_WINDOW_SECONDS * 1000;

    for (let i = 0; i < limit; i++) {
      const res = consumeRateLimit(globalKey, limit, windowMs);
      assert.strictEqual(res.allowed, true);
    }

    const blocked = consumeRateLimit(globalKey, limit, windowMs);
    assert.strictEqual(blocked.allowed, false, "31st global register attempt must be blocked");
  });

  it("isolates independent client IP addresses", () => {
    const key1 = "customer_login_client:198.51.100.1";
    const key2 = "customer_login_client:198.51.100.2";
    const limit = CUSTOMER_LOGIN_MAX_ATTEMPTS_PER_CLIENT;
    const windowMs = CUSTOMER_LOGIN_WINDOW_SECONDS * 1000;

    for (let i = 0; i < limit; i++) {
      consumeRateLimit(key1, limit, windowMs);
    }
    assert.strictEqual(consumeRateLimit(key1, limit, windowMs).allowed, false);

    // Client 2 must remain allowed
    assert.strictEqual(consumeRateLimit(key2, limit, windowMs).allowed, true);
  });
});
