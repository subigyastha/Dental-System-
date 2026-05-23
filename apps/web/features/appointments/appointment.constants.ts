import type { AppointmentStatus, Priority } from "@/lib/domain";

export const DEFAULT_TIMEZONE = "Asia/Kathmandu";
export const DEFAULT_WORK_DAY_START = "08:00";
export const DEFAULT_WORK_DAY_END = "18:00";
export const SLOT_STEP_MINUTES = 60;

export const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  "Scheduled",
  "Confirmed",
  "CheckedIn",
  "InProgress",
  "Completed",
  "Cancelled",
  "NoShow",
  "Rescheduled",
  "FollowUpRequired",
];

export const APPOINTMENT_PRIORITIES: Priority[] = [
  "Low",
  "Normal",
  "High",
  "Urgent",
];

export const BLOCKING_APPOINTMENT_STATUSES = new Set<AppointmentStatus>([
  "Scheduled",
  "Confirmed",
  "CheckedIn",
  "InProgress",
  "FollowUpRequired",
]);

export const NON_BLOCKING_APPOINTMENT_STATUSES = new Set<AppointmentStatus>([
  "Completed",
  "Cancelled",
  "NoShow",
  "Rescheduled",
]);

export const AUDIT_ACTIONS = {
  created: "created",
  updated: "updated",
  deleted: "deleted",
  cancelled: "cancelled",
  statusChanged: "status_changed",
  completed: "completed",
  noShow: "no_show",
  sessionNoteAdded: "session_note_added",
} as const;
