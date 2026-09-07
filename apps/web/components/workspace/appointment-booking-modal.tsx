"use client";

import { CalendarClock, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { DualCalendarDatePicker } from "@/components/calendar-ui";
import { KoiInlineLoader } from "@/components/koi-loader";
import { Button } from "@/components/ui";
import { apiFetchJson } from "@/lib/api-client";
import type { BookingBootstrap } from "@/lib/booking-bootstrap";
import { buildNepalIsoFromDateAndTime, getMinutesInNepalFromIso } from "@/lib/calendar";
import { isProviderTimeConflict } from "@/lib/booking-error";
import {
  type AppointmentDraft,
  type CustomerDraft,
  type ResolveCustomerDraft,
  useWorkspaceApp,
} from "@/components/workspace/app-state";
import {
  Field,
  Drawer,
  inputClassName,
  textareaClassName,
} from "@/components/workspace/elements";
import {
  effectiveBookingService,
  resolveAppointmentBookingReferences,
  servicesForBookingProvider,
} from "@/components/workspace/appointment-booking-references";
import type {
  Appointment,
  Customer,
  CustomerMatch,
  Priority,
  Provider,
  ProviderSlot,
  Service,
} from "@/lib/domain";

const priorityOptions: Priority[] = ["Low", "Normal", "High", "Urgent"];
const noLegacyProviders: Provider[] = [];
const noLegacyServices: Service[] = [];
type ClientMode = "existing" | "new";
type BookingPath = "direct" | "availability";
type BookingClientOption = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  patientCode?: string | null;
  clientCode?: string | null;
};

