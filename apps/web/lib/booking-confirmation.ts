import { apiFetchJson } from "@/lib/api-client";

export type ConfirmBookingRequest = {
  draftId: string;
  locationId: string;
  providerId: string;
  serviceId: string;
  startsAtIso: string;
  priority: "Low" | "Normal" | "High" | "Urgent";
  notes?: string;
  holdId?: string;
  client:
    | {
        mode: "existing";
        clientId: string;
        phone?: string;
      }
    | {
        mode: "new";
        name: string;
        phone: string;
        address?: string;
        priorVisitedClinic: boolean;
        duplicateCheckAcknowledged: boolean;
        skippedPossibleMatchClientIds: string[];
        candidateSetVersion: string;
      };
};

export type ConfirmBookingResult = {
  confirmationId: string;
  appointment: {
    id: string;
    status: "Scheduled";
    startsAtIso: string;
    endsAtIso: string;
    durationMinutes: number;
    bufferMinutes: number;
    priority: "Low" | "Normal" | "High" | "Urgent";
  };
  client: {
    id: string;
    name: string;
    clientCode: string | null;
    created: boolean;
    phoneAppended: boolean;
    identityReviewCreated: boolean;
  };
  hold: { id: string; status: "consumed" } | null;
  replayed: boolean;
};

type V1Envelope<T> = {
  data: T;
  meta: { apiVersion: "v1"; requestId?: string };
};

export async function confirmBooking(
  payload: ConfirmBookingRequest,
  idempotencyKey: string,
) {
  const response = await apiFetchJson<V1Envelope<ConfirmBookingResult>>(
    "/v1/booking/confirm",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    },
  );
  return response.data;
}

export function confirmationPayloadFingerprint(
  payload: ConfirmBookingRequest,
) {
  return JSON.stringify(payload);
}
