const DEFAULT_TTL_MS = 30_000;

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const valueCache = new Map<string, CacheEntry>();
const pendingCache = new Map<string, Promise<unknown>>();

let catalogGeneration = 0;

export async function withCatalogCache<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS
): Promise<T> {
  const now = Date.now();
  const cached = valueCache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const pending = pendingCache.get(key);
  if (pending) {
    return pending as Promise<T>;
  }

  const generationAtStart = catalogGeneration;

  const task = (async () => {
    const value = await loader();

    if (generationAtStart === catalogGeneration) {
      valueCache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
      });
    }

    return value;
  })();

  pendingCache.set(key, task as Promise<unknown>);

  try {
    return await task;
  } finally {
    pendingCache.delete(key);
  }
}

function invalidateByPrefixes(prefixes: string[]) {
  catalogGeneration += 1;

  for (const key of valueCache.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      valueCache.delete(key);
    }
  }

  for (const key of pendingCache.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      pendingCache.delete(key);
    }
  }
}

export function invalidateProductCatalogCache() {
  invalidateByPrefixes(["api:products:", "page:products:"]);
}

export function invalidateCategoryCatalogCache() {
  invalidateByPrefixes(["api:categories:", "page:shop:categories:"]);
}
