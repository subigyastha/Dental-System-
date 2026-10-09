"use client";

import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getPrimaryAppointmentAction } from "@/lib/appointment-workflow";
import { buildDayTimeline, replacementCancellationNote, groupScheduleSlots, type ScheduleDisplayGroup } from "@/lib/schedule-display";
import {
  CalendarPlus2,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Filter,
  PencilLine,
  Search,
  Trash2,
} from "lucide-react";

import {
  AppointmentDateHeader,
  DualCalendarDatePicker,
  DualDateDisplay,
} from "@/components/calendar-ui";
import { KoiSectionLoader } from "@/components/koi-loader";
import { Button, Panel, PriorityTag, StatusPill } from "@/components/ui";
import { AppointmentBookingModal } from "@/components/workspace/appointment-booking-modal";
import { useWorkspaceApp } from "@/components/workspace/app-state";
import {
  EmptyState,
  Modal,
  PageHeader,
  inputClassName,
} from "@/components/workspace/elements";
import {
  MobileWorkspaceBottomNav,
  MobileWorkspaceMoreSheet,
} from "@/components/workspace/mobile-workspace-nav";
import { useSecureSignOut } from "@/components/workspace/secure-sign-out";
import { useQuickBook } from "@/components/workspace/quick-book-provider";
import {
  buildAppointmentView,
  formatClockRange,
} from "@/components/workspace/workspace-utils";
import {
  buildCalendarGrid,
  shiftCalendarPage,
  toDateKey,
} from "@/lib/calendar";
import type {
  Appointment,
  AppointmentDaySummary,
  AppointmentWeekSummary,
  ProviderDayScheduleGrid,
} from "@/lib/domain";

type CalendarView = "day" | "week" | "month";
type AppointmentView = ReturnType<typeof buildAppointmentView>;

export function ScheduleDateLabel({
  adDateKey,
  mode,
  primaryClassName = "text-base font-semibold",
  secondaryClassName = "text-xs",
}: {
  adDateKey: string;
  mode: "AD" | "BS";
  primaryClassName?: string;
  secondaryClassName?: string;
}) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "Asia/Kathmandu",
  }).format(new Date(`${adDateKey}T12:00:00+05:45`));
  return (
    <div>
      <div className="mb-1 text-sm font-semibold text-[var(--text-muted)]">
        {weekday}
      </div>
      <DualDateDisplay
        adDateKey={adDateKey}
        mode={mode}
        primaryClassName={primaryClassName}
        secondaryClassName={secondaryClassName}
      />
    </div>
  );
}

function scheduleSlotAction(slot: ScheduleDisplayGroup["slot"] | undefined, appointment: AppointmentView | undefined, canBook: boolean) {
  if (slot?.state === "BOOKED" || slot?.state === "HISTORY") return appointment ? "details" : null;
  return slot?.state === "AVAILABLE" && canBook ? "book" : null;
}
export function scheduleAppointmentColor(status: Appointment["status"], communicationState: string | undefined, providerColor: string) {
  if (status === "Cancelled") return "#dc2626";
  if (status === "Scheduled" && communicationState !== "Confirmed by phone") return "#ca8a04";
  return providerColor;
}
function cancelledSlotNote(slot: ScheduleDisplayGroup["slot"]) {
  return slot.cancelledSummary ? `Cancelled: ${slot.cancelledSummary.customerName} - ${slot.cancelledSummary.reason}. Available to book.` : null;
}
function occupiedSlotLabel(slot: ScheduleDisplayGroup["slot"], appointment?: AppointmentView) {
  const continuation = appointment && new Date(slot.startTime).getTime() > new Date(appointment.startsAtIso).getTime();
  return `${continuation ? "Continues" : "Occupied"} until ${formatClockLabel(slot.endTime)}`;
}
const selfBookingRestrictedRoles = new Set(["Provider", "Assistant"]);
const crossProviderBookingRoles = new Set([
  "Owner",
  "Admin",
  "Manager",
  "Receptionist",
  "Scheduler",
]);

export function resolveAppointmentOverlay(
  hasEditor: boolean,
  hasDetails: boolean,
) {
  if (hasEditor) return "editor" as const;
  if (hasDetails) return "details" as const;
  return "none" as const;
}

export function isScheduleRequestPending(
  active: boolean,
  requestKey: string,
  settledKey: string | null,
) {
  return active && requestKey !== settledKey;
}

