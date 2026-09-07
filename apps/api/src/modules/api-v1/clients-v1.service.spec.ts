import assert from "node:assert/strict";
import test from "node:test";

import { buildClientCandidateSetVersion } from "../customers/client-match-version";
import { normalizeClientPhone } from "../customers/client-phone-normalization";
import { ClientsV1Service } from "./clients-v1.service";

const actor = {
  id: "staff-a",
  organizationId: "clinic-a",
  name: "Clinic A Receptionist",
  email: "staff-a@example.test",
  role: "Receptionist",
  effectiveRoles: ["Receptionist"],
};

const clientRow = {
  id: "client-a",
  organizationId: "clinic-a",
  fullName: "Asha Rai",
  patientCode: "CL-000001",
  phone: "+977 9800000000",
  email: "asha@example.test",
  gender: null,
  dateOfBirth: null,
  address: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  allergies: null,
  medicalNotes: null,
  riskLabel: "Routine",
  lastVisitAt: null,
  archivedAt: null,
  mergedIntoCustomerId: null,
  createdAt: new Date("2030-01-01T00:00:00.000Z"),
  updatedAt: new Date("2030-01-01T00:00:00.000Z"),
};

function emptyCandidateVersion(phone: string) {
  return buildClientCandidateSetVersion(normalizeClientPhone(phone), []);
}

test("v1 Client directory scopes and excludes archived or merged Client records", async () => {
  const observed: unknown[] = [];
  const service = new ClientsV1Service(
    {
      customer: {
        findMany: async (query: unknown) => {
          observed.push(query);
          return [clientRow];
        },
      },
    } as never,
    { requireSession: async () => actor } as never,
  );

  const result = await service.list({ limit: 25, query: "Asha" }, actor);
  assert.equal(result.items[0]?.clientCode, "CL-000001");
  const query = observed[0] as { where: Record<string, unknown>; take: number };
  assert.equal(query.where.organizationId, "clinic-a");
  assert.equal(query.where.archivedAt, null);
  assert.equal(query.where.mergedIntoCustomerId, null);
  assert.equal(query.take, 26);
});

test("v1 Client directory normalizes an HTTP query-string limit", async () => {
  let observedTake: unknown;
  const service = new ClientsV1Service(
    {
      customer: {
        findMany: async ({ take }: { take: unknown }) => {
          observedTake = take;
          return [];
        },
      },
    } as never,
    { requireSession: async () => actor } as never,
  );

  const result = await service.list({ limit: "25" as never }, actor);

  assert.equal(observedTake, 26);
  assert.equal(result.page.limit, 25);
});

test("v1 Client directory can return a deterministic recent-booking list", async () => {
  let observedOrder: unknown;
  const service = new ClientsV1Service(
    {
      customer: {
        findMany: async ({ orderBy }: { orderBy: unknown }) => {
          observedOrder = orderBy;
          return [];
        },
      },
    } as never,
    { requireSession: async () => actor } as never,
  );

  await service.list({ limit: 6, order: "recent" }, actor);

  assert.deepEqual(observedOrder, [
    { lastVisitAt: { sort: "desc", nulls: "last" } },
    { updatedAt: "desc" },
    { id: "desc" },
  ]);
});

