import assert from "node:assert/strict";
import test from "node:test";

import { isConfigurationOnlyDomain, isPlatformSuperAdmin } from "./platform-workspace";

test("platform workspace is reserved for Super Admins", () => {
  assert.equal(isPlatformSuperAdmin({ role: "SuperAdmin" }), true);
  assert.equal(isPlatformSuperAdmin({ role: "Owner" }), false);
  assert.equal(isPlatformSuperAdmin(null), false);
});

test("support access permits configuration-only domains", () => {
  assert.equal(isConfigurationOnlyDomain("organization_configuration"), true);
  assert.equal(isConfigurationOnlyDomain("operational_metadata"), true);
  assert.equal(isConfigurationOnlyDomain("scheduling_metadata"), true);
  assert.equal(isConfigurationOnlyDomain("client_records"), false);
  assert.equal(isConfigurationOnlyDomain("financial_data"), false);
});
