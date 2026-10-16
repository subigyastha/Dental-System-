export const followupResponses = {
  reached: "Reached — no further action",
  no_answer: "No answer",
  contact_later: "Asked to contact later",
  appointment_needed: "Appointment needed",
  provider_attention: "Needs provider attention",
  not_needed: "Follow-up not needed",
  reschedule: "Change follow-up date",
} as const;
export type FollowupResponse = keyof typeof followupResponses;
export type FollowupDraft = { response: FollowupResponse | ""; note: string; date: string; time: string; nextRecallDate: string };

export function clinicDateTime(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

export function contactPreset(preset: "today" | "tomorrow", now = new Date()) {
  return clinicDateTime(new Date(now.getTime() + (preset === "today" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000)));
}

export function buildFollowupResponse(draft: FollowupDraft, requestId: string, expectedUpdatedAtIso: string, type: string, now = new Date()) {
  if (!draft.response) throw new Error("Choose the client's response.");
  if (["provider_attention", "not_needed"].includes(draft.response) && !draft.note.trim()) throw new Error("Enter a brief reason.");
  const waiting = ["no_answer", "contact_later", "reschedule"].includes(draft.response);
  let nextContactAtIso: string | undefined;
  if (waiting) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) throw new Error("Choose the next contact date and time.");
    const date = new Date(`${draft.date}T${draft.time}:00+05:45`);
    if (Number.isNaN(date.getTime()) || clinicDateTime(date).date !== draft.date || date <= now) throw new Error("Choose a future contact time, including for later today.");
    nextContactAtIso = date.toISOString();
  }
  const finished = ["reached", "not_needed"].includes(draft.response);
  let nextRecallAtIso: string | undefined;
  if (type === "Recall" && finished && draft.nextRecallDate) {
    const date = new Date(`${draft.nextRecallDate}T00:00:00+05:45`);
    if (Number.isNaN(date.getTime()) || clinicDateTime(date).date !== draft.nextRecallDate || date <= now) throw new Error("Choose a future next routine recall date.");
    nextRecallAtIso = date.toISOString();
  }
  return { response: draft.response, note: draft.note.trim(), requestId, expectedUpdatedAtIso, ...(nextContactAtIso ? { nextContactAtIso } : {}), ...(nextRecallAtIso ? { nextRecallAtIso } : {}) };
}
