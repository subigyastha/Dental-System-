import { NepaliDate } from "nepali-date-library";

import type { CalendarGrid, CalendarGridCell, CalendarMode } from "./types";
import { adDateKeyToBsDateKey, bsDateKeyToAdDateKey, shiftAdMonth, shiftBsMonth } from "./conversion";
import { formatMonthYear, getDualCalendarDay } from "./format";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toBsDateKey(year: number, monthIndex: number, day: number) {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

function toAdDateKey(year: number, monthIndex: number, day: number) {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

function buildAdMonthGrid(anchorAdDateKey: string): CalendarGrid {
  const [year, month] = anchorAdDateKey.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - first.getUTCDay());

  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const adDateKey = toAdDateKey(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    );
    return {
      adDateKey,
      bsDateKey: adDateKeyToBsDateKey(adDateKey),
      inCurrentMonth: date.getUTCMonth() === month - 1,
      dual: getDualCalendarDay(adDateKey),
    } satisfies CalendarGridCell;
  });

  return {
    mode: "AD",
    anchorAdDateKey,
    primaryMonthLabel: formatMonthYear(anchorAdDateKey, "AD"),
    secondaryMonthLabel: formatMonthYear(anchorAdDateKey, "BS"),
    cells,
  };
}

function buildBsMonthGrid(anchorAdDateKey: string): CalendarGrid {
  const bsDate = new NepaliDate(adDateKeyToBsDateKey(anchorAdDateKey));
  const year = bsDate.getYear();
  const month = bsDate.getMonth();
  const calendarDays = NepaliDate.getCalendarDays(year, month);

  const prevCells = calendarDays.prevMonth.days.map((day) => ({
    bsYear: calendarDays.prevMonth.year,
    bsMonth: calendarDays.prevMonth.month,
    day,
    inCurrentMonth: false,
  }));
  const currentCells = calendarDays.currentMonth.days.map((day) => ({
    bsYear: year,
    bsMonth: month,
    day,
    inCurrentMonth: true,
  }));
  const nextCells = calendarDays.nextMonth.days.map((day) => ({
    bsYear: calendarDays.nextMonth.year,
    bsMonth: calendarDays.nextMonth.month,
    day,
    inCurrentMonth: false,
  }));

  const cells = [...prevCells, ...currentCells, ...nextCells].map((cell) => {
    const bsDateKey = toBsDateKey(cell.bsYear, cell.bsMonth, cell.day);
    const adDateKey = bsDateKeyToAdDateKey(bsDateKey);
    return {
      adDateKey,
      bsDateKey,
      inCurrentMonth: cell.inCurrentMonth,
      dual: getDualCalendarDay(adDateKey),
    } satisfies CalendarGridCell;
  });

  return {
    mode: "BS",
    anchorAdDateKey,
    primaryMonthLabel: `${NepaliDate.getMonthName(month, false, false)} ${year}`,
    secondaryMonthLabel: formatMonthYear(anchorAdDateKey, "AD"),
    cells,
  };
}

export function buildCalendarGrid(anchorAdDateKey: string, mode: CalendarMode) {
  return mode === "BS"
    ? buildBsMonthGrid(anchorAdDateKey)
    : buildAdMonthGrid(anchorAdDateKey);
}

export function shiftCalendarPage(anchorAdDateKey: string, mode: CalendarMode, months: number) {
  return mode === "BS"
    ? shiftBsMonth(anchorAdDateKey, months)
    : shiftAdMonth(anchorAdDateKey, months);
}