test("v1 Client creation allocates unique server-side codes and permits shared phones", async () => {
  let nextValue = 1;
  const created: Array<Record<string, unknown>> = [];
  const receipts: Array<Record<string, unknown>> = [];
  const tx = {
    $executeRaw: async () => 1,
    clientCodeSequence: {
      upsert: async () => ({ nextValue: ++nextValue }),
    },
    customer: {
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { ...clientRow, id: "client-" + created.length, patientCode: data.patientCode };
      },
    },
    clientPhone: { create: async () => ({}) },
    clientIdentityReview: { create: async () => ({ id: "review-a", status: "Pending" }) },
    clientCreationReceipt: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        receipts.push(data);
        return {};
      },
    },
    auditLog: { create: async () => ({}) },
  };
  const service = new ClientsV1Service(
    {
      clientCreationReceipt: { findUnique: async () => null },
      $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    } as never,
    { requireSession: async () => actor } as never,
  );

  const [first, second] = await Promise.all([
    service.create(
      {
        name: "Asha Rai",
        phone: "+977 9800000000",
        risk: "Routine",
        candidateSetVersion: emptyCandidateVersion("+977 9800000000"),
      },
      "client-create-key-0001",
      actor,
    ),
    service.create(
      {
        name: "Bina Rai",
        phone: "+977 9800000000",
        risk: "Routine",
        candidateSetVersion: emptyCandidateVersion("+977 9800000000"),
      },
      "client-create-key-0002",
      actor,
    ),
  ]);

  assert.notEqual(first.clientCode, second.clientCode);
  assert.deepEqual(created.map((item) => item.normalizedPhone), ["9779800000000", "9779800000000"]);
  assert.ok(created.every((item) => typeof item.patientCode === "string"));
  assert.equal(JSON.stringify(receipts).includes("allergies"), false);
  assert.equal(JSON.stringify(receipts).includes("medicalNotes"), false);
  assert.equal(JSON.stringify(receipts).includes("9800000000"), false);
});

test("v1 Client creation replays a completed idempotent request without opening a transaction", async () => {
  let transactionCalled = false;
  const storedResponse = {
    id: clientRow.id,
    clientCode: clientRow.patientCode,
  };
  const dto = {
    name: "Asha Rai",
    phone: "+977 9800000000",
    risk: "Routine" as const,
    candidateSetVersion: emptyCandidateVersion("+977 9800000000"),
  };
  const initialService = new ClientsV1Service(
    {
      clientCreationReceipt: { findUnique: async () => null },
      $transaction: async (callback: (transaction: never) => Promise<unknown>) => {
        transactionCalled = true;
        return callback({} as never);
      },
    } as never,
    { requireSession: async () => actor } as never,
  );
  const requestHash = (
    initialService as unknown as {
      clientCreateRequestHash(value: typeof dto): string;
    }
  ).clientCreateRequestHash(dto);
  const service = new ClientsV1Service(
    {
      clientCreationReceipt: {
        findUnique: async () => ({
          requestHash,
          response: storedResponse,
          customer: {
            id: clientRow.id,
            patientCode: clientRow.patientCode,
            fullName: clientRow.fullName,
            phone: clientRow.phone,
          },
        }),
      },
      $transaction: async () => {
        transactionCalled = true;
        throw new Error("transaction should not run for a replay");
      },
    } as never,
    { requireSession: async () => actor } as never,
  );

  const result = await service.create(dto, "client-create-key-replay", actor);

  assert.equal(transactionCalled, false);
  assert.equal(result.replayed, true);
  assert.equal(result.clientCode, "CL-000001");
  assert.equal(result.name, "Asha Rai");
  assert.equal(result.phone, "+977 9800000000");
  assert.equal(result.identityReview, null);
});

test("v1 Client creation rejects stale match evidence before allocating a code", async () => {
  let allocated = false;
  const tx = {
    $executeRaw: async () => 1,
    clientCreationReceipt: { findUnique: async () => null },
    customer: { findMany: async () => [] },
    clientCodeSequence: {
      upsert: async () => {
        allocated = true;
        return { nextValue: 2 };
      },
    },
  };
  const service = new ClientsV1Service(
    {
      clientCreationReceipt: { findUnique: async () => null },
      $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    } as never,
    { requireSession: async () => actor } as never,
  );

  await assert.rejects(
    service.create(
      {
        name: "Asha Rai",
        phone: "+977 9800000000",
        risk: "Routine",
        candidateSetVersion: "stale-candidate-version-1",
      },
      "client-create-key-stale",
      actor,
    ),
    /Possible Client matches changed/,
  );
  assert.equal(allocated, false);
});

