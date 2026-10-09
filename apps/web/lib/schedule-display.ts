import type { Appointment, ProviderDayScheduleGrid } from "./domain";
import { toDateKey } from "./calendar";

export type ScheduleSlot =
  ProviderDayScheduleGrid["providers"][number]["slots"][number];

export type ScheduleSlotGroup = {
  /** The original first cell, including its API occupancy end and booking state. */
  slot: ScheduleSlot;
  /** Zero-based row in slotStarts, or the provider's sorted starts when omitted. */
  startRow: number;
  rowSpan: number;
};

export type ScheduleDisplayGroup = Omit<ScheduleSlotGroup, "slot"> & {
  slot: Omit<ScheduleSlot, "state"> & {
    state: ScheduleSlot["state"] | "HISTORY";
  };
};

/** Historical records are a display layer; the original capacity slots never change. */
export function buildDayTimeline(
  slots: readonly ScheduleSlot[],
  appointments: Iterable<Appointment>,
  providerId: string,
  dateKey: string,
  slotStarts = slots.map((slot) => slot.startTime).sort(),
) {
  const groups: ScheduleDisplayGroup[] = groupScheduleSlots(
    slots,
    slotStarts,
  ).filter((group) => group.slot.state === "BOOKED");
  // A conservative occupied grid may arrive before its updated lifecycle record.
  const historyIds = new Set(
    groups
      .map((group) => group.slot.appointmentId)
      .filter((id): id is string => !!id),
  );
  for (const appointment of appointments) {
    if (
      appointment.providerId !== providerId ||
      !["Completed", "NoShow", "Cancelled"].includes(appointment.status) ||
      !Number.isFinite(Date.parse(appointment.startsAtIso)) ||
      !Number.isFinite(appointment.durationMinutes) ||
      appointment.durationMinutes <= 0 ||
      toDateKey(appointment.startsAtIso) !== dateKey ||
      historyIds.has(appointment.id)
    )
      continue;
    const start = Date.parse(appointment.startsAtIso);
    const end = start + appointment.durationMinutes * 60_000;
    const rows = slotStarts
      .map((time, row) => ({ time: Date.parse(time), row }))
      .filter(
        ({ time }, index, all) =>
          time < end && (all[index + 1]?.time ?? time + 15 * 60_000) > start,
      );
    if (!rows.length) continue;
    historyIds.add(appointment.id);
    groups.push({
      startRow: rows[0].row,
      rowSpan: rows.length,
      slot: {
        startTime: appointment.startsAtIso,
        endTime: new Date(end).toISOString(),
        state: "HISTORY",
        appointmentId: appointment.id,
      },
    });
  }
  // Overlapping records use separate lanes, so a replacement cannot cover history.
  const laneEnds: number[] = [];
  const records = groups
    .sort(
      (a, b) =>
        a.startRow - b.startRow ||
        Number(a.slot.state === "HISTORY") -
          Number(b.slot.state === "HISTORY") ||
        (a.slot.appointmentId ?? "").localeCompare(b.slot.appointmentId ?? ""),
    )
    .map((group) => {
      let lane = laneEnds.findIndex((end) => end <= group.startRow);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = group.startRow + group.rowSpan;
      return { group, lane };
    });
  return { records, laneCount: Math.max(1, laneEnds.length) };
}

/** A time overlap is a display hint, not a permanent replacement relationship. */
export function cancelledVisitsInTime(
  appointment: Appointment,
  appointments: Iterable<Appointment>,
) {
  if (appointment.status === "Cancelled") return [];
  const start = Date.parse(appointment.startsAtIso);
  const end = start + appointment.durationMinutes * 60_000;
  return [...appointments].filter(
    (previous) =>
      previous.id !== appointment.id &&
      previous.providerId === appointment.providerId &&
      previous.organizationId === appointment.organizationId &&
      previous.status === "Cancelled" &&
      Date.parse(previous.startsAtIso) < end &&
      Date.parse(previous.startsAtIso) + previous.durationMinutes * 60_000 >
        start,
  );
}

export function replacementCancellationNote(
  appointment: Appointment,
  appointments: Iterable<Appointment>,
) {
  const cancelled = cancelledVisitsInTime(appointment, appointments);
  const active = ["Scheduled", "Confirmed", "CheckedIn", "InProgress"].includes(appointment.status);
  return cancelled.length
    ? `${active ? "Rebooked time" : "Cancellation history"} · ${cancelled.length} ${active ? "prior cancellation" : "cancelled visit"}${cancelled.length === 1 ? "" : "s"}: ${cancelled.map((previous) => previous.cancellationReason || "Reason not recorded").join("; ")}`
    : undefined;
}

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
    (slotStarts ?? ordered.map((slot) => slot.startTime)).map(
      (start, index) => [start, index],
    ),
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
      group &&
      previous &&
      slot.state === "BOOKED" &&
      previous.state === "BOOKED" &&
      Boolean(slot.appointmentId?.trim()) &&
      slot.appointmentId === previous.appointmentId &&
      startRow === group.startRow + group.rowSpan &&
      Date.parse(slot.startTime) - Date.parse(previous.startTime) > 0 &&
      Date.parse(slot.startTime) - Date.parse(previous.startTime) <=
        intervalMinutes * 60_000;

    if (canMerge) {
      group.rowSpan += 1;
    } else {
      groups.push({ slot, startRow, rowSpan: 1 });
    }
    previous = slot;
  }

  return groups;
}
