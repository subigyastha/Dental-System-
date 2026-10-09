import type { AppointmentStatus } from "./domain";

/** Reception's daily flow does not require a separate clinical-start action. */
export function getPrimaryAppointmentAction(status: AppointmentStatus) {
  switch (status) {
    case "Scheduled": return { label: "Confirm appointment", status: "Confirmed" as const };
    case "Confirmed": return { label: "Check in Client", status: "CheckedIn" as const };
    case "CheckedIn":
    case "InProgress": return { label: "Complete appointment", status: "Completed" as const };
    default: return null;
  }
}
