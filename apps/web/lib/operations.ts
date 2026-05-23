import {
  appointments,
  customers,
  followUps,
  providers,
  services,
} from "@/lib/seed-data";
import type {
  Appointment,
  AppointmentStatus,
  FollowUpTask,
  OperationalMetric,
  Priority,
  Provider,
} from "@/lib/domain";

const attentionStatuses: AppointmentStatus[] = [
  "NoShow",
  "FollowUpRequired",
  "Rescheduled",
];

const priorityWeight: Record<Priority, number> = {
  Urgent: 4,
  High: 3,
  Normal: 2,
  Low: 1,
};

export function getCustomer(customerId: string) {
  return customers.find((customer) => customer.id === customerId);
}

export function getProvider(providerId: string) {
  return providers.find((provider) => provider.id === providerId);
}

export function getServices(serviceIds: string[]) {
  return services.filter((service) => serviceIds.includes(service.id));
}

export function getTodayAppointments() {
  return appointments
    .filter((appointment) => appointment.startsAtIso.startsWith("2026-05-06"))
    .sort(
      (a, b) =>
        new Date(a.startsAtIso).getTime() - new Date(b.startsAtIso).getTime(),
    );
}

export function getAttentionAppointments() {
  return appointments
    .filter(
      (appointment) =>
        attentionStatuses.includes(appointment.status) ||
        appointment.priority === "Urgent" ||
        appointment.communicationState === "Needs call",
    )
    .sort((a, b) => priorityWeight[b.priority] - priorityWeight[a.priority]);
}

export function getOpenFollowUps() {
  return followUps
    .filter((task) => task.status !== "Done")
    .sort((a, b) => {
      const priorityDelta = priorityWeight[b.priority] - priorityWeight[a.priority];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return new Date(a.dueIso).getTime() - new Date(b.dueIso).getTime();
    });
}

export function getProviderLoad(provider: Provider) {
  return Math.round((provider.bookedMinutes / provider.capacityMinutes) * 100);
}

export function getProviderState(provider: Provider) {
  const load = getProviderLoad(provider);
  if (load >= 92) {
    return "Overloaded";
  }

  if (load >= 78) {
    return "Tight";
  }

  return provider.status;
}

export function getOperationalMetrics(): OperationalMetric[] {
  const today = getTodayAppointments();
  const openFollowUps = getOpenFollowUps();
  const urgentTasks = openFollowUps.filter((task) => task.priority === "Urgent");
  const unconfirmed = today.filter(
    (appointment) => appointment.communicationState !== "Confirmed by phone",
  );

  return [
    {
      label: "Today scheduled",
      value: String(today.length),
      context: `${today.filter((item) => item.status === "Confirmed").length} confirmed`,
      tone: "neutral",
    },
    {
      label: "Needs attention",
      value: String(getAttentionAppointments().length),
      context: "No-show, urgent, delayed, or blocked",
      tone: "warning",
    },
    {
      label: "Open follow-ups",
      value: String(openFollowUps.length),
      context: `${urgentTasks.length} urgent recovery tasks`,
      tone: urgentTasks.length ? "danger" : "neutral",
    },
    {
      label: "Confirmation gap",
      value: String(unconfirmed.length),
      context: "Appointments still needing communication",
      tone: unconfirmed.length > 2 ? "warning" : "good",
    },
  ];
}

export function buildAppointmentView(appointment: Appointment) {
  return {
    ...appointment,
    customer: getCustomer(appointment.customerId),
    provider: getProvider(appointment.providerId),
    services: getServices(appointment.serviceIds),
  };
}

export function buildFollowUpView(task: FollowUpTask) {
  return {
    ...task,
    customer: getCustomer(task.customerId),
    owner: getProvider(task.ownerId),
    appointment: task.appointmentId
      ? appointments.find((appointment) => appointment.id === task.appointmentId)
      : undefined,
  };
}
