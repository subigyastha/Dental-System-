"use client";

import { CalendarDays, ChevronLeft, Search, UserPlus, Users } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  DualCalendarDatePicker,
  DualDateDisplay,
} from "@/components/calendar-ui";
import { Button } from "@/components/ui";
import { useWorkspaceApp } from "@/components/workspace/app-state";
import { ClientMinimalIntakeFields } from "@/components/workspace/client-intake-fields";
import { Drawer } from "@/components/workspace/elements";
import { useQuickBook } from "@/components/workspace/quick-book-provider";
import {
  createBookingSlotHold,
  formatHoldCountdown,
  loadRankedAvailability,
  releaseBookingSlotHold,
  remainingHoldSeconds,
  type RankedAvailability,
  type RankedBookingSlot,
} from "@/lib/booking-availability";
import { ApiRequestError } from "@/lib/api-client";
import {
  confirmBooking,
  confirmationPayloadFingerprint,
  type ConfirmBookingRequest,
} from "@/lib/booking-confirmation";
import {
  loadNumberMatches,
  loadRecentBookingClients,
  primaryPhone,
  type BookingClientIdentity,
  type NumberMatchResult,
} from "@/lib/client-identity";
import {
  isSearchablePhone,
  isSameClientIntakeIdentity,
  maskPhone,
  needsMatchReview,
  type GuidedBookingDraft,
  type GuidedBookingStep,
} from "@/lib/guided-booking";
import type { ProviderSlotResponse } from "@/lib/domain";

const inputClass =
  "h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]";
const choiceClass =
  "min-h-12 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-left text-sm transition hover:border-[var(--accent)]";
const selectedChoiceClass =
  "border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]";

