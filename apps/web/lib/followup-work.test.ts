import assert from "node:assert/strict";
import test from "node:test";
import { buildFollowupResponse, clinicDateTime, contactPreset, type FollowupDraft } from "./followup-work";
import { loadBookingClientIdentity } from "./client-identity";

const now = new Date("2026-10-10T10:30:00+05:45");
const draft: FollowupDraft = { response: "no_answer", note: "", date: "2026-10-10", time: "14:00", nextRecallDate: "" };
const build = (changes: Partial<FollowupDraft> = {}, type = "TreatmentContinuation") => buildFollowupResponse({ ...draft, ...changes }, "request", now.toISOString(), type, now);

test("later-today retries use the clinic timezone and must be after now", () => {
  assert.equal(build().nextContactAtIso, "2026-10-10T08:15:00.000Z");
  assert.throws(() => build({ time: "10:30" }), /future contact time/);
  assert.throws(() => build({ time: "09:00" }), /future contact time/);
  assert.throws(() => build({ date: "2026-10-09" }), /future contact time/);
});

test("contact presets handle local midnight and year rollover", () => {
  assert.deepEqual(contactPreset("today", now), { date: "2026-10-10", time: "11:30" });
  assert.deepEqual(contactPreset("today", new Date("2026-12-31T23:30:00+05:45")), { date: "2027-01-01", time: "00:30" });
  assert.deepEqual(clinicDateTime(new Date("2026-10-09T18:15:00Z")), { date: "2026-10-10", time: "00:00" });
});

test("impossible dates and times fail instead of silently scheduling another day", () => {
  assert.throws(() => build({ date: "2026-02-30" }), /future contact time/);
  assert.throws(() => build({ time: "24:00" }), /date and time/);
  assert.throws(() => build({ date: "" }), /date and time/);
});

test("simple outcomes omit irrelevant draft dates and preserve plain optional notes", () => {
  const result = build({ response: "reached", date: "", note: "  <b>Doing well</b>  " });
  assert.equal(result.note, "<b>Doing well</b>");
  assert.equal(result.nextContactAtIso, undefined);
  assert.throws(() => build({ response: "" }), /Choose the client's response/);
});

test("provider attention and not-needed require a reason; next recall applies only to routine recalls", () => {
  assert.throws(() => build({ response: "provider_attention" }), /brief reason/);
  assert.throws(() => build({ response: "not_needed", note: " " }), /brief reason/);
  assert.equal(build({ response: "reached", nextRecallDate: "2027-04-10" }, "Recall").nextRecallAtIso, "2027-04-09T18:15:00.000Z");
  assert.equal(build({ response: "reached", nextRecallDate: "2027-04-10" }).nextRecallAtIso, undefined);
});

const existingClient = { id: "client/a", name: "Existing client", clientCode: "CL-1", phone: "9800000000", lastVisitIso: null, archivedAtIso: null, mergedIntoClientId: null, phoneSummaries: [] };
async function withClientResponse(client: unknown, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "/api/v1/clients/client%2Fa");
    return Response.json({ data: { client } });
  };
  try { await run(); } finally { globalThis.fetch = original; }
}

test("follow-up booking retrieves the exact selected active client and handles legacy phone records", async () => {
  await withClientResponse(existingClient, async () => {
    const client = await loadBookingClientIdentity(existingClient.id);
    assert.equal(client.id, existingClient.id); assert.equal(client.name, existingClient.name);
    assert.equal(client.phoneSummaries[0].displayValue, existingClient.phone);
  });
});

test("follow-up booking rejects archived, merged and mismatched client references", async () => {
  for (const changes of [{ archivedAtIso: "2026-10-10T00:00:00Z" }, { mergedIntoClientId: "another-client" }, { id: "another-client" }]) {
    await withClientResponse({ ...existingClient, ...changes }, async () => {
      await assert.rejects(loadBookingClientIdentity(existingClient.id), /no longer active/);
    });
  }
});

test("follow-up booking retains the verified primary contact summary", async () => {
  const phone = { id: "phone-a", displayValue: "9810000000", isPrimary: true, label: "Mobile" };
  await withClientResponse({ ...existingClient, phoneSummaries: [phone] }, async () => {
    assert.deepEqual((await loadBookingClientIdentity(existingClient.id)).phoneSummaries, [phone]);
  });
});
