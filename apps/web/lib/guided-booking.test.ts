import assert from "node:assert/strict";
import test from "node:test";

import {
  createGuidedBookingDraft,
  findSelectedBookingSlot,
  isSameBookingTime,
  isSearchablePhone,
  isSameClientIntakeIdentity,
  maskPhone,
  needsMatchReview,
  resolveBookingConfirmationAttempt,
} from "./guided-booking";

const confirmationPayload = {
  draftId: "draft-a", locationId: "clinic-a", providerId: "provider-a", serviceId: "service-a",
  startsAtIso: "2030-01-01T04:15:00.000Z", holdId: "original-expired-hold", priority: "Normal" as const,
  client: { mode: "existing" as const, clientId: "client-a" },
};

test("an uncertain confirmation replays its original key and payload despite changed form content", () => {
  let keysCreated = 0;
  const createKey = () => `confirmation-${++keysCreated}`;
  const original = resolveBookingConfirmationAttempt(null, confirmationPayload, createKey);
  const pending = { ...original, uncertain: true };
  const changed = { ...confirmationPayload, startsAtIso: "2030-01-01T04:30:00.000Z", holdId: "new-hold", client: { mode: "existing" as const, clientId: "different-client" } };
  const retry = resolveBookingConfirmationAttempt(pending, changed, createKey);
  assert.equal(retry, pending);
  assert.equal(retry.payload, confirmationPayload);
  assert.equal(retry.payload.holdId, "original-expired-hold");
  assert.equal(retry.idempotencyKey, original.idempotencyKey);
  assert.equal(keysCreated, 1);
});

test("settled confirmation attempts reuse unchanged content and allow a fresh key for edited bookings", () => {
  let keysCreated = 0;
  const createKey = () => `confirmation-${++keysCreated}`;
  const original = resolveBookingConfirmationAttempt(null, confirmationPayload, createKey);
  assert.equal(resolveBookingConfirmationAttempt(original, { ...confirmationPayload }, createKey), original);
  const changed = resolveBookingConfirmationAttempt(original, { ...confirmationPayload, priority: "Urgent" }, createKey);
  assert.notEqual(changed.idempotencyKey, original.idempotencyKey);
  assert.equal(changed.payload.priority, "Urgent");
  assert.equal(changed.uncertain, false);
  assert.equal(keysCreated, 2);
});

test("guided booking draft preserves safe launch references", () => {
  const draft = createGuidedBookingDraft(
    {
      refs: {
        providerId: "provider-1",
        date: "2026-07-25",
        slotIso: "2026-07-25T04:15:00.000Z",
      },
    },
    "2026-07-26",
  );

  assert.equal(draft.providerId, "provider-1");
  assert.equal(draft.date, "2026-07-25");
  assert.equal(draft.selectedSlotIso, "2026-07-25T04:15:00.000Z");
  assert.equal(draft.path, "slot-first");
});

test("Schedule offset times match UTC availability, including a later selected slot", () => {
  const startsAtIso = "2026-10-01T09:15:00.000Z";
  const slot = { startsAtIso, slotId: "later-slot", time: "15:00", timeLabel: "15:00", dateKey: "2026-10-01", rank: 12, rankReason: "later" as const, recommended: false };
  assert.equal(isSameBookingTime("2026-10-01T15:00:00+05:45", startsAtIso), true);
  assert.equal(findSelectedBookingSlot([slot], "2026-10-01T15:00:00+05:45"), slot);
  assert.equal(findSelectedBookingSlot([slot], "2026-10-01T15:15:00+05:45"), undefined);
  assert.equal(isSameBookingTime("invalid", "invalid"), false);
});

test("phone search waits for seven digits", () => {
  assert.equal(isSearchablePhone("98-123"), false);
  assert.equal(isSearchablePhone("+977 981-2345"), true);
  assert.equal(isSearchablePhone("1234567890123456"), false);
});

test("stale intake responses cannot match an edited identity", () => {
  assert.equal(
    isSameClientIntakeIdentity(
      { name: "Asha Rai", phone: "+977 9812345678" },
      { name: "Asha Rai", phone: "+977 9812345678" },
    ),
    true,
  );
  assert.equal(
    isSameClientIntakeIdentity(
      { name: "Asha Rai", phone: "+977 9812345679" },
      { name: "Asha Rai", phone: "+977 9812345678" },
    ),
    false,
  );
});

test("possible matches require an explicit review for a new Client", () => {
  const draft = createGuidedBookingDraft();
  draft.newClient = {
    name: "Sam Client",
    phone: "9812345678",
    address: "",
    priorVisitedClinic: true,
  };
  draft.numberMatchResult = {
    classification: "possible",
    candidateSetVersion: "candidate-v1",
    matches: [
      {
        classification: "possible",
        matchedOn: ["phone"],
        client: {
          id: "client-1",
          clientCode: "CL-001",
          name: "Sam Client",
          phoneSummaries: [],
          lastVisitIso: null,
        },
      },
    ],
  };

  assert.equal(needsMatchReview(draft), true);
  draft.selectedClient = draft.numberMatchResult.matches[0].client;
  assert.equal(needsMatchReview(draft), false);
});

test("masked phone retains only a short identifying suffix", () => {
  assert.equal(maskPhone("9812345678"), "981•••5678");
});
