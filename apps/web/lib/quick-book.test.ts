import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceQuickBookHistoryMarker,
  createClosedQuickBookHref,
  createQuickBookHref,
  planQuickBookClose,
  readQuickBookHistoryMarker,
  readQuickBookUrl,
  resolveQuickBookLocation,
  sanitizeQuickBookPrefill,
  shouldRestoreBusyQuickBookEntry,
  withQuickBookHistoryMarker,
  type QuickBookHistoryMarker,
} from "./quick-book";
import type { WorkspaceBootstrap } from "./workspace-bootstrap";

const launchedMarker: QuickBookHistoryMarker = {
  version: 1,
  sessionId: "booking-session",
  depth: 0,
  origin: "launch",
};

const workspaceBootstrap: WorkspaceBootstrap = {
  user: {
    id: "user-a",
    organizationId: "clinic-a",
    name: "Clinic Owner",
    email: "owner@clinic-a.test",
    role: "Owner",
    effectiveRoles: ["Owner"],
  },
  context: {
    capabilities: {
      canCreateAppointment: true,
      canCreateClient: true,
      canAccessInventory: true,
      canAccessStaff: true,
      canAccessSettings: true,
    },
    organization: {
      id: "clinic-a",
      name: "Clinic A",
      timezone: "Asia/Kathmandu",
      primaryCalendar: "AD",
    },
    actor: {
      id: "user-a",
      name: "Clinic Owner",
      roles: ["Owner"],
      roleSource: "assignment_policy",
    },
  },
  locations: [
    {
      id: "location-denied",
      name: "Restricted clinic",
      timezone: "Asia/Kathmandu",
      canCreateAppointment: false,
      canManageInventory: false,
    },
    {
      id: "location-allowed",
      name: "Main clinic",
      timezone: "Asia/Kathmandu",
      canCreateAppointment: true,
      canManageInventory: true,
    },
  ],
};

test("Quick Book URL state preserves the current route, query, and hash", () => {
  const openHref = createQuickBookHref(
    "/billing?status=outstanding&order=due#invoice-list",
    "details",
  );
  const openUrl = new URL(openHref, "https://clinicflow.local");

  assert.equal(openUrl.pathname, "/billing");
  assert.equal(openUrl.searchParams.get("status"), "outstanding");
  assert.equal(openUrl.searchParams.get("order"), "due");
  assert.equal(openUrl.searchParams.get("book"), "1");
  assert.equal(openUrl.searchParams.get("bookStep"), "details");
  assert.equal(openUrl.hash, "#invoice-list");
  assert.deepEqual(readQuickBookUrl(openHref), {
    isOpen: true,
    step: "details",
  });

  assert.equal(
    createClosedQuickBookHref(openHref),
    "/billing?status=outstanding&order=due#invoice-list",
  );
});

test("only a bounded non-sensitive step marker is added to the URL", () => {
  const prefill = sanitizeQuickBookPrefill({
    locationId: "location-allowed",
    refs: {
      clientId: "client-private-id",
      providerId: "provider-private-id",
    },
  });
  const openHref = createQuickBookHref("/clients?view=recent", "client");

  assert.deepEqual(prefill, {
    locationId: "location-allowed",
    refs: {
      clientId: "client-private-id",
      providerId: "provider-private-id",
    },
  });
  assert.equal(openHref.includes("client-private-id"), false);
  assert.equal(openHref.includes("provider-private-id"), false);
  assert.equal(openHref.includes("location-allowed"), false);
  assert.equal(
    new URL(openHref, "https://clinicflow.local").searchParams.get("view"),
    "recent",
  );
  assert.equal(
    new URL(
      createQuickBookHref("/schedule", "Invalid PII marker@example.com"),
      "https://clinicflow.local",
    ).searchParams.has("bookStep"),
    false,
  );
});

