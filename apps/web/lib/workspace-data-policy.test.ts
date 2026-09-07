import assert from "node:assert/strict";
import test from "node:test";

import {
  requiresCompatibilityBootstrap,
  workspaceDataPolicy,
} from "./workspace-data-policy";

test("route-owned screens use the minimal bootstrap", () => {
  assert.equal(workspaceDataPolicy("/dashboard"), "minimal-bootstrap");
  assert.equal(workspaceDataPolicy("/clients"), "minimal-bootstrap");
  assert.equal(workspaceDataPolicy("/billing"), "minimal-bootstrap");
  assert.equal(workspaceDataPolicy("/archive"), "minimal-bootstrap");
  assert.equal(workspaceDataPolicy("/inventory"), "minimal-bootstrap");
  assert.equal(workspaceDataPolicy("/staff"), "minimal-bootstrap");
  assert.equal(workspaceDataPolicy("/settings"), "minimal-bootstrap");
  assert.equal(workspaceDataPolicy("/patients"), "minimal-bootstrap");
  assert.equal(requiresCompatibilityBootstrap("/dashboard"), false);
  assert.equal(requiresCompatibilityBootstrap("/clients"), false);
  assert.equal(requiresCompatibilityBootstrap("/billing"), false);
  assert.equal(requiresCompatibilityBootstrap("/archive"), false);
  assert.equal(requiresCompatibilityBootstrap("/inventory"), false);
  assert.equal(requiresCompatibilityBootstrap("/staff"), false);
  assert.equal(requiresCompatibilityBootstrap("/settings"), false);
  assert.equal(requiresCompatibilityBootstrap("/patients"), false);
});

test("nested client routes deterministically use the minimal bootstrap", () => {
  const equivalentClientPaths = [
    "/clients/client-123",
    "/clients/client-123/",
    "clients/client-123",
    "/clients/client-123?tab=records",
    "/clients/client-123#contact",
  ];

  for (const pathname of equivalentClientPaths) {
    assert.equal(
      workspaceDataPolicy(pathname),
      "minimal-bootstrap",
      `${pathname} should be route-owned`,
    );
  }
});

test("unknown routes safely receive only the bounded workspace shell bootstrap", () => {
  assert.equal(workspaceDataPolicy("/client"), "minimal-bootstrap");
  assert.equal(workspaceDataPolicy("/clientele"), "minimal-bootstrap");
  assert.equal(workspaceDataPolicy("/dashboard-old"), "minimal-bootstrap");
});

test("schedule screens use their bounded schedule bootstrap", () => {
  for (const pathname of [
    "/my-schedule",
    "/my-schedule/",
    "/reservations",
    "/reservations?view=week",
  ]) {
    assert.equal(workspaceDataPolicy(pathname), "schedule-bootstrap");
    assert.equal(requiresCompatibilityBootstrap(pathname), false);
  }
});

test("no workspace route can request the legacy compatibility aggregate", () => {
  for (const pathname of ["/", "/patients", "/settings", "/unknown"]) {
    assert.notEqual(workspaceDataPolicy(pathname), "compatibility-bootstrap");
    assert.equal(requiresCompatibilityBootstrap(pathname), false);
  }
});
