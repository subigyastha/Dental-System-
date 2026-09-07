import { apiFetchJson } from "@/lib/api-client";

export type ClientPhoneSummary = {
  id: string;
  displayValue: string;
  label: string | null;
  isPrimary: boolean;
};

export type BookingClientIdentity = {
  id: string;
  clientCode: string | null;
  name: string;
  phoneSummaries: ClientPhoneSummary[];
  lastVisitIso: string | null;
};

export type NumberMatchClassification =
  | "none"
  | "strong"
  | "possible"
  | "shared_household";

export type NumberMatch = {
  classification: Exclude<NumberMatchClassification, "none">;
  matchedOn: Array<"phone" | "name">;
  client: BookingClientIdentity;
};

export type NumberMatchResult = {
  classification: NumberMatchClassification;
  candidateSetVersion: string;
  matches: NumberMatch[];
};

export type CreateStandaloneClientInput = {
  name: string;
  phone: string;
  address?: string;
  priorVisitedClinic: boolean;
  candidateSetVersion: string;
  duplicateCheckAcknowledged: boolean;
  skippedPossibleMatchClientIds: string[];
  email?: string;
  gender?: string;
  dateOfBirthIso?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  allergies?: string;
  medicalNotes?: string;
  risk?: "Routine" | "Needs attention" | "High priority";
};

export type CreatedClientResult = {
  id: string;
  clientCode: string | null;
  name: string;
  phone: string;
  identityReview: {
    id: string;
    status: string;
    triggers: string[];
  } | null;
  replayed: boolean;
};

type V1Envelope<T> = {
  data: T;
  meta: { apiVersion: "v1" };
};

export async function loadNumberMatches(
  phone: string,
  options: { name?: string; signal?: AbortSignal } = {},
) {
  const response = await apiFetchJson<V1Envelope<NumberMatchResult>>(
    "/v1/clients/number-matches",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone,
        name: options.name?.trim() || undefined,
      }),
      signal: options.signal,
    },
  );
  return response.data;
}

export async function loadRecentBookingClients(signal?: AbortSignal) {
  const response = await apiFetchJson<
    V1Envelope<{
      items: Array<{
        id: string;
        clientCode: string | null;
        name: string;
        phone: string;
        phoneSummaries?: ClientPhoneSummary[];
        lastVisitIso: string | null;
      }>;
    }>
  >("/v1/clients?limit=6&order=recent", {
    cache: "no-store",
    signal,
  });

  return response.data.items.map((client): BookingClientIdentity => ({
    id: client.id,
    clientCode: client.clientCode,
    name: client.name,
    phoneSummaries:
      client.phoneSummaries?.length
        ? client.phoneSummaries
        : [{
            id: `legacy:${client.id}`,
            displayValue: client.phone,
            label: "Mobile",
            isPrimary: true,
          }],
    lastVisitIso: client.lastVisitIso,
  }));
}

export async function createStandaloneClient(
  input: CreateStandaloneClientInput,
  idempotencyKey: string,
) {
  const response = await apiFetchJson<V1Envelope<CreatedClientResult>>(
    "/v1/clients",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function appendClientPhone(
  clientId: string,
  phone: string,
  matchEvidence: { name: string; candidateSetVersion: string },
) {
  const response = await apiFetchJson<
    V1Envelope<{ added: boolean; phone: ClientPhoneSummary }>
  >(`/v1/clients/${encodeURIComponent(clientId)}/caller-phone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone,
      name: matchEvidence.name,
      candidateSetVersion: matchEvidence.candidateSetVersion,
      reason: "Standalone Client intake match selection",
    }),
  });
  return response.data;
}

export function primaryPhone(client: BookingClientIdentity) {
  return (
    client.phoneSummaries.find((phone) => phone.isPrimary)?.displayValue ??
    client.phoneSummaries[0]?.displayValue ??
    ""
  );
}
