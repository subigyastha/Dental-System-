import { NepaliDate } from "nepali-date-library";

import { NEPAL_TIME_ZONE } from "./calendarMode";
import type { CalendarMode, DualCalendarDay } from "./types";
import { adDateKeyToBsDateKey, toDateKey } from "./conversion";

const adLongFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NEPAL_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});

const adShortFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NEPAL_TIME_ZONE,
  month: "short",
  day: "numeric",
});

const adMonthYearFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NEPAL_TIME_ZONE,
  month: "short",
  year: "numeric",
});

const adTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NEPAL_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function asNepalDate(adDateKey: string) {
  return new Date(`${adDateKey}T00:00:00+05:45`);
}

export function getDualCalendarDay(adDateKey: string): DualCalendarDay {
  const date = asNepalDate(adDateKey);
  const bsDateKey = adDateKeyToBsDateKey(adDateKey);
  const bsDate = new NepaliDate(bsDateKey);

  const adYear = date.getUTCFullYear();
  const adMonthNumber = date.getUTCMonth() + 1;
  const adDay = date.getUTCDate();
  const bsYear = bsDate.getYear();
  const bsMonthNumber = bsDate.getMonth() + 1;
  const bsDay = bsDate.getDate();
  const bsMonth = NepaliDate.getMonthName(bsDate.getMonth(), false, false);
  const bsShortMonth = NepaliDate.getMonthName(bsDate.getMonth(), true, false);

  return {
    adDateKey,
    bsDateKey,
    adYear,
    adMonthNumber,
    adDay,
    adMonth: adMonthYearFormatter.format(date).split(" ")[0] ?? "AD",
    adShortMonth: adShortFormatter.format(date).split(" ")[0] ?? "AD",
    bsYear,
    bsMonthNumber,
    bsDay,
    bsMonth,
    bsShortMonth,
    adDate: adLongFormatter.format(date),
    adShort: adShortFormatter.format(date),
    adLabel: adShortFormatter.format(date),
    bsDate: `${bsMonth} ${bsDay}, ${bsYear}`,
    bsShort: `${bsShortMonth} ${bsDay}`,
    bsLabel: `${bsMonth} ${bsDay}`,
  };
}

export function formatDateLabel(iso: string, mode: CalendarMode) {
  const dual = getDualCalendarDay(toDateKey(iso));
  return mode === "BS"
    ? `${dual.bsDate} / ${dual.adDate}`
    : `${dual.adDate} / ${dual.bsDate}`;
}

export function formatDayShort(iso: string, mode: CalendarMode) {
  const dual = getDualCalendarDay(toDateKey(iso));
  return mode === "BS" ? dual.bsShort : dual.adShort;
}

export function formatTime(iso: string) {
  return adTimeFormatter.format(new Date(iso));
}

export function formatMonthYear(adDateKey: string, mode: CalendarMode) {
  const dual = getDualCalendarDay(adDateKey);
  return mode === "BS"
    ? `${dual.bsMonth} ${dual.bsYear}`
    : adMonthYearFormatter.format(asNepalDate(adDateKey));
}
