import assert from "node:assert/strict";
import test from "node:test";

import { ScheduleCacheService } from "./schedule-cache.service";

test("schedule cache expires entries instead of retaining stale planning data", async () => {
  const cache = new ScheduleCacheService();
  cache.set("short-lived", { value: 1 }, 1);

  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(cache.get("short-lived"), null);
  assert.deepEqual(cache.keys(), []);
});

test("schedule cache shares concurrent loads for the same key", async () => {
  const cache = new ScheduleCacheService();
  let calls = 0;
  const load = async () => {
    calls += 1;
    await Promise.resolve();
    return { value: 1 };
  };

  const [first, second] = await Promise.all([
    cache.getOrLoad("shared", load),
    cache.getOrLoad("shared", load),
  ]);

  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(cache.get("shared"), first);
});

test("invalidation prevents an older pending load from restoring stale data", async () => {
  const cache = new ScheduleCacheService();
  let release: ((value: { value: number }) => void) | undefined;
  const pendingValue = new Promise<{ value: number }>((resolve) => {
    release = resolve;
  });

  const request = cache.getOrLoad("planning", () => pendingValue);
  cache.delete("planning");
  release?.({ value: 1 });
  await request;

  assert.equal(cache.get("planning"), null);
});
