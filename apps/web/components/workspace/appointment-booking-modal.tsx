"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { DualCalendarDatePicker } from "@/components/calendar-ui";
import { KoiInlineLoader } from "@/components/koi-loader";
import { Button } from "@/components/ui";
import {
  type AppointmentDraft,
  type CustomerDraft,
  type ResolveCustomerDraft,
  useWorkspaceApp,
} from "@/components/workspace/app-state";
import {
  Field,
  Modal,
  inputClassName,
  textareaClassName,
} from "@/components/workspace/elements";
import type { Appointment, Customer, CustomerMatch, Priority, ProviderSlot } from "@/lib/domain";

const priorityOptions: Priority[] = ["Low", "Normal", "High", "Urgent"];
type ClientMode = "existing" | "new";

export function AppointmentBookingModal({
  defaultCustomerId,
  defaultProviderId,
  fixedProviderId,
  initialAppointment,
  initialDate,
  initialSlotIso,
  onClose,
}: {
  defaultCustomerId?: string;
  defaultProviderId?: string;
  fixedProviderId?: string;
  initialAppointment?: Appointment;
  initialDate?: string;
  initialSlotIso?: string;
  onClose: () => void;
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
    updateAppointment,
  } = useWorkspaceApp();

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
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [selectedMatchAction, setSelectedMatchAction] = useState<{
    mode: "use_existing" | "update_existing";
    customer: Customer;
  } | null>(null);
  const [providerId, setProviderId] = useState(
    fixedProviderId ?? defaultProviderId ?? initialAppointment?.providerId ?? "",
  );
  const [serviceId, setServiceId] = useState(
    initialAppointment?.serviceIds[0] ?? data.services[0]?.id ?? "",
  );
  const [dateKey, setDateKey] = useState(initialDate ?? selectedDate);
  const [priority, setPriority] = useState<Priority>(initialAppointment?.priority ?? "Normal");
  const [chair, setChair] = useState(initialAppointment?.chair ?? "");
  const [notes, setNotes] = useState(initialAppointment?.notes ?? "");
  const [selectedSlotIso, setSelectedSlotIso] = useState(
    initialSlotIso ?? initialAppointment?.startsAtIso ?? "",
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
  const selectedSlotRef = useRef(selectedSlotIso);

  useEffect(() => {
    selectedSlotRef.current = selectedSlotIso;
  }, [selectedSlotIso]);

  const availableProviders = useMemo(
    () =>
      data.providers.filter((provider) => {
        if (fixedProviderId) {
          return provider.id === fixedProviderId;
        }
        return provider.status !== "Inactive";
      }),
    [data.providers, fixedProviderId],
  );

  const selectedCustomer = useMemo(
    () => data.customers.find((customer) => customer.id === customerId),
    [customerId, data.customers],
  );

  useEffect(() => {
    if (selectedCustomer && !customerSearch) {
      setCustomerSearch(selectedCustomer.name);
    }
  }, [customerSearch, selectedCustomer]);

  const customerOptions = useMemo(() => {
    const search = customerSearch.trim().toLowerCase();
    const sorted = [...data.customers].sort((left, right) => left.name.localeCompare(right.name));
    if (!search) {
      return sorted.slice(0, 8);
    }
    return sorted
      .filter((customer) =>
        [customer.name, customer.phone, customer.email ?? "", customer.patientCode ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(search),
      )
      .slice(0, 8);
  }, [customerSearch, data.customers]);

  const availableServices = useMemo(() => {
    if (!providerId) {
      return data.services;
    }
    const provider = data.providers.find((item) => item.id === providerId);
    if (!provider) {
      return data.services;
    }
    const mappedServices = data.services.filter((service) => provider.serviceIds.includes(service.id));
    return mappedServices.length ? mappedServices : data.services;
  }, [data.providers, data.services, providerId]);

  const selectedProvider = useMemo(
    () => data.providers.find((provider) => provider.id === providerId),
    [data.providers, providerId],
  );

  const selectedService = useMemo(
    () => data.services.find((service) => service.id === serviceId),
    [data.services, serviceId],
  );
  const requestedDurationMinutes = selectedService?.durationMinutes ?? initialAppointment?.durationMinutes ?? 0;

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
    // Phase 2: slot fetch will use cached snapshot when available
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
        locationId: data.locations[0]?.id,
        serviceId:
          selectedProvider?.serviceIds.length && serviceId ? serviceId : undefined,
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
            durationMinutes: response.durationMinutes || fallbackDuration,
            bufferMinutes: response.bufferMinutes || fallbackBuffer,
          });

          if (
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
    data.locations,
    dateKey,
    fetchProviderSlotsForBooking,
    initialAppointment?.id,
    initialAppointment?.startsAtIso,
    initialSlotIso,
    providerId,
    requestedDurationMinutes,
    selectedProvider?.serviceIds.length,
    selectedService?.bufferMinutes,
    selectedService?.durationMinutes,
    serviceId,
    showSlotPicker,
    slotPrefilled,
  ]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!providerId || !serviceId || !selectedSlotIso) {
      return;
    }

    let resolvedCustomerId = customerId;
    setCustomerError(null);

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
      locationId: data.locations[0]?.id,
      customerId: resolvedCustomerId,
      providerId,
      serviceIds: [serviceId],
      startsAtIso: selectedSlotIso,
      durationMinutes: slotState.durationMinutes || selectedService?.durationMinutes || 60,
      bufferMinutes: slotState.bufferMinutes || selectedService?.bufferMinutes || 0,
      priority,
      chair: chair || undefined,
      notes: notes || undefined,
    };

    setIsSaving(true);
    setSlotError(null);
    try {
      if (initialAppointment) {
        await updateAppointment(initialAppointment.id, draft);
      } else {
        await createAppointment(draft);
      }
      onClose();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "This slot is no longer available. Please choose another slot.";
      setSlotError(
        message.includes("available") || message.includes("overlap")
          ? "This slot is no longer available. Please choose another slot."
          : message,
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      subtitle={
        selectedSlotIso
          ? `Booking for ${
              availableProviders.find((provider) => provider.id === providerId)?.name ?? "provider"
            } on ${dateKey} at ${new Date(selectedSlotIso).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
              timeZone: "Asia/Kathmandu",
            })}.`
          : "Choose the patient and service first, then assign an appointment slot."
      }
      title={initialAppointment ? "Edit appointment" : "Book appointment"}
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <BookingSection
          description="These details describe the visit and do not block slot lookup."
          title="Client and service"
        >
          <div className="flex gap-2">
            <button
              className={`rounded-md px-3 py-2 text-sm font-medium ${
                clientMode === "existing"
                  ? "bg-[var(--accent-soft)] text-[var(--brand-strong)]"
                  : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
              }`}
              onClick={() => setClientMode("existing")}
              type="button"
            >
              Existing client
            </button>
            <button
              className={`rounded-md px-3 py-2 text-sm font-medium ${
                clientMode === "new"
                  ? "bg-[var(--accent-soft)] text-[var(--brand-strong)]"
                  : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
              }`}
              onClick={() => setClientMode("new")}
              type="button"
            >
              New client
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
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
                      onChange={(event) => setCustomerSearch(event.target.value)}
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
                            className={`flex w-full items-start justify-between gap-3 border-b border-[var(--border)] px-3 py-3 text-left last:border-b-0 ${
                              active
                                ? "bg-[var(--surface-muted)]"
                                : "bg-white hover:bg-[var(--surface-muted)]"
                            }`}
                            key={customer.id}
                            onClick={() => {
                              setCustomerId(customer.id);
                              setCustomerSearch(customer.name);
                            }}
                            type="button"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-medium text-[var(--foreground)]">
                                {customer.name}
                              </div>
                              <div className="truncate text-xs text-[var(--text-muted)]">
                                {[customer.patientCode, customer.phone, customer.email]
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
                  <div className="grid gap-3 md:grid-cols-2">
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
                                  className={`rounded-md px-3 py-2 text-xs font-medium ${
                                    active && selectedMatchAction?.mode === "use_existing"
                                      ? "bg-[var(--foreground)] text-white"
                                      : "bg-white text-[var(--foreground)]"
                                  }`}
                                  onClick={() =>
                                    setSelectedMatchAction({
                                      mode: "use_existing",
                                      customer: match.customer,
                                    })
                                  }
                                  type="button"
                                >
                                  Use existing
                                </button>
                                <button
                                  className={`rounded-md px-3 py-2 text-xs font-medium ${
                                    active && selectedMatchAction?.mode === "update_existing"
                                      ? "bg-[var(--foreground)] text-white"
                                      : "bg-white text-[var(--foreground)]"
                                  }`}
                                  onClick={() =>
                                    setSelectedMatchAction({
                                      mode: "update_existing",
                                      customer: match.customer,
                                    })
                                  }
                                  type="button"
                                >
                                  Update existing
                                </button>
                                <button
                                  className="rounded-md bg-white px-3 py-2 text-xs font-medium text-[var(--foreground)]"
                                  onClick={() => setSelectedMatchAction(null)}
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
                  {customerError ? (
                    <div className="text-sm text-[var(--danger)]">{customerError}</div>
                  ) : null}
                </div>
              )}
            </Field>

            <Field label="Service">
              <select
                className={inputClassName}
                onChange={(event) => setServiceId(event.target.value)}
                value={serviceId}
              >
                {availableServices.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </BookingSection>

        <BookingSection
          className="border-[var(--accent)]/20 bg-[var(--surface-muted)]"
          description="Choose the doctor and date. Available slots load from the live booking engine."
          title="Appointment slot selection"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
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
                      <Button onClick={() => setShowSlotPicker(true)} variant="secondary">
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
                  <div className="grid max-h-72 gap-2 overflow-auto md:grid-cols-3">
                    {slotState.slots.map((slot) => {
                      const active = slot.startsAtIso === selectedSlotIso;
                      return (
                        <button
                          className={`rounded-md border px-3 py-3 text-left text-sm transition ${
                            active
                              ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                              : "border-[var(--border)] bg-white hover:border-[var(--accent)]"
                          }`}
                          key={slot.startsAtIso}
                          onClick={() => {
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
                  <div className="mt-3 text-sm text-[var(--danger)]">{slotError}</div>
                ) : null}
              </div>
            </Field>
          </div>
        </BookingSection>

        <BookingSection
          description="Attach any operational details that front desk or clinical staff should keep with this visit."
          title="Additional details"
        >
          <div className="grid gap-4 md:grid-cols-3">
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
            <Field label="Chair">
              <input
                className={inputClassName}
                onChange={(event) => setChair(event.target.value)}
                placeholder="Chair 2"
                value={chair}
              />
            </Field>
            <Field label="Location">
              <input className={inputClassName} disabled value={data.locations[0]?.name ?? "Main clinic"} />
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

        <div className="flex justify-end gap-2">
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
    </Modal>
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