function timeInputFromIso(value?: string) {
  if (!value) return "09:00";
  const minutes = getMinutesInNepalFromIso(value);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function AppointmentBookingModal({
  bookingBootstrap,
  defaultCustomerId,
  defaultProviderId,
  fixedProviderId,
  initialAppointment,
  initialDate,
  initialSlotIso,
  locationId,
  mode = "book",
  onBack,
  onBooked,
  onClose,
  onDirtyChange,
  stepLabel,
}: {
  bookingBootstrap?: BookingBootstrap;
  defaultCustomerId?: string;
  defaultProviderId?: string;
  fixedProviderId?: string;
  initialAppointment?: Appointment;
  initialDate?: string;
  initialSlotIso?: string;
  locationId?: string;
  mode?: "book" | "edit" | "reschedule";
  onBack?: () => void;
  onBooked?: () => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  stepLabel?: string;
}) {
  const {
    calendarMode,
    createAppointment,
    data,
    fetchProviderSlotsForBooking,
    matchCustomers,
    resolveCustomerForAppointment,
    selectedDate,
    setCalendarMode,
    rescheduleAppointment,
    updateAppointment,
  } = useWorkspaceApp();

  const useLegacyReferences = Boolean(initialAppointment) || mode !== "book";
  const legacyLocation = useLegacyReferences ? data.locations[0] : undefined;
  const legacyProviders = useLegacyReferences
    ? data.providers
    : noLegacyProviders;
  const legacyServices = useLegacyReferences ? data.services : noLegacyServices;
  const references = useMemo(
    () =>
      resolveAppointmentBookingReferences({
        bookingBootstrap,
        legacyLocation,
        legacyProviders,
        legacyServices,
        locationId,
        useLegacyReferences,
      }),
    [
      bookingBootstrap,
      legacyLocation,
      legacyProviders,
      legacyServices,
      locationId,
      useLegacyReferences,
    ],
  );
  const [clientMode, setClientMode] = useState<ClientMode>(
    defaultCustomerId || initialAppointment?.customerId ? "existing" : "new",
  );
  const [customerId, setCustomerId] = useState(
    defaultCustomerId ?? initialAppointment?.customerId ?? "",
  );
  const [customerSearch, setCustomerSearch] = useState("");
  const [newCustomer, setNewCustomer] = useState<CustomerDraft>({
    name: "",
    phone: "",
    email: "",
    gender: "",
    dateOfBirthIso: "",
    address: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    allergies: "",
    medicalNotes: "",
    risk: "Routine",
  });
  const [customerMatches, setCustomerMatches] = useState<CustomerMatch[]>([]);
  const [remoteCustomerOptions, setRemoteCustomerOptions] = useState<BookingClientOption[]>([]);
  const [selectedRemoteCustomer, setSelectedRemoteCustomer] =
    useState<BookingClientOption | null>(() =>
      initialAppointment?.clientSummary
        ? {
            id: initialAppointment.clientSummary.id,
            name: initialAppointment.clientSummary.name,
            phone: "",
            patientCode: initialAppointment.clientSummary.patientCode,
          }
        : null,
    );
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState<string | null>(null);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [selectedMatchAction, setSelectedMatchAction] = useState<{
    mode: "use_existing" | "update_existing";
    customer: Customer;
  } | null>(null);
  const [providerId, setProviderId] = useState(
    fixedProviderId ??
      defaultProviderId ??
      initialAppointment?.providerId ??
      references.defaultProviderId,
  );
  const [serviceId, setServiceId] = useState(
    initialAppointment?.serviceIds[0] ?? "",
  );
  const [dateKey, setDateKey] = useState(initialDate ?? selectedDate);
  const [bookingPath, setBookingPath] = useState<BookingPath>(
    mode === "reschedule" ? "availability" : "direct",
  );
  const [directStartTime, setDirectStartTime] = useState(
    timeInputFromIso(initialSlotIso ?? initialAppointment?.startsAtIso),
  );
  const [directDurationMinutes, setDirectDurationMinutes] = useState(
    initialAppointment?.durationMinutes ?? 60,
  );
  const [priority, setPriority] = useState<Priority>(initialAppointment?.priority ?? "Normal");
  const [notes, setNotes] = useState(initialAppointment?.notes ?? "");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [selectedSlotIso, setSelectedSlotIso] = useState(
    initialSlotIso ??
      (mode === "reschedule" ? "" : initialAppointment?.startsAtIso) ??
      "",
  );
  const slotPrefilled = Boolean(initialSlotIso && !initialAppointment);
  const [showSlotPicker, setShowSlotPicker] = useState(!slotPrefilled);
  const [slotState, setSlotState] = useState<{
    isLoading: boolean;
    slots: ProviderSlot[];
    durationMinutes: number;
    bufferMinutes: number;
  }>({
    isLoading: false,
    slots: [],
    durationMinutes: initialAppointment?.durationMinutes ?? 60,
    bufferMinutes: initialAppointment?.bufferMinutes ?? 0,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [discardChangeOpen, setDiscardChangeOpen] = useState(false);
  const selectedSlotRef = useRef(selectedSlotIso);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    selectedSlotRef.current = selectedSlotIso;
  }, [selectedSlotIso]);

  const availableProviders = useMemo(
    () =>
      references.providers.filter((provider) => {
        if (fixedProviderId) {
          return provider.id === fixedProviderId;
        }
        return provider.isActive;
      }),
    [fixedProviderId, references.providers],
  );

  const selectedCustomer = useMemo(
    () =>
      (selectedRemoteCustomer?.id === customerId ? selectedRemoteCustomer : undefined) ??
      remoteCustomerOptions.find((customer) => customer.id === customerId) ??
      data.customers.find((customer) => customer.id === customerId),
    [customerId, data.customers, remoteCustomerOptions, selectedRemoteCustomer],
  );

  useEffect(() => {
    if (selectedCustomer && !customerSearch) {
      setCustomerSearch(selectedCustomer.name);
    }
  }, [customerSearch, selectedCustomer]);

  const customerOptions = useMemo<BookingClientOption[]>(() => {
    const selected = selectedRemoteCustomer
      ? [selectedRemoteCustomer]
      : [];
    return [...new Map(
      [...selected, ...remoteCustomerOptions].map((customer) => [customer.id, customer]),
    ).values()];
  }, [remoteCustomerOptions, selectedRemoteCustomer]);

  useEffect(() => {
    if (clientMode !== "existing") {
      setCustomerSearchLoading(false);
      setCustomerSearchError(null);
      return;
    }

    const controller = new AbortController();
    setRemoteCustomerOptions([]);
    setCustomerSearchLoading(true);
    setCustomerSearchError(null);
    const timeout = window.setTimeout(() => {
      const query = customerSearch.trim();
      const params = new URLSearchParams({ limit: "8" });
      if (query) {
        params.set("query", query);
      }

      void apiFetchJson<{
        data: { items: BookingClientOption[] };
        meta: { apiVersion: "v1" };
      }>(`/v1/clients?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((response) => {
          if (!controller.signal.aborted) {
            setRemoteCustomerOptions(response.data.items);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setRemoteCustomerOptions([]);
            setCustomerSearchError("Unable to search Clients right now. Try again.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setCustomerSearchLoading(false);
          }
        });
    }, 200);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [clientMode, customerSearch]);

  const availableServices = useMemo(() => {
    return servicesForBookingProvider(references, providerId);
  }, [providerId, references]);

  const selectedProvider = useMemo(
    () => references.providers.find((provider) => provider.id === providerId),
    [providerId, references.providers],
  );

  const selectedService = useMemo(
    () => effectiveBookingService(references, providerId, serviceId),
    [providerId, references, serviceId],
  );
  const requestedDurationMinutes = selectedService?.durationMinutes ?? initialAppointment?.durationMinutes ?? 0;

  useEffect(() => {
    if (!initialAppointment && selectedService?.durationMinutes) {
      setDirectDurationMinutes(selectedService.durationMinutes);
    }
  }, [initialAppointment, selectedService?.durationMinutes]);

  useEffect(() => {
    if (fixedProviderId) {
      return;
    }
    if (references.providers.some((provider) => provider.id === providerId)) {
      return;
    }

    const preferredProviderId = [
      defaultProviderId,
      initialAppointment?.providerId,
      references.defaultProviderId,
    ].find(
      (candidate) =>
        candidate &&
        references.providers.some((provider) => provider.id === candidate),
    );
    setProviderId(preferredProviderId ?? "");
  }, [
    defaultProviderId,
    fixedProviderId,
    initialAppointment?.providerId,
    providerId,
    references.defaultProviderId,
    references.providers,
  ]);

  useEffect(() => {
    if (!availableServices.some((service) => service.id === serviceId)) {
      setServiceId(availableServices[0]?.id ?? "");
    }
  }, [availableServices, serviceId]);

  useEffect(() => {
    if (clientMode !== "new") {
      setCustomerMatches([]);
      setMatchesLoading(false);
      return;
    }

    if (!newCustomer.name.trim() && !newCustomer.phone.trim()) {
      setCustomerMatches([]);
      setMatchesLoading(false);
      return;
    }

    let cancelled = false;
    setMatchesLoading(true);

    const timeout = window.setTimeout(() => {
      void matchCustomers({
        name: newCustomer.name,
        phone: newCustomer.phone,
        email: newCustomer.email || undefined,
      })
        .then((matches) => {
          if (!cancelled) {
            setCustomerMatches(matches);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCustomerMatches([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setMatchesLoading(false);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [clientMode, matchCustomers, newCustomer.email, newCustomer.name, newCustomer.phone]);

  useEffect(() => {
    if (bookingPath !== "availability") {
      setSlotState((current) => ({ ...current, isLoading: false }));
      return;
    }

    // Availability is an explicit secondary path, never a prerequisite for
    // direct-time booking.
    if (slotPrefilled && !showSlotPicker) {
      setSlotState((current) => ({ ...current, isLoading: false, slots: [] }));
      setSlotError(null);
      return;
    }

    if (!providerId || !dateKey || !(serviceId || requestedDurationMinutes)) {
      setSlotState((current) => ({ ...current, isLoading: false, slots: [] }));
      setSlotError(null);
      return;
    }

    let cancelled = false;
    setSlotState((current) => ({ ...current, isLoading: true }));
    setSlotError(null);

    const timeout = window.setTimeout(() => {
      void fetchProviderSlotsForBooking({
        providerId,
        date: dateKey,
        locationId: references.locationId,
        serviceId: serviceId || undefined,
        durationMinutes: requestedDurationMinutes || undefined,
        excludeAppointmentId: initialAppointment?.id,
      })
        .then((response) => {
          if (cancelled) {
            return;
          }

          const fallbackDuration = selectedService?.durationMinutes ?? 60;
          const fallbackBuffer = selectedService?.bufferMinutes ?? 0;

          setSlotState({
            isLoading: false,
            slots: response.slots,
            durationMinutes: response.durationMinutes ?? fallbackDuration,
            bufferMinutes: response.bufferMinutes ?? fallbackBuffer,
          });

          if (
            mode !== "reschedule" &&
            initialAppointment?.startsAtIso &&
            response.slots.some((slot) => slot.startsAtIso === initialAppointment.startsAtIso)
          ) {
            setSelectedSlotIso(initialAppointment.startsAtIso);
            return;
          }

          if (initialSlotIso && response.slots.some((slot) => slot.startsAtIso === initialSlotIso)) {
            setSelectedSlotIso(initialSlotIso);
            return;
          }

          if (
            selectedSlotRef.current &&
            !response.slots.some((slot) => slot.startsAtIso === selectedSlotRef.current)
          ) {
            setSelectedSlotIso("");
            setSlotError("This slot is no longer available. Please choose another slot.");
          }
        })
        .catch(() => {
          if (cancelled) {
            return;
          }
          setSlotState((current) => ({
            ...current,
            isLoading: false,
            slots: [],
          }));
          setSlotError("Unable to load available slots right now.");
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    bookingPath,
    dateKey,
    fetchProviderSlotsForBooking,
    initialAppointment?.id,
    initialAppointment?.startsAtIso,
    initialSlotIso,
    mode,
    providerId,
    references.locationId,
    requestedDurationMinutes,
    selectedService?.bufferMinutes,
    selectedService?.durationMinutes,
    serviceId,
    showSlotPicker,
    slotPrefilled,
  ]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setCustomerError(null);

    if (references.error) {
      setSubmitError(references.error);
      return;
    }
    if (!references.locationId) {
      setSubmitError("Choose a clinic location before booking.");
      return;
    }
    if (!providerId || !selectedProvider) {
      setSubmitError("Choose an available provider before booking.");
      return;
    }
    if (!serviceId || !selectedService) {
      setSubmitError("Choose a service offered by this provider before booking.");
      return;
    }
    if (!dateKey) {
      setSubmitError("Choose an appointment date before booking.");
      return;
    }
    if (bookingPath === "direct" && !directStartTime) {
      setSubmitError("Enter an appointment start time before booking.");
      return;
    }
    if (bookingPath === "availability" && !selectedSlotIso) {
      setSubmitError("Choose an available time before booking.");
      return;
    }
    if (initialAppointment && mode === "reschedule" && !rescheduleReason.trim()) {
      setSubmitError("Enter a reason for rescheduling this appointment.");
      return;
    }

    const appointmentStartIso =
      bookingPath === "direct"
        ? buildNepalIsoFromDateAndTime(dateKey, directStartTime)
        : selectedSlotIso;
    if (
      initialAppointment &&
      mode === "reschedule" &&
      appointmentStartIso === initialAppointment.startsAtIso
    ) {
      setSubmitError("Choose a different time before confirming the reschedule.");
      return;
    }
    let resolvedCustomerId = customerId;
    if (clientMode === "new") {
      if (!newCustomer.name.trim() || !newCustomer.phone.trim()) {
        setCustomerError("Name and phone are required for a new client.");
        return;
      }

      const resolveDraft: ResolveCustomerDraft = {
        ...newCustomer,
        name: newCustomer.name.trim(),
        phone: newCustomer.phone.trim(),
        email: newCustomer.email || undefined,
        gender: newCustomer.gender || undefined,
        dateOfBirthIso: newCustomer.dateOfBirthIso || undefined,
        address: newCustomer.address || undefined,
        emergencyContactName: newCustomer.emergencyContactName || undefined,
        emergencyContactPhone: newCustomer.emergencyContactPhone || undefined,
        allergies: newCustomer.allergies || undefined,
        medicalNotes: newCustomer.medicalNotes || undefined,
        mode: selectedMatchAction?.mode ?? "create_new",
        existingCustomerId: selectedMatchAction?.customer.id,
      };

      setIsSaving(true);
      try {
        const resolvedCustomer = await resolveCustomerForAppointment(resolveDraft);
        resolvedCustomerId = resolvedCustomer.id;
        setCustomerId(resolvedCustomer.id);
        setCustomerSearch(resolvedCustomer.name);
      } catch (error) {
        setIsSaving(false);
        setCustomerError(
          error instanceof Error ? error.message : "Unable to resolve the patient record.",
        );
        return;
      }
    }

    if (!resolvedCustomerId) {
      setCustomerError("Choose or create a client before booking.");
      return;
    }

    const draft: AppointmentDraft = {
      locationId: references.locationId,
      customerId: resolvedCustomerId,
      providerId,
      serviceIds: [serviceId],
      startsAtIso: appointmentStartIso,
      durationMinutes:
        bookingPath === "direct"
          ? directDurationMinutes
          : slotPrefilled && !showSlotPicker
            ? selectedService.durationMinutes
            : slotState.durationMinutes,
      bufferMinutes:
        bookingPath === "direct" || (slotPrefilled && !showSlotPicker)
          ? selectedService.bufferMinutes
          : slotState.bufferMinutes,
      priority,
      notes: notes || undefined,
    };

    setIsSaving(true);
    setSlotError(null);
    try {
      if (initialAppointment && mode === "reschedule") {
        await rescheduleAppointment(initialAppointment.id, draft, rescheduleReason.trim());
      } else if (initialAppointment) {
        await updateAppointment(initialAppointment.id, draft);
      } else {
        await createAppointment(draft);
      }
    } catch (error) {
      if (isProviderTimeConflict(error)) {
        setBookingPath("availability");
        setSelectedSlotIso("");
        setShowSlotPicker(true);
        setSlotError(
          "That time conflicts with the provider schedule. Choose a nearby available time below; your client and appointment details are preserved.",
        );
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : "This slot is no longer available. Please choose another slot.";
      setSlotError(
        message.includes("available") || message.includes("overlap")
          ? "This slot is no longer available. Please choose another slot."
          : message,
      );
      return;
    } finally {
      setIsSaving(false);
    }

    setIsDirty(false);
    onDirtyChange?.(false);
    try {
      onBooked?.();
    } finally {
      onClose();
    }
  }

  if (initialAppointment) {
    const isReschedule = mode === "reschedule";
    const originalServiceNames = initialAppointment.serviceSummaries
      ?.map((service) => service.name)
      .join(", ");
    const selectedTimeIso = isReschedule
      ? selectedSlotIso
      : buildNepalIsoFromDateAndTime(dateKey, directStartTime);

    const requestChangeClose = () => {
      if (isDirty) {
        setDiscardChangeOpen(true);
        return;
      }
      onClose();
    };
    const canSubmitChange = Boolean(
      providerId &&
        serviceId &&
        dateKey &&
        (isReschedule
          ? selectedSlotIso &&
            selectedSlotIso !== initialAppointment.startsAtIso &&
            rescheduleReason.trim()
          : directStartTime),
    );

    return (
      <>
      <Drawer
        closeDisabled={isSaving}
        context={
          isReschedule
            ? "Choose a new Provider time. The original appointment remains in governed history."
            : "Update the visit details without changing the Client record."
        }
        onClose={requestChangeClose}
        stepLabel={isReschedule ? "Schedule change" : "Appointment update"}
        title={isReschedule ? "Reschedule appointment" : "Edit appointment"}
        width="wide"
      >
        <form
          className="space-y-5"
          onChange={() => setIsDirty(true)}
          onSubmit={handleSubmit}
        >
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-[var(--foreground)]">
                  {initialAppointment.clientSummary?.name ?? selectedCustomer?.name ?? "Unknown Client"}
                </p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  {originalServiceNames || selectedService?.name || "Service not specified"}
                </p>
              </div>
              <span className="rounded-full border border-[var(--border)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--text-muted)]">
                {initialAppointment.status}
              </span>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-[var(--text-muted)]">Current appointment</dt>
                <dd className="mt-1 font-medium text-[var(--foreground)]">
                  {new Date(initialAppointment.startsAtIso).toLocaleString("en-NP", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Kathmandu",
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-[var(--text-muted)]">Current Provider</dt>
                <dd className="mt-1 font-medium text-[var(--foreground)]">
                  {initialAppointment.providerSummary?.name ?? selectedProvider?.name ?? "Unassigned"}
                </dd>
              </div>
            </dl>
          </section>

          {references.error ? (
            <div aria-live="assertive" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-[var(--danger)]" role="alert">
              {references.error}
            </div>
          ) : null}

          <ChangeSection
            description="Provider availability and service duration remain authoritative on the server."
            title={isReschedule ? "1. Choose the new appointment" : "Appointment details"}
          >
            <div>
              <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">Provider</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {availableProviders.map((provider) => {
                  const selected = provider.id === providerId;
                  return (
                    <button
                      aria-pressed={selected}
                      className={`min-h-14 rounded-xl border px-3 py-3 text-left transition ${
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]"
                          : "border-[var(--border)] bg-white hover:border-[var(--accent)]"
                      }`}
                      disabled={Boolean(fixedProviderId) || isSaving}
                      key={provider.id}
                      onClick={() => {
                        setIsDirty(true);
                        setProviderId(provider.id);
                        setSelectedSlotIso("");
                        setSlotError(null);
                      }}
                      type="button"
                    >
                      <span className="block text-sm font-semibold text-[var(--foreground)]">{provider.name}</span>
                      <span className="mt-1 block text-xs text-[var(--text-muted)]">{provider.specialty || provider.roleLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <Field label="Service">
              <select
                className={inputClassName}
                disabled={isSaving}
                onChange={(event) => {
                  const nextServiceId = event.target.value;
                  setServiceId(nextServiceId);
                  setSelectedSlotIso("");
                  if (!isReschedule) {
                    const nextService = effectiveBookingService(
                      references,
                      providerId,
                      nextServiceId,
                    );
                    if (nextService) {
                      setDirectDurationMinutes(nextService.durationMinutes);
                    }
                  }
                }}
                required
                value={serviceId}
              >
                <option value="">Choose a service</option>
                {availableServices.map((service) => (
                  <option key={service.id} value={service.id}>{service.name} · {service.durationMinutes} min</option>
                ))}
              </select>
            </Field>

            <DualCalendarDatePicker
              disabled={isSaving}
              mode={calendarMode}
              onChange={(nextDate) => {
                setIsDirty(true);
                setDateKey(nextDate);
                setSelectedSlotIso("");
                setSlotError(null);
              }}
              onModeChange={setCalendarMode}
              value={dateKey}
            />

            {isReschedule ? (
              <Field label="Available time">
                <div className="rounded-xl border border-[var(--border)] bg-white p-3">
                  {!providerId || !serviceId ? (
                    <p className="py-4 text-sm text-[var(--text-muted)]">Choose a Provider and service to see live times.</p>
                  ) : slotState.isLoading ? (
                    <div className="flex justify-center py-5"><KoiInlineLoader label="Loading available times" /></div>
                  ) : slotState.slots.length ? (
                    <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                      {slotState.slots.map((slot) => {
                        const selected = slot.startsAtIso === selectedSlotIso;
                        const original = slot.startsAtIso === initialAppointment.startsAtIso;
                        return (
                          <button
                            aria-pressed={selected}
                            className={`min-h-14 rounded-lg border px-3 py-2 text-center transition ${
                              selected
                                ? "border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]"
                                : "border-[var(--border)] bg-white hover:border-[var(--accent)]"
                            }`}
                            disabled={isSaving || original}
                            key={slot.startsAtIso}
                            onClick={() => { setIsDirty(true); setSelectedSlotIso(slot.startsAtIso); setSlotError(null); }}
                            type="button"
                          >
                            <span className="block text-sm font-semibold tabular-nums text-[var(--foreground)]">{slot.timeLabel}</span>
                            <span className="mt-1 block text-[11px] text-[var(--text-muted)]">{original ? "Current time" : "Available"}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="py-4 text-sm text-amber-800">No times fit this service on the selected date. Choose another date or Provider.</p>
                  )}
                  {slotError ? <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-[var(--danger)]" role="alert">{slotError}</p> : null}
                </div>
              </Field>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start time">
                  <div className="relative">
                    <CalendarClock aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
                    <input className={`${inputClassName} pl-9`} disabled={isSaving} onChange={(event) => setDirectStartTime(event.target.value)} required type="time" value={directStartTime} />
                  </div>
                </Field>
                <Field label="Duration">
                  <input
                    aria-describedby="appointment-duration-help"
                    className={inputClassName}
                    disabled
                    value={`${directDurationMinutes} minutes`}
                  />
                  <p id="appointment-duration-help" className="mt-1 text-xs text-[var(--text-muted)]">
                    Duration follows the selected service.
                  </p>
                </Field>
              </div>
            )}
          </ChangeSection>

          {isReschedule ? (
            <ChangeSection
              description="This is stored with the original and successor appointment for audit history."
              title="2. Explain the change"
            >
              <Field label="Reschedule reason">
                <textarea className={textareaClassName} disabled={isSaving} onChange={(event) => setRescheduleReason(event.target.value)} placeholder="Required reason" required value={rescheduleReason} />
              </Field>
            </ChangeSection>
          ) : null}

          <ChangeSection title={isReschedule ? "3. Review and confirm" : "Priority and notes"}>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">Priority</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {priorityOptions.map((option) => (
                  <button
                    aria-pressed={priority === option}
                    className={`min-h-11 rounded-lg border px-3 text-sm font-medium ${priority === option ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "border-[var(--border)] bg-white text-[var(--text-muted)]"}`}
                    disabled={isSaving}
                    key={option}
                    onClick={() => { setIsDirty(true); setPriority(option); }}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <details className="rounded-xl border border-[var(--border)] bg-white p-3" open={!isReschedule}>
              <summary className="cursor-pointer text-sm font-semibold text-[var(--foreground)]">Notes and location</summary>
              <div className="mt-4 space-y-4">
                <p className="text-sm text-[var(--text-muted)]">Location: {references.locationName}</p>
                <Field label="Notes">
                  <textarea className={textareaClassName} disabled={isSaving} onChange={(event) => setNotes(event.target.value)} placeholder="Operational or clinical handoff notes" value={notes} />
                </Field>
              </div>
            </details>
            {isReschedule && selectedSlotIso ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                New appointment: {selectedProvider?.name ?? "Provider"} · {selectedService?.name ?? "Service"} · {new Date(selectedTimeIso).toLocaleString("en-NP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kathmandu" })}
              </div>
            ) : null}
          </ChangeSection>

          {submitError ? <div aria-live="assertive" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-[var(--danger)]" role="alert">{submitError}</div> : null}

          <div className="sticky -bottom-5 -mx-5 flex justify-end gap-2 border-t border-[var(--border)] bg-white px-5 py-4">
            <Button disabled={isSaving} onClick={requestChangeClose} variant="ghost">Cancel</Button>
            <Button disabled={!canSubmitChange || isSaving} loading={isSaving} loadingLabel={isReschedule ? "Rescheduling appointment" : "Saving appointment"} type="submit">
              {isReschedule ? "Confirm reschedule" : "Save changes"}
            </Button>
          </div>
        </form>
      </Drawer>
      {discardChangeOpen ? (
        <DiscardAppointmentChangeDialog
          onCancel={() => setDiscardChangeOpen(false)}
          onDiscard={() => {
            setDiscardChangeOpen(false);
            setIsDirty(false);
            onDirtyChange?.(false);
            onClose();
          }}
        />
      ) : null}
      </>
    );
  }

  return (
    <Drawer
      onClose={onClose}
      context="Enter a known time immediately, or search availability only when the caller needs options."
      stepLabel={
        stepLabel ??
        (bookingPath === "direct" ? "Direct time" : "Find available time")
      }
      title={mode === "reschedule" ? "Reschedule appointment" : initialAppointment ? "Edit appointment" : "Book appointment"}
    >
      <form
        className="space-y-5"
        onChange={() => setIsDirty(true)}
        onSubmit={handleSubmit}
      >
        {references.error ? (
          <div
            aria-live="assertive"
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-[var(--danger)]"
            role="alert"
          >
            {references.error}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Booking method">
          <button
            aria-checked={bookingPath === "direct"}
            className={`rounded-lg border px-3 py-3 text-left transition ${
              bookingPath === "direct"
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                : "border-[var(--border)] bg-white text-[var(--foreground)] hover:border-[var(--accent)]"
            }`}
            onClick={() => {
              setIsDirty(true);
              setBookingPath("direct");
              setSlotError(null);
            }}
            role="radio"
            type="button"
          >
            <span className="block text-sm font-semibold">Enter a specific time</span>
            <span className="mt-1 block text-xs font-normal text-[var(--text-muted)]">
              Fast default
            </span>
          </button>
          <button
            aria-checked={bookingPath === "availability"}
            className={`rounded-lg border px-3 py-3 text-left transition ${
              bookingPath === "availability"
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                : "border-[var(--border)] bg-white text-[var(--foreground)] hover:border-[var(--accent)]"
            }`}
            onClick={() => {
              setIsDirty(true);
              setBookingPath("availability");
            }}
            role="radio"
            type="button"
          >
            <span className="block text-sm font-semibold">Find available time</span>
            <span className="mt-1 block text-xs font-normal text-[var(--text-muted)]">
              Show live options
            </span>
          </button>
        </div>

        <BookingSection
          description="Choose an existing client or capture only the minimum details needed for this visit."
          title="Client and service"
        >
          <div className="flex gap-2" role="radiogroup" aria-label="Client type">
            <button
              aria-checked={clientMode === "existing"}
              className={`rounded-md px-3 py-2 text-sm font-medium ${
                clientMode === "existing"
                  ? "bg-[var(--accent-soft)] text-[var(--brand-strong)]"
                  : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
              }`}
              onClick={() => {
                setIsDirty(true);
                setClientMode("existing");
              }}
              role="radio"
              type="button"
            >
              Existing client
            </button>
            <button
              aria-checked={clientMode === "new"}
              className={`rounded-md px-3 py-2 text-sm font-medium ${
                clientMode === "new"
                  ? "bg-[var(--accent-soft)] text-[var(--brand-strong)]"
                  : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
              }`}
              onClick={() => {
                setIsDirty(true);
                setClientMode("new");
              }}
              role="radio"
              type="button"
            >
              New client
            </button>
          </div>

          <div className="grid gap-4">
            <Field label="Client">
              {clientMode === "existing" ? (
                <div className="space-y-3">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                      size={16}
                    />
                    <input
                      autoFocus={!initialSlotIso}
                      className={`${inputClassName} pl-9`}
                      onChange={(event) => {
                        const nextSearch = event.target.value;
                        setCustomerSearch(nextSearch);
                        if (nextSearch !== selectedCustomer?.name) {
                          setCustomerId("");
                          setSelectedRemoteCustomer(null);
                        }
                      }}
                      placeholder="Search by name, phone, email, or patient code"
                      value={customerSearch}
                    />
                  </div>
                  <div className="max-h-48 overflow-auto rounded-md border border-[var(--border)] bg-white">
                    {customerOptions.length ? (
                      customerOptions.map((customer) => {
                        const active = customer.id === customerId;
                        return (
                          <button
                            aria-pressed={active}
                            className={`flex w-full items-start justify-between gap-3 border-b border-[var(--border)] px-3 py-3 text-left last:border-b-0 ${
                              active
                                ? "bg-[var(--surface-muted)]"
                                : "bg-white hover:bg-[var(--surface-muted)]"
                            }`}
                            key={customer.id}
                            onClick={() => {
                              setIsDirty(true);
                              setCustomerId(customer.id);
                              if (!useLegacyReferences) {
                                setSelectedRemoteCustomer(customer);
                              }
                              setCustomerSearch(customer.name);
                            }}
                            type="button"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-medium text-[var(--foreground)]">
                                {customer.name}
                              </div>
                              <div className="truncate text-xs text-[var(--text-muted)]">
                                {[customer.patientCode ?? customer.clientCode, customer.phone, customer.email]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            </div>
                            {active ? (
                              <span className="rounded-full bg-[var(--accent-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--brand-strong)]">
                                Selected
                              </span>
                            ) : null}
                          </button>
                        );
                      })
                    ) : customerSearchLoading ? (
                      <div aria-live="polite" className="px-3 py-4 text-sm text-[var(--text-muted)]">
                        Searching Clients…
                      </div>
                    ) : customerSearchError ? (
                      <div aria-live="assertive" className="px-3 py-4 text-sm text-[var(--danger)]" role="alert">
                        {customerSearchError}
                      </div>
                    ) : (
                      <div className="px-3 py-4 text-sm text-[var(--text-muted)]">
                        No matching client found.
                      </div>
                    )}
                  </div>
                  {selectedCustomer ? (
                    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3 text-sm text-[var(--text-muted)]">
                      <span className="font-medium text-[var(--foreground)]">
                        {selectedCustomer.name}
                      </span>{" "}
                      · {selectedCustomer.phone}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid gap-3">
                    <input
                      className={inputClassName}
                      onChange={(event) =>
                        setNewCustomer((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder="Full name"
                      required={clientMode === "new"}
                      value={newCustomer.name}
                    />
                    <input
                      className={inputClassName}
                      onChange={(event) =>
                        setNewCustomer((current) => ({ ...current, phone: event.target.value }))
                      }
                      placeholder="Phone number"
                      required={clientMode === "new"}
                      value={newCustomer.phone}
                    />
                  </div>
                  <input
                    className={inputClassName}
                    onChange={(event) =>
                      setNewCustomer((current) => ({ ...current, email: event.target.value }))
                    }
                    placeholder="Email (optional)"
                    type="email"
                    value={newCustomer.email}
                  />
                  <div className="rounded-md border border-[var(--border)] bg-white">
                    <div className="border-b border-[var(--border)] px-3 py-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      Suggested matches
                    </div>
                    {matchesLoading ? (
                      <div className="px-3 py-4">
                        <KoiInlineLoader label="Checking for existing clients" />
                      </div>
                    ) : customerMatches.length ? (
                      <div className="space-y-2 p-3">
                        {customerMatches.map((match) => {
                          const colors =
                            match.confidence === "strong"
                              ? "border-emerald-300 bg-emerald-50"
                              : match.confidence === "moderate"
                                ? "border-amber-300 bg-amber-50"
                                : "border-rose-300 bg-rose-50";
                          const label =
                            match.confidence === "strong"
                              ? "Perfect match"
                              : match.confidence === "moderate"
                                ? "Suggested match"
                                : "Possible match";
                          const active = selectedMatchAction?.customer.id === match.customer.id;

                          return (
                            <div className={`rounded-md border px-3 py-3 ${colors}`} key={match.customer.id}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="font-medium text-[var(--foreground)]">
                                    {match.customer.name}
                                  </div>
                                  <div className="mt-1 text-xs text-[var(--text-muted)]">
                                    {[match.customer.phone, match.customer.email, match.customer.patientCode]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </div>
                                </div>
                                <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-semibold text-[var(--foreground)]">
                                  {label}
                                </span>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  aria-pressed={
                                    active &&
                                    selectedMatchAction?.mode === "use_existing"
                                  }
                                  className={`rounded-md px-3 py-2 text-xs font-medium ${
                                    active && selectedMatchAction?.mode === "use_existing"
                                      ? "bg-[var(--foreground)] text-white"
                                      : "bg-white text-[var(--foreground)]"
                                  }`}
                                  onClick={() => {
                                    setIsDirty(true);
                                    setSelectedMatchAction({
                                      mode: "use_existing",
                                      customer: match.customer,
                                    });
                                  }}
                                  type="button"
                                >
                                  Use existing
                                </button>
                                <button
                                  aria-pressed={
                                    active &&
                                    selectedMatchAction?.mode ===
                                      "update_existing"
                                  }
                                  className={`rounded-md px-3 py-2 text-xs font-medium ${
                                    active && selectedMatchAction?.mode === "update_existing"
                                      ? "bg-[var(--foreground)] text-white"
                                      : "bg-white text-[var(--foreground)]"
                                  }`}
                                  onClick={() => {
                                    setIsDirty(true);
                                    setSelectedMatchAction({
                                      mode: "update_existing",
                                      customer: match.customer,
                                    });
                                  }}
                                  type="button"
                                >
                                  Update existing
                                </button>
                                <button
                                  className="rounded-md bg-white px-3 py-2 text-xs font-medium text-[var(--foreground)]"
                                  onClick={() => {
                                    setIsDirty(true);
                                    setSelectedMatchAction(null);
                                  }}
                                  type="button"
                                >
                                  Create new anyway
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="px-3 py-4 text-sm text-[var(--text-muted)]">
                        No matching client found.
                      </div>
                    )}
                  </div>
                  {selectedMatchAction ? (
                    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3 text-sm text-[var(--text-muted)]">
                      {selectedMatchAction.mode === "use_existing"
                        ? `Will use ${selectedMatchAction.customer.name}.`
                        : `Will update ${selectedMatchAction.customer.name} with any missing details.`}
                    </div>
                  ) : null}
                </div>
              )}
              {customerError ? (
                <div
                  aria-live="assertive"
                  className="mt-3 text-sm text-[var(--danger)]"
                  role="alert"
                >
                  {customerError}
                </div>
              ) : null}
            </Field>

            <Field label="Service">
              <select
                className={inputClassName}
                onChange={(event) => setServiceId(event.target.value)}
                required
                value={serviceId}
              >
                <option value="">Select service</option>
                {availableServices.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
              {providerId && availableServices.length === 0 ? (
                <div
                  aria-live="polite"
                  className="mt-2 text-sm text-[var(--danger)]"
                  role="status"
                >
                  This provider has no bookable services at the selected
                  location.
                </div>
              ) : null}
            </Field>
          </div>
        </BookingSection>
        {mode === "reschedule" ? (
          <BookingSection
            description="The original appointment will remain in history as Rescheduled and a new linked appointment will be created."
            title="Reschedule reason"
          >
            <Field label="Required reason">
              <textarea className={textareaClassName} onChange={(event) => setRescheduleReason(event.target.value)} required value={rescheduleReason} />
            </Field>
          </BookingSection>
        ) : null}

        <BookingSection
          className="border-[var(--accent)]/20 bg-[var(--surface-muted)]"
          description={
            bookingPath === "direct"
              ? "Enter the requested time immediately. The server performs the authoritative conflict check when you book."
              : "Load a small set of live options only when the caller needs help choosing a time."
          }
          title={bookingPath === "direct" ? "Provider, date, and time" : "Available times"}
        >
          {bookingPath === "direct" ? (
            <div className="space-y-4">
              <Field label="Provider">
                <select
                  className={inputClassName}
                  disabled={Boolean(fixedProviderId)}
                  onChange={(event) => setProviderId(event.target.value)}
                  required
                  value={providerId}
                >
                  <option value="">Select provider</option>
                  {availableProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
                {!references.error && availableProviders.length === 0 ? (
                  <div
                    aria-live="polite"
                    className="mt-2 text-sm text-[var(--danger)]"
                    role="status"
                  >
                    No available provider can be selected for this appointment.
                  </div>
                ) : null}
              </Field>

              <DualCalendarDatePicker
                mode={calendarMode}
                onChange={setDateKey}
                onModeChange={setCalendarMode}
                value={dateKey}
              />

              <div className="grid grid-cols-2 gap-3">
                <Field label="Start time">
                  <div className="relative">
                    <CalendarClock
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                      size={16}
                    />
                    <input
                      className={`${inputClassName} pl-9`}
                      onChange={(event) => setDirectStartTime(event.target.value)}
                      required
                      type="time"
                      value={directStartTime}
                    />
                  </div>
                </Field>
                <Field label="Duration">
                  <select
                    className={inputClassName}
                    onChange={(event) => setDirectDurationMinutes(Number(event.target.value))}
                    value={directDurationMinutes}
                  >
                    {[...new Set([15, 30, 45, 60, 75, 90, 120, directDurationMinutes])]
                      .sort((left, right) => left - right)
                      .map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutes} minutes
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs leading-5 text-emerald-800">
                You can book without waiting for a slot grid. If the time conflicts, your entered values stay here and nearby options will load.
              </div>
            </div>
          ) : (
          <div className="grid gap-4">
            <div className="space-y-4">
              <Field label="Doctor">
              <select
                className={inputClassName}
                disabled={Boolean(fixedProviderId)}
                onChange={(event) => {
                  setProviderId(event.target.value);
                  setSelectedSlotIso("");
                  if (slotPrefilled) {
                    setShowSlotPicker(true);
                  }
                }}
                value={providerId}
              >
                  <option value="">Select doctor</option>
                  {availableProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </Field>

              <DualCalendarDatePicker
                mode={calendarMode}
                onChange={(nextDateKey) => {
                  setDateKey(nextDateKey);
                  setSelectedSlotIso("");
                  if (slotPrefilled) {
                    setShowSlotPicker(true);
                  }
                }}
                onModeChange={setCalendarMode}
                value={dateKey}
              />
            </div>

            <Field label="Slot">
              <div className="rounded-lg border border-[var(--border)] bg-white p-3">
                {slotPrefilled && !showSlotPicker && selectedSlotIso ? (
                  <div className="space-y-3">
                    <div className="rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-3">
                      <div className="font-medium text-[var(--foreground)]">
                        {new Date(selectedSlotIso).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: true,
                          timeZone: "Asia/Kathmandu",
                        })}
                      </div>
                      <div className="mt-1 text-xs text-[var(--text-muted)]">
                        This slot is pre-selected for the appointment.
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        onClick={() => {
                          setIsDirty(true);
                          setShowSlotPicker(true);
                        }}
                        variant="secondary"
                      >
                        Change slot
                      </Button>
                    </div>
                  </div>
                ) : !providerId ? (
                  <div className="py-6 text-sm text-[var(--text-muted)]">
                    Select a doctor to load available slots.
                  </div>
                ) : slotState.isLoading ? (
                  <div className="flex justify-center py-4">
                    <KoiInlineLoader label="Loading available slots" />
                  </div>
                ) : slotState.slots.length ? (
                  <div className="grid max-h-72 grid-cols-3 gap-2 overflow-auto">
                    {slotState.slots.map((slot) => {
                      const active = slot.startsAtIso === selectedSlotIso;
                      return (
                        <button
                          aria-pressed={active}
                          className={`rounded-md border px-3 py-3 text-left text-sm transition ${
                            active
                              ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                              : "border-[var(--border)] bg-white hover:border-[var(--accent)]"
                          }`}
                          key={slot.startsAtIso}
                          onClick={() => {
                            setIsDirty(true);
                            setSelectedSlotIso(slot.startsAtIso);
                            setSlotError(null);
                          }}
                          type="button"
                        >
                          <div className="font-medium text-[var(--foreground)]">{slot.timeLabel}</div>
                          <div className="mt-1 text-xs text-[var(--text-muted)]">
                            {active ? "Assigned to this appointment" : "Available"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-6 text-sm text-[var(--text-muted)]">
                    No available slots for this doctor on this date.
                  </div>
                )}
                {slotError ? (
                  <div
                    aria-live="assertive"
                    className="mt-3 text-sm text-[var(--danger)]"
                    role="alert"
                  >
                    {slotError}
                  </div>
                ) : null}
              </div>
            </Field>
          </div>
          )}
        </BookingSection>

        <BookingSection
          description="Attach any operational details that front desk or clinical staff should keep with this visit."
          title="Additional details"
        >
          <div className="grid grid-cols-2 gap-4">
            <Field label="Priority">
              <select
                className={inputClassName}
                onChange={(event) => setPriority(event.target.value as Priority)}
                value={priority}
              >
                {priorityOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Location">
              <input
                className={inputClassName}
                disabled
                value={references.locationName}
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              className={textareaClassName}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Front desk or clinical notes for this booking."
              value={notes}
            />
          </Field>
        </BookingSection>

        {submitError ? (
          <div
            aria-live="assertive"
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-[var(--danger)]"
            role="alert"
          >
            {submitError}
          </div>
        ) : null}

        <div className="sticky -bottom-5 -mx-5 flex justify-end gap-2 border-t border-[var(--border)] bg-white px-5 py-4">
          {onBack ? (
            <Button onClick={onBack} variant="secondary">
              Back
            </Button>
          ) : null}
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button
            loading={isSaving}
            loadingLabel={initialAppointment ? "Saving appointment" : "Booking appointment"}
            type="submit"
          >
            {initialAppointment ? "Save appointment" : "Book appointment"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function BookingSection({
  children,
  className,
  description,
  title,
}: {
  children: ReactNode;
  className?: string;
  description?: string;
  title: string;
}) {
  return (
    <section className={`rounded-xl border border-[var(--border)] bg-white p-4 ${className ?? ""}`}>
      <div className="mb-4">
        <div className="font-medium text-[var(--foreground)]">{title}</div>
        {description ? <div className="mt-1 text-sm text-[var(--text-muted)]">{description}</div> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function ChangeSection({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{description}</p> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function DiscardAppointmentChangeDialog({
  onCancel,
  onDiscard,
}: {
  onCancel: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 p-4">
      <section aria-describedby="discard-appointment-change-description" aria-labelledby="discard-appointment-change-title" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" role="alertdialog">
        <h2 className="text-base font-semibold text-[var(--foreground)]" id="discard-appointment-change-title">Discard appointment changes?</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]" id="discard-appointment-change-description">The appointment remains unchanged, and the values entered in this form will be lost.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel} variant="ghost">Keep editing</Button>
          <Button onClick={onDiscard} variant="secondary">Discard changes</Button>
        </div>
      </section>
    </div>
  );
}
