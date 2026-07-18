import assert from "node:assert/strict";
import test from "node:test";

import { isPlatformOnlyUser, signedInRoute } from "./session-routing";

const baseUser = {
  id: "user-1",
  organizationId: "organization-1",
  name: "User",
  email: "user@example.test",
} as const;

test("Super Admins are routed to the isolated platform workspace", () => {
  const user = { ...baseUser, role: "SuperAdmin" as const };
  assert.equal(signedInRoute(user), "/platform");
  assert.equal(isPlatformOnlyUser(user), true);
});

test("clinic users retain their clinic-specific signed-in destinations", () => {
  assert.equal(signedInRoute({ ...baseUser, role: "Owner" }), "/dashboard");
  assert.equal(signedInRoute({ ...baseUser, role: "Provider", providerId: "provider-1" }), "/my-schedule");
});
