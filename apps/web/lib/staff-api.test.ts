import assert from "node:assert/strict";
import test from "node:test";

import { rememberCsrfToken } from "./api-client";
import { loadStaffDirectory, updateStaffMember } from "./staff-api";

test("Staff directory sends bounded server-side filters and pagination", async () => {
  const originalFetch = globalThis.fetch;
  let url = "";
  globalThis.fetch = (async (input) => {
    url = String(input);
    return Response.json({
      data: { capabilities: {}, summary: {}, pagination: {}, items: [] },
      meta: { apiVersion: "v1" },
    });
  }) as typeof fetch;
  try {
    await loadStaffDirectory({
      page: 2,
      limit: 25,
      query: "dental",
      role: "Provider",
      status: "Active",
      locationId: "location-a",
      sort: "lastLogin",
      direction: "desc",
    });
    assert.equal(
      url,
      "/api/v1/staff?page=2&limit=25&query=dental&role=Provider&status=Active&locationId=location-a&sort=lastLogin&direction=desc",
    );
    assert.equal(url.includes("operational-data"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Staff update uses protected mutation and does not trigger an aggregate reload", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  rememberCsrfToken("test-csrf");
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({ id: "staff-a" });
  }) as typeof fetch;
  try {
    await updateStaffMember("clinic-a", "staff/a", {
      name: "A Staff Member",
      email: "staff@example.test",
      role: "Finance",
      staffLabel: "Finance",
      status: "Active",
      isSchedulable: false,
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, "/api/staff/staff%2Fa");
    assert.equal(requests[0]?.init?.method, "PATCH");
    assert.ok(new Headers(requests[0]?.init?.headers).has("x-csrf-token"));
  } finally {
    globalThis.fetch = originalFetch;
    rememberCsrfToken();
  }
});
