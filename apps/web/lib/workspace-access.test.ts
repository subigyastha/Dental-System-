import assert from "node:assert/strict";
import test from "node:test";

import { resolveWorkspaceGate } from "./workspace-access";

test("a protected workspace redirects before rendering clinic data when no session is available", () => {
  assert.equal(
    resolveWorkspaceGate({
      requiresSignIn: true,
      hasData: true,
      hasError: false,
    }),
    "redirecting",
  );
});

test("a failed secure workspace request renders unavailable rather than sample data", () => {
  assert.equal(
    resolveWorkspaceGate({
      requiresSignIn: false,
      hasData: false,
      hasError: true,
    }),
    "unavailable",
  );
});

test("workspace data renders only after an authenticated request supplies it", () => {
  assert.equal(
    resolveWorkspaceGate({
      requiresSignIn: false,
      hasData: true,
      hasError: false,
    }),
    "ready",
  );
});
