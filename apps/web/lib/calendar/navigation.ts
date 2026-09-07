import { shiftAdDateKey } from "./conversion";

export type CalendarNavigationKey =
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "End"
  | "Home"
  | "PageDown"
  | "PageUp";

export function moveCalendarFocus(
  adDateKey: string,
  key: CalendarNavigationKey,
) {
  switch (key) {
    case "ArrowDown":
      return shiftAdDateKey(adDateKey, 7);
    case "ArrowLeft":
      return shiftAdDateKey(adDateKey, -1);
    case "ArrowRight":
      return shiftAdDateKey(adDateKey, 1);
    case "ArrowUp":
      return shiftAdDateKey(adDateKey, -7);
    case "Home":
      return shiftAdDateKey(adDateKey, -dayOfWeek(adDateKey));
    case "End":
      return shiftAdDateKey(adDateKey, 6 - dayOfWeek(adDateKey));
    case "PageDown":
      return shiftMonthPreservingDay(adDateKey, 1);
    case "PageUp":
      return shiftMonthPreservingDay(adDateKey, -1);
  }
}

export function isDateKeyWithinBounds(
  adDateKey: string,
  min?: string,
  max?: string,
) {
  return (!min || adDateKey >= min) && (!max || adDateKey <= max);
}

function dayOfWeek(adDateKey: string) {
  return new Date(`${adDateKey}T00:00:00.000Z`).getUTCDay();
}

function shiftMonthPreservingDay(adDateKey: string, months: number) {
  const [year, month, day] = adDateKey.split("-").map(Number);
  const targetMonth = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  return [
    targetMonth.getUTCFullYear(),
    String(targetMonth.getUTCMonth() + 1).padStart(2, "0"),
    String(clampedDay).padStart(2, "0"),
  ].join("-");
}