test("Provider-only actors can create a governed Client record", async () => {
  const provider = { ...actor, role: "Provider", effectiveRoles: ["Provider"] };
  const tx = {
    $executeRaw: async () => 1,
    clientCodeSequence: { upsert: async () => ({ nextValue: 2 }) },
    customer: {
      findMany: async () => [],
      create: async () => ({
        ...clientRow,
        id: "client-provider",
        patientCode: "CL-000001",
      }),
    },
    clientPhone: { create: async () => ({}) },
    clientIdentityReview: { create: async () => ({ id: "review-a", status: "Pending" }) },
    clientCreationReceipt: {
      findUnique: async () => null,
      create: async () => ({}),
    },
    auditLog: { create: async () => ({}) },
  };
  const service = new ClientsV1Service(
    {
      clientCreationReceipt: { findUnique: async () => null },
      $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    } as never,
    { requireSession: async () => provider } as never,
  );

  const result = await service.create(
      {
        name: "Asha Rai",
        phone: "9800000000",
        risk: "Routine",
        candidateSetVersion: emptyCandidateVersion("9800000000"),
      },
      "client-create-key-provider",
      provider,
  );
  assert.equal(result.id, "client-provider");
  assert.equal(result.clientCode, "CL-000001");
});

test("v1 Client creation rejects a future date of birth before reading receipts", async () => {
  let receiptRead = false;
  const service = new ClientsV1Service(
    {
      clientCreationReceipt: {
        findUnique: async () => {
          receiptRead = true;
          return null;
        },
      },
    } as never,
    { requireSession: async () => actor } as never,
  );

  await assert.rejects(
    service.create(
      {
        name: "Asha Rai",
        phone: "9800000000",
        dateOfBirthIso: "2999-01-01",
        risk: "Routine",
        candidateSetVersion: emptyCandidateVersion("9800000000"),
      },
      "client-create-key-future-dob",
      actor,
    ),
    /not in the future/,
  );
  assert.equal(receiptRead, false);
});

test("v1 Client creation rejects an emergency phone without canonical digits", async () => {
  const service = new ClientsV1Service(
    {} as never,
    { requireSession: async () => actor } as never,
  );

  await assert.rejects(
    service.create(
      {
        name: "Asha Rai",
        phone: "9800000000",
        emergencyContactPhone: "----------",
        risk: "Routine",
        candidateSetVersion: emptyCandidateVersion("9800000000"),
      },
      "client-create-key-emergency-phone",
      actor,
    ),
    /7 to 15 digits/,
  );
});

test("number-first matching reports a shared household without exposing sensitive fields", async () => {
  const service = new ClientsV1Service(
    {
      customer: {
        findMany: async () => [
          {
            id: "client-a",
            patientCode: "CL-000001",
            fullName: "Asha Rai",
            phone: "9800000000",
            normalizedPhone: "9779800000000",
            lastVisitAt: null,
            updatedAt: new Date("2030-01-01T00:00:00.000Z"),
            phones: [{
              id: "phone-a",
              rawValue: "9800000000",
              normalizedValue: "9779800000000",
              updatedAt: new Date("2030-01-01T00:00:00.000Z"),
              label: null,
              type: "Mobile",
              isPrimary: true,
            }],
          },
          {
            id: "client-b",
            patientCode: "CL-000002",
            fullName: "Bina Rai",
            phone: "+977 9800000000",
            normalizedPhone: "9779800000000",
            lastVisitAt: null,
            updatedAt: new Date("2030-01-02T00:00:00.000Z"),
            phones: [],
          },
        ],
      },
    } as never,
    { requireSession: async () => actor } as never,
  );

  const result = await service.numberMatches({ phone: "+977 9800000000" }, actor);

  assert.equal(result.classification, "shared_household");
  assert.equal(result.matches.length, 2);
  assert.ok(result.matches.every((match) => match.classification === "shared_household"));
  assert.ok(result.matches.every((match) => !("email" in match.client)));
  assert.ok(result.matches.every((match) => !("risk" in match.client)));
  assert.equal(result.candidateSetVersion.length, 24);
});

