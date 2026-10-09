import type { ProviderDayScheduleGrid } from "./domain";

export type ScheduleSlot = ProviderDayScheduleGrid["providers"][number]["slots"][number];

export type ScheduleSlotGroup = {
  /** The original first cell, including its API occupancy end and booking state. */
  slot: ScheduleSlot;
  /** Zero-based row in slotStarts, or the provider's sorted starts when omitted. */
  startRow: number;
  rowSpan: number;
};

/** Call separately for each provider. Only consecutive booked cells can merge. */
export function groupScheduleSlots(
  slots: readonly ScheduleSlot[],
  slotStarts?: readonly string[],
  intervalMinutes = 15,
): ScheduleSlotGroup[] {
  const ordered = [...slots].sort(
    (left, right) => Date.parse(left.startTime) - Date.parse(right.startTime),
  );
  const rows = new Map(
    (slotStarts ?? ordered.map((slot) => slot.startTime)).map((start, index) => [start, index]),
  );
  const groups: ScheduleSlotGroup[] = [];
  let previous: ScheduleSlot | undefined;

  for (const slot of ordered) {
    const startRow = rows.get(slot.startTime);
    if (startRow === undefined) {
      previous = undefined;
      continue;
    }
    const group = groups.at(-1);
    const canMerge =
      group && previous &&
      slot.state === "BOOKED" && previous.state === "BOOKED" &&
      Boolean(slot.appointmentId?.trim()) &&
      slot.appointmentId === previous.appointmentId &&
      startRow === group.startRow + group.rowSpan &&
      Date.parse(slot.startTime) - Date.parse(previous.startTime) === intervalMinutes * 60_000;

    if (canMerge) {
      group.rowSpan += 1;
    } else {
      groups.push({ slot, startRow, rowSpan: 1 });
    }
    previous = slot;
  }

  return groups;
}
