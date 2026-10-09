import type {
  BookingClientIdentity,
  NumberMatchResult,
} from "@/lib/client-identity";
import type {
  BookingSlotHold,
  RankedBookingSlot,
  CreateBookingSlotHoldRequest,
} from "@/lib/booking-availability";
import type {
  ConfirmBookingRequest,
  ConfirmBookingResult,
} from "@/lib/booking-confirmation";
import type { QuickBookPrefill } from "@/lib/quick-book";
import { confirmationPayloadFingerprint } from "@/lib/booking-confirmation";

/** Offset and UTC representations of one slot must match across API boundaries. */
export function isSameBookingTime(left: string, right: string) {
  return Boolean(left && right && new Date(left).getTime() === new Date(right).getTime());
}

export function findSelectedBookingSlot(slots: RankedBookingSlot[], selectedIso: string) {
  return slots.find((slot) => isSameBookingTime(slot.startsAtIso, selectedIso));
}

export function isValidBookingDuration(minutes: number | undefined) {
  return minutes === undefined || (Number.isInteger(minutes) && minutes >= 15 && minutes <= 1440 && minutes % 15 === 0);
}

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
  procedureMode?: "catalog" | "custom";
  customProcedureName?: string;
  durationMinutes?: number;
  date: string;
  selectedSlotIso: string;
  selectedSlot: RankedBookingSlot | null;
  availabilityVersion: string;
  hold: BookingSlotHold | null;
  pendingHold: {
    idempotencyKey: string;
    slot: RankedBookingSlot;
    request: CreateBookingSlotHoldRequest;
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

export function resolveBookingConfirmationAttempt(
  current: GuidedBookingDraft["confirmationAttempt"],
  payload: ConfirmBookingRequest,
  createKey: () => string,
): NonNullable<GuidedBookingDraft["confirmationAttempt"]> {
  // Reconcile the original write before allowing any changed booking. The
  // server replays its receipt even if the original slot hold has since expired.
  const payloadFingerprint = confirmationPayloadFingerprint(payload);
  if (current && (current.uncertain || current.payloadFingerprint === payloadFingerprint)) return current;
  return { idempotencyKey: createKey(), payloadFingerprint, payload, uncertain: false };
}

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