test("appending an existing normalized phone is idempotent and preserves the primary projection", async () => {
  let transactionCalled = false;
  const service = new ClientsV1Service(
    {
      customer: { findFirst: async () => ({ id: "client-a" }) },
      clientPhone: {
        findFirst: async () => ({
          id: "phone-a",
          rawValue: "+977 9800000000",
          type: "Mobile",
          label: null,
          isPrimary: true,
          verificationStatus: "Unverified",
          createdAt: new Date("2030-01-01T00:00:00.000Z"),
        }),
      },
      $transaction: async () => {
        transactionCalled = true;
      },
    } as never,
    { requireSession: async () => actor } as never,
  );

  const result = await service.appendPhone(
    "client-a",
    { phone: "9800000000", reason: "Booking intake" },
    actor,
  );

  assert.equal(result.added, false);
  assert.equal(result.phone.isPrimary, true);
  assert.equal(transactionCalled, false);
});

test("Provider cannot bypass caller match evidence through the generic phone endpoint", async () => {
  const provider = { ...actor, role: "Provider", effectiveRoles: ["Provider"] };
  const service = new ClientsV1Service(
    {} as never,
    { requireSession: async () => provider } as never,
  );

  await assert.rejects(
    service.appendPhone(
      "client-a",
      { phone: "9800000000", reason: "Booking" },
      provider,
    ),
    /not allowed to create or change Client identity/,
  );
});

test("Provider can append a caller phone only with current selected-match evidence", async () => {
  const provider = { ...actor, role: "Provider", effectiveRoles: ["Provider"] };
  const updatedAt = new Date("2030-01-01T00:00:00.000Z");
  const matchedPhone = {
    id: "phone-a",
    rawValue: "9800000000",
    normalizedValue: "9779800000000",
    updatedAt,
    label: null,
    type: "Mobile",
    isPrimary: true,
  };
  const transaction = {
    customer: {
      findMany: async ({ where }: { where: { id?: unknown } }) =>
        where.id
          ? []
          : [{
              id: "client-a",
              patientCode: "CL-000001",
              fullName: "Asha Rai",
              phone: "9800000000",
              normalizedPhone: "9779800000000",
              lastVisitAt: null,
              updatedAt,
              phones: [matchedPhone],
            }],
      count: async () => 1,
    },
    clientPhone: {
      findFirst: async () => ({
        id: "phone-a",
        rawValue: "9800000000",
        type: "Mobile",
        label: null,
        isPrimary: true,
        verificationStatus: "Unverified",
        createdAt: updatedAt,
      }),
    },
  };
  const service = new ClientsV1Service(
    {
      clientPhone: transaction.clientPhone,
      $transaction: async (
        callback: (tx: typeof transaction) => Promise<unknown>,
      ) => callback(transaction),
    } as never,
    { requireSession: async () => provider } as never,
  );
  const candidateSetVersion = buildClientCandidateSetVersion(
    "9779800000000",
    [{
      id: "client-a",
      updatedAt,
      phones: [{
        id: matchedPhone.id,
        normalizedValue: matchedPhone.normalizedValue,
        updatedAt,
      }],
    }],
  );

  const result = await service.appendCallerPhone(
    "client-a",
    {
      name: "Asha Rai",
      phone: "9800000000",
      candidateSetVersion,
      reason: "Provider received caller",
    },
    provider,
  );
  assert.equal(result.added, false);
});

