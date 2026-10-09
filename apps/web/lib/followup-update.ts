import { isValidAdDateKey } from "./calendar/validation";

export function buildFollowupUpdate(status: "Done" | "Open", outcome: string, date: string) {
  if (!outcome.trim()) throw new Error("Enter the call outcome or next action.");
  if ((status === "Open" || date) && !isValidAdDateKey(date)) {
    throw new Error("Choose a valid follow-up date.");
  }
  return { status, outcome: outcome.trim(), ...(date ? { dueAtIso: date + "T00:00:00+05:45" } : {}) };
}
