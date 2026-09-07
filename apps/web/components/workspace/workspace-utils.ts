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
  const customer =
    customers.find((item) => item.id === appointment.customerId) ??
    (appointment.clientSummary
      ? {
          id: appointment.clientSummary.id,
          name: appointment.clientSummary.name,
          patientCode: appointment.clientSummary.patientCode,
          phone: "",
          age: 0,
          risk: "Routine" as const,
          lastVisitIso: appointment.startsAtIso,
        }
      : undefined);
  const provider =
    providers.find((item) => item.id === appointment.providerId) ??
    (appointment.providerSummary
      ? {
          id: appointment.providerSummary.id,
          name: appointment.providerSummary.name,
          roleLabel: "Provider",
          specialty: appointment.providerSummary.specialty ?? "General service",
          color: appointment.providerSummary.color,
          capacityMinutes: 0,
          bookedMinutes: 0,
          status: "Available" as const,
          availability: [],
          recurringBlocks: [],
          blockedTimes: [],
          serviceIds: [],
        }
      : undefined);
  const serviceMap = new Map([
    ...appointment.serviceSummaries?.map((service) => [service.id, service] as const) ?? [],
    ...services.map((service) => [service.id, service] as const),
  ]);
  return {
    ...appointment,
    customer,
    provider,
    services: appointment.serviceIds.flatMap((serviceId) => {
      const service = serviceMap.get(serviceId);
      return service ? [service] : [];
    }),
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
