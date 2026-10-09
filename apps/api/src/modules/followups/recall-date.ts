export const routineRecallAction = "Call the client to arrange their next check-up. Adjust the date for their care plan.";
export const recurringRecallAction = "Call the client for their next routine recall.";

/** Six calendar months in Nepal, clamped for shorter target months. */
export function defaultRecallDate(completedAt: Date) {
  const local = new Date(completedAt.getTime() + 345 * 60_000);
  const target = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 6, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(local.getUTCDate(), lastDay));
  // A recall date is actionable from the start of that clinic day.
  return new Date(target.getTime() - 345 * 60_000);
}