test("Provider Client creation authority does not grant profile-correction authority", async () => {
  const provider = { ...actor, role: "Provider", effectiveRoles: ["Provider"] };
  const service = new ClientsV1Service(
    {} as never,
    { requireSession: async () => provider } as never,
  );

  await assert.rejects(
    service.update(
      "client-a",
      { name: "Changed", phone: "9800000000", risk: "Routine" },
      provider,
    ),
    /not allowed to create or change Client identity/,
  );
});

test("prior-visit intake creates a pending identity review from server-derived candidates", async () => {
  let reviewData: Record<string, unknown> | undefined;
  const tx = {
    $executeRaw: async () => 1,
    clientCodeSequence: { upsert: async () => ({ nextValue: 2 }) },
    customer: {
      findMany: async () => [],
      create: async () => ({ ...clientRow, id: "client-new", patientCode: "CL-000001" }),
    },
    clientPhone: { create: async () => ({}) },
    clientIdentityReview: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        reviewData = data;
        return { id: "review-a", status: "Pending" };
      },
    },
    clientCreationReceipt: {
      findUnique: async () => null,
      create: async () => ({}),
    },
    auditLog: { create: async () => ({}) },
  };
  const service = new ClientsV1Service(
    {
      clientCreationReceipt: { findUnique: async () => null },
      $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    } as never,
    { requireSession: async () => actor } as never,
  );

  const result = await service.create(
    {
      name: "Asha Rai",
      phone: "9800000000",
      risk: "Routine",
      priorVisitedClinic: true,
      candidateSetVersion: emptyCandidateVersion("9800000000"),
    },
    "client-create-key-0003",
    actor,
  );

  assert.equal(result.identityReview?.status, "Pending");
  assert.equal(reviewData?.reason, "PriorVisitClaim");
  assert.deepEqual(result.identityReview?.triggers, ["prior_visit_claim"]);
});

test("new phone append stores a secondary phone and redacts the full number from audit metadata", async () => {
  let phoneData: Record<string, unknown> | undefined;
  let auditData: Record<string, unknown> | undefined;
  const tx = {
    customer: { count: async () => 1 },
    clientPhone: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        phoneData = data;
        return {
          id: "phone-b",
          rawValue: data.rawValue,
          type: data.type,
          label: data.label ?? null,
          isPrimary: data.isPrimary,
          verificationStatus: "Unverified",
          createdAt: new Date("2030-01-01T00:00:00.000Z"),
        };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditData = data;
        return {};
      },
    },
  };
  const service = new ClientsV1Service(
    {
      customer: { findFirst: async () => ({ id: "client-a" }) },
      clientPhone: { findFirst: async () => null },
      $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    } as never,
    { requireSession: async () => actor } as never,
  );

  const result = await service.appendPhone(
    "client-a",
    { phone: "9812345678", type: "Guardian", reason: "Booking intake" },
    actor,
  );

  assert.equal(result.added, true);
  assert.equal(phoneData?.isPrimary, false);
  assert.equal(phoneData?.normalizedValue, "9779812345678");
  assert.equal(JSON.stringify(auditData).includes("9812345678"), false);
  assert.equal(JSON.stringify(auditData).includes("5678"), true);
});

