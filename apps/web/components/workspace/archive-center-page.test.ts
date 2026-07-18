import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveProtectionLabel,
  canManageArchive,
  type ArchivedClient,
} from "./archive-center-page";

const archivedClient: ArchivedClient = {
  id: "client-1",
  fullName: "Archived Client",
  patientCode: "CL-1001",
  archivedAt: "2026-07-01T09:00:00.000Z",
  archiveReason: "Duplicate record",
  archivedByUserId: "owner-1",
  retentionUntil: null,
  legalHoldAt: null,
  legalHoldReason: null,
};

test("archive access is restricted to Owners and Admins", () => {
  assert.equal(canManageArchive("Owner"), true);
  assert.equal(canManageArchive("Admin"), true);
  assert.equal(canManageArchive("Manager"), false);
  assert.equal(canManageArchive(null), false);
});

test("archive protection label prioritizes legal hold over retention", () => {
  assert.equal(archiveProtectionLabel(archivedClient), "Retention review required");
  assert.equal(
    archiveProtectionLabel({
      ...archivedClient,
      legalHoldAt: "2026-07-02T09:00:00.000Z",
      legalHoldReason: "Open claim",
      retentionUntil: "2999-01-01T00:00:00.000Z",
    }),
    "Legal hold: Open claim",
  );
  assert.match(
    archiveProtectionLabel({ ...archivedClient, retentionUntil: "2999-01-01T00:00:00.000Z" }),
    /^Retained until /,
  );
});
