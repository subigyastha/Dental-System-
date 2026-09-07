import { apiFetchJson } from "@/lib/api-client";

export type SlotStartInterval = 5 | 10 | 15 | 20 | 30 | 60;

export type ClinicSettingsData = {
  capabilities: { canEdit: boolean; canManageSlotInterval: boolean };
  organization: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    timezone: string;
    primaryCalendar: "AD";
  };
  scheduling: {
    businessDayStartsAt: string;
    businessDayEndsAt: string;
    defaultBufferMinutes: number;
    bookingHoldMinutes: number;
    slotStartIntervalMinutes: SlotStartInterval;
    scheduleConfigurationVersion: number;
    reminderLeadMinutes: number;
    allowOverlaps: false;
  };
};

export type ClinicSettingsDraft = {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  businessDayStartsAt: string;
  businessDayEndsAt: string;
  defaultBufferMinutes: number;
  bookingHoldMinutes: number;
  slotStartIntervalMinutes: SlotStartInterval;
  reminderLeadMinutes: number;
};

type V1Envelope<T> = {
  data: T;
  meta: { apiVersion: "v1"; requestId?: string };
};

export function loadClinicSettings(signal?: AbortSignal) {
  return apiFetchJson<V1Envelope<ClinicSettingsData>>("/v1/settings", {
    cache: "no-store",
    signal,
  }).then((response) => response.data);
}

export function updateClinicSettings(draft: ClinicSettingsDraft) {
  return apiFetchJson<V1Envelope<ClinicSettingsData>>("/v1/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  }).then((response) => response.data);
}