test("identity review resolution uses compare-and-swap versioning", async () => {
  const manager = { ...actor, role: "Manager", effectiveRoles: ["Manager"] };
  let updateWhere: Record<string, unknown> | undefined;
  const tx = {
    clientIdentityReview: {
      updateMany: async ({ where }: { where: Record<string, unknown> }) => {
        updateWhere = where;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({
        id: "review-a",
        status: "Resolved",
        version: 2,
        resolution: "confirmed_distinct",
        resolvedAt: new Date("2030-01-02T00:00:00.000Z"),
      }),
    },
    auditLog: { create: async () => ({}) },
  };
  const service = new ClientsV1Service(
    {
      $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    } as never,
    { requireSession: async () => manager } as never,
  );

  const result = await service.resolveIdentityReview(
    "review-a",
    { expectedVersion: 1, resolution: "confirmed_distinct", reason: "Household members confirmed" },
    manager,
  );

  assert.equal(updateWhere?.organizationId, "clinic-a");
  assert.equal(updateWhere?.version, 1);
  assert.equal(result.version, 2);
});

test("exact number candidates cannot be crowded out by recent name matches", async () => {
  let queryCount = 0;
  const exact = {
    id: "client-exact",
    patientCode: "CL-000099",
    fullName: "Older Exact Client",
    phone: "9800000000",
    normalizedPhone: "9779800000000",
    lastVisitAt: null,
    updatedAt: new Date("2020-01-01T00:00:00.000Z"),
    phones: [],
  };
  const service = new ClientsV1Service(
    {
      customer: {
        findMany: async () => {
          queryCount += 1;
          return queryCount === 1
            ? [exact]
            : [{
                ...exact,
                id: "client-name",
                fullName: "Asha Rai",
                phone: "9811111111",
                normalizedPhone: "9779811111111",
                updatedAt: new Date("2030-01-01T00:00:00.000Z"),
              }];
        },
      },
    } as never,
    { requireSession: async () => actor } as never,
  );

  const result = await service.numberMatches(
    { phone: "9800000000", name: "Asha Rai" },
    actor,
  );

  assert.equal(result.matches[0]?.client.id, "client-exact");
  assert.equal(result.matches[0]?.classification, "possible");
  assert.equal(result.matches[1]?.client.id, "client-name");
});

test("administrative phone correction preserves the old primary as history", async () => {
  const phoneUpdates: Array<Record<string, unknown>> = [];
  const phoneCreates: Array<Record<string, unknown>> = [];
  const tx = {
    clientPhone: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        "normalizedValue" in where ? null : { id: "phone-old" },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        phoneUpdates.push(data);
        return {};
      },
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        phoneCreates.push(data);
        return {};
      },
    },
    customer: {
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => ({ ...clientRow, phone: "9812345678" }),
    },
    auditLog: { create: async () => ({}) },
  };
  const service = new ClientsV1Service(
    {
      customer: { findFirst: async () => clientRow },
      $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    } as never,
    { requireSession: async () => actor } as never,
  );

  await service.update(
    "client-a",
    { name: "Asha Rai", phone: "9812345678", risk: "Routine" },
    actor,
  );

  assert.deepEqual(phoneUpdates, [{ isPrimary: false }]);
  assert.equal(phoneCreates[0]?.normalizedValue, "9779812345678");
  assert.equal(phoneCreates[0]?.isPrimary, true);
});

test("non-existing identity resolutions reject a contradictory resolved Client", async () => {
  const manager = { ...actor, role: "Manager", effectiveRoles: ["Manager"] };
  const service = new ClientsV1Service(
    {} as never,
    { requireSession: async () => manager } as never,
  );

  await assert.rejects(
    service.resolveIdentityReview(
      "review-a",
      {
        expectedVersion: 1,
        resolution: "confirmed_distinct",
        resolvedClientId: "client-a",
        reason: "Distinct person",
      },
      manager,
    ),
    /allowed only when confirming an existing identity/,
  );
});

test("generic duplicate matching preserves an older exact phone candidate and treats phone-only evidence as weak", async () => {
  const queries: Array<Record<string, unknown>> = [];
  const exact = {
    ...clientRow,
    id: "client-exact",
    fullName: "Different Household Member",
    normalizedPhone: "9779800000000",
    phones: [],
  };
  const service = new ClientsV1Service(
    {
      customer: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          queries.push(where);
          return "OR" in where ? [exact] : [];
        },
      },
    } as never,
    { requireSession: async () => actor } as never,
  );

  const result = await service.match(
    { name: "New Household Member", phone: "9800000000" },
    actor,
  );

  assert.equal(result.matches[0]?.client.id, "client-exact");
  assert.equal(result.matches[0]?.confidence, "weak");
  assert.ok("OR" in queries[0]!);
});
