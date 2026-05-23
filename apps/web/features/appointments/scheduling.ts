import { getMinutesInNepalFromIso, getNepalDayOfWeekFromAdDateKey, toDateKey } from "@/lib/calendar";
import type { Appointment, Provider, ScheduleBlock, Service } from "@/lib/domain";
import {
  BLOCKING_APPOINTMENT_STATUSES,
  DEFAULT_WORK_DAY_END,
  DEFAULT_WORK_DAY_START,
  SLOT_STEP_MINUTES,
} from "@/features/appointments/appointment.constants";

export type AvailableSlot = {
  provider: Provider;
  time: string;
  timeLabel: string;
};

export function hasAppointmentOverlap({
  appointments,
  blockedTimes = [],
  candidateEndMinutes,
  candidateStartMinutes,
  providerId,
  selectedDateKey,
}: {
  appointments: Appointment[];
  blockedTimes?: ScheduleBlock[];
  candidateEndMinutes: number;
  candidateStartMinutes: number;
  providerId: string;
  selectedDateKey?: string;
}) {
  const appointmentConflict = appointments
    .filter(
      (appointment) =>
        appointment.providerId === providerId &&
        BLOCKING_APPOINTMENT_STATUSES.has(appointment.status),
    )
    .some((appointment) => {
      const appointmentStart = minutesFromIso(appointment.startsAtIso);
      const appointmentEnd =
        appointmentStart + appointment.durationMinutes + appointment.bufferMinutes;
      return candidateStartMinutes < appointmentEnd && candidateEndMinutes > appointmentStart;
    });

  if (appointmentConflict) {
    return true;
  }

  if (!selectedDateKey) {
    return false;
  }

  return blockedTimes
    .filter(
      (block) =>
        block.providerId === providerId && toDateKey(block.startsAtIso) === selectedDateKey,
    )
    .some((block) => {
      const blockStart = minutesFromIso(block.startsAtIso);
      const blockEnd = minutesFromIso(block.endsAtIso);
      return candidateStartMinutes < blockEnd && candidateEndMinutes > blockStart;
    });
}

export function getProviderAvailableSlots({
  appointments,
  dateKey,
  providers,
  service,
  workDayEnd = DEFAULT_WORK_DAY_END,
  workDayStart = DEFAULT_WORK_DAY_START,
}: {
  appointments: Appointment[];
  dateKey: string;
  providers: Provider[];
  service?: Service;
  workDayEnd?: string;
  workDayStart?: string;
}): AvailableSlot[] {
  if (!service) {
    return [];
  }

  const holdMinutes = service.durationMinutes + service.bufferMinutes;
  const dayAppointments = appointments.filter(
    (appointment) => toDateKey(appointment.startsAtIso) === dateKey,
  );
  const slots: AvailableSlot[] = [];
  const dayOfWeek = getNepalDayOfWeekFromAdDateKey(dateKey);

  for (const provider of providers) {
    if (!provider.serviceIds.includes(service.id)) {
      continue;
    }

    const dayWindows = provider.availability
      .filter((item) => item.dayOfWeek === dayOfWeek && item.isActive)
      .sort((a, b) => inputTimeToMinutes(a.startsAtLocal) - inputTimeToMinutes(b.startsAtLocal));
    const windows = dayWindows.length
      ? dayWindows
      : provider.availability.length
        ? []
        : [
            {
              startsAtLocal: workDayStart,
              endsAtLocal: workDayEnd,
              slotDurationMinutes: SLOT_STEP_MINUTES,
            },
          ];

    for (const availability of windows) {
      const providerStartMinutes = inputTimeToMinutes(availability.startsAtLocal);
      const providerEndMinutes = inputTimeToMinutes(availability.endsAtLocal);
      const providerSlotStep = availability.slotDurationMinutes ?? SLOT_STEP_MINUTES;

      for (
        let minutes = providerStartMinutes;
        minutes <= providerEndMinutes - holdMinutes;
        minutes += providerSlotStep
      ) {
        const candidateEnd = minutes + holdMinutes;
        const hasOverlap = hasAppointmentOverlap({
          appointments: dayAppointments,
          blockedTimes: provider.blockedTimes,
          candidateEndMinutes: candidateEnd,
          candidateStartMinutes: minutes,
          providerId: provider.id,
          selectedDateKey: dateKey,
        });

        if (!hasOverlap) {
          slots.push({
            provider,
            time: minutesToInputTime(minutes),
            timeLabel: minutesToClockLabel(minutes),
          });
        }
      }
    }
  }

  return slots.sort((a, b) => a.time.localeCompare(b.time));
}

export function minutesFromIso(iso: string) {
  return getMinutesInNepalFromIso(iso);
}

export function inputTimeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToInputTime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function minutesToClockLabel(minutes: number) {
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${suffix}`;
}
