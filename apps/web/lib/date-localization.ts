export {
  adDateKeyToBsDateKey as adToBs,
  bsDateKeyToAdDateKey as bsToAd,
  dateKeyInTimeZone,
  formatDateLabel,
  formatDayShort,
  formatTime,
  getDualCalendarDay,
  toDateKey,
} from "@/lib/calendar";

export function minutesToLabel(minutes: number) {
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
