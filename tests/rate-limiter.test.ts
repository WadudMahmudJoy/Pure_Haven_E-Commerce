/**
 * RED test — In-memory rate limiter primitive
 *
 * Verifies the contract of the zero-dependency in-memory rate limiting engine:
 *   - Requests up to limit are allowed
 *   - Exceeding limit is denied with integer retryAfterSeconds > 0
 *   - Key and bucket prefix isolation
 *   - Deterministic window expiration (time injection, NO real sleeps)
 *   - Manual reset capability
 *   - Automatic lazy pruning of expired entries verified via getRateLimitStoreSize()
 *
 * Run with:
 *   npx tsx --test tests/rate-limiter.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetTimeMs: number;
};

type RateLimitModule = {
  consumeRateLimit: (
    key: string,
    limit: number,
    windowMs: number,
    nowMs?: number
  ) => RateLimitResult;
  resetRateLimit: (key: string) => void;
  getRateLimitStoreSize: () => number;
};

async function getRateLimiter(): Promise<RateLimitModule> {
  const modulePath = `../lib/${"rateLimit"}`;
  try {
    const mod = (await import(modulePath)) as Partial<RateLimitModule>;
    if (
      typeof mod.consumeRateLimit !== "function" ||
      typeof mod.resetRateLimit !== "function" ||
      typeof mod.getRateLimitStoreSize !== "function"
    ) {
      assert.fail(
        "lib/rateLimit.ts is missing required exports: consumeRateLimit, resetRateLimit, getRateLimitStoreSize."
      );
    }
    return mod as RateLimitModule;
  } catch (err: unknown) {
    const errorObj = err as { code?: string; message?: string } | null;
    const isRateLimitModuleNotFound =
      (errorObj?.code === "ERR_MODULE_NOT_FOUND" ||
        errorObj?.message?.includes("Cannot find module") ||
        errorObj?.message?.includes("Failed to load url")) &&
      (errorObj?.message?.includes("rateLimit") ?? false);

    if (isRateLimitModuleNotFound) {
      assert.fail(
        "RED assertion: lib/rateLimit.ts is not implemented yet. Expected in Task 4.2 GREEN."
      );
    }
    // Genuine runtime or transitive module error inside the implementation — propagate immediately!
    throw err;
  }
}

test("CASE 1 — Requests up to the configured limit are allowed", async () => {
  const limiter = await getRateLimiter();
  const key = "test:client-a";
  const limit = 3;
  const windowMs = 60_000;
  const baseTime = 1_000_000;

  const res1 = limiter.consumeRateLimit(key, limit, windowMs, baseTime);
  assert.strictEqual(res1.allowed, true, "First request must be allowed");
  assert.strictEqual(res1.remaining, 2, "Remaining attempts must be 2");

  const res2 = limiter.consumeRateLimit(key, limit, windowMs, baseTime + 100);
  assert.strictEqual(res2.allowed, true, "Second request must be allowed");
  assert.strictEqual(res2.remaining, 1, "Remaining attempts must be 1");

  const res3 = limiter.consumeRateLimit(key, limit, windowMs, baseTime + 200);
  assert.strictEqual(res3.allowed, true, "Third request (at limit) must be allowed");
  assert.strictEqual(res3.remaining, 0, "Remaining attempts must be 0");
});

test("CASE 2 — The first request beyond the limit is denied", async () => {
  const limiter = await getRateLimiter();
  const key = "test:client-b";
  const limit = 2;
  const windowMs = 60_000;
  const baseTime = 2_000_000;

  limiter.consumeRateLimit(key, limit, windowMs, baseTime);
  limiter.consumeRateLimit(key, limit, windowMs, baseTime + 100);

  // 3rd attempt on limit=2 must be rejected
  const res3 = limiter.consumeRateLimit(key, limit, windowMs, baseTime + 200);
  assert.strictEqual(res3.allowed, false, "Request beyond limit must be denied");
  assert.strictEqual(res3.remaining, 0, "Remaining attempts must stay 0");
});

test("CASE 3 — Denied result provides an integer retryAfterSeconds > 0", async () => {
  const limiter = await getRateLimiter();
  const key = "test:client-c";
  const limit = 1;
  const windowMs = 30_000; // 30 seconds
  const baseTime = 3_000_000;

  limiter.consumeRateLimit(key, limit, windowMs, baseTime);

  // Attempt 10 seconds into the window
  const deniedRes = limiter.consumeRateLimit(key, limit, windowMs, baseTime + 10_000);
  assert.strictEqual(deniedRes.allowed, false);
  assert.ok(
    Number.isInteger(deniedRes.retryAfterSeconds),
    `retryAfterSeconds must be an integer, got: ${String(deniedRes.retryAfterSeconds)}`
  );
  assert.ok(
    deniedRes.retryAfterSeconds >= 19 && deniedRes.retryAfterSeconds <= 20,
    `Expected retryAfterSeconds ~20s, got: ${String(deniedRes.retryAfterSeconds)}`
  );
});

test("CASE 4 — Different keys are isolated", async () => {
  const limiter = await getRateLimiter();
  const limit = 2;
  const windowMs = 60_000;
  const baseTime = 4_000_000;

  // Exhaust client-1
  limiter.consumeRateLimit("client-1", limit, windowMs, baseTime);
  limiter.consumeRateLimit("client-1", limit, windowMs, baseTime + 100);
  const client1Blocked = limiter.consumeRateLimit("client-1", limit, windowMs, baseTime + 200);
  assert.strictEqual(client1Blocked.allowed, false, "client-1 must be blocked");

  // client-2 must still be allowed
  const client2Res = limiter.consumeRateLimit("client-2", limit, windowMs, baseTime + 300);
  assert.strictEqual(
    client2Res.allowed,
    true,
    "client-2 must not be affected by client-1's consumption"
  );
});

test("CASE 5 — Different route/bucket prefixes are isolated", async () => {
  const limiter = await getRateLimiter();
  const limit = 1;
  const windowMs = 60_000;
  const baseTime = 5_000_000;

  // Block client on admin-login bucket
  limiter.consumeRateLimit("admin_login:192.0.2.1", limit, windowMs, baseTime);
  const adminBlocked = limiter.consumeRateLimit(
    "admin_login:192.0.2.1",
    limit,
    windowMs,
    baseTime + 100
  );
  assert.strictEqual(adminBlocked.allowed, false);

  // Same IP on order_create bucket must not be blocked
  const orderRes = limiter.consumeRateLimit(
    "order_create:192.0.2.1",
    limit,
    windowMs,
    baseTime + 200
  );
  assert.strictEqual(
    orderRes.allowed,
    true,
    "order_create bucket must remain isolated from admin_login bucket"
  );
});

test("CASE 6 — After the window expires, requests are allowed again", async () => {
  const limiter = await getRateLimiter();
  const key = "test:client-expiry";
  const limit = 1;
  const windowMs = 10_000; // 10s
  const baseTime = 6_000_000;

  // Consume limit
  limiter.consumeRateLimit(key, limit, windowMs, baseTime);
  const blocked = limiter.consumeRateLimit(key, limit, windowMs, baseTime + 1_000);
  assert.strictEqual(blocked.allowed, false);

  // Request after window expiration (11s later)
  const afterExpiry = limiter.consumeRateLimit(key, limit, windowMs, baseTime + 11_000);
  assert.strictEqual(
    afterExpiry.allowed,
    true,
    "Request after window expiration must be allowed"
  );
});

test("CASE 7 — resetRateLimit(key) clears the bucket", async () => {
  const limiter = await getRateLimiter();
  const key = "test:client-reset";
  const limit = 1;
  const windowMs = 60_000;
  const baseTime = 7_000_000;

  // Consume and block
  limiter.consumeRateLimit(key, limit, windowMs, baseTime);
  const blocked = limiter.consumeRateLimit(key, limit, windowMs, baseTime + 100);
  assert.strictEqual(blocked.allowed, false);

  // Reset
  limiter.resetRateLimit(key);

  // Next request must now be allowed
  const afterReset = limiter.consumeRateLimit(key, limit, windowMs, baseTime + 200);
  assert.strictEqual(
    afterReset.allowed,
    true,
    "Request after resetRateLimit must be allowed"
  );
});

test("CASE 8 — Expired entries are pruned on subsequent consume calls", async () => {
  const limiter = await getRateLimiter();
  const limit = 5;
  const windowMs = 5_000; // 5s window
  const baseTime = 8_000_000;

  // 1. Warm-up consume at baseTime to trigger lazy pruning of any stale earlier-test entries,
  // then immediately reset the warm-up key to normalize baseline.
  limiter.consumeRateLimit("cleanup-prune-warmup", 1, windowMs, baseTime);
  limiter.resetRateLimit("cleanup-prune-warmup");

  // 2. Capture normalized baseline store size
  const baselineSize = limiter.getRateLimitStoreSize();

  // 3. Populate 10 distinct keys at baseTime
  for (let i = 0; i < 10; i++) {
    limiter.consumeRateLimit(`cleanup-test-${String(i)}`, limit, windowMs, baseTime);
  }

  // 4. Verify store grew by exactly 10 active entries
  const sizeAfterPopulation = limiter.getRateLimitStoreSize();
  assert.strictEqual(
    sizeAfterPopulation,
    baselineSize + 10,
    `Expected store size === ${String(baselineSize + 10)}, got ${String(sizeAfterPopulation)}`
  );

  // 5. Advance time 20s past window expiration and consume a new key
  const futureTime = baseTime + 20_000;
  const newKeyRes = limiter.consumeRateLimit("cleanup-new-key", limit, windowMs, futureTime);
  assert.strictEqual(newKeyRes.allowed, true);

  // 6. Verify lazy pruning removed the 10 expired entries (store size should be at most baselineSize + 1)
  const afterPruneSize = limiter.getRateLimitStoreSize();
  assert.ok(
    afterPruneSize <= baselineSize + 1,
    `Expected store size <= ${String(baselineSize + 1)} after lazy pruning of 10 expired entries, got ${String(afterPruneSize)}`
  );
});
