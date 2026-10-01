import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import manifest from "../app/manifest";

test("install manifest has real PNG icons and a standalone same-origin launch", () => {
  const app = manifest();
  assert.equal(app.display, "standalone");
  assert.equal(app.start_url, "/");
  assert.equal(app.scope, "/");
  for (const icon of app.icons ?? []) {
    const png = readFileSync(new URL(`../public${icon.src}`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});

function worker(fetch: () => Promise<Response>) {
  const handlers = new Map<string, (event: unknown) => void>();
  const offline = new Response("Public offline screen");
  const cached: string[] = [];
  runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    self: { addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler), skipWaiting: () => undefined },
    caches: {
      open: async () => ({ add: async (url: string) => { cached.push(url); } }),
      match: async () => offline,
    },
    fetch,
    Response,
  });
  return { handlers, offline, cached };
}

test("service worker caches only the public offline page and ignores APIs and writes", async () => {
  const { handlers, cached } = worker(async () => new Response("network"));
  let installation: Promise<unknown> | undefined;
  handlers.get("install")!({ waitUntil: (promise: Promise<unknown>) => { installation = promise; } });
  await installation;
  assert.deepEqual(cached, ["/offline.html"]);
  for (const request of [{ method: "GET", mode: "cors" }, { method: "POST", mode: "navigate" }]) {
    handlers.get("fetch")!({ request, respondWith: () => assert.fail("API data and writes must bypass the worker") });
  }
});

test("online navigation preserves server denial; a network failure shows the public offline page", async () => {
  for (const online of [true, false]) {
    const denied = new Response("Sign in required", { status: 401 });
    const { handlers, offline } = worker(async () => {
      if (!online) throw new TypeError("Network unavailable");
      return denied;
    });
    let result: Promise<Response> | undefined;
    handlers.get("fetch")!({ request: { method: "GET", mode: "navigate" }, respondWith: (response: Promise<Response>) => { result = response; } });
    assert.equal(await result, online ? denied : offline);
  }
});
