import { apiFetchJson } from "@/lib/api-client";

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
  serviceId: string;
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
  serviceId: string;
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
    serviceId: string;
    date: string;
  },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams(params);
  const response = await apiFetchJson<V1Envelope<RankedAvailability>>(
    `/v1/booking/availability?${query.toString()}`,
    { cache: "no-store", signal },
  );
  return response.data;
}

export async function createBookingSlotHold(params: {
  draftId: string;
  locationId: string;
  providerId: string;
  serviceId: string;
  startsAtIso: string;
  slotId: string;
  availabilityVersion: string;
  idempotencyKey: string;
}) {
  const response = await apiFetchJson<V1Envelope<BookingSlotHold>>(
    "/v1/booking/holds",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": params.idempotencyKey,
      },
      body: JSON.stringify(params),
    },
  );
  return response.data;
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
