import {
  buildNepalIsoFromDateAndTime,
  formatTime,
  getDualCalendarDay,
  toDateKey,
} from "@/lib/calendar";
import type {
  Appointment,
  CalendarMode,
  Customer,
  FollowUpTask,
  Provider,
  Service,
} from "@/lib/domain";

export function buildAppointmentView(
  appointment: Appointment,
  customers: Customer[],
  providers: Provider[],
  services: Service[],
) {
  return {
    ...appointment,
    customer: customers.find((customer) => customer.id === appointment.customerId),
    provider: providers.find((provider) => provider.id === appointment.providerId),
    services: services.filter((service) => appointment.serviceIds.includes(service.id)),
  };
}

export function buildFollowUpView(
  task: FollowUpTask,
  customers: Customer[],
  providers: Provider[],
) {
  return {
    ...task,
    customer: customers.find((customer) => customer.id === task.customerId),
    provider: providers.find((provider) => provider.id === task.ownerId),
  };
}

export function formatDualDate(isoOrDateKey: string, mode: CalendarMode, variant: "long" | "short" = "long") {
  const dual = getDualCalendarDay(
    isoOrDateKey.includes("T") ? toDateKey(isoOrDateKey) : isoOrDateKey,
  );

  if (variant === "short") {
    return mode === "BS"
      ? `${dual.bsShort} / ${dual.adShort}`
      : `${dual.adShort} / ${dual.bsShort}`;
  }

  return mode === "BS"
    ? `${dual.bsDate} / ${dual.adDate}`
    : `${dual.adDate} / ${dual.bsDate}`;
}

export function formatClockRange(startsAtIso: string, durationMinutes: number, bufferMinutes = 0) {
  const startsAt = new Date(startsAtIso);
  const endsAt = new Date(startsAt.getTime() + (durationMinutes + bufferMinutes) * 60 * 1000);
  return `${formatTime(startsAt.toISOString())} - ${formatTime(endsAt.toISOString())}`;
}

export function buildBlockedTimeIso(dateKey: string, time: string) {
  return buildNepalIsoFromDateAndTime(dateKey, time);
}

export function countTodayAppointments(appointments: Appointment[], dateKey: string) {
  return appointments.filter((appointment) => toDateKey(appointment.startsAtIso) === dateKey).length;
}
