const NEPAL_TIME_ZONE = "Asia/Kathmandu";
const NEPAL_UTC_OFFSET = "+05:45";

const nepalDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: NEPAL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const nepalTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NEPAL_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function getPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function getNepalAdDateKeyFromIso(iso: string) {
  const parts = nepalDateFormatter.formatToParts(new Date(iso));
  const year = getPart(parts, "year");
  const month = getPart(parts, "month");
  const day = getPart(parts, "day");
  return `${year}-${month}-${day}`;
}

export function getNepalDayOfWeekFromIso(iso: string) {
  return new Date(
    `${getNepalAdDateKeyFromIso(iso)}T12:00:00${NEPAL_UTC_OFFSET}`,
  ).getUTCDay();
}

export function getNepalMinutesFromIso(iso: string) {
  const parts = nepalTimeFormatter.formatToParts(new Date(iso));
  const hour = Number(getPart(parts, "hour") || "0");
  const minute = Number(getPart(parts, "minute") || "0");
  return hour * 60 + minute;
}

export function inputTimeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTimeLabel(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function buildNepalIsoFromDateAndTime(dateKey: string, time: string) {
  return `${dateKey}T${time}:00${NEPAL_UTC_OFFSET}`;
}

export function getNepalDayRangeFromDateKey(dateKey: string) {
  return {
    startsAt: new Date(`${dateKey}T00:00:00${NEPAL_UTC_OFFSET}`),
    endsAt: new Date(`${dateKey}T23:59:59.999${NEPAL_UTC_OFFSET}`),
  };
}

export { NEPAL_TIME_ZONE, NEPAL_UTC_OFFSET };
