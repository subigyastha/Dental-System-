import assert from "node:assert/strict";
import test from "node:test";

import {
  createGuidedBookingDraft,
  isSearchablePhone,
  isSameClientIntakeIdentity,
  maskPhone,
  needsMatchReview,
} from "./guided-booking";

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
