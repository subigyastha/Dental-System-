import type { CalendarGrid, CalendarMode } from "./types";
import {
  adDateKeyToBsDateKey,
  bsDateKeyToAdDateKey,
  shiftAdDateKey,
  shiftAdMonth,
  shiftBsMonth,
} from "./conversion";
import { formatMonthYear, getDualCalendarDay } from "./format";

/** Both calendars share civil-date arithmetic, independent of the device timezone. */
export function buildCalendarGrid(anchorAdDateKey: string, mode: CalendarMode): CalendarGrid {
  const primaryDateKey = mode === "BS"
    ? adDateKeyToBsDateKey(anchorAdDateKey)
    : anchorAdDateKey;
  const primaryMonth = primaryDateKey.slice(0, 7);
  const firstPrimaryDate = `${primaryMonth}-01`;
  const firstAdDate = mode === "BS"
    ? bsDateKeyToAdDateKey(firstPrimaryDate)
    : firstPrimaryDate;
  // The library's BS grid uses local Date.getDay(), shifting columns in some timezones.
  const weekday = new Date(`${firstAdDate}T12:00:00Z`).getUTCDay();
  const gridStart = shiftAdDateKey(firstAdDate, -weekday);
  const cells = Array.from({ length: 42 }, (_, index) => {
    const adDateKey = shiftAdDateKey(gridStart, index);
    const dual = getDualCalendarDay(adDateKey);
    return {
      adDateKey,
      bsDateKey: dual.bsDateKey,
      inCurrentMonth: (mode === "BS" ? dual.bsDateKey : adDateKey).slice(0, 7) === primaryMonth,
      dual,
    };
  });

  return {
    mode,
    anchorAdDateKey,
    primaryMonthLabel: formatMonthYear(anchorAdDateKey, mode),
    secondaryMonthLabel: formatMonthYear(anchorAdDateKey, mode === "BS" ? "AD" : "BS"),
    cells,
  };
}

export function shiftCalendarPage(anchorAdDateKey: string, mode: CalendarMode, months: number) {
  return mode === "BS"
    ? shiftBsMonth(anchorAdDateKey, months)
    : shiftAdMonth(anchorAdDateKey, months);
}
