/**
 * Zero-dependency in-memory fixed-window rate limiter.
 *
 * Designed for Phase-1 abuse mitigation (admin brute-force protection,
 * CPU safety valve, and order creation throttling).
 *
 * NOTE: This store is process-local and in-memory. It does not provide
 * distributed rate-limiting across multi-instance serverless deployments.
 */

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetTimeMs: number;
};

type RateLimitBucket = {
  count: number;
  resetTimeMs: number;
};

const store = new Map<string, RateLimitBucket>();

/**
 * Prunes expired buckets from the in-memory store lazily.
 */
function pruneExpiredEntries(now: number): void {
  for (const [key, bucket] of store.entries()) {
    if (bucket.resetTimeMs <= now) {
      store.delete(key);
    }
  }
}

/**
 * Consumes a request attempt against a named rate-limiting key.
 *
 * @param key Unique bucket identifier (e.g. `admin_login:198.51.100.1`)
 * @param limit Maximum allowed attempts within the window
 * @param windowMs Duration of the fixed window in milliseconds
 * @param nowMs Injected timestamp (defaults to Date.now())
 */
export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  nowMs?: number
): RateLimitResult {
  if (!key || typeof key !== "string" || !key.trim()) {
    throw new Error("Rate limit key must be a non-empty string");
  }
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    throw new Error("Rate limit must be a positive finite integer");
  }
  if (typeof windowMs !== "number" || !Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("Rate limit windowMs must be a positive finite number");
  }
  if (nowMs !== undefined && (typeof nowMs !== "number" || !Number.isFinite(nowMs) || nowMs <= 0)) {
    throw new Error("Rate limit nowMs must be a positive finite number when provided");
  }

  const now = nowMs ?? Date.now();

  // Lazy cleanup of expired entries across the store
  pruneExpiredEntries(now);

  let bucket = store.get(key);

  // If bucket does not exist or window has expired, create a new window
  if (!bucket || bucket.resetTimeMs <= now) {
    bucket = {
      count: 0,
      resetTimeMs: now + windowMs,
    };
  }

  if (bucket.count < limit) {
    bucket.count += 1;
    store.set(key, bucket);
    return {
      allowed: true,
      limit,
      remaining: limit - bucket.count,
      retryAfterSeconds: 0,
      resetTimeMs: bucket.resetTimeMs,
    };
  }

  // Limit exceeded: retain existing count and window
  store.set(key, bucket);
  const retryAfterMs = Math.max(0, bucket.resetTimeMs - now);
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

  return {
    allowed: false,
    limit,
    remaining: 0,
    retryAfterSeconds,
    resetTimeMs: bucket.resetTimeMs,
  };
}

/**
 * Manually clears the bucket for a given key (e.g. on successful authentication).
 */
export function resetRateLimit(key: string): void {
  if (key && typeof key === "string") {
    store.delete(key);
  }
}

/**
 * Returns the current count of active buckets in memory (testing/observability).
 */
export function getRateLimitStoreSize(): number {
  return store.size;
}
