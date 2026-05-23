import type { CalendarMode } from "./types";

export const CALENDAR_MODES = ["BS", "AD"] as const satisfies readonly CalendarMode[];
export const DEFAULT_CALENDAR_MODE: CalendarMode = "BS";
export const NEPAL_TIME_ZONE = "Asia/Kathmandu";
export const NEPAL_UTC_OFFSET = "+05:45";