test("guided pushes are bounded and close returns to the pre-drawer entry", () => {
  const firstStep = advanceQuickBookHistoryMarker(launchedMarker);
  const secondStep = advanceQuickBookHistoryMarker(firstStep!);

  assert.equal(firstStep?.depth, 1);
  assert.equal(secondStep?.depth, 2);
  assert.deepEqual(
    planQuickBookClose("/schedule?book=1&bookStep=confirm", secondStep),
    {
      method: "go",
      delta: -3,
      replaceAfterGo: false,
    },
  );

  let boundedMarker = launchedMarker;
  for (let index = 0; index < 24; index += 1) {
    boundedMarker = advanceQuickBookHistoryMarker(boundedMarker)!;
  }
  assert.equal(advanceQuickBookHistoryMarker(boundedMarker), null);
});

test("a directly loaded drawer closes with replace instead of unsafe history navigation", () => {
  const directMarker: QuickBookHistoryMarker = {
    ...launchedMarker,
    origin: "direct",
  };
  assert.deepEqual(
    planQuickBookClose(
      "/clients?filter=active&book=1&bookStep=client",
      directMarker,
    ),
    {
      method: "replace",
      href: "/clients?filter=active",
    },
  );
  assert.deepEqual(
    planQuickBookClose("/clients?filter=active&book=1", null),
    {
      method: "replace",
      href: "/clients?filter=active",
    },
  );
});

test("direct deep-link steps collapse to the direct entry before replacement", () => {
  assert.deepEqual(
    planQuickBookClose("/clients?book=1&bookStep=confirm", {
      ...launchedMarker,
      origin: "direct",
      depth: 2,
    }),
    {
      method: "go",
      delta: -2,
      replaceAfterGo: true,
    },
  );
});

test("history markers retain router state and reject malformed controller state", () => {
  const nextRouterState = {
    __NA: true,
    tree: ["", { children: ["billing", {}] }],
  };
  const state = withQuickBookHistoryMarker(nextRouterState, launchedMarker);

  assert.equal(state.__NA, true);
  assert.deepEqual(readQuickBookHistoryMarker(state), launchedMarker);
  assert.equal(
    readQuickBookHistoryMarker(
      withQuickBookHistoryMarker(nextRouterState, {
        ...launchedMarker,
        depth: 25,
      }),
    ),
    null,
  );
});

test("booking location selection respects global and per-location capabilities", () => {
  assert.equal(
    resolveQuickBookLocation(workspaceBootstrap)?.id,
    "location-allowed",
  );
  assert.equal(
    resolveQuickBookLocation(workspaceBootstrap, "location-allowed")?.id,
    "location-allowed",
  );
  assert.equal(
    resolveQuickBookLocation(workspaceBootstrap, "location-denied"),
    null,
  );
  assert.equal(
    resolveQuickBookLocation(
      {
        ...workspaceBootstrap,
        context: {
          ...workspaceBootstrap.context,
          capabilities: {
            canCreateAppointment: false,
            canCreateClient: false,
            canAccessInventory: false,
            canAccessStaff: false,
            canAccessSettings: false,
          },
        },
      },
      "location-allowed",
    ),
    null,
  );
});

test("busy Quick Book restores every differing history entry", () => {
  const busyEntry = "/dashboard?book=1&bookStep=details";

  assert.equal(
    shouldRestoreBusyQuickBookEntry({
      currentHref: "/dashboard?book=1&bookStep=client",
      isBusy: true,
      isOpen: true,
      lastOpenHref: busyEntry,
    }),
    true,
  );
  assert.equal(
    shouldRestoreBusyQuickBookEntry({
      currentHref: "/dashboard",
      isBusy: true,
      isOpen: true,
      lastOpenHref: busyEntry,
    }),
    true,
  );
  assert.equal(
    shouldRestoreBusyQuickBookEntry({
      currentHref: busyEntry,
      isBusy: true,
      isOpen: true,
      lastOpenHref: busyEntry,
    }),
    false,
  );
  assert.equal(
    shouldRestoreBusyQuickBookEntry({
      currentHref: "/dashboard?book=1&bookStep=matches",
      isBusy: false,
      isOpen: true,
      lastOpenHref: busyEntry,
    }),
    false,
  );
});
