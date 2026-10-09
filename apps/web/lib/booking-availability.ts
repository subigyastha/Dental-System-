import { apiFetchJson } from "@/lib/api-client";
import { isUncertainBookingWriteError } from "@/lib/booking-error";

export type RankedSlotReason = "earliest" | "next_available" | "later";

export type RankedBookingSlot = {
  slotId: string;
  startsAtIso: string;
  time: string;
  timeLabel: string;
  dateKey: string;
  rank: number;
  rankReason: RankedSlotReason;
  recommended: boolean;
};

export type RankedAvailability = {
  providerId: string;
  serviceId?: string;
  customProcedureName?: string;
  locationId: string;
  dateKey: string;
  timezone: string;
  durationMinutes: number;
  bufferMinutes: number;
  availabilityVersion: string;
  recommended: RankedBookingSlot[];
  later: RankedBookingSlot[];
};

export type BookingSlotHold = {
  id: string;
  draftId: string;
  idempotencyKey: string;
  status: "active" | "expired" | "released" | "consumed";
  organizationId: string;
  locationId: string;
  providerId: string;
  serviceId?: string;
  customProcedureName?: string;
  startsAtIso: string;
  endsAtIso: string;
  bufferMinutes: number;
  expiresAtIso: string;
};

type V1Envelope<T> = {
  data: T;
  meta: { apiVersion: "v1" };
};

export async function loadRankedAvailability(
  params: {
    locationId: string;
    providerId: string;
    serviceId?: string;
  customProcedureName?: string;
    durationMinutes?: number;
    date: string;
  },
  signal?: AbortSignal,
) {
  const { durationMinutes, serviceId, customProcedureName, ...filters } = params;
  const query = new URLSearchParams(filters);
  if (serviceId) query.set("serviceId", serviceId);
  if (customProcedureName) query.set("customProcedureName", customProcedureName);
  if (durationMinutes !== undefined) query.set("durationMinutes", String(durationMinutes));
  const response = await apiFetchJson<V1Envelope<RankedAvailability>>(
    `/v1/booking/availability?${query.toString()}`,
    { cache: "no-store", signal },
  );
  return response.data;
}

export type CreateBookingSlotHoldRequest = {
  draftId: string;
  locationId: string;
  providerId: string;
  serviceId?: string;
  customProcedureName?: string;
  durationMinutes?: number;
  startsAtIso: string;
  slotId: string;
  availabilityVersion: string;
  idempotencyKey: string;
};

/** A lost response does not tell us whether the server committed the hold. */
export const isUncertainSlotHoldError = isUncertainBookingWriteError;

export async function createBookingSlotHold(params: CreateBookingSlotHoldRequest) {
  const send = async () => {
    const response = await apiFetchJson<V1Envelope<BookingSlotHold>>(
      "/v1/booking/holds",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": params.idempotencyKey,
        },
        body: JSON.stringify(params),
        timeoutMs: 45_000,
      },
    );
    return response.data;
  };
  try {
    return await send();
  } catch (error) {
    if (!isUncertainSlotHoldError(error)) throw error;
    // Replaying the identical key and payload recovers a committed hold without
    // reserving it again. Keep retries bounded; the UI retains this attempt.
    return send();
  }
}

export async function loadBookingSlotHold(id: string) {
  const response = await apiFetchJson<V1Envelope<BookingSlotHold>>(
    `/v1/booking/holds/${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );
  return response.data;
}

export async function releaseBookingSlotHold(id: string) {
  await apiFetchJson<V1Envelope<{ id: string; released: true }>>(
    `/v1/booking/holds/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export function remainingHoldSeconds(
  expiresAtIso: string,
  nowMs = Date.now(),
) {
  return Math.max(
    0,
    Math.ceil((new Date(expiresAtIso).getTime() - nowMs) / 1000),
  );
}

export function formatHoldCountdown(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
