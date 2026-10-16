import { clinicDateTime } from "./followup-work";

export function staffFollowupDate(date: string, time: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new Error("Choose a valid date and optional time.");
  const value = new Date(`${date}T${time || "00:00"}:00+05:45`);
  if (Number.isNaN(value.getTime()) || clinicDateTime(value).date !== date || date < clinicDateTime(now).date || (time && value <= now)) throw new Error("Choose today or a future date; a specific time must be in the future.");
  return { dueAtIso: value.toISOString(), dateOnly: !time };
}

export function contactAge(value: string | null, now = new Date()) {
  if (!value) return "Not recorded";
  const today = new Date(clinicDateTime(now).date + "T00:00:00+05:45");
  const day = new Date(clinicDateTime(new Date(value)).date + "T00:00:00+05:45");
  const days = Math.floor((today.getTime() - day.getTime()) / 86400000);
  if (days < 0) return "Future date";
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
}

export const followupDateLabel = (value: string, dateOnly?: boolean | null) => new Intl.DateTimeFormat("en-NP", { timeZone: "Asia/Kathmandu", dateStyle: "medium", ...(dateOnly === true || (dateOnly !== false && clinicDateTime(new Date(value)).time === "00:00") ? {} : { timeStyle: "short" as const }) }).format(new Date(value));
