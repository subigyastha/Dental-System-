import type {
  BookingClientIdentity,
  NumberMatchResult,
} from "@/lib/client-identity";
import type {
  BookingSlotHold,
  RankedBookingSlot,
} from "@/lib/booking-availability";
import type {
  ConfirmBookingRequest,
  ConfirmBookingResult,
} from "@/lib/booking-confirmation";
import type { QuickBookPrefill } from "@/lib/quick-book";

export type GuidedBookingStep =
  | "client"
  | "new-client"
  | "details"
  | "matches"
  | "ready"
  | "success";

export type GuidedBookingDraft = {
  draftId: string;
  path: "client-first" | "slot-first";
  phone: string;
  selectedClient: BookingClientIdentity | null;
  newClient: {
    name: string;
    phone: string;
    address: string;
    priorVisitedClinic: boolean;
  } | null;
  numberMatchResult: NumberMatchResult | null;
  skippedPossibleMatchClientIds: string[];
  providerId: string;
  serviceId: string;
  date: string;
  selectedSlotIso: string;
  selectedSlot: RankedBookingSlot | null;
  availabilityVersion: string;
  hold: BookingSlotHold | null;
  pendingHold: {
    idempotencyKey: string;
    slot: RankedBookingSlot;
  } | null;
  confirmationAttempt: {
    idempotencyKey: string;
    payloadFingerprint: string;
    payload: ConfirmBookingRequest;
    uncertain: boolean;
  } | null;
  confirmationResult: ConfirmBookingResult | null;
  priority: "Low" | "Normal" | "High" | "Urgent";
  notes: string;
};

export function createGuidedBookingDraft(
  prefill: QuickBookPrefill = {},
  fallbackDate = "",
): GuidedBookingDraft {
  const refs = prefill.refs ?? {};
  return {
    draftId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `00000000-0000-4000-8000-${Date.now().toString().padStart(12, "0").slice(-12)}`,
    path: refs.slotIso ? "slot-first" : "client-first",
    phone: "",
    selectedClient: null,
    newClient: null,
    numberMatchResult: null,
    skippedPossibleMatchClientIds: [],
    providerId: refs.providerId ?? "",
    serviceId: "",
    date: refs.date ?? fallbackDate,
    selectedSlotIso: refs.slotIso ?? "",
    selectedSlot: null,
    availabilityVersion: "",
    hold: null,
    pendingHold: null,
    confirmationAttempt: null,
    confirmationResult: null,
    priority: "Normal",
    notes: "",
  };
}

export function phoneDigitCount(value: string) {
  return value.replace(/\D/g, "").length;
}

export function isSearchablePhone(value: string) {
  const digits = phoneDigitCount(value);
  return digits >= 7 && digits <= 15;
}

export function isSameClientIntakeIdentity(
  current: { name: string; phone: string } | null,
  expected: { name: string; phone: string },
) {
  return Boolean(
    current &&
      current.name.trim() === expected.name.trim() &&
      current.phone.replace(/\D/g, "") === expected.phone.replace(/\D/g, ""),
  );
}

export function maskPhone(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return trimmed;
  return `${trimmed.slice(0, 3)}${"•".repeat(Math.max(3, trimmed.length - 7))}${trimmed.slice(-4)}`;
}

export function needsMatchReview(draft: GuidedBookingDraft) {
  return Boolean(
    draft.newClient &&
      !draft.selectedClient &&
      draft.numberMatchResult?.matches.length,
  );
}
