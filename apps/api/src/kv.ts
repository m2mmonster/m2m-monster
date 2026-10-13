// The few Redis operations the API needs (rate limiting, idempotency, nonces).
import { Redis } from "ioredis";

export interface Kv {
  /** Sets `key` only if it does not exist. Returns true if it was set. */
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  get(key: string): Promise<string | null>;
  /** Increments a counter that expires `ttlMs` after its first increment. */
  incr(key: string, ttlMs: number): Promise<number>;
}

export function redisKv(url: string): Kv {
  const redis = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
  return {
    async setIfAbsent(key, value, ttlMs) {
      return (await redis.set(key, value, "PX", ttlMs, "NX")) === "OK";
    },
    async set(key, value, ttlMs) {
      await redis.set(key, value, "PX", ttlMs);
    },
    get: (key) => redis.get(key),
    async incr(key, ttlMs) {
      const [[, count]] = (await redis.multi().incr(key).pexpire(key, ttlMs, "NX").exec()) as [
        [Error | null, number],
      ];
      return count;
    },
  };
}

/** In-process implementation for tests and local development. */
export function memoryKv(now: () => number = Date.now): Kv {
  const store = new Map<string, { value: string; expires: number }>();
  const live = (key: string) => {
    const entry = store.get(key);
    if (entry && entry.expires <= now()) store.delete(key);
    return store.get(key);
  };
  return {
    async setIfAbsent(key, value, ttlMs) {
      if (live(key)) return false;
      store.set(key, { value, expires: now() + ttlMs });
      return true;
    },
    async set(key, value, ttlMs) {
      store.set(key, { value, expires: now() + ttlMs });
    },
    async get(key) {
      return live(key)?.value ?? null;
    },
    async incr(key, ttlMs) {
      const entry = live(key) ?? { value: "0", expires: now() + ttlMs };
      entry.value = `${Number(entry.value) + 1}`;
      store.set(key, entry);
      return Number(entry.value);
    },
  };
}
