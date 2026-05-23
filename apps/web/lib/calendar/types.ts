export type CalendarMode = "BS" | "AD";

export type DualCalendarDay = {
  adDateKey: string;
  bsDateKey: string;
  adYear: number;
  adMonthNumber: number;
  adDay: number;
  adMonth: string;
  adShortMonth: string;
  bsYear: number;
  bsMonthNumber: number;
  bsDay: number;
  bsMonth: string;
  bsShortMonth: string;
  adDate: string;
  adShort: string;
  adLabel: string;
  bsDate: string;
  bsShort: string;
  bsLabel: string;
};

export type CalendarGridCell = {
  adDateKey: string;
  bsDateKey: string;
  inCurrentMonth: boolean;
  dual: DualCalendarDay;
};

export type CalendarGrid = {
  mode: CalendarMode;
  anchorAdDateKey: string;
  primaryMonthLabel: string;
  secondaryMonthLabel: string;
  cells: CalendarGridCell[];
};
