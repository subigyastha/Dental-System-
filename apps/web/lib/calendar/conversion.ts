import { ADtoBS, BStoAD, NepaliDate } from "nepali-date-library";

import { NEPAL_TIME_ZONE, NEPAL_UTC_OFFSET } from "./calendarMode";
import type { CalendarMode } from "./types";
import {
  isValidAdDateKey,
  isValidBsDateKey,
  normalizeAdDateKey,
  normalizeBsDateKey,
  normalizeDateInput,
} from "./validation";

function partsFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function dateKeyInTimeZone(timeZone: string, date: Date = new Date()) {
  return partsFormatter(timeZone).format(date);
}

export function adDateKeyToBsDateKey(adDateKey: string) {
  return ADtoBS(normalizeAdDateKey(adDateKey));
}

export function bsDateKeyToAdDateKey(bsDateKey: string) {
  return BStoAD(normalizeBsDateKey(bsDateKey));
}

export function toDateKey(iso: string) {
  return dateKeyInTimeZone(NEPAL_TIME_ZONE, new Date(iso));
}

export function normalizeCalendarInputToAdDateKey(
  value: string,
  mode: CalendarMode,
) {
  const normalized = normalizeDateInput(value);
  if (mode === "BS") {
    return isValidBsDateKey(normalized) ? bsDateKeyToAdDateKey(normalized) : null;
  }

  return isValidAdDateKey(normalized) ? normalizeAdDateKey(normalized) : null;
}

export function buildNepalIsoFromDateAndTime(adDateKey: string, time: string) {
  const normalizedDateKey = normalizeAdDateKey(adDateKey);
  const normalizedTime = time.trim().slice(0, 5);
  return new Date(`${normalizedDateKey}T${normalizedTime}:00${NEPAL_UTC_OFFSET}`).toISOString();
}

export function getNepalDayOfWeekFromAdDateKey(adDateKey: string) {
  return new Date(`${normalizeAdDateKey(adDateKey)}T12:00:00${NEPAL_UTC_OFFSET}`).getUTCDay();
}

export function getMinutesInNepalFromIso(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NEPAL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export function shiftAdDateKey(adDateKey: string, days: number) {
  const [year, month, day] = normalizeAdDateKey(adDateKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function shiftAdMonth(adDateKey: string, months: number) {
  const date = new Date(`${normalizeAdDateKey(adDateKey)}T00:00:00${NEPAL_UTC_OFFSET}`);
  date.setUTCMonth(date.getUTCMonth() + months, 1);
  return date.toISOString().slice(0, 10);
}

export function shiftBsMonth(adDateKey: string, months: number) {
  const currentBs = new NepaliDate(adDateKeyToBsDateKey(adDateKey));
  const shifted = currentBs.startOfMonth().addMonths(months);
  const bsDateKey = `${shifted.getYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}-${String(shifted.getDate()).padStart(2, "0")}`;
  return bsDateKeyToAdDateKey(bsDateKey);
}
