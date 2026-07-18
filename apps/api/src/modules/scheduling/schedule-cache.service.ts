import { Injectable } from "@nestjs/common";

// Phase 2: swap ScheduleCacheService backing store to Redis or database snapshot table

@Injectable()
export class ScheduleCacheService {
  private readonly store = new Map<string, unknown>();

  get<T>(key: string) {
    return (this.store.get(key) as T | undefined) ?? null;
  }

  set<T>(key: string, value: T) {
    this.store.set(key, value);
  }

  delete(key: string) {
    this.store.delete(key);
  }

  keys() {
    return Array.from(this.store.keys());
  }
}