export function GuidedQuickBookFlow({
  onBack,
}: {
  onBack?: () => void;
  [key: string]: unknown;
}) {
  const app = useWorkspaceApp();
  const quickBook = useQuickBook();
  const draft = quickBook.draft;
  const step = normalizeStep(quickBook.currentStep);
  const bootstrap = quickBook.bootstrap!;
  const [recentClients, setRecentClients] = useState<BookingClientIdentity[]>([]);
  const [searchResult, setSearchResult] = useState<NumberMatchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [slots, setSlots] = useState<ProviderSlotResponse | null>(null);
  const [rankedAvailability, setRankedAvailability] =
    useState<RankedAvailability | null>(null);
  const [showLaterSlots, setShowLaterSlots] = useState(false);
  const [availabilityRefreshKey, setAvailabilityRefreshKey] = useState(0);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [isCreatingHold, setIsCreatingHold] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [holdAnnouncement, setHoldAnnouncement] = useState("");
  const [slotError, setSlotError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const draftRef = useRef(draft);
  const intakeMatchRequestRef = useRef<{
    controller: AbortController;
    id: number;
  } | null>(null);
  const intakeMatchSequenceRef = useRef(0);
  const submitLockRef = useRef(false);
  const holdRef = useRef(draft.hold);
  const confirmationAttemptRef = useRef(draft.confirmationAttempt);
  const preserveHoldRef = useRef(false);
  const announcedHoldBandRef = useRef<string | null>(null);
  const fetchProviderSlotsForBookingRef = useRef(
    app.fetchProviderSlotsForBooking,
  );
  draftRef.current = draft;
  holdRef.current = draft.hold;
  confirmationAttemptRef.current = draft.confirmationAttempt;
  fetchProviderSlotsForBookingRef.current = app.fetchProviderSlotsForBooking;
  const selectedLocationId = quickBook.selectedLocationId;
  const setQuickBookDraft = quickBook.setDraft;

  // Consume the server-issued capability instead of duplicating the role
  // matrix in the browser. This keeps Provider create-only authority aligned
  // with the API as assignments and location scopes evolve.
  const canCreateClient =
    app.workspaceBootstrap.context.capabilities.canCreateClient;
  const provider = bootstrap.providers.find((item) => item.id === draft.providerId);
  const selectedService = bootstrap.services.find(
    (item) => item.id === draft.serviceId,
  );

  useEffect(() => {
    const providerIsValid = bootstrap.providers.some(
      (item) => item.id === draft.providerId,
    );
    if (draft.date && providerIsValid) return;
    quickBook.setDraft((current) => ({
      ...current,
      date: current.date || app.selectedDate,
      providerId:
        (bootstrap.providers.some((item) => item.id === current.providerId)
          ? current.providerId
          : "") ||
        bootstrap.bookingDefaults.defaultProviderId ||
        bootstrap.providers[0]?.id ||
        "",
      selectedSlotIso: providerIsValid ? current.selectedSlotIso : "",
    }));
  }, [app.selectedDate, bootstrap, draft.date, draft.providerId, quickBook]);

  useEffect(() => {
    if (step !== "client") return;
    const controller = new AbortController();
    setRecentError(null);
    void loadRecentBookingClients(controller.signal)
      .then(setRecentClients)
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRecentError("Recent Clients are temporarily unavailable.");
      });
    return () => controller.abort();
  }, [step]);

  useEffect(() => {
    if (step !== "client" || !isSearchablePhone(draft.phone)) {
      setSearchResult(null);
      setIsSearching(false);
      setMatchError(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setIsSearching(true);
      setMatchError(null);
      void loadNumberMatches(draft.phone, { signal: controller.signal })
        .then(setSearchResult)
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setMatchError("Client search failed. Check the number and try again.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearching(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft.phone, step]);

  useEffect(() => {
    if (
      step !== "details" ||
      !draft.providerId ||
      !draft.serviceId ||
      !draft.date
    ) {
      setSlots(null);
      setRankedAvailability(null);
      setIsLoadingSlots(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setIsLoadingSlots(true);
      setSlotError(null);
      const request =
        draft.path === "slot-first"
          ? loadRankedAvailability(
              {
                providerId: draft.providerId,
                serviceId: draft.serviceId,
                date: draft.date,
                locationId: selectedLocationId!,
              },
              controller.signal,
            )
          : fetchProviderSlotsForBookingRef.current({
              providerId: draft.providerId,
              serviceId: draft.serviceId,
              date: draft.date,
              locationId: selectedLocationId ?? undefined,
            });
      void request
        .then((response) => {
          if (!active) return;
          if ("availabilityVersion" in response) {
            setRankedAvailability(response);
            setSlots(null);
            const currentSelection = draftRef.current.selectedSlotIso;
            const matchingSelectedSlot = currentSelection
              ? [...response.recommended, ...response.later].find(
                  (slot) => slot.startsAtIso === currentSelection,
                )
              : undefined;
            setQuickBookDraft((current) => ({
              ...current,
              availabilityVersion: response.availabilityVersion,
              ...(currentSelection && !current.hold
                ? matchingSelectedSlot
                  ? { selectedSlot: matchingSelectedSlot }
                  : { selectedSlot: null, selectedSlotIso: "" }
                : {}),
            }));
            if (currentSelection && !matchingSelectedSlot) {
              setSlotError(
                "The selected schedule time does not fit this service. Choose another available time.",
              );
            }
          } else {
            setSlots(response);
            setRankedAvailability(null);
            const currentSelection = draftRef.current.selectedSlotIso;
            if (
              currentSelection &&
              !response.slots.some(
                (slot) => slot.startsAtIso === currentSelection,
              )
            ) {
              setQuickBookDraft((current) => ({
                ...current,
                selectedSlotIso: "",
              }));
            }
          }
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (active) setSlotError("Available times could not be loaded.");
        })
        .finally(() => {
          if (active) setIsLoadingSlots(false);
        });
    }, 180);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    availabilityRefreshKey,
    draft.date,
    draft.path,
    draft.providerId,
    draft.serviceId,
    selectedLocationId,
    setQuickBookDraft,
    step,
  ]);

  useEffect(() => {
    if (!draft.hold || draft.hold.status !== "active") {
      setRemainingSeconds(0);
      return;
    }
    function updateRemaining() {
      const seconds = remainingHoldSeconds(draft.hold!.expiresAtIso);
      setRemainingSeconds(seconds);
      if (seconds === 0 && draftRef.current.hold?.status === "active") {
        quickBook.setDraft((current) => ({
          ...current,
          hold: current.hold
            ? { ...current.hold, status: "expired" }
            : null,
        }));
      }
    }
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    const onVisibility = () => updateRemaining();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [draft.hold, quickBook]);

  useEffect(() => {
    const hold = draft.hold;
    if (!hold) {
      announcedHoldBandRef.current = null;
      setHoldAnnouncement("");
      return;
    }
    const band =
      hold.status !== "active" || remainingSeconds === 0
        ? "expired"
        : remainingSeconds <= 30
          ? "thirty"
          : remainingSeconds <= 60
            ? "minute"
            : "active";
    const key = `${hold.id}:${band}`;
    if (announcedHoldBandRef.current === key) return;
    announcedHoldBandRef.current = key;
    setHoldAnnouncement(
      band === "expired"
        ? "The selected time hold expired."
        : band === "thirty"
          ? "Thirty seconds remain on the selected time hold."
          : band === "minute"
            ? "One minute remains on the selected time hold."
            : "The selected time is now held.",
    );
  }, [draft.hold, remainingSeconds]);

  useEffect(
    () => () => {
      const hold = holdRef.current;
      const confirmationAttempt = confirmationAttemptRef.current;
      if (
        hold?.status === "active" &&
        !preserveHoldRef.current &&
        !confirmationAttempt?.uncertain
      ) {
        void releaseBookingSlotHold(hold.id).catch(() => undefined);
      }
    },
    [],
  );

  useEffect(() => {
    if (step !== "new-client") {
      intakeMatchRequestRef.current?.controller.abort();
      intakeMatchRequestRef.current = null;
    }
    return () => {
      intakeMatchRequestRef.current?.controller.abort();
    };
  }, [step]);

  function updateDraft(patch: Partial<typeof draft>) {
    quickBook.setDraft((current) => ({ ...current, ...patch }));
    quickBook.setDirty(true);
    setFormError(null);
  }

  function chooseClient(client: BookingClientIdentity) {
    updateDraft({
      selectedClient: client,
      newClient: null,
      phone: draft.phone || primaryPhone(client),
      numberMatchResult: searchResult,
    });
    quickBook.setStep(
      draft.path === "slot-first" && draft.hold?.status === "active"
        ? "ready"
        : "details",
    );
  }

  async function continueNewClient() {
    const intake = draft.newClient;
    if (!intake?.name.trim() || !isSearchablePhone(intake.phone)) {
      setFormError("Enter a Client name and a valid phone number.");
      return;
    }
    intakeMatchRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const requestId = ++intakeMatchSequenceRef.current;
    intakeMatchRequestRef.current = { controller, id: requestId };
    const requestedIdentity = { name: intake.name, phone: intake.phone };
    setIsSearching(true);
    try {
      const result = await loadNumberMatches(intake.phone, {
        name: intake.name,
        signal: controller.signal,
      });
      const currentIntake = draftRef.current.newClient;
      if (
        controller.signal.aborted ||
        intakeMatchRequestRef.current?.id !== requestId ||
        !isSameClientIntakeIdentity(currentIntake, requestedIdentity)
      ) {
        return;
      }
      updateDraft({
        phone: intake.phone,
        numberMatchResult: result,
        skippedPossibleMatchClientIds: [],
      });
      if (draft.path === "slot-first" && draft.hold?.status === "active") {
        quickBook.setStep(result.matches.length ? "matches" : "ready");
      } else {
        quickBook.setStep("details");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFormError("Possible matches could not be checked. Try again.");
    } finally {
      if (intakeMatchRequestRef.current?.id === requestId) {
        intakeMatchRequestRef.current = null;
        setIsSearching(false);
      }
    }
  }

  async function submitBooking() {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    quickBook.setBusy(true);
    if (!draft.providerId || !draft.serviceId || !draft.selectedSlotIso || !selectedService) {
      setFormError("Choose a provider, service, date, and available time.");
      submitLockRef.current = false;
      quickBook.setBusy(false);
      return;
    }
    if (!draft.selectedClient && !draft.newClient) {
      setFormError("Choose or add a Client before booking.");
      submitLockRef.current = false;
      quickBook.setBusy(false);
      return;
    }
    setIsSaving(true);
    setFormError(null);
    let backgroundTimer: number | undefined;
    let activeAttempt = draft.confirmationAttempt;
    try {
      if (!quickBook.selectedLocationId) {
        throw new Error("Choose a clinic location before booking.");
      }
      if (
        !draft.selectedClient &&
        !draft.numberMatchResult?.candidateSetVersion
      ) {
        throw new Error(
          "Review possible Client matches again before booking.",
        );
      }
      const payload: ConfirmBookingRequest = {
        draftId: draft.draftId,
        locationId: quickBook.selectedLocationId,
        providerId: draft.providerId,
        serviceId: draft.serviceId,
        startsAtIso: draft.selectedSlotIso,
        priority: draft.priority,
        notes: draft.notes.trim() || undefined,
        holdId:
          draft.path === "slot-first" ? draft.hold?.id : undefined,
        client: draft.selectedClient
          ? {
              mode: "existing",
              clientId: draft.selectedClient.id,
              phone:
                canCreateClient && isSearchablePhone(draft.phone)
                  ? draft.phone.trim()
                  : undefined,
            }
          : {
              mode: "new",
              name: draft.newClient!.name.trim(),
              phone: draft.newClient!.phone.trim(),
              address: draft.newClient!.address.trim() || undefined,
              priorVisitedClinic:
                draft.newClient!.priorVisitedClinic,
              duplicateCheckAcknowledged:
                draft.skippedPossibleMatchClientIds.length > 0 ||
                !(draft.numberMatchResult?.matches.length),
              skippedPossibleMatchClientIds:
                draft.skippedPossibleMatchClientIds,
              candidateSetVersion:
                draft.numberMatchResult!.candidateSetVersion,
            },
      };
      const payloadFingerprint =
        confirmationPayloadFingerprint(payload);
      const attempt =
        draft.confirmationAttempt?.payloadFingerprint ===
        payloadFingerprint
          ? draft.confirmationAttempt
          : {
              idempotencyKey:
                typeof crypto !== "undefined" &&
                "randomUUID" in crypto
                  ? crypto.randomUUID()
                  : `confirm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              payloadFingerprint,
              payload,
              uncertain: false,
            };
      activeAttempt = attempt;
      updateDraft({ confirmationAttempt: attempt });
      preserveHoldRef.current = true;
      backgroundTimer = window.setTimeout(() => {
        if (submitLockRef.current) quickBook.minimize();
      }, 400);
      const result = await confirmBooking(
        attempt.payload,
        attempt.idempotencyKey,
      );
      updateDraft({
        confirmationResult: result,
        confirmationAttempt: {
          ...attempt,
          uncertain: false,
        },
        hold:
          draft.hold && result.hold
            ? { ...draft.hold, status: "consumed" }
            : draft.hold,
      });
      app.applyConfirmedBooking({
        appointmentId: result.appointment.id,
        providerId: draft.providerId,
        dateKey: draft.date,
        clientId: result.client.id,
      });
      quickBook.setDirty(false);
      preserveHoldRef.current = false;
      quickBook.setBusy(false);
      quickBook.setStep("success");
    } catch (error) {
      const reason =
        error instanceof ApiRequestError ? error.reason : undefined;
      if (
        reason === "HOLD_EXPIRED" ||
        reason === "HOLD_RELEASED" ||
        reason === "HOLD_CONSUMED" ||
        reason === "HOLD_MISMATCH" ||
        reason === "SLOT_UNAVAILABLE" ||
        reason === "AVAILABILITY_CHANGED"
      ) {
        preserveHoldRef.current = false;
        updateDraft({
          hold: null,
          pendingHold: null,
          selectedSlot: null,
          selectedSlotIso: "",
          availabilityVersion: "",
          confirmationAttempt: null,
        });
        setRankedAvailability(null);
        setSlots(null);
        setAvailabilityRefreshKey((current) => current + 1);
        quickBook.setStep("details");
      } else if (
        reason === "IDENTITY_MATCH_CHANGED" ||
        reason === "MATCH_REVIEW_REQUIRED"
      ) {
        preserveHoldRef.current = false;
        updateDraft({ confirmationAttempt: null });
        quickBook.setStep("client");
      } else if (
        error instanceof ApiRequestError &&
        (error.status >= 500 || error.status === 0)
      ) {
        preserveHoldRef.current = true;
        updateDraft({
          confirmationAttempt: activeAttempt
            ? {
                ...activeAttempt,
                uncertain: true,
              }
            : null,
        });
      } else {
        preserveHoldRef.current = false;
      }
      setFormError(
        error instanceof Error ? error.message : "The appointment could not be booked.",
      );
    } finally {
      if (backgroundTimer !== undefined) window.clearTimeout(backgroundTimer);
      submitLockRef.current = false;
      quickBook.setBusy(false);
      setIsSaving(false);
    }
  }

  function continueFromDetails() {
    if (!draft.providerId || !draft.serviceId || !draft.selectedSlotIso) {
      setFormError("Choose a provider, service, date, and available time.");
      return;
    }
    if (!draft.selectedClient && !draft.newClient) {
      quickBook.setStep("client");
    } else if (needsMatchReview(draft)) {
      quickBook.setStep("matches");
    } else {
      quickBook.setStep("ready");
    }
  }

  async function chooseRankedSlot(
    slot: RankedBookingSlot,
    retryKey?: string,
  ) {
    if (
      !quickBook.selectedLocationId ||
      !draft.providerId ||
      !draft.serviceId
    ) {
      setSlotError("Choose a clinic, provider, and service first.");
      return;
    }
    setIsCreatingHold(true);
    quickBook.setBusy(true);
    setSlotError(null);
    const idempotencyKey =
      retryKey ??
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `hold-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    updateDraft({
      pendingHold: { idempotencyKey, slot },
    });
    try {
      if (draft.hold?.status === "active") {
        await releaseBookingSlotHold(draft.hold.id);
        setRankedAvailability(null);
        setSlots(null);
        setIsLoadingSlots(true);
        updateDraft({
          hold: null,
          pendingHold: null,
          selectedSlot: null,
          selectedSlotIso: "",
          availabilityVersion: "",
        });
        setAvailabilityRefreshKey((current) => current + 1);
        setSlotError(
          "The previous time was released. Choose a refreshed time.",
        );
        return;
      }
      const requestSnapshot = {
        locationId: quickBook.selectedLocationId,
        providerId: draft.providerId,
        serviceId: draft.serviceId,
        availabilityVersion: draft.availabilityVersion,
      };
      const hold = await createBookingSlotHold({
        draftId: draft.draftId,
        locationId: quickBook.selectedLocationId,
        providerId: draft.providerId,
        serviceId: draft.serviceId,
        startsAtIso: slot.startsAtIso,
        slotId: slot.slotId,
        availabilityVersion: draft.availabilityVersion,
        idempotencyKey,
      });
      const current = draftRef.current;
      if (
        quickBook.selectedLocationId !== requestSnapshot.locationId ||
        current.providerId !== requestSnapshot.providerId ||
        current.serviceId !== requestSnapshot.serviceId ||
        current.availabilityVersion !==
          requestSnapshot.availabilityVersion
      ) {
        await releaseBookingSlotHold(hold.id).catch(() => undefined);
        setSlotError(
          "Booking details changed while the time was being held. Choose a time again.",
        );
        setAvailabilityRefreshKey((value) => value + 1);
        return;
      }
      updateDraft({
        selectedSlot: slot,
        selectedSlotIso: slot.startsAtIso,
        hold,
        pendingHold: null,
      });
      quickBook.setBusy(false);
      quickBook.setStep("client");
    } catch (error) {
      updateDraft({ pendingHold: null });
      setSlotError(
        error instanceof Error
          ? error.message
          : "That time could not be held. Choose another slot.",
      );
      if (error instanceof ApiRequestError && error.status === 409) {
        setRankedAvailability(null);
        setAvailabilityRefreshKey((current) => current + 1);
      }
    } finally {
      quickBook.setBusy(false);
      setIsCreatingHold(false);
    }
  }

  async function changeHeldTime() {
    const hold = draft.hold;
    setRankedAvailability(null);
    setSlots(null);
    setIsLoadingSlots(true);
    quickBook.setBusy(true);
    setIsCreatingHold(true);
    setSlotError(null);
    try {
      if (hold?.status === "active") {
        await releaseBookingSlotHold(hold.id);
      }
    } catch (error) {
      setIsLoadingSlots(false);
      setFormError(
        error instanceof Error
          ? error.message
          : "The held time could not be released. Try again.",
      );
      return;
    } finally {
      quickBook.setBusy(false);
      setIsCreatingHold(false);
    }
    updateDraft({
      hold: null,
      pendingHold: null,
      selectedSlot: null,
      selectedSlotIso: "",
      availabilityVersion: "",
    });
    setAvailabilityRefreshKey((current) => current + 1);
    quickBook.setStep("details");
  }

  async function updateScheduleSelection(patch: Partial<typeof draft>) {
    const hold = draft.hold;
    const preserveRequestedTime = Boolean(
      !hold &&
        draft.selectedSlotIso &&
        patch.serviceId !== undefined &&
        patch.providerId === undefined &&
        patch.date === undefined,
    );
    setRankedAvailability(null);
    setSlots(null);
    setIsLoadingSlots(true);
    if (hold?.status === "active") {
      quickBook.setBusy(true);
      setIsCreatingHold(true);
      setSlotError(null);
      try {
        await releaseBookingSlotHold(hold.id);
      } catch (error) {
        setIsLoadingSlots(false);
        setSlotError(
          error instanceof Error
            ? error.message
            : "The held time could not be released. Try again.",
        );
        return;
      } finally {
        quickBook.setBusy(false);
        setIsCreatingHold(false);
      }
    }
    updateDraft({
      ...patch,
      hold: null,
      pendingHold: null,
      selectedSlot: null,
      selectedSlotIso: preserveRequestedTime ? draft.selectedSlotIso : "",
      availabilityVersion: "",
    });
  }

  const commonDrawer = {
    closeDisabled: isSaving || isCreatingHold,
    hidden: quickBook.isMinimized,
    onClose: quickBook.requestClose,
    title: "Book appointment",
  };

  if (step === "new-client") {
    const intake = draft.newClient ?? {
      name: "",
      phone: draft.phone,
      address: "",
      priorVisitedClinic: false,
    };
    return (
      <Drawer
        {...commonDrawer}
        key={step}
        context="Only the essentials are required. More details can be added from the Client profile."
        stepLabel="Step 2 · New Client"
      >
        <div className="space-y-5">
          <BackButton disabled={isSaving || isCreatingHold} onClick={quickBook.back} />
          <HoldStatus
            announcement={holdAnnouncement}
            draft={draft}
            locationName={bootstrap.location.name}
            onChangeTime={changeHeldTime}
            providerName={provider?.name}
            remainingSeconds={remainingSeconds}
            serviceName={selectedService?.name}
          />
          <ClientMinimalIntakeFields
            autofocus
            disabled={isSearching}
            intake={intake}
            onChange={(next) =>
              updateDraft({ phone: next.phone, newClient: next })
            }
          />
          <InlineError message={formError} />
          <Footer>
            <Button disabled={isSearching} onClick={quickBook.back} variant="ghost">Back</Button>
            <Button loading={isSearching} loadingLabel="Checking matches" onClick={() => void continueNewClient()}>
              Continue
            </Button>
          </Footer>
        </div>
      </Drawer>
    );
  }

  if (step === "details") {
    return (
      <Drawer
        {...commonDrawer}
        key={step}
        context="Choose a provider first, then select a service and an available time."
        stepLabel={draft.path === "slot-first" ? "Step 1 · Appointment" : "Step 3 · Appointment"}
        width={draft.path === "slot-first" ? "default" : "wide"}
      >
        <div className="space-y-6">
          <BackButton disabled={isSaving || isCreatingHold} onClick={quickBook.back} />
          <HoldStatus
            announcement={holdAnnouncement}
            draft={draft}
            locationName={bootstrap.location.name}
            onChangeTime={changeHeldTime}
            providerName={provider?.name}
            remainingSeconds={remainingSeconds}
            serviceName={selectedService?.name}
          />
          {draft.selectedClient ? <ClientSummary client={draft.selectedClient} /> : null}
          {draft.newClient ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm">
              <strong>{draft.newClient.name}</strong>
              <span className="ml-2 text-[var(--text-muted)]">{maskPhone(draft.newClient.phone)}</span>
            </div>
          ) : null}
          <section>
            <h3 className="mb-2 text-sm font-semibold" data-drawer-autofocus tabIndex={-1}>Provider</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {bootstrap.providers.map((item) => (
                <button
                  aria-pressed={draft.providerId === item.id}
                  className={`${choiceClass} ${draft.providerId === item.id ? selectedChoiceClass : ""}`}
                  disabled={isCreatingHold}
                  key={item.id}
                  onClick={() =>
                    void updateScheduleSelection({
                      providerId: item.id,
                      serviceId: "",
                    })
                  }
                  type="button"
                >
                  <strong>{item.name}</strong>
                  <span className="block text-xs text-[var(--text-muted)]">{item.specialty || item.roleLabel}</span>
                </button>
              ))}
            </div>
          </section>
          <Field label="Service" required>
            <select
              className={inputClass}
              disabled={isCreatingHold}
              onChange={(event) =>
                void updateScheduleSelection({
                  serviceId: event.target.value,
                })
              }
              value={draft.serviceId}
            >
              <option value="">Choose a service</option>
              {bootstrap.services
                .filter((service) =>
                  provider
                    ? provider.serviceOptions.some((option) => option.serviceId === service.id)
                    : true,
                )
                .map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} · {service.durationMinutes} min
                  </option>
                ))}
            </select>
          </Field>
          <DualCalendarDatePicker
            disabled={isCreatingHold}
            mode={app.calendarMode}
            onChange={(date) =>
              void updateScheduleSelection({ date })
            }
            onModeChange={app.setCalendarMode}
            value={draft.date || app.selectedDate}
          />
          {draft.path === "slot-first" ? (
            <PriorityField draft={draft} updateDraft={updateDraft} />
          ) : null}
          {draft.path === "slot-first" && draft.selectedSlotIso && !draft.hold ? (
            <div className="rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-3 text-sm">
              <p className="font-semibold text-[var(--foreground)]">Selected from schedule</p>
              <p className="mt-1 text-[var(--text-muted)]">
                {new Date(draft.selectedSlotIso).toLocaleString("en-NP", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Kathmandu",
                })}
                {provider ? ` · ${provider.name}` : ""}
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {draft.serviceId
                  ? "This time is available for the selected service. Continue to hold it."
                  : "Choose a service to verify that its duration fits this time."}
              </p>
            </div>
          ) : null}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Available times</h3>
              {isLoadingSlots ? <span aria-live="polite" className="text-xs text-[var(--text-muted)]">Loading…</span> : null}
            </div>
            <InlineError message={slotError} />
            {!draft.serviceId ? (
              <p className="rounded-lg bg-[var(--surface-muted)] p-3 text-sm text-[var(--text-muted)]">
                Choose a service to see live availability.
              </p>
            ) : draft.path === "slot-first" &&
              rankedAvailability?.recommended.length ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {rankedAvailability.recommended.map((slot) => (
                    <RankedSlotButton
                      disabled={isCreatingHold}
                      key={slot.slotId}
                      onClick={() => void chooseRankedSlot(slot)}
                      selected={draft.selectedSlotIso === slot.startsAtIso}
                      slot={slot}
                    />
                  ))}
                </div>
                {rankedAvailability.later.length ? (
                  <>
                    <Button
                      onClick={() => setShowLaterSlots((shown) => !shown)}
                      variant="ghost"
                    >
                      {showLaterSlots ? "Hide later times" : "More times"}
                    </Button>
                    {showLaterSlots ? (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {rankedAvailability.later.map((slot) => (
                          <RankedSlotButton
                            disabled={isCreatingHold}
                            key={slot.slotId}
                            onClick={() => void chooseRankedSlot(slot)}
                            selected={draft.selectedSlotIso === slot.startsAtIso}
                            slot={slot}
                          />
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : slots?.slots.length ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {slots.slots.map((slot) => (
                  <button
                    aria-pressed={draft.selectedSlotIso === slot.startsAtIso}
                    className={`${choiceClass} min-h-11 text-center ${draft.selectedSlotIso === slot.startsAtIso ? selectedChoiceClass : ""}`}
                    key={slot.startsAtIso}
                    onClick={() => updateDraft({ selectedSlotIso: slot.startsAtIso })}
                    type="button"
                  >
                    {slot.timeLabel}
                  </button>
                ))}
              </div>
            ) : draft.serviceId && !isLoadingSlots ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                No times are available on this date. Try another day.
              </p>
            ) : null}
          </section>
          {draft.path === "client-first" ? (
            <PriorityField draft={draft} updateDraft={updateDraft} />
          ) : null}
          <details className="rounded-lg border border-[var(--border)] p-3">
            <summary className="cursor-pointer text-sm font-semibold">Optional details</summary>
            <div className="mt-4 space-y-4">
              <p className="text-sm text-[var(--text-muted)]">Location: {bootstrap.location.name}</p>
              <Field label="Notes">
                <textarea
                  className={`${inputClass} min-h-24 py-2`}
                  onChange={(event) => updateDraft({ notes: event.target.value })}
                  value={draft.notes}
                />
              </Field>
            </div>
          </details>
          <InlineError message={formError} />
          <Footer>
            <Button disabled={isSaving || isCreatingHold} onClick={quickBook.back} variant="ghost">Back</Button>
            {draft.path === "client-first" ? (
              <Button loading={isSaving} loadingLabel="Booking appointment" onClick={continueFromDetails}>
              {!draft.selectedClient && !draft.newClient
                ? "Choose Client"
                : needsMatchReview(draft)
                  ? "Review matches"
                  : "Review booking"}
              </Button>
            ) : (
              draft.selectedSlot && draft.hold?.status !== "active" ? (
                <Button
                  disabled={isCreatingHold}
                  loading={isCreatingHold}
                  loadingLabel="Holding selected time"
                  onClick={() => void chooseRankedSlot(draft.selectedSlot!)}
                >
                  Continue with selected time
                </Button>
              ) : (
                <span className="self-center text-xs text-[var(--text-muted)]">
                  Select an available time to continue
                </span>
              )
            )}
          </Footer>
        </div>
      </Drawer>
    );
  }

  if (step === "matches") {
    const matches = draft.numberMatchResult?.matches ?? [];
    return (
      <Drawer
        {...commonDrawer}
        key={step}
        context="Choose a record only when you are confident it is the same person."
        stepLabel="Step 4 · Possible matches"
      >
        <div className="space-y-4">
          <BackButton disabled={isSaving} onClick={quickBook.back} />
          <HoldStatus
            announcement={holdAnnouncement}
            draft={draft}
            locationName={bootstrap.location.name}
            onChangeTime={changeHeldTime}
            providerName={provider?.name}
            remainingSeconds={remainingSeconds}
            serviceName={selectedService?.name}
          />
          <div aria-live="polite" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-drawer-autofocus tabIndex={-1}>
            No match is selected automatically.
          </div>
          {matches.map((match) => (
            <div className="rounded-lg border border-[var(--border)] p-4" key={match.client.id}>
              <ClientSummary client={match.client} />
              <p className="mt-2 text-xs capitalize text-[var(--text-muted)]">
                {match.classification.replace("_", " ")} · matched on {match.matchedOn.join(" and ")}
              </p>
              <Button
                className="mt-3 w-full"
                disabled={isSaving}
                onClick={() => {
                  updateDraft({ selectedClient: match.client });
                  quickBook.setStep("ready");
                }}
                variant="secondary"
              >
                Use this Client
              </Button>
            </div>
          ))}
          <InlineError message={formError} />
          <Footer>
            <Button disabled={isSaving} onClick={quickBook.back} variant="ghost">Back</Button>
            <Button
              disabled={
                draft.path === "slot-first" &&
                draft.hold?.status !== "active"
              }
              onClick={() => {
                updateDraft({
                  skippedPossibleMatchClientIds: matches.map(
                    (match) => match.client.id,
                  ),
                });
                quickBook.setStep("ready");
              }}
            >
                Continue as new Client
            </Button>
          </Footer>
        </div>
      </Drawer>
    );
  }

  if (step === "success" && draft.confirmationResult) {
    const result = draft.confirmationResult;
    return (
      <Drawer
        {...commonDrawer}
        key={step}
        context="The appointment was confirmed by the clinic server."
        stepLabel="Appointment booked"
      >
        <div
          aria-live="polite"
          className="space-y-5"
          data-drawer-autofocus
          tabIndex={-1}
        >
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
            <h3 className="text-lg font-semibold">Appointment booked</h3>
            <p className="mt-1 text-sm">
              {result.client.name} is scheduled with {provider?.name}.
            </p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 rounded-lg border border-[var(--border)] p-4 text-sm">
            <dt className="text-[var(--text-muted)]">Client</dt>
            <dd className="font-medium">{result.client.name}</dd>
            <dt className="text-[var(--text-muted)]">Service</dt>
            <dd className="font-medium">{selectedService?.name}</dd>
            <dt className="text-[var(--text-muted)]">Time</dt>
            <dd className="font-medium">
              {new Date(result.appointment.startsAtIso).toLocaleString(
                "en-NP",
                { timeZone: "Asia/Kathmandu" },
              )}
            </dd>
            <dt className="text-[var(--text-muted)]">Status</dt>
            <dd className="font-medium">{result.appointment.status}</dd>
          </dl>
          {result.replayed ? (
            <p className="text-sm text-[var(--text-muted)]">
              This confirmed result was safely restored from an earlier
              submission.
            </p>
          ) : null}
          <Button
            className="min-h-11 w-full"
            onClick={quickBook.closeQuickBook}
          >
            Done
          </Button>
        </div>
      </Drawer>
    );
  }

  if (step === "ready") {
    const slotFirstUnavailable =
      draft.path === "slot-first" &&
      draft.hold?.status !== "active" &&
      !draft.confirmationAttempt?.uncertain;
    return (
      <Drawer
        {...commonDrawer}
        key={step}
        context="Review the Client and appointment details before booking."
        stepLabel="Confirm appointment"
      >
        <div className="space-y-5">
          <BackButton disabled={isSaving} onClick={quickBook.back} />
          <HoldStatus
            announcement={holdAnnouncement}
            draft={draft}
            locationName={bootstrap.location.name}
            onChangeTime={changeHeldTime}
            providerName={provider?.name}
            remainingSeconds={remainingSeconds}
            serviceName={selectedService?.name}
          />
          {draft.selectedClient ? (
            <>
              <ClientSummary client={draft.selectedClient} />
              {canCreateClient &&
              isSearchablePhone(draft.phone) &&
              draft.phone.replace(/\D/g, "") !==
                primaryPhone(draft.selectedClient).replace(/\D/g, "") ? (
                <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
                  The searched phone will be added as a secondary Client
                  number when the booking is confirmed.
                </p>
              ) : null}
            </>
          ) : draft.newClient ? (
            <div className="rounded-lg border border-[var(--border)] p-4 text-sm">
              <strong className="block">{draft.newClient.name}</strong>
              <span className="text-[var(--text-muted)]">
                {maskPhone(draft.newClient.phone)}
              </span>
            </div>
          ) : null}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm">
            <dt className="text-[var(--text-muted)]">Provider</dt>
            <dd className="font-medium">{provider?.name}</dd>
            <dt className="text-[var(--text-muted)]">Service</dt>
            <dd className="font-medium">
              {selectedService?.name} · {selectedService?.durationMinutes} min
            </dd>
            <dt className="text-[var(--text-muted)]">Time</dt>
            <dd className="space-y-1 font-medium">
              {draft.selectedSlotIso ? (
                <>
                  <DualDateDisplay
                    iso={draft.selectedSlotIso}
                    mode="AD"
                    variant="short"
                  />
                  <span className="block">
                    {new Date(
                      draft.selectedSlotIso,
                    ).toLocaleTimeString("en-NP", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Kathmandu",
                    })}
                  </span>
                </>
              ) : (
                "Not selected"
              )}
            </dd>
            <dt className="text-[var(--text-muted)]">Priority</dt>
            <dd className="font-medium">{draft.priority}</dd>
          </dl>
          <details className="rounded-lg border border-[var(--border)] p-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Additional details
            </summary>
            <div className="mt-3 space-y-2 text-sm">
              <p>Location: {bootstrap.location.name}</p>
              <p>Notes: {draft.notes.trim() || "None"}</p>
            </div>
          </details>
          <InlineError message={formError} />
          {draft.confirmationAttempt?.uncertain ? (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              The previous response was uncertain. Retry safely to restore
              the same confirmed result without creating a duplicate.
            </div>
          ) : null}
          {slotFirstUnavailable ? (
            <Button className="w-full" onClick={changeHeldTime}>
              Choose another time
            </Button>
          ) : (
            <Footer>
              <Button
                disabled={isSaving}
                onClick={quickBook.back}
                variant="ghost"
              >
                Back
              </Button>
              <Button
                loading={isSaving}
                loadingLabel="Booking appointment"
                onClick={() => void submitBooking()}
              >
                {draft.confirmationAttempt?.uncertain
                  ? "Retry safely"
                  : "Book appointment"}
              </Button>
            </Footer>
          )}
        </div>
      </Drawer>
    );
  }

  return (
      <Drawer
        {...commonDrawer}
        key={step}
      context="Search by phone number, choose a recent Client, or start a minimal new entry."
      stepLabel="Step 1 · Client"
    >
      <div className="space-y-5">
        {onBack ? <BackButton onClick={onBack} /> : null}
        <HoldStatus
          announcement={holdAnnouncement}
          draft={draft}
          locationName={bootstrap.location.name}
          onChangeTime={changeHeldTime}
          providerName={provider?.name}
          remainingSeconds={remainingSeconds}
          serviceName={selectedService?.name}
        />
        <Field label="Client phone number">
          <div className="relative">
            <Search aria-hidden="true" className="absolute left-3 top-3 text-[var(--text-muted)]" size={17} />
            <input
              autoComplete="tel"
              className={`${inputClass} pl-10`}
              data-drawer-autofocus
              inputMode="tel"
              onChange={(event) => updateDraft({ phone: event.target.value })}
              placeholder="Enter at least 7 digits"
              value={draft.phone}
            />
          </div>
        </Field>
        <div aria-live="polite">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {isSearchablePhone(draft.phone) ? "Matching Clients" : "Recent Clients"}
            </h3>
            {isSearching ? <span className="text-xs text-[var(--text-muted)]">Searching…</span> : null}
          </div>
          <div className="space-y-2">
            {isSearchablePhone(draft.phone)
              ? searchResult?.matches.map((match) => (
                  <button
                    className={`${choiceClass} w-full`}
                    key={match.client.id}
                    onClick={() => chooseClient(match.client)}
                    type="button"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <strong>{match.client.name}</strong>
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold capitalize text-amber-800">
                        {match.classification.replace("_", " ")}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-[var(--text-muted)]">
                      {maskPhone(primaryPhone(match.client))} · matched on {match.matchedOn.join(" and ")}
                    </span>
                  </button>
                ))
              : recentClients.map((client) => (
                  <button className={`${choiceClass} w-full`} key={client.id} onClick={() => chooseClient(client)} type="button">
                    <strong>{client.name}</strong>
                    <span className="ml-2 text-xs text-[var(--text-muted)]">{maskPhone(primaryPhone(client))}</span>
                  </button>
                ))}
            {!isSearching &&
            (isSearchablePhone(draft.phone)
              ? (searchResult?.matches.length ?? 0) === 0
              : recentClients.length === 0) ? (
              <p className="rounded-lg bg-[var(--surface-muted)] p-3 text-sm text-[var(--text-muted)]">
                {isSearchablePhone(draft.phone) ? "No existing Client matches this number." : "No recent Clients to show."}
              </p>
            ) : null}
          </div>
        </div>
        <InlineError
          message={
            isSearchablePhone(draft.phone) ? matchError : recentError
          }
        />
        <div className="grid gap-2 sm:grid-cols-2">
          {canCreateClient ? (
            <Button
              className="h-11"
              onClick={() => {
                updateDraft({
                  newClient: { name: "", phone: draft.phone, address: "", priorVisitedClinic: false },
                  selectedClient: null,
                });
                quickBook.setStep("new-client");
              }}
              variant="secondary"
            >
              <UserPlus aria-hidden="true" size={17} />
              New Client
            </Button>
          ) : null}
          {draft.path === "slot-first" && draft.hold ? (
            <Button className="h-11" onClick={changeHeldTime} variant="secondary">
              <CalendarDays aria-hidden="true" size={17} />
              Change time
            </Button>
          ) : (
            <Button
              className="h-11"
              onClick={() => {
                updateDraft({ path: "slot-first", selectedClient: null });
                quickBook.setStep("details");
              }}
              variant="secondary"
            >
              <CalendarDays aria-hidden="true" size={17} />
              View slots first
            </Button>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function normalizeStep(value: string | null): GuidedBookingStep {
  return value === "new-client" ||
    value === "details" ||
    value === "matches" ||
    value === "ready" ||
    value === "success"
    ? value
    : "client";
}

function RankedSlotButton({
  disabled,
  onClick,
  selected,
  slot,
}: {
  disabled: boolean;
  onClick: () => void;
  selected: boolean;
  slot: RankedBookingSlot;
}) {
  return (
    <button
      aria-pressed={selected}
      className={`${choiceClass} min-h-16 text-center disabled:cursor-wait disabled:opacity-60 ${selected ? selectedChoiceClass : ""}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="block font-semibold tabular-nums">{slot.timeLabel}</span>
      <span className="mt-1 block text-[11px] text-[var(--text-muted)]">
        {slot.rankReason === "earliest"
          ? "Earliest"
          : slot.recommended
            ? "Recommended"
            : "Later"}
      </span>
    </button>
  );
}

function HoldStatus({
  announcement,
  draft,
  locationName,
  onChangeTime,
  providerName,
  remainingSeconds,
  serviceName,
}: {
  announcement: string;
  draft: GuidedBookingDraft;
  locationName: string;
  onChangeTime: () => void;
  providerName?: string;
  remainingSeconds: number;
  serviceName?: string;
}) {
  const hold = draft.hold;
  const liveRemainingSeconds =
    remainingSeconds ||
    (hold ? remainingHoldSeconds(hold.expiresAtIso) : 0);
  const expired =
    !hold || hold.status !== "active" || liveRemainingSeconds <= 0;
  const expiryAlertRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (hold && expired) {
      expiryAlertRef.current?.focus();
    }
  }, [expired, hold]);

  if (draft.path !== "slot-first" || !hold) return null;

  return (
    <section
      className={`rounded-lg border p-3 text-sm ${
        expired
          ? "border-rose-200 bg-rose-50"
          : "border-emerald-200 bg-emerald-50"
      }`}
      ref={expiryAlertRef}
      role={expired ? "alert" : "status"}
      tabIndex={expired ? -1 : undefined}
    >
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            {expired ? "This hold expired" : "Selected time held"}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {new Date(hold.startsAtIso).toLocaleString("en-NP", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Asia/Kathmandu",
            })}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {[providerName, serviceName, locationName]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {!expired ? (
            <p className="mt-1 font-semibold tabular-nums">
              Time held: {formatHoldCountdown(liveRemainingSeconds)}
            </p>
          ) : (
            <p className="mt-1">Your other details are still saved.</p>
          )}
        </div>
        <Button onClick={onChangeTime} variant="ghost">
          {expired ? "Choose another time" : "Change time"}
        </Button>
      </div>
    </section>
  );
}

function PriorityField({
  draft,
  updateDraft,
}: {
  draft: GuidedBookingDraft;
  updateDraft: (patch: Partial<GuidedBookingDraft>) => void;
}) {
  return (
    <Field label="Priority">
      <select
        className={inputClass}
        onChange={(event) =>
          updateDraft({
            priority: event.target.value as GuidedBookingDraft["priority"],
          })
        }
        value={draft.priority}
      >
        {["Low", "Normal", "High", "Urgent"].map((priority) => (
          <option key={priority}>{priority}</option>
        ))}
      </select>
    </Field>
  );
}

function BackButton({ disabled = false, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <button className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[var(--accent-strong)] disabled:opacity-50" disabled={disabled} onClick={onClick} type="button">
      <ChevronLeft aria-hidden="true" size={16} />
      Back
    </button>
  );
}

function ClientSummary({ client }: { client: BookingClientIdentity }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]">
        <Users aria-hidden="true" size={17} />
      </span>
      <span>
        <strong className="block text-sm">{client.name}</strong>
        <span className="block text-xs text-[var(--text-muted)]">{maskPhone(primaryPhone(client))}</span>
      </span>
    </div>
  );
}

function Field({ children, label, required = false }: { children: ReactNode; label: string; required?: boolean }) {
  return (
    <label className="block text-sm font-medium">
      <span className="mb-1.5 block">{label}{required ? " *" : ""}</span>
      {children}
    </label>
  );
}

function InlineError({ message }: { message: string | null }) {
  return message ? (
    <p aria-live="assertive" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-[var(--danger)]" role="alert">
      {message}
    </p>
  ) : null;
}

function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="sticky -bottom-5 -mx-5 flex justify-end gap-2 border-t border-[var(--border)] bg-white px-5 py-4">
      {children}
    </div>
  );
}