export function ReservationsPage({
  providerScope,
  visibleProviderScope,
}: {
  providerScope?: string;
  visibleProviderScope?: string;
}) {
  const router = useRouter();
  const { canOpen: canQuickBook, openQuickBook } = useQuickBook();
  const { isBlocked: isLogoutBlocked, isSigningOut, requestSignOut } = useSecureSignOut();
  const {
    calendarMode,
    data,
    deleteAppointment,
    fetchAppointmentDaySummaries,
    fetchAppointmentsRange,
    fetchScheduleDay,
    fetchWeekOperationalSummaries,
    invalidatePlanningCaches,
    planningRevision,
    selectedDate,
    sessionUser,
    setCalendarMode,
    setSelectedDate,
    updateAppointmentStatus,
    workspaceBootstrap,
  } = useWorkspaceApp();
  const [calendarView, setCalendarView] = useState<CalendarView>("day");
  const [selectedProviderId, setSelectedProviderId] = useState("all");
  const [rangeAppointments, setRangeAppointments] = useState<Appointment[]>([]);
  const [settledRangeKey, setSettledRangeKey] = useState<string | null>(null);
  const [monthSummaries, setMonthSummaries] = useState<AppointmentDaySummary[]>([]);
  const [weekSummaries, setWeekSummaries] = useState<AppointmentWeekSummary[]>([]);
  const [settledSummaryKey, setSettledSummaryKey] = useState<string | null>(null);
  const [dayScheduleGrid, setDayScheduleGrid] = useState<ProviderDayScheduleGrid | null>(null);
  const [settledDayGridKey, setSettledDayGridKey] = useState<string | null>(null);
  const [planningError, setPlanningError] = useState<string | null>(null);
  const [monthAnchorDate, setMonthAnchorDate] = useState(selectedDate);
  const [selectedDayDetailsDate, setSelectedDayDetailsDate] = useState(selectedDate);
  const [bookingState, setBookingState] = useState<{
    customerId?: string;
    date?: string;
    providerId?: string;
    appointment?: Appointment;
    slotIso?: string;
    mode?: "book" | "edit" | "reschedule";
  } | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const appointmentOverlay = resolveAppointmentOverlay(
    Boolean(bookingState),
    Boolean(selectedAppointment),
  );

  const activeDate = calendarView === "month" ? selectedDayDetailsDate : selectedDate;
  const sessionRoles = sessionUser?.effectiveRoles?.length
    ? sessionUser.effectiveRoles
    : sessionUser
      ? [sessionUser.role]
      : [];
  const canBookAcrossProviders = sessionRoles.some((role) =>
    crossProviderBookingRoles.has(role),
  );
  const sessionBookingScope =
    sessionUser?.providerId &&
    sessionRoles.some((role) => selfBookingRestrictedRoles.has(role)) &&
    !canBookAcrossProviders
      ? sessionUser.providerId
      : undefined;
  const bookingProviderLimit = visibleProviderScope ?? sessionBookingScope ?? providerScope;
  const title = visibleProviderScope ? "My schedule" : "Reservations";
  const subtitle = visibleProviderScope
    ? "Your board shows only your own schedule and availability."
    : bookingProviderLimit
      ? "See the full clinic board here. You can review every provider schedule, but new bookings are limited to your own calendar."
    : "Keep planning views fast, then drop into Day view when it is time to book or edit.";

  const visibleProviders = useMemo(
    () =>
      data.providers.filter((provider) => {
        if (provider.status === "Inactive") {
          return false;
        }
        if (visibleProviderScope) {
          return provider.id === visibleProviderScope;
        }
        return selectedProviderId === "all" ? true : provider.id === selectedProviderId;
      }),
    [data.providers, selectedProviderId, visibleProviderScope],
  );

  const appointmentViews = useMemo(
    () =>
      rangeAppointments
        .map((appointment) =>
          buildAppointmentView(appointment, data.customers, data.providers, data.services),
        )
        .sort((a, b) => new Date(a.startsAtIso).getTime() - new Date(b.startsAtIso).getTime()),
    [data.customers, data.providers, data.services, rangeAppointments],
  );

  const appointmentById = useMemo(
    () => new Map(appointmentViews.map((appointment) => [appointment.id, appointment])),
    [appointmentViews],
  );

  const providerDetailsById = useMemo(
    () => new Map(data.providers.map((provider) => [provider.id, provider])),
    [data.providers],
  );

  const monthGrid = useMemo(
    () => buildCalendarGrid(monthAnchorDate, calendarMode),
    [calendarMode, monthAnchorDate],
  );

  const weekDateKeys = useMemo(() => getWeekDateKeys(selectedDate), [selectedDate]);
  const locationId = data.locations[0]?.id ?? "location:none";
  const providerRequestKey = visibleProviders.map((provider) => provider.id).join(",");
  const dayGridRequestKey = [
    selectedDate,
    providerRequestKey,
    locationId,
    planningRevision,
  ].join("|");
  const rangeRequestKey = [
    calendarView,
    selectedDate,
    monthAnchorDate,
    selectedProviderId,
    locationId,
    planningRevision,
  ].join("|");
  const summaryRequestKey = [
    calendarView,
    selectedDate,
    monthAnchorDate,
    selectedProviderId,
    locationId,
    planningRevision,
  ].join("|");
  const dayGridLoading = isScheduleRequestPending(
    calendarView === "day" && visibleProviders.length > 0,
    dayGridRequestKey,
    settledDayGridKey,
  );
  const rangeLoading = isScheduleRequestPending(
    calendarView !== "day",
    rangeRequestKey,
    settledRangeKey,
  );
  const summaryLoading = isScheduleRequestPending(
    calendarView === "week" || calendarView === "month",
    summaryRequestKey,
    settledSummaryKey,
  );

  const selectedDayAppointments = useMemo(
    () =>
      appointmentViews.filter((appointment) => toDateKey(appointment.startsAtIso) === activeDate),
    [activeDate, appointmentViews],
  );

  const weekAppointmentsByDate = useMemo(() => {
    const grouped = new Map<string, AppointmentView[]>();
    weekDateKeys.forEach((dateKey) => grouped.set(dateKey, []));
    appointmentViews.forEach((appointment) => {
      const dateKey = toDateKey(appointment.startsAtIso);
      if (!grouped.has(dateKey)) {
        return;
      }
      grouped.get(dateKey)?.push(appointment);
    });

    grouped.forEach((appointments) =>
      appointments.sort(
        (left, right) => new Date(left.startsAtIso).getTime() - new Date(right.startsAtIso).getTime(),
      ),
    );

    return grouped;
  }, [appointmentViews, weekDateKeys]);

  const openBooking = useCallback((
    providerId?: string,
    date?: string,
    appointment?: Appointment,
    slotIso?: string,
  ) => {
    if (appointment) {
      setBookingState({
        providerId,
        date,
        appointment,
        slotIso,
      });
      return;
    }
    if (!canQuickBook) {
      return;
    }

    openQuickBook({
      locationId: data.locations[0]?.id,
      refs: Object.fromEntries(
        Object.entries({ providerId, date, slotIso }).filter(
          (entry): entry is [string, string] => Boolean(entry[1]),
        ),
      ),
    });
  }, [canQuickBook, data.locations, openQuickBook]);

  useEffect(() => {
    setSelectedDayDetailsDate(selectedDate);
    setMonthAnchorDate(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    if (calendarView === "day") {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const { fromIso, toIso } = getVisibleRange(calendarView, selectedDate, monthAnchorDate);
    setPlanningError(null);

    void fetchAppointmentsRange({
      fromIso,
      toIso,
      providerId: selectedProviderId === "all" ? undefined : selectedProviderId,
      locationId: data.locations[0]?.id,
      signal: controller.signal,
    })
      .then((appointments) => {
        if (!cancelled) {
          setRangeAppointments(appointments);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlanningError("The visible appointments could not be loaded. Try the date or view again.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSettledRangeKey(rangeRequestKey);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    calendarView,
    data.locations,
    fetchAppointmentsRange,
    monthAnchorDate,
    planningRevision,
    rangeRequestKey,
    selectedDate,
    selectedProviderId,
  ]);

  useEffect(() => {
    if (calendarView !== "month") {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const monthKeys = getMonthDateKeys(monthGrid.cells);
    setPlanningError(null);
    void fetchAppointmentDaySummaries({
      fromDateKey: monthKeys.fromDateKey,
      toDateKey: monthKeys.toDateKey,
      providerId: selectedProviderId === "all" ? undefined : selectedProviderId,
      locationId: data.locations[0]?.id,
      signal: controller.signal,
    })
      .then((summaries) => {
        if (!cancelled) {
          setMonthSummaries(summaries);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlanningError("The month summary could not be loaded. Try again.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSettledSummaryKey(summaryRequestKey);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    calendarView,
    data.locations,
    fetchAppointmentDaySummaries,
    monthGrid.cells,
    planningRevision,
    selectedProviderId,
    summaryRequestKey,
  ]);

  useEffect(() => {
    if (calendarView !== "week") {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setPlanningError(null);
    void fetchWeekOperationalSummaries({
      fromDateKey: weekDateKeys[0] ?? selectedDate,
      toDateKey: weekDateKeys[weekDateKeys.length - 1] ?? selectedDate,
      providerId: selectedProviderId === "all" ? undefined : selectedProviderId,
      locationId: data.locations[0]?.id,
      signal: controller.signal,
    })
      .then((summaries) => {
        if (!cancelled) {
          setWeekSummaries(summaries);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlanningError("The week summary could not be loaded. Try again.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSettledSummaryKey(summaryRequestKey);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    calendarView,
    data.locations,
    fetchWeekOperationalSummaries,
    planningRevision,
    selectedDate,
    selectedProviderId,
    summaryRequestKey,
    weekDateKeys,
  ]);

  useEffect(() => {
    if (calendarView !== "day" || !visibleProviders.length) {
      setDayScheduleGrid(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setPlanningError(null);
    const providerIds = visibleProviders.map((provider) => provider.id);
    // A failed navigation must not relabel the previous day's actionable slots.
    setDayScheduleGrid(null);
    setRangeAppointments([]);
    const locationId = data.locations[0]?.id;
    void fetchScheduleDay({
      providerIds,
      date: selectedDate,
      locationId,
      signal: controller.signal,
    })
      .then((snapshot) => {
        if (!cancelled) {
          if (snapshot.grid.date !== selectedDate || snapshot.grid.providers.some(provider => !providerIds.includes(provider.providerId))) {
            throw new Error("Schedule response does not match the selected day/provider scope");
          }
          setDayScheduleGrid(snapshot.grid);
          setRangeAppointments(snapshot.appointments);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlanningError("Provider availability could not be loaded. Try again.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSettledDayGridKey(dayGridRequestKey);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    calendarView,
    data.locations,
    dayGridRequestKey,
    fetchScheduleDay,
    planningRevision,
    selectedDate,
    visibleProviders,
  ]);

  const summaryByDate = useMemo(
    () => new Map(monthSummaries.map((summary) => [summary.dateKey, summary])),
    [monthSummaries],
  );

  const weekSummaryByDate = useMemo(
    () => new Map(weekSummaries.map((summary) => [summary.dateKey, summary])),
    [weekSummaries],
  );

  const providerFilterOptions = useMemo(
    () =>
      data.providers
        .filter((provider) => provider.status !== "Inactive")
        .map((provider) => ({
          id: provider.id,
          name: provider.name,
          specialty: provider.specialty,
          color: provider.color,
          appointmentCount: appointmentViews.filter((appointment) => appointment.providerId === provider.id).length,
        })),
    [appointmentViews, data.providers],
  );

  return (
    <div className="space-y-5 md:space-y-5">
      {planningError ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
          role="alert"
        >
          <span>{planningError}</span>
          <Button onClick={() => invalidatePlanningCaches()} variant="ghost">Retry schedule</Button>
        </div>
      ) : null}
      <div className="hidden md:block">
        <PageHeader
          title={title}
          subtitle={subtitle}
          action={canQuickBook ? (
            <Button onClick={() => openBooking(bookingProviderLimit, activeDate)}>
              <CalendarPlus2 size={16} />
              New appointment
            </Button>
          ) : undefined}
        />

        <div className="mt-5 rounded-[28px] border border-[var(--border)] bg-[color:rgba(237,247,245,0.75)] p-4 shadow-[0_20px_60px_rgba(15,55,52,0.08)]">
          <div className="flex flex-wrap items-center gap-4">
            <label className="relative min-w-[320px] flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={18} />
              <input
                className="h-12 w-full rounded-full border border-[var(--border)] bg-white pl-11 pr-4 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]"
                placeholder="Quick search appointments or Clients..."
                type="search"
              />
            </label>
            <div className="rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm text-[var(--text-muted)]">
              {visibleProviders.length} provider{visibleProviders.length === 1 ? "" : "s"} visible
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-[var(--border)] bg-white px-5 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                {calendarView === "week" ? (
                  <div className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
                    {formatWeekRangeLabel(weekDateKeys)}
                  </div>
                ) : (
                  <ScheduleDateLabel
                    adDateKey={selectedDate}
                    mode={calendarMode}
                    primaryClassName="text-3xl font-semibold tracking-tight"
                    secondaryClassName="text-sm"
                  />
                )}
              </div>
              <div className="ml-2 flex flex-wrap items-center gap-2">
                <button
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground)] transition hover:bg-white"
                  onClick={() => handlePrevious(calendarView, selectedDate, monthAnchorDate, setSelectedDate, setMonthAnchorDate)}
                  type="button"
                >
                  <ChevronLeft size={16} />
                </button>
                <DateShortcutButton
                  active={selectedDate === todayDateKey()}
                  label="Today"
                  onClick={() => {
                    setSelectedDate(todayDateKey());
                    setMonthAnchorDate(todayDateKey());
                  }}
                />
                <button
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground)] transition hover:bg-white"
                  onClick={() => handleNext(calendarView, selectedDate, monthAnchorDate, setSelectedDate, setMonthAnchorDate)}
                  type="button"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <ViewToggle current={calendarView} onChange={setCalendarView} />
          </div>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.9fr)_320px]">
          <div className="min-w-0 space-y-5">
            {calendarView === "day" ? (
              <DayGridPanel
                appointmentById={appointmentById}
                calendarMode={calendarMode}
                dateKey={selectedDate}
                isLoading={dayGridLoading}
                lockedProviderId={bookingProviderLimit}
                onBookedSlotClick={setSelectedAppointment}
                onOpenBooking={openBooking}
                scheduleGrid={dayScheduleGrid}
              />
            ) : null}

            {calendarView === "week" ? (
              <WeekPanel
                appointmentsByDate={weekAppointmentsByDate}
                isLoading={rangeLoading || summaryLoading}
                lockedProviderId={bookingProviderLimit}
                onBookedSlotClick={setSelectedAppointment}
                onOpenBooking={openBooking}
                onOpenDay={(dateKey) => {
                  setSelectedDate(dateKey);
                  setCalendarView("day");
                }}
                providerDetailsById={providerDetailsById}
                visibleProviders={visibleProviders}
                weekDateKeys={weekDateKeys}
                weekSummaryByDate={weekSummaryByDate}
              />
            ) : null}

            {calendarView === "month" ? (
              <MonthPanel
                calendarMode={calendarMode}
                grid={monthGrid}
                onChangeMonth={(months) =>
                  setMonthAnchorDate(shiftCalendarPage(monthAnchorDate, calendarMode, months))
                }
                onDaySelect={setSelectedDayDetailsDate}
                onOpenDay={(dateKey) => {
                  setSelectedDayDetailsDate(dateKey);
                  setSelectedDate(dateKey);
                  setCalendarView("day");
                }}
                selectedDate={selectedDayDetailsDate}
                summaries={summaryByDate}
                summaryLoading={summaryLoading}
              />
            ) : null}
          </div>

          <div className="space-y-5">
            <ScheduleFiltersRail
              activeDate={activeDate}
              calendarMode={calendarMode}
              calendarView={calendarView}
              onProviderChange={setSelectedProviderId}
              onSelectDate={setSelectedDate}
              providerOptions={providerFilterOptions}
              selectedProviderId={selectedProviderId}
              setCalendarMode={setCalendarMode}
              visibleProviderScope={visibleProviderScope}
            />

            {calendarView === "month" ? (
              <MonthDayRail
                appointments={selectedDayAppointments}
                calendarMode={calendarMode}
                dateKey={selectedDayDetailsDate}
                onAppointmentClick={setSelectedAppointment}
                onOpenBooking={() => {
                  setSelectedDate(selectedDayDetailsDate);
                  setCalendarView("day");
                }}
              />
            ) : calendarView === "week" ? (
              <WeekInsightRail
                calendarMode={calendarMode}
                selectedDate={selectedDate}
                weekDateKeys={weekDateKeys}
                weekSummaryByDate={weekSummaryByDate}
              />
            ) : (
              <DayListPanel
                appointments={selectedDayAppointments}
                calendarMode={calendarMode}
                dateKey={selectedDate}
                isLoading={dayGridLoading}
                loadError={Boolean(planningError)}
                onAppointmentClick={setSelectedAppointment}
              />
            )}
          </div>
        </div>
      </div>

      <div className="pb-24 md:hidden">
        <MobileReservationsView
          appointmentById={appointmentById}
          appointments={selectedDayAppointments}
          appointmentsByDate={weekAppointmentsByDate}
          calendarMode={calendarMode}
          calendarView={calendarView}
          canBook={canQuickBook}
          dayGridLoading={dayGridLoading}
          monthAnchorDate={monthAnchorDate}
          monthGrid={monthGrid}
          monthSummaries={summaryByDate}
          isLogoutBlocked={isLogoutBlocked}
          isLoggingOut={isSigningOut}
          onChangeMonth={(months) =>
            setMonthAnchorDate(shiftCalendarPage(monthAnchorDate, calendarMode, months))
          }
          onChangeView={setCalendarView}
          onLogout={requestSignOut}
          onMoreOpenChange={setMobileMoreOpen}
          onOpenAppointment={setSelectedAppointment}
          onOpenBooking={openBooking}
          onSelectDate={setSelectedDate}
          onSelectDayDetailsDate={setSelectedDayDetailsDate}
          moreOpen={mobileMoreOpen}
          hasInventoryAccess={workspaceBootstrap.context.capabilities.canAccessInventory}
          hasStaffAccess={workspaceBootstrap.context.capabilities.canAccessStaff}
          providerOptions={data.providers.filter((provider) => provider.status !== "Inactive")}
          providerScope={bookingProviderLimit}
          router={router}
          selectedDate={selectedDate}
          selectedDayDetailsDate={selectedDayDetailsDate}
          selectedProviderId={selectedProviderId}
          sessionUser={sessionUser!}
          setCalendarMode={setCalendarMode}
          setMonthAnchorDate={setMonthAnchorDate}
          setSelectedProviderId={setSelectedProviderId}
          summaryLoading={summaryLoading}
          title={title}
          visibleProviderScope={visibleProviderScope}
          dayScheduleGrid={dayScheduleGrid}
          weekDateKeys={weekDateKeys}
          weekSummaryByDate={weekSummaryByDate}
        />
      </div>

      {appointmentOverlay === "editor" && bookingState ? (
        <AppointmentBookingModal
          defaultCustomerId={bookingState.customerId}
          defaultProviderId={bookingState.providerId}
          fixedProviderId={bookingProviderLimit ? bookingProviderLimit : undefined}
          initialDate={bookingState.date}
          initialAppointment={bookingState.appointment}
          initialSlotIso={bookingState.slotIso}
          mode={bookingState.mode}
          onBooked={() => setSelectedAppointment(null)}
          onClose={() => setBookingState(null)}
        />
      ) : appointmentOverlay === "details" && selectedAppointment ? (
        <AppointmentDetailModal
          appointment={buildAppointmentView(
            selectedAppointment,
            data.customers,
            data.providers,
            data.services,
          )}
          onClose={() => setSelectedAppointment(null)}
          onDelete={async () => {
            await deleteAppointment(selectedAppointment.id);
            setSelectedAppointment(null);
          }}
          onEdit={() =>
            openBooking(
              selectedAppointment.providerId,
              toDateKey(selectedAppointment.startsAtIso),
              selectedAppointment,
            )
          }
          onReschedule={() =>
            setBookingState({
              appointment: selectedAppointment,
              date: toDateKey(selectedAppointment.startsAtIso),
              providerId: selectedAppointment.providerId,
              mode: "reschedule",
            })
          }
          onStatusChange={async (status, reason) => {
            await updateAppointmentStatus(selectedAppointment.id, status, reason);
            setSelectedAppointment(null);
          }}
        />
      ) : null}
    </div>
  );
}

function MobileReservationsView({
  appointmentById,
  appointments,
  appointmentsByDate,
  calendarMode,
  calendarView,
  canBook,
  dayGridLoading,
  dayScheduleGrid,
  monthAnchorDate,
  monthGrid,
  monthSummaries,
  isLogoutBlocked,
  isLoggingOut,
  onChangeMonth,
  onChangeView,
  onLogout,
  onMoreOpenChange,
  onOpenAppointment,
  onOpenBooking,
  onSelectDate,
  onSelectDayDetailsDate,
  moreOpen,
  hasInventoryAccess,
  hasStaffAccess,
  providerOptions,
  providerScope,
  router,
  selectedDate,
  selectedDayDetailsDate,
  selectedProviderId,
  sessionUser,
  setCalendarMode,
  setMonthAnchorDate,
  setSelectedProviderId,
  summaryLoading,
  title,
  visibleProviderScope,
  weekDateKeys,
  weekSummaryByDate,
}: {
  appointmentById: Map<string, ReturnType<typeof buildAppointmentView>>;
  appointments: ReturnType<typeof buildAppointmentView>[];
  appointmentsByDate: Map<string, AppointmentView[]>;
  calendarMode: "BS" | "AD";
  calendarView: CalendarView;
  canBook: boolean;
  dayGridLoading: boolean;
  dayScheduleGrid: ProviderDayScheduleGrid | null;
  monthAnchorDate: string;
  monthGrid: ReturnType<typeof buildCalendarGrid>;
  monthSummaries: Map<string, AppointmentDaySummary>;
  isLogoutBlocked: boolean;
  isLoggingOut: boolean;
  onChangeMonth: (months: number) => void;
  onChangeView: (view: CalendarView) => void;
  onLogout: () => void;
  onMoreOpenChange: (open: boolean) => void;
  onOpenAppointment: (appointment: Appointment) => void;
  onOpenBooking: (
    providerId?: string,
    date?: string,
    appointment?: Appointment,
    slotIso?: string,
  ) => void;
  onSelectDate: (dateKey: string) => void;
  onSelectDayDetailsDate: (dateKey: string) => void;
  moreOpen: boolean;
  hasInventoryAccess: boolean;
  hasStaffAccess: boolean;
  providerOptions: Array<{ id: string; name: string; status: string; specialty: string; color: string }>;
  providerScope?: string;
  router: ReturnType<typeof useRouter>;
  selectedDate: string;
  selectedDayDetailsDate: string;
  selectedProviderId: string;
  sessionUser: NonNullable<ReturnType<typeof useWorkspaceApp>["sessionUser"]>;
  setCalendarMode: (mode: "BS" | "AD") => void;
  setMonthAnchorDate: (dateKey: string) => void;
  setSelectedProviderId: (providerId: string) => void;
  summaryLoading: boolean;
  title: string;
  visibleProviderScope?: string;
  weekDateKeys: string[];
  weekSummaryByDate: Map<string, AppointmentWeekSummary>;
}) {
  const selectedDateLabel = (
    <ScheduleDateLabel
      adDateKey={calendarView === "month" ? monthAnchorDate : selectedDate}
      mode={calendarMode}
      primaryClassName="text-base font-semibold"
      secondaryClassName="text-xs"
    />
  );

  return (
    <div className="mobile-schedule space-y-4">
      <div className="sticky top-[57px] z-10 -mx-4 border-b border-[var(--border)] bg-[var(--surface)]/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-[var(--foreground)]">{title}</div>
            <div className="mt-1">{selectedDateLabel}</div>
          </div>
          <div className="shrink-0">
            <ViewToggle
              current={calendarView}
              onChange={(view) => {
                onChangeView(view);
              }}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)]"
            onClick={() =>
              calendarView === "month"
                ? onChangeMonth(-1)
                : onSelectDate(addDaysToDateKey(selectedDate, -1))
            }
            type="button"
          >
            <ChevronLeft size={16} />
          </button>
          <DateShortcutButton
            active={selectedDate === todayDateKey()}
            label="Today"
            onClick={() => {
              onSelectDate(todayDateKey());
              setMonthAnchorDate(todayDateKey());
            }}
          />
          <button
            className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)]"
            onClick={() =>
              calendarView === "month"
                ? onChangeMonth(1)
                : onSelectDate(addDaysToDateKey(selectedDate, 1))
            }
            type="button"
          >
            <ChevronRight size={16} />
          </button>
          {!visibleProviderScope ? (
            <select
              className={`${inputClassName} min-w-0 flex-1`}
              onChange={(event) => setSelectedProviderId(event.target.value)}
              value={selectedProviderId}
            >
              <option value="all">All providers</option>
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      {calendarView === "day" ? (
        <div className="space-y-4">
          <Panel title="Today">
            <div className="p-4">
              <DualCalendarDatePicker
                mode={calendarMode}
                onChange={onSelectDate}
                onModeChange={setCalendarMode}
                value={selectedDate}
              />
            </div>
          </Panel>
          {!visibleProviderScope ? (
            <Panel title="Providers">
              <div className="flex gap-2 overflow-x-auto p-4 scrollbar-quiet">
                <button
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${
                    selectedProviderId === "all"
                      ? "bg-[var(--accent)] text-white"
                      : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
                  }`}
                  onClick={() => setSelectedProviderId("all")}
                  type="button"
                >
                  All
                </button>
                {providerOptions.map((provider) => (
                  <button
                    className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${
                      selectedProviderId === provider.id
                        ? "bg-[var(--accent)] text-white"
                        : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
                    }`}
                    key={provider.id}
                    onClick={() => setSelectedProviderId(provider.id)}
                    type="button"
                  >
                    {provider.name}
                  </button>
                ))}
              </div>
            </Panel>
          ) : null}
          <Panel title="Day schedule">
            <div className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold">{formatShortWeekday(selectedDate)} · {selectedDate}</div>
            {dayGridLoading ? (
              <KoiSectionLoader label="Loading day schedule" />
            ) : dayScheduleGrid ? (
              <MobileDayScheduleList
                appointmentById={appointmentById}
                lockedProviderId={providerScope}
                onBookedSlotClick={onOpenAppointment}
                onOpenBooking={onOpenBooking}
                scheduleGrid={dayScheduleGrid}
              />
            ) : (
              <div className="p-4 text-sm text-[var(--text-muted)]">No schedule available.</div>
            )}
          </Panel>
        </div>
      ) : null}

      {calendarView === "week" ? (
        <WeekPanel
          appointmentsByDate={appointmentsByDate}
          isLoading={dayGridLoading || summaryLoading}
          lockedProviderId={providerScope}
          onBookedSlotClick={onOpenAppointment}
          onOpenBooking={onOpenBooking}
          onOpenDay={(dateKey) => {
            onSelectDate(dateKey);
            onChangeView("day");
          }}
          providerDetailsById={new Map(providerOptions.map((provider) => [provider.id, provider]))}
          visibleProviders={providerOptions.filter(
            (provider) => selectedProviderId === "all" || provider.id === selectedProviderId,
          )}
          weekDateKeys={weekDateKeys}
          weekSummaryByDate={weekSummaryByDate}
        />
      ) : null}

      {calendarView === "month" ? (
        <div className="space-y-4">
          <MonthPanel
            calendarMode={calendarMode}
            grid={monthGrid}
            onChangeMonth={onChangeMonth}
            onDaySelect={(dateKey) => { onSelectDayDetailsDate(dateKey); onSelectDate(dateKey); }}
            onOpenDay={(dateKey) => { onSelectDayDetailsDate(dateKey); onSelectDate(dateKey); onChangeView("day"); }}
            selectedDate={selectedDayDetailsDate}
            summaries={monthSummaries}
            summaryLoading={summaryLoading}
          />
          <MonthDayRail
            appointments={appointments}
            calendarMode={calendarMode}
            dateKey={selectedDayDetailsDate}
            onAppointmentClick={onOpenAppointment}
                onOpenBooking={() => {
                  onChangeView("day");
                }}
              />
        </div>
      ) : null}

      {moreOpen ? (
        <MobileWorkspaceMoreSheet
          hasBillingAccess={["Owner", "Admin", "Manager", "Receptionist", "Scheduler"].includes(
            sessionUser.role,
          )}
          hasInventoryAccess={hasInventoryAccess}
          hasStaffAccess={hasStaffAccess}
          hasMySchedule={Boolean(visibleProviderScope)}
          hasArchiveAccess={["Owner", "Admin"].includes(sessionUser.role)}
          hasSettingsAccess={["Owner", "Admin", "Manager"].includes(sessionUser.role)}
          isLogoutBlocked={isLogoutBlocked}
          isLoggingOut={isLoggingOut}
          onClose={() => onMoreOpenChange(false)}
          onLogout={onLogout}
          onNavigate={(href) => {
            onMoreOpenChange(false);
            router.push(href);
          }}
        />
      ) : null}

      <MobileWorkspaceBottomNav
        active="schedule"
        canBook={canBook}
        onBook={() => onOpenBooking(providerScope, selectedDate)}
        onMore={() => onMoreOpenChange(true)}
        onSchedule={() => {}}
      />
    </div>
  );
}

function ViewToggle({
  current,
  onChange,
}: {
  current: CalendarView;
  onChange: (view: CalendarView) => void;
}) {
  return (
    <div className="flex rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-1">
      {(["day", "week", "month"] as CalendarView[]).map((view) => (
        <button
          className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
            current === view
              ? "bg-white text-[var(--foreground)] shadow-sm"
              : "text-[var(--text-muted)]"
          }`}
          key={view}
          onClick={() => onChange(view)}
          type="button"
        >
          {view[0].toUpperCase() + view.slice(1)}
        </button>
      ))}
    </div>
  );
}

function DateShortcutButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-md border px-3 py-1.5 text-sm transition ${
        active
          ? "border-[var(--accent)] bg-white text-[var(--foreground)]"
          : "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)]"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function ScheduleFiltersRail({
  activeDate,
  calendarMode,
  calendarView,
  onProviderChange,
  onSelectDate,
  providerOptions,
  selectedProviderId,
  setCalendarMode,
  visibleProviderScope,
}: {
  activeDate: string;
  calendarMode: "BS" | "AD";
  calendarView: CalendarView;
  onProviderChange: (providerId: string) => void;
  onSelectDate: (dateKey: string) => void;
  providerOptions: Array<{
    id: string;
    name: string;
    specialty: string;
    color: string;
    appointmentCount: number;
  }>;
  selectedProviderId: string;
  setCalendarMode: (mode: "BS" | "AD") => void;
  visibleProviderScope?: string;
}) {
  return (
    <>
      <Panel title="Date">
        <div className="p-4">
          <DualCalendarDatePicker
            mode={calendarMode}
            onChange={onSelectDate}
            onModeChange={setCalendarMode}
            value={activeDate}
          />
        </div>
      </Panel>

      {!visibleProviderScope ? (
        <Panel title="Filters">
          <div className="space-y-4 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              <Filter size={14} />
              Providers
            </div>
            <div className="space-y-2">
              <ProviderFilterRow
                active={selectedProviderId === "all"}
                color="var(--accent)"
                count={providerOptions.reduce((sum, provider) => sum + provider.appointmentCount, 0)}
                label="All providers"
                onClick={() => onProviderChange("all")}
                subtitle="Full clinic board"
              />
              {providerOptions.map((provider) => (
                <ProviderFilterRow
                  active={selectedProviderId === provider.id}
                  color={provider.color}
                  count={provider.appointmentCount}
                  key={provider.id}
                  label={provider.name}
                  onClick={() => onProviderChange(provider.id)}
                  subtitle={provider.specialty || "Provider"}
                />
              ))}
            </div>
          </div>
        </Panel>
      ) : null}

      {calendarView === "week" ? (
        <Panel title="Board note">
          <div className="space-y-2 p-4 text-sm text-[var(--text-muted)]">
            <div className="font-medium text-[var(--foreground)]">Seven-day planning</div>
            <div>
              This week view stays lightweight on purpose. It shows appointment cards and daily capacity
              summaries, then sends you into Day view for live slot execution.
            </div>
          </div>
        </Panel>
      ) : null}
    </>
  );
}

function ProviderFilterRow({
  active,
  color,
  count,
  label,
  onClick,
  subtitle,
}: {
  active: boolean;
  color: string;
  count: number;
  label: string;
  onClick: () => void;
  subtitle: string;
}) {
  return (
    <button
      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
        active
          ? "border-[var(--accent)] bg-[var(--surface-muted)]"
          : "border-[var(--border)] bg-white hover:bg-[var(--surface-muted)]"
      }`}
      onClick={onClick}
      type="button"
    >
      <div
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border"
        style={{
          borderColor: active ? "transparent" : "var(--border)",
          backgroundColor: active ? "var(--accent)" : "white",
          color: active ? "white" : "transparent",
        }}
      >
        <Check size={13} />
      </div>
      <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-[var(--foreground)]">{label}</div>
        <div className="text-xs text-[var(--text-muted)]">{subtitle}</div>
      </div>
      <div className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)]">
        {count}
      </div>
    </button>
  );
}

function WeekInsightRail({
  calendarMode,
  selectedDate,
  weekDateKeys,
  weekSummaryByDate,
}: {
  calendarMode: "BS" | "AD";
  selectedDate: string;
  weekDateKeys: string[];
  weekSummaryByDate: Map<string, AppointmentWeekSummary>;
}) {
  return (
    <Panel title="Week pulse">
      <div className="border-b border-[var(--border)] p-4">
        <DualDateDisplay adDateKey={selectedDate} mode={calendarMode} />
      </div>
      <div className="space-y-3 p-4">
        {weekDateKeys.map((dateKey) => {
          const summary = weekSummaryByDate.get(dateKey);
          return (
            <div className="rounded-xl border border-[var(--border)] bg-white p-3" key={dateKey}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-[var(--foreground)]">{formatShortWeekday(dateKey)}</div>
                <div className="text-xs text-[var(--text-muted)]">{summary?.totalAppointments ?? 0} booked</div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(summary?.providers ?? []).slice(0, 4).map((provider) => (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium"
                    key={`${dateKey}-${provider.providerId}`}
                    style={{ backgroundColor: `${provider.color}18`, color: provider.color }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: provider.color }} />
                    {provider.appointmentCount}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export function WeekPanel({
  appointmentsByDate,
  isLoading,
  lockedProviderId,
  onBookedSlotClick,
  onOpenBooking,
  onOpenDay,
  providerDetailsById,
  visibleProviders,
  weekDateKeys,
  weekSummaryByDate,
}: {
  appointmentsByDate: Map<string, AppointmentView[]>;
  isLoading: boolean;
  lockedProviderId?: string;
  onBookedSlotClick: (appointment: Appointment) => void;
  onOpenBooking: (providerId: string, date: string) => void;
  onOpenDay: (dateKey: string) => void;
  providerDetailsById: Map<string, { color?: string }>;
  visibleProviders: Array<{ id: string; name: string; specialty?: string; color?: string }>;
  weekDateKeys: string[];
  weekSummaryByDate: Map<string, AppointmentWeekSummary>;
}) {
  return (
    <Panel className="min-w-0" title="Week view">
      {isLoading ? (
        <KoiSectionLoader className="min-h-[520px]" label="Loading weekly board" />
      ) : (
        <div className="max-h-[70vh] overflow-auto" data-testid="week-scroll-container">
          <div className="grid w-[700%] grid-cols-7 divide-x divide-[var(--border)] sm:w-auto sm:min-w-[1960px]">
            {weekDateKeys.map((dateKey) => {
              const summary = weekSummaryByDate.get(dateKey);
              const appointments = appointmentsByDate.get(dateKey) ?? [];
              return (
                <div className="flex min-h-[640px] flex-col bg-white" key={dateKey}>
                  <button
                    className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-4 text-left transition hover:bg-white"
                    onClick={() => onOpenDay(dateKey)}
                    type="button"
                  >
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      {formatShortWeekday(dateKey)}
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-[var(--foreground)]">
                      {new Date(`${dateKey}T12:00:00+05:45`).getDate()}
                    </div>
                    <div className="mt-2 text-xs text-[var(--text-muted)]">
                      {(summary?.totalAppointments ?? appointments.length)} appointments
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(summary?.providers ?? []).slice(0, 3).map((provider) => (
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium"
                          key={`${dateKey}-${provider.providerId}`}
                          style={{ backgroundColor: `${provider.color}16`, color: provider.color }}
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: provider.color }} />
                          {provider.name.split(" ")[0]}
                        </span>
                      ))}
                    </div>
                  </button>

                  <div className="flex-1 space-y-3 p-3">
                    {appointments.length ? (
                      appointments.map((appointment) => {
                        const providerColor =
                          appointment.provider?.color ??
                          providerDetailsById.get(appointment.providerId)?.color ??
                          "var(--accent)";
                        return (
                          <button
                            className="w-full rounded-2xl border border-[var(--border)] bg-white px-3 py-3 text-left shadow-[0_10px_30px_rgba(16,61,58,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(16,61,58,0.1)]"
                            key={appointment.id}
                            onClick={() => onBookedSlotClick(appointment)}
                            style={{ boxShadow: `inset 3px 0 0 ${scheduleAppointmentColor(appointment.status, appointment.communicationState, providerColor)}`, backgroundColor: `${scheduleAppointmentColor(appointment.status, appointment.communicationState, providerColor)}12` }}
                            type="button"
                          >
                            <div className="text-xs font-semibold text-[var(--text-muted)]">
                              {formatClockRange(appointment.startsAtIso, appointment.durationMinutes)}
                            </div>
                            <div className="mt-1 font-semibold text-[var(--foreground)]">
                              {appointment.customer?.name ?? "Unknown Client"}
                            </div>
                            <div className="mt-1 text-sm text-[var(--text-muted)]">
                              {appointment.procedureLabel}
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                              <span style={{ color: providerColor }}>
                                {appointment.provider?.name ?? "Provider"}
                              </span>
                              <StatusPill status={appointment.status} />
                              {appointment.status === "Cancelled" ? <span className="text-xs text-red-700">{appointment.cancellationReason || "Reason not recorded"}</span> : null}
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--text-muted)]">
                        No appointments booked yet.
                      </div>
                    )}

                    <div className="pt-1">
                      {visibleProviders.map((provider) => {
                        const canBookThisProvider =
                          !lockedProviderId || lockedProviderId === provider.id;
                        if (!canBookThisProvider && lockedProviderId) {
                          return null;
                        }
                        return (
                          <button
                            className="mt-2 flex w-full items-center justify-between rounded-xl border border-dashed border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:bg-[var(--surface-muted)]"
                            key={`${dateKey}-${provider.id}`}
                            onClick={() => onOpenBooking(provider.id, dateKey)}
                            type="button"
                          >
                            <span>Add for {provider.name}</span>
                            <span className="font-medium" style={{ color: provider.color ?? "var(--accent)" }}>
                              Open
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}

function DayGridPanel({
  appointmentById,
  calendarMode,
  dateKey,
  isLoading,
  lockedProviderId,
  onBookedSlotClick,
  onOpenBooking,
  scheduleGrid,
}: {
  appointmentById: Map<string, ReturnType<typeof buildAppointmentView>>;
  calendarMode: "BS" | "AD";
  dateKey: string;
  isLoading: boolean;
  lockedProviderId?: string;
  onBookedSlotClick: (appointment: Appointment) => void;
  onOpenBooking: (
    providerId: string,
    date: string,
    appointment?: Appointment,
    slotIso?: string,
  ) => void;
  scheduleGrid: ProviderDayScheduleGrid | null;
}) {
  return (
    <Panel title="Day view">
      <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div><div className="mb-1 text-sm font-semibold">{formatShortWeekday(dateKey)}</div><AppointmentDateHeader adDateKey={dateKey} mode={calendarMode} /></div>
          <div className="rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--text-muted)]">
            Provider-based Client board
          </div>
        </div>
      </div>
      {isLoading ? (
        <KoiSectionLoader label="Loading day schedule" />
      ) : !scheduleGrid?.providers.length ? (
        <div className="p-4">
          <EmptyState
            body={scheduleGrid ? "No active provider is available in this view." : "Retry loading the schedule or choose a provider."}
            title={scheduleGrid ? "Nothing to schedule" : "Schedule unavailable"}
          />
        </div>
      ) : (
        <>
          <div className="md:hidden">
            <MobileDayScheduleList
              appointmentById={appointmentById}
              lockedProviderId={lockedProviderId}
              onBookedSlotClick={onBookedSlotClick}
              onOpenBooking={onOpenBooking}
              scheduleGrid={scheduleGrid}
            />
          </div>
          <div className="hidden md:block">
            <ScheduleGridTable
              appointmentById={appointmentById}
              lockedProviderId={lockedProviderId}
              onBookedSlotClick={onBookedSlotClick}
              onOpenBooking={onOpenBooking}
              scheduleGrid={scheduleGrid}
            />
          </div>
        </>
      )}
    </Panel>
  );
}

export function MonthPanel({
  calendarMode,
  grid,
  onChangeMonth,
  onDaySelect,
  onOpenDay,
  selectedDate,
  summaries,
  summaryLoading,
}: {
  calendarMode: "BS" | "AD";
  grid: ReturnType<typeof buildCalendarGrid>;
  onChangeMonth: (months: number) => void;
  onDaySelect: (dateKey: string) => void;
  onOpenDay: (dateKey: string) => void;
  selectedDate: string;
  summaries: Map<string, AppointmentDaySummary>;
  summaryLoading: boolean;
}) {
  const today = todayDateKey();
  return (
    <Panel className="min-w-0" title="Month view">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-4 sm:px-5">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-[var(--foreground)]">
            {grid.primaryMonthLabel}
          </div>
          <div className="text-xs text-[var(--text-muted)] sm:text-sm">
            {grid.secondaryMonthLabel}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label="Previous month"
            className="flex size-11 items-center justify-center rounded-full border border-[var(--border)]"
            onClick={() => onChangeMonth(-1)}
            type="button"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            aria-label="Next month"
            className="flex size-11 items-center justify-center rounded-full border border-[var(--border)]"
            onClick={() => onChangeMonth(1)}
            type="button"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div data-testid="month-calendar">
        <div
          aria-label="Calendar weekdays"
          className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--surface-muted)] text-center text-xs font-semibold"
          role="group"
        >
          {[
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
          ].map((label, index) => (
            <div
              className={`py-3 ${index === 0 || index === 6 ? "text-red-700" : "text-[var(--text-muted)]"}`}
              key={label}
            >
              <abbr className="no-underline" title={label}>
                {label.slice(0, 3)}
              </abbr>
            </div>
          ))}
        </div>
        {summaryLoading ? (
          <KoiSectionLoader
            className="min-h-[420px]"
            label="Loading month overview"
          />
        ) : (
          <div className="grid grid-cols-7">
            {grid.cells.map((cell, index) => {
              const summary = summaries.get(cell.adDateKey);
              const selected = selectedDate === cell.adDateKey;
              const current = today === cell.adDateKey;
              const count = summary?.appointmentCount ?? 0;
              return (
                <div
                  className={`relative min-w-0 border-b border-r border-[var(--border)] ${selected ? "bg-[var(--surface-muted)] ring-2 ring-inset ring-[var(--accent)]" : cell.inCurrentMonth ? "bg-white" : "bg-slate-50"}`}
                  data-date={cell.adDateKey}
                  key={cell.adDateKey}
                >
                  <button
                    aria-current={current ? "date" : undefined}
                    aria-label={`Select ${cell.adDateKey}, ${count} appointments`}
                    aria-pressed={selected}
                    className="relative block min-h-20 w-full px-1 pb-2 pt-4 text-center sm:min-h-32 sm:px-3 sm:text-left"
                    onClick={() => onDaySelect(cell.adDateKey)}
                    type="button"
                  >
                    <span className="absolute right-1 top-1 text-[10px] text-[var(--text-muted)] sm:right-3 sm:top-2 sm:text-xs">
                      {calendarMode === "BS"
                        ? cell.dual.adDay
                        : cell.dual.bsDay}
                    </span>
                    <span
                      className={`inline-flex size-8 items-center justify-center rounded-full text-xl font-semibold tabular-nums sm:size-10 sm:text-2xl ${current ? "bg-[var(--accent)] text-white" : !cell.inCurrentMonth ? "text-slate-400" : index % 7 === 0 || index % 7 === 6 ? "text-red-700" : "text-[var(--foreground)]"}`}
                    >
                      {calendarMode === "BS"
                        ? cell.dual.bsDay
                        : cell.dual.adDay}
                    </span>
                    <span className="mt-1 flex min-h-3 justify-center gap-1 sm:mt-2 sm:justify-start">
                      {(summary?.providerMarkers ?? [])
                        .slice(0, 3)
                        .map((marker) => (
                          <span
                            aria-hidden="true"
                            className="size-1.5 rounded-full sm:size-2"
                            key={marker.providerId}
                            style={{ backgroundColor: marker.color }}
                          />
                        ))}
                    </span>
                    {count > 0 ? (
                      <span className="mt-1 block text-[10px] font-medium text-[var(--text-muted)] sm:text-xs">
                        <span className="sm:hidden">{count}</span>
                        <span className="hidden sm:inline">
                          {count} appt{count === 1 ? "" : "s"}
                        </span>
                      </span>
                    ) : null}
                  </button>
                  {count > 0 || selected ? (
                    <button
                      aria-label={`Open day schedule for ${cell.adDateKey}`}
                      className="absolute bottom-1 right-1 hidden size-8 items-center justify-center rounded-lg border border-[var(--border)] bg-white text-[var(--text-muted)] hover:text-[var(--accent)] sm:flex"
                      onClick={() => onOpenDay(cell.adDateKey)}
                      type="button"
                    >
                      <Eye size={14} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-xs sm:px-5">
        <div aria-label="Selected day">
          <ScheduleDateLabel
            adDateKey={selectedDate}
            mode={calendarMode}
            primaryClassName="text-xs font-semibold"
            secondaryClassName="text-[11px]"
          />
        </div>
        <button
          className="min-h-11 rounded-lg px-3 font-semibold text-[var(--accent)] hover:bg-[var(--surface-muted)]"
          onClick={() => onOpenDay(selectedDate)}
          type="button"
        >
          Open selected day
        </button>
      </div>
    </Panel>
  );
}

function MonthDayRail({
  appointments,
  calendarMode,
  dateKey,
  onAppointmentClick,
  onOpenBooking,
}: {
  appointments: ReturnType<typeof buildAppointmentView>[];
  calendarMode: "BS" | "AD";
  dateKey: string;
  onAppointmentClick: (appointment: Appointment) => void;
  onOpenBooking: () => void;
}) {
  return (
    <Panel title="Selected day">
      <div className="border-b border-[var(--border)] p-4">
        <div className="mb-1 text-sm font-semibold">{formatShortWeekday(dateKey)}</div><DualDateDisplay adDateKey={dateKey} mode={calendarMode} />
      </div>
      <div className="space-y-4 p-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
          <div className="text-sm font-medium text-[var(--foreground)]">Need exact slots?</div>
          <div className="mt-1 text-sm text-[var(--text-muted)]">
            Open Day view to load the live slot grid for this date.
          </div>
          <div className="mt-3">
            <Button onClick={onOpenBooking} variant="secondary">
              Open day view
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-[var(--foreground)]">Appointments</div>
          {appointments.length ? (
            appointments.map((appointment) => (
              <button
                className="w-full rounded-md border border-[var(--border)] px-3 py-3 text-left"
                key={appointment.id}
                onClick={() => onAppointmentClick(appointment)}
                style={{ borderLeft: `4px solid ${scheduleAppointmentColor(appointment.status, appointment.communicationState, appointment.provider?.color ?? "#0f766e")}` }}
                type="button"
              >
                <div className="font-medium text-[var(--foreground)]">
                  {appointment.customer?.name ?? "Unknown Client"}
                </div>
                <div className="text-sm text-[var(--text-muted)]">
                  {formatClockRange(
                    appointment.startsAtIso,
                    appointment.durationMinutes,
                    appointment.bufferMinutes,
                  )}
                </div>
              </button>
            ))
          ) : (
            <div className="text-sm text-[var(--text-muted)]">No appointments booked for this day.</div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function DayListPanel({
  appointments,
  calendarMode,
  dateKey,
  isLoading,
  loadError,
  onAppointmentClick,
}: {
  appointments: ReturnType<typeof buildAppointmentView>[];
  calendarMode: "BS" | "AD";
  dateKey: string;
  isLoading: boolean;
  loadError?: boolean;
  onAppointmentClick: (appointment: Appointment) => void;
}) {
  return (
    <Panel title="Daily list">
      <div className="border-b border-[var(--border)] p-4">
        <div className="mb-1 text-sm font-semibold">{formatShortWeekday(dateKey)}</div><DualDateDisplay adDateKey={dateKey} mode={calendarMode} />
      </div>
      <div className="divide-y divide-[var(--border)]">
        {loadError ? <div className="p-4 text-sm text-[var(--text-muted)]">Appointment records are unavailable until the schedule reloads.</div> : isLoading ? (
          <KoiSectionLoader className="min-h-[260px]" label="Loading daily appointments" />
        ) : appointments.length ? (
          appointments.map((appointment) => (
            <button
              className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left"
              key={appointment.id}
              onClick={() => onAppointmentClick(appointment)}
              type="button"
            >
              <div>
                <div className="font-medium text-[var(--foreground)]">
                  {appointment.customer?.name ?? "Unknown Client"}
                </div>
                <div className="mt-1 text-sm text-[var(--text-muted)]">
                  {formatClockRange(
                    appointment.startsAtIso,
                    appointment.durationMinutes,
                    appointment.bufferMinutes,
                  )}
                </div>
              </div>
              <StatusPill status={appointment.status} />
                              {appointment.status === "Cancelled" ? <span className="text-xs text-red-700">{appointment.cancellationReason || "Reason not recorded"}</span> : null}
            </button>
          ))
        ) : (
          <div className="p-4 text-sm text-[var(--text-muted)]">No reservations on this day.</div>
        )}
      </div>
    </Panel>
  );
}

type DayScheduleProps = {
  appointmentById: Map<string, AppointmentView>;
  lockedProviderId?: string;
  onBookedSlotClick: (appointment: Appointment) => void;
  onOpenBooking: (
    providerId: string,
    date: string,
    appointment?: Appointment,
    slotIso?: string,
  ) => void;
  scheduleGrid: ProviderDayScheduleGrid;
};

export const ScheduleGridTable = memo(function ScheduleGridTable({
  appointmentById,
  lockedProviderId,
  onBookedSlotClick,
  onOpenBooking,
  scheduleGrid,
}: DayScheduleProps) {
  const slotStarts = useMemo(
    () =>
      Array.from(
        new Set(
          scheduleGrid.providers.flatMap((provider) =>
            provider.slots.map((slot) => slot.startTime),
          ),
        ),
      ).sort((a, b) => Date.parse(a) - Date.parse(b)),
    [scheduleGrid.providers],
  );
  const layouts = useMemo(() => {
    return scheduleGrid.providers.map((provider) => {
      const timeline = buildDayTimeline(
        provider.slots,
        appointmentById.values(),
        provider.providerId,
        scheduleGrid.date,
        slotStarts,
      );
      return { provider, ...timeline };
    }).map((layout, index, layouts) => ({
      ...layout,
      column: 2 + layouts.slice(0, index).reduce((count, previous) => count + previous.laneCount + 1, 0),
    }));
  }, [scheduleGrid.providers, scheduleGrid.date, appointmentById, slotStarts]);
  return (
    <div
      className="max-h-[70vh] overflow-auto bg-white [scrollbar-gutter:stable]"
      data-testid="day-scroll-container"
    >
      <div
        className="grid min-w-[600px]"
        style={{
          gridTemplateColumns: `80px ${layouts.map((layout) => `repeat(${layout.laneCount}, minmax(220px, 1fr)) 44px`).join(" ")}`,
          gridTemplateRows: slotStarts.length
            ? `auto repeat(${slotStarts.length}, 80px)`
            : "auto",
        }}
      >
        <div
          className="sticky left-0 top-0 z-30 border-b border-r border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3 text-xs font-semibold text-[var(--text-muted)]"
          style={{ gridColumn: 1, gridRow: 1 }}
        >
          Time
        </div>
        {layouts.map((layout) => (
          <div
            className="sticky top-0 z-20 border-b border-r border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3"
            key={layout.provider.providerId}
            style={{
              gridColumn: `${layout.column} / span ${layout.laneCount + 1}`,
              gridRow: 1,
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: layout.provider.providerColor }}
              />
              <span className="font-medium">
                {layout.provider.providerName}
              </span>
            </div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              {layout.provider.specialty} · + books available time
            </div>
          </div>
        ))}
        {slotStarts.map((startTime, row) => (
          <div
            className="sticky left-0 z-10 border-b border-r border-[var(--border)] bg-white px-3 py-3 text-xs tabular-nums text-[var(--text-muted)]"
            key={startTime}
            style={{ gridColumn: 1, gridRow: row + 2 }}
          >
            {formatClockLabel(startTime)}
          </div>
        ))}
        {layouts.flatMap((layout) => {
          const slots = new Map(
            layout.provider.slots.map((slot) => [slot.startTime, slot]),
          );
          return slotStarts.map((startTime, row) => {
            // Missing provider rows fail closed. History never changes this capacity state.
            const slot = slots.get(startTime);
            const hasRecord = layout.records.some(record => record.group.startRow <= row && record.group.startRow + record.group.rowSpan > row);
            const canBook =
              slot?.state === "AVAILABLE" &&
              (!lockedProviderId ||
                lockedProviderId === layout.provider.providerId);
            const label =
              slot?.state === "BOOKED"
                ? "Occupied"
                : slot?.state === "AVAILABLE"
                  ? canBook
                    ? "Open slot"
                    : "View only"
                  : slot?.state === "BLOCKED"
                    ? "Blocked"
                    : "Unavailable";
            const book = () =>
              onOpenBooking(
                layout.provider.providerId,
                scheduleGrid.date,
                undefined,
                startTime,
              );
            return (
              <React.Fragment
                key={`${layout.provider.providerId}-${startTime}`}
              >
                <button
                  aria-label={`${label}, ${layout.provider.providerName}, ${formatClockLabel(startTime)}`}
                  className="min-w-0 border-b border-r border-[var(--border)] bg-[var(--surface-muted)] px-3 text-left text-xs text-[var(--text-muted)] enabled:hover:bg-white"
                  disabled={!canBook}
                  onClick={book}
                  style={{
                    gridColumn: `${layout.column} / span ${layout.laneCount}`,
                    gridRow: row + 2,
                  }}
                  type="button"
                >
                  {slot?.state === "BOOKED" || hasRecord ? "" : label}
                </button>
                <button
                  aria-label={`Book ${layout.provider.providerName} at ${formatClockLabel(startTime)} on ${scheduleGrid.date}`}
                  className="border-b border-r border-[var(--border)] text-lg text-[var(--accent)] enabled:bg-white enabled:hover:bg-[var(--surface-muted)] disabled:text-slate-300"
                  disabled={!canBook}
                  onClick={book}
                  style={{
                    gridColumn: layout.column + layout.laneCount,
                    gridRow: row + 2,
                  }}
                  title={canBook ? "Book this available time" : label}
                  type="button"
                >
                  {canBook ? "+" : "·"}
                </button>
              </React.Fragment>
            );
          });
        })}
        {/* Record lanes retain overlaps without hiding earlier visits or free booking controls. */}
        {layouts
          .flatMap((layout) =>
            layout.records.map((record) => ({
              ...record,
              provider: layout.provider,
              column: layout.column + record.lane,
            })),
          )
          .sort(
            (a, b) =>
              a.group.startRow - b.group.startRow || a.column - b.column,
          )
          .map((record) => (
            <ScheduleGridCell
              appointmentById={appointmentById}
              column={record.column}
              group={record.group}
              key={`${record.provider.providerId}-${record.group.slot.appointmentId}-${record.group.startRow}`}
              lockedProviderId={lockedProviderId}
              onBookedSlotClick={onBookedSlotClick}
              onOpenBooking={onOpenBooking}
              provider={record.provider}
              scheduleGrid={scheduleGrid}
            />
          ))}
      </div>
    </div>
  );
});

const ScheduleGridCell = memo(function ScheduleGridCell({
  appointmentById,
  column,
  group,
  lockedProviderId,
  onBookedSlotClick,
  onOpenBooking,
  provider,
  scheduleGrid,
}: DayScheduleProps & {
  column: number;
  group: ScheduleDisplayGroup;
  provider: ProviderDayScheduleGrid["providers"][number];
}) {
  const { slot, rowSpan, startRow } = group;
  const appointment = slot.appointmentId
    ? appointmentById.get(slot.appointmentId)
    : undefined;
  const canBook = !lockedProviderId || lockedProviderId === provider.providerId;
  const action = scheduleSlotAction(slot, appointment, canBook);
  const history = slot.state === "HISTORY";
  const booked = slot.state === "BOOKED" || history;
  const cancellationNote = appointment
    ? replacementCancellationNote(appointment, appointmentById.values())
    : undefined;
  const status =
    appointment?.status ?? slot.appointmentSummary?.status ?? "Scheduled";
  const color = slot.cancelledSummary
    ? "#dc2626"
    : scheduleAppointmentColor(
        status,
        slot.appointmentSummary?.communicationState,
        provider.providerColor,
      );
  const name =
    slot.appointmentSummary?.customerName ??
    appointment?.customer?.name ??
    "Client";
  const procedure =
    slot.appointmentSummary?.serviceName ??
    appointment?.procedureLabel ??
    "Booked";
  const range = `${formatClockLabel(slot.startTime)}–${formatClockLabel(slot.endTime)}`;
  const urgent = appointment?.priority === "Urgent";
  const label = booked
    ? `${name}, ${procedure}, ${range}, ${status}${history ? ", history record" : ""}${urgent ? ", Urgent" : ""}${appointment?.cancellationReason ? `, ${appointment.cancellationReason}` : ""}${cancellationNote ? `, ${cancellationNote}` : ""}`
    : (cancelledSlotNote(slot) ??
      (slot.state === "AVAILABLE"
        ? "Open slot"
        : slot.state === "BLOCKED"
          ? "Blocked"
          : "Unavailable"));
  return (
    <button
      aria-label={label}
      className={`relative z-[1] min-h-0 min-w-0 overflow-hidden px-3 ${rowSpan === 1 ? "py-1" : "py-2"} text-left transition ${booked ? "m-1 flex flex-col justify-start rounded-lg border border-[var(--border)] hover:brightness-95" : "border-b border-r border-[var(--border)] hover:bg-[var(--surface-muted)]"}`}
      data-appointment-id={booked ? slot.appointmentId : undefined}
      data-history={history || undefined}
      disabled={!action}
      onClick={() =>
        action === "details" && appointment
          ? onBookedSlotClick(appointment)
          : action === "book"
            ? onOpenBooking(
                provider.providerId,
                scheduleGrid.date,
                undefined,
                slot.startTime,
              )
            : undefined
      }
      style={{
        gridColumn: column,
        gridRow: `${startRow + 2} / span ${rowSpan}`,
        backgroundColor: booked
          ? "white"
          : slot.cancelledSummary
            ? "#fef2f2"
            : slot.state === "AVAILABLE"
              ? "#fcfffe"
              : "var(--surface-muted)",
        backgroundImage: booked ? `linear-gradient(${color}16, ${color}16)` : undefined,
        boxShadow: booked ? `inset 4px 0 0 ${color}` : undefined,
      }}
      title={label}
      type="button"
    >
      {booked ? (
        <>
          <span className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
            <span className="truncate">{name}</span>
            {urgent && rowSpan === 1 ? (
              <span className="shrink-0 text-[11px] text-red-600">Urgent</span>
            ) : null}
          </span>
          {rowSpan > 1 ? (
            <span className="mt-1 block truncate text-xs text-[var(--text-muted)]">
              {procedure}
            </span>
          ) : null}
          <span className="mt-1 block text-[11px] font-medium tabular-nums text-[var(--text-muted)]">
            {range}
            {rowSpan === 1 ? ` · ${status}` : ""}
          </span>
          {rowSpan > 1 ? (
            <span
              className="mt-2 flex items-center justify-between gap-2 text-[11px] font-medium"
              style={{ color }}
            >
              {status}
              {urgent ? (
                <span className="rounded-full bg-red-50 px-2 text-red-600">
                  Urgent
                </span>
              ) : null}
            </span>
          ) : null}
          {appointment?.status === "Cancelled" ? (
            <span className="mt-0.5 line-clamp-2 text-[11px] text-red-700">
              {appointment.cancellationReason || "Reason not recorded"}
            </span>
          ) : null}
          {cancellationNote ? (
            <span
              className="mt-0.5 line-clamp-2 text-[11px] text-red-700"
              title={cancellationNote}
            >
              {cancellationNote}
            </span>
          ) : null}
        </>
      ) : (
        <span className="block text-xs text-[var(--text-muted)]">
          {slot.state === "AVAILABLE"
            ? canBook
              ? "Open slot"
              : "View only"
            : slot.state === "BLOCKED"
              ? "Blocked"
              : "Unavailable"}
          {slot.cancelledSummary ? (
            <span className="mt-1 block line-clamp-2 text-[11px] text-red-700">
              {cancelledSlotNote(slot)}
            </span>
          ) : null}
        </span>
      )}
    </button>
  );
});

export function MobileDayScheduleList({
  appointmentById,
  lockedProviderId,
  onBookedSlotClick,
  onOpenBooking,
  scheduleGrid,
}: {
  appointmentById: Map<string, ReturnType<typeof buildAppointmentView>>;
  lockedProviderId?: string;
  onBookedSlotClick: (appointment: Appointment) => void;
  onOpenBooking: (
    providerId: string,
    date: string,
    appointment?: Appointment,
    slotIso?: string,
  ) => void;
  scheduleGrid: ProviderDayScheduleGrid;
}) {
  const timeline = useMemo(
    () =>
      scheduleGrid.providers
        .flatMap((provider) => {
          const capacity = groupScheduleSlots(provider.slots).filter(
            ({ slot }) => slot.state === "AVAILABLE",
          );
          const records = buildDayTimeline(
            provider.slots,
            appointmentById.values(),
            provider.providerId,
            scheduleGrid.date,
          ).records.map((record) => record.group);
          return [...records, ...capacity].map(({ slot }) => ({
            provider,
            slot,
          }));
        })
        .sort((left, right) => {
          const timeDifference =
            new Date(left.slot.startTime).getTime() -
            new Date(right.slot.startTime).getTime();
          return (
            timeDifference ||
            left.provider.providerName.localeCompare(
              right.provider.providerName,
            )
          );
        }),
    [scheduleGrid.providers, scheduleGrid.date, appointmentById],
  );

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap gap-2" aria-label="Provider colours">
        {scheduleGrid.providers.map((provider) => (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-2.5 py-1 text-xs text-[var(--text-muted)]"
            key={provider.providerId}
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: provider.providerColor }}
            />
            {provider.providerName}
          </span>
        ))}
      </div>
      <div className="relative space-y-2 before:absolute before:bottom-4 before:left-[3.15rem] before:top-4 before:w-px before:bg-[var(--border)]">
        {timeline.map(({ provider, slot }) => {
          const appointmentView = slot.appointmentId
            ? appointmentById.get(slot.appointmentId)
            : undefined;
          const history = slot.state === "HISTORY";
          const isBooked = slot.state === "BOOKED" || history;
          const cancellationNote = appointmentView
            ? replacementCancellationNote(
                appointmentView,
                appointmentById.values(),
              )
            : undefined;
          const action = scheduleSlotAction(
            slot,
            appointmentView,
            !lockedProviderId || lockedProviderId === provider.providerId,
          );
          const slotColor = slot.cancelledSummary
            ? "#dc2626"
            : scheduleAppointmentColor(
                appointmentView?.status ??
                  slot.appointmentSummary?.status ??
                  "Scheduled",
                slot.appointmentSummary?.communicationState ??
                  appointmentView?.communicationState,
                provider.providerColor,
              );
          const canBookThisProvider =
            !lockedProviderId || lockedProviderId === provider.providerId;
          return (
            <div
              className="relative grid grid-cols-[3.35rem_minmax(0,1fr)] gap-3"
              key={`${provider.providerId}-${slot.state}-${slot.appointmentId ?? "capacity"}-${slot.startTime}`}
            >
              <time className="pt-3 text-xs font-semibold tabular-nums text-[var(--text-muted)]">
                {formatClockLabel(slot.startTime)}
              </time>
              <span
                aria-hidden="true"
                className="absolute left-[2.86rem] top-4 size-2.5 rounded-full border-2 border-white"
                style={{ backgroundColor: provider.providerColor }}
              />
              <button
                data-appointment-id={isBooked ? slot.appointmentId : undefined}
                data-history={history || undefined}
                className="min-w-0 rounded-xl border border-[var(--border)] px-3 py-3 text-left disabled:opacity-60"
                disabled={!action}
                style={{
                  backgroundColor:
                    isBooked || slot.cancelledSummary
                      ? `${slotColor}18`
                      : "white",
                  boxShadow: `inset 3px 0 0 ${isBooked || slot.cancelledSummary ? slotColor : provider.providerColor}`,
                }}
                onClick={() =>
                  action === "details" && appointmentView
                    ? onBookedSlotClick(appointmentView)
                    : action === "book"
                      ? onOpenBooking(
                          provider.providerId,
                          scheduleGrid.date,
                          undefined,
                          slot.startTime,
                        )
                      : undefined
                }
                type="button"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <strong className="block truncate text-sm text-[var(--foreground)]">
                      {isBooked
                        ? (slot.appointmentSummary?.customerName ??
                          appointmentView?.customer?.name ??
                          "Booked appointment")
                        : "Available"}
                    </strong>
                    <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                      {provider.providerName}
                      {isBooked &&
                      (slot.appointmentSummary?.serviceName ||
                        appointmentView?.procedureLabel)
                        ? ` · ${slot.appointmentSummary?.serviceName || appointmentView?.procedureLabel}`
                        : !isBooked
                          ? canBookThisProvider
                            ? " · Tap to book"
                            : " · View only"
                          : ""}
                    </span>
                    {isBooked ? (
                      <span className="mt-1 block text-xs font-medium">
                        {history
                          ? `${formatClockLabel(slot.startTime)}–${formatClockLabel(slot.endTime)} · History record`
                          : occupiedSlotLabel(slot, appointmentView)}
                      </span>
                    ) : null}
                    {appointmentView?.status === "Cancelled" ? (
                      <span className="mt-1 block text-xs text-red-700">
                        {appointmentView.cancellationReason ||
                          "Reason not recorded"}
                      </span>
                    ) : null}
                    {cancellationNote ? (
                      <span className="mt-1 block text-xs text-red-700">
                        {cancellationNote}
                      </span>
                    ) : null}
                    {slot.cancelledSummary ? (
                      <span className="mt-1 block text-xs font-medium text-red-700">
                        {cancelledSlotNote(slot)}
                      </span>
                    ) : null}
                  </span>
                  {isBooked ? (
                    <StatusPill
                      status={
                        appointmentView?.status ??
                        slot.appointmentSummary?.status ??
                        "Scheduled"
                      }
                    />
                  ) : null}
                </span>
              </button>
            </div>
          );
        })}
        {!timeline.length ? (
          <div className="rounded-xl bg-[var(--surface-muted)] p-4 text-sm text-[var(--text-muted)]">
            No available or booked times on this date.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AppointmentDetailModal({
  appointment,
  onClose,
  onDelete,
  onEdit,
  onReschedule,
  onStatusChange,
}: {
  appointment: ReturnType<typeof buildAppointmentView>;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onEdit: () => void;
  onReschedule: () => void;
  onStatusChange: (status: "Confirmed" | "CheckedIn" | "InProgress" | "Completed" | "Cancelled" | "NoShow", reason?: string) => Promise<void>;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [reasonAction, setReasonAction] = useState<"Cancelled" | "NoShow" | null>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [archiveConfirmationOpen, setArchiveConfirmationOpen] = useState(false);
  const nextAction = getPrimaryAppointmentAction(appointment.status);

  async function runStatusChange(
    status: "Confirmed" | "CheckedIn" | "InProgress" | "Completed" | "Cancelled" | "NoShow",
    statusReason?: string,
  ) {
    setIsUpdating(true);
    setActionError(null);
    try {
      await onStatusChange(status, statusReason);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The appointment could not be updated.");
      setIsUpdating(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      subtitle="Review the visit, move it through the clinic workflow, or change its schedule."
      title="Appointment details"
    >
      <div className="space-y-5">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold text-[var(--foreground)]">
                <Link className="underline decoration-dotted underline-offset-4" href={`/clients/${encodeURIComponent(appointment.customerId)}`}>{appointment.customer?.name ?? "Unknown Client"}</Link>
              </div>
              <div className="mt-1 text-sm text-[var(--text-muted)]">
                {appointment.procedureLabel}
              </div>
            </div>
            <StatusPill status={appointment.status} />
                              {appointment.status === "Cancelled" ? <span className="text-xs text-red-700">{appointment.cancellationReason || "Reason not recorded"}</span> : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <PriorityTag priority={appointment.priority} />
            <span className="rounded-full border border-[var(--border)] bg-white px-2.5 py-1 text-xs text-[var(--text-muted)]">
              {appointment.communicationState}
            </span>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2" aria-label="Appointment information">
          <AppointmentDetailField label="Date and time">
            {new Date(appointment.startsAtIso).toLocaleString("en-NP", {
              dateStyle: "full",
              timeStyle: "short",
              timeZone: "Asia/Kathmandu",
            })}
          </AppointmentDetailField>
          <AppointmentDetailField label="Provider">
            {appointment.provider?.name ?? "Unassigned"}
          </AppointmentDetailField>
          <AppointmentDetailField label="Reserved time">
            {formatClockRange(appointment.startsAtIso, appointment.durationMinutes, appointment.bufferMinutes)}
          </AppointmentDetailField>
          <AppointmentDetailField label="Duration">
            {appointment.durationMinutes} minutes{appointment.bufferMinutes ? ` + ${appointment.bufferMinutes} minute buffer` : ""}
          </AppointmentDetailField>
        </section>

        {appointment.status === "Cancelled" ? <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">Cancelled: {appointment.cancellationReason || "Reason not recorded"}</p> : null}
        {appointment.notes ? (
          <section className="rounded-xl border border-[var(--border)] p-4">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Notes</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--text-muted)]">{appointment.notes}</p>
          </section>
        ) : null}

        {nextAction ? (
          <Button className="h-12 w-full" disabled={isUpdating} loading={isUpdating} loadingLabel="Updating appointment" onClick={() => void runStatusChange(nextAction.status)}>
            {nextAction.label}
          </Button>
        ) : null}

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Schedule actions</h3>
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={isUpdating} onClick={onEdit} variant="secondary"><PencilLine size={16} />Edit details</Button>
            {["Scheduled", "Confirmed"].includes(appointment.status) ? <Button disabled={isUpdating} onClick={onReschedule} variant="secondary">Reschedule</Button> : null}
            {["Scheduled", "Confirmed"].includes(appointment.status) ? <Button disabled={isUpdating} onClick={() => { setReasonAction("NoShow"); setReason(""); }} variant="ghost">Mark no-show</Button> : null}
            {["Scheduled", "Confirmed"].includes(appointment.status) ? <Button disabled={isUpdating} onClick={() => { setReasonAction("Cancelled"); setReason(""); }} variant="ghost">Cancel appointment</Button> : null}
          </div>
        </section>

        {reasonAction ? (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <label className="block text-sm font-semibold text-amber-950">
              {reasonAction === "Cancelled" ? "Cancellation reason" : "No-show reason"}
              <textarea className="mt-2 min-h-24 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-normal text-[var(--foreground)] outline-none focus:border-[var(--accent)]" onChange={(event) => setReason(event.target.value)} placeholder="Required for the audit history" value={reason} />
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <Button disabled={isUpdating} onClick={() => setReasonAction(null)} variant="ghost">Keep appointment</Button>
              <Button disabled={!reason.trim() || isUpdating} loading={isUpdating} loadingLabel="Updating appointment" onClick={() => void runStatusChange(reasonAction, reason.trim())}>
                Confirm {reasonAction === "Cancelled" ? "cancellation" : "no-show"}
              </Button>
            </div>
          </section>
        ) : null}

        <section className="border-t border-[var(--border)] pt-4">
          {!archiveConfirmationOpen ? (
            <Button disabled={isUpdating} onClick={() => setArchiveConfirmationOpen(true)} variant="ghost"><Trash2 size={16} />Archive appointment</Button>
          ) : (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-sm font-semibold text-rose-900">Archive this appointment?</p>
              <p className="mt-1 text-xs text-rose-800">It leaves active scheduling views while its history remains governed.</p>
              <div className="mt-3 flex justify-end gap-2">
                <Button disabled={isDeleting} onClick={() => setArchiveConfirmationOpen(false)} variant="ghost">Keep appointment</Button>
                <Button disabled={isDeleting} loading={isDeleting} loadingLabel="Archiving appointment" onClick={async () => {
                  setIsDeleting(true);
                  setActionError(null);
                  try {
                    await onDelete();
                  } catch (error) {
                    setActionError(error instanceof Error ? error.message : "The appointment could not be archived.");
                    setIsDeleting(false);
                  }
                }} variant="secondary">Archive</Button>
              </div>
            </div>
          )}
        </section>
        {actionError ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">{actionError}</p> : null}
      </div>
    </Modal>
  );
}

function AppointmentDetailField({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-sm font-medium text-[var(--foreground)]">{children}</div>
    </div>
  );
}

function getVisibleRange(view: CalendarView, selectedDate: string, monthAnchorDate: string) {
  if (view === "month") {
    const grid = buildCalendarGrid(monthAnchorDate, "AD");
    const fromDateKey = grid.cells[0]?.adDateKey ?? selectedDate;
    const toDateKey = grid.cells[grid.cells.length - 1]?.adDateKey ?? selectedDate;
    return {
      fromIso: `${fromDateKey}T00:00:00+05:45`,
      toIso: `${toDateKey}T23:59:59+05:45`,
    };
  }

  if (view === "week") {
    const weekDateKeys = getWeekDateKeys(selectedDate);
    return {
      fromIso: `${weekDateKeys[0] ?? selectedDate}T00:00:00+05:45`,
      toIso: `${weekDateKeys[weekDateKeys.length - 1] ?? selectedDate}T23:59:59+05:45`,
    };
  }

  return {
    fromIso: `${selectedDate}T00:00:00+05:45`,
    toIso: `${selectedDate}T23:59:59+05:45`,
  };
}

function getMonthDateKeys(cells: Array<{ adDateKey: string }>) {
  return {
    fromDateKey: cells[0]?.adDateKey ?? todayDateKey(),
    toDateKey: cells[cells.length - 1]?.adDateKey ?? todayDateKey(),
  };
}

function addDaysToDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00+05:45`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayDateKey() {
  return toDateKey(new Date().toISOString());
}

function formatClockLabel(iso: string) {
  const date = new Date(iso);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kathmandu",
  });
}

function handlePrevious(
  view: CalendarView,
  selectedDate: string,
  monthAnchorDate: string,
  setSelectedDate: (dateKey: string) => void,
  setMonthAnchorDate: (dateKey: string) => void,
) {
  if (view === "month") {
    setMonthAnchorDate(addMonthsToDateKey(monthAnchorDate, -1));
    return;
  }
  if (view === "week") {
    setSelectedDate(addDaysToDateKey(selectedDate, -7));
    return;
  }
  setSelectedDate(addDaysToDateKey(selectedDate, -1));
}

function handleNext(
  view: CalendarView,
  selectedDate: string,
  monthAnchorDate: string,
  setSelectedDate: (dateKey: string) => void,
  setMonthAnchorDate: (dateKey: string) => void,
) {
  if (view === "month") {
    setMonthAnchorDate(addMonthsToDateKey(monthAnchorDate, 1));
    return;
  }
  if (view === "week") {
    setSelectedDate(addDaysToDateKey(selectedDate, 7));
    return;
  }
  setSelectedDate(addDaysToDateKey(selectedDate, 1));
}

function addMonthsToDateKey(dateKey: string, months: number) {
  const date = new Date(`${dateKey}T12:00:00+05:45`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function getWeekDateKeys(dateKey: string) {
  const anchor = new Date(`${dateKey}T12:00:00+05:45`);
  const weekday = anchor.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(anchor);
  monday.setUTCDate(anchor.getUTCDate() + mondayOffset);

  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(monday);
    next.setUTCDate(monday.getUTCDate() + index);
    return next.toISOString().slice(0, 10);
  });
}

function formatWeekRangeLabel(weekDateKeys: string[]) {
  const start = weekDateKeys[0];
  const end = weekDateKeys[weekDateKeys.length - 1];
  if (!start || !end) {
    return "";
  }
  const startDate = new Date(`${start}T12:00:00+05:45`);
  const endDate = new Date(`${end}T12:00:00+05:45`);
  return `${startDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kathmandu",
  })} - ${endDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: start.slice(0, 4) === end.slice(0, 4) ? undefined : "numeric",
    timeZone: "Asia/Kathmandu",
  })}`;
}

function formatShortWeekday(dateKey: string) {
  return new Date(`${dateKey}T12:00:00+05:45`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kathmandu",
  });
}
