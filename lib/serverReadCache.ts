type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const DEFAULT_TTL_MS = 5_000;

const readCache = new Map<string, CacheEntry>();
const pendingReads = new Map<string, Promise<unknown>>();

let mutationEpoch = 0;

export async function withServerReadCache<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS
): Promise<T> {
  const now = Date.now();
  const cached = readCache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const pending = pendingReads.get(key);
  if (pending) {
    return pending as Promise<T>;
  }

  const readEpoch = mutationEpoch;

  const task = loader()
    .then((value) => {
      if (readEpoch === mutationEpoch) {
        readCache.set(key, {
          value,
          expiresAt: Date.now() + ttlMs,
        });
      }

      return value;
    })
    .finally(() => {
      pendingReads.delete(key);
    });

  pendingReads.set(key, task as Promise<unknown>);
  return task;
}

export function peekServerReadCache<T>(key: string): T | undefined {
  const cached = readCache.get(key);

  if (!cached) return undefined;

  if (cached.expiresAt <= Date.now()) {
    readCache.delete(key);
    return undefined;
  }

  return cached.value as T;
}

function clearServerReadCacheByPrefix(prefixes: string[]) {
  mutationEpoch += 1;

  for (const key of readCache.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      readCache.delete(key);
    }
  }

  for (const key of pendingReads.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      pendingReads.delete(key);
    }
  }
}

export function invalidateProductReadCache() {
  clearServerReadCacheByPrefix(["products:"]);
}

export function invalidateCategoryReadCache() {
  clearServerReadCacheByPrefix(["categories:"]);
}


