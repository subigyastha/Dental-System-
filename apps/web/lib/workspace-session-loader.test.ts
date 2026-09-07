import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceSessionLoader } from "./workspace-session-loader";

const session = {
  user: { id: "user-a" },
  bootstrap: { context: { organization: { id: "clinic-a" } } },
} as never;

test("workspace session bootstrap is shared across route transitions", async () => {
  let calls = 0;
  const loader = createWorkspaceSessionLoader(async () => {
    calls += 1;
    return session;
  });

  const [first, concurrent] = await Promise.all([loader.load(), loader.load()]);
  const nextRoute = await loader.load();
  assert.equal(first, concurrent);
  assert.equal(nextRoute, first);
  assert.equal(calls, 1);
});

test("logout or authorization change clears the reusable workspace session", async () => {
  let calls = 0;
  const loader = createWorkspaceSessionLoader(async () => {
    calls += 1;
    return session;
  });

  await loader.load();
  loader.clear();
  await loader.load();
  assert.equal(calls, 2);
});

test("a failed workspace session request stays retryable", async () => {
  let calls = 0;
  const loader = createWorkspaceSessionLoader(async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary outage");
    return session;
  });

  await assert.rejects(loader.load(), /temporary outage/);
  assert.equal(await loader.load(), session);
  assert.equal(calls, 2);
});
