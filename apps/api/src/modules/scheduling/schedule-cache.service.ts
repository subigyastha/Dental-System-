import { Injectable } from "@nestjs/common";

// Phase 2: swap ScheduleCacheService backing store to Redis or database snapshot table

type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

const DEFAULT_CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 500;

@Injectable()
export class ScheduleCacheService {
  private readonly store = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<unknown>>();

  get<T>(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }

    // Refresh insertion order so eviction behaves as an LRU cache.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs = DEFAULT_CACHE_TTL_MS) {
    this.store.delete(key);
    this.store.set(key, {
      value,
      expiresAt: Date.now() + Math.max(1, ttlMs),
    });
    this.prune();
  }

  getOrLoad<T>(
    key: string,
    load: () => Promise<T>,
    ttlMs = DEFAULT_CACHE_TTL_MS,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) return Promise.resolve(cached);

    const active = this.pending.get(key) as Promise<T> | undefined;
    if (active) return active;

    const request = load()
      .then((value) => {
        // An invalidation removes the pending marker. Do not let an older load
        // repopulate the cache after a schedule/settings mutation.
        if (this.pending.get(key) === request) {
          this.set(key, value, ttlMs);
        }
        return value;
      })
      .finally(() => {
        if (this.pending.get(key) === request) {
          this.pending.delete(key);
        }
      });
    this.pending.set(key, request);
    return request;
  }

  delete(key: string) {
    this.store.delete(key);
    this.pending.delete(key);
  }

  keys() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(key);
    }
    return Array.from(this.store.keys());
  }

  private prune() {
    while (this.store.size > MAX_CACHE_ENTRIES) {
      const oldestKey = this.store.keys().next().value as string | undefined;
      if (!oldestKey) return;
      this.store.delete(oldestKey);
    }
  }
}
