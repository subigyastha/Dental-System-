"use client";

import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
    const locationId = data.locations[0]?.id;
    void fetchScheduleDay({
      providerIds,
      date: selectedDate,
      locationId,
      signal: controller.signal,
    })
      .then((snapshot) => {
        if (!cancelled) {
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
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
          role="alert"
        >
          {planningError}
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
                  <DualDateDisplay
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
          <div className="space-y-5">
            {calendarView === "day" ? (
              <DayGridPanel
                appointmentById={appointmentById}
                calendarMode={calendarMode}
                dateKey={selectedDate}
                isLoading={dayGridLoading}
                lockedProviderId={bookingProviderLimit}
                onBookedSlotClick={setSelectedAppointment}
                onOpenBooking={(providerId, date) => openBooking(providerId, date)}
                scheduleGrid={dayScheduleGrid}
              />
            ) : null}

            {calendarView === "week" ? (
              <WeekPanel
                appointmentsByDate={weekAppointmentsByDate}
                isLoading={rangeLoading || summaryLoading}
                lockedProviderId={bookingProviderLimit}
                onBookedSlotClick={setSelectedAppointment}
                onOpenBooking={(providerId, date) => openBooking(providerId, date)}
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
    <DualDateDisplay
      adDateKey={calendarView === "month" ? monthAnchorDate : selectedDate}
      mode={calendarMode}
      primaryClassName="text-base font-semibold"
      secondaryClassName="text-xs"
    />
  );

  return (
    <div className="space-y-4">
      <div className="sticky top-[57px] z-10 -mx-4 border-b border-[var(--border)] bg-[var(--surface)]/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
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
          onOpenBooking={(providerId, date) => onOpenBooking(providerId, date)}
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
          <Panel title="Calendar">
            <div className="border-b border-[var(--border)] px-4 py-3">
              <div className="font-medium text-[var(--foreground)]">{monthGrid.primaryMonthLabel}</div>
              <div className="text-sm text-[var(--text-muted)]">{monthGrid.secondaryMonthLabel}</div>
            </div>
            {summaryLoading ? (
              <KoiSectionLoader className="min-h-[360px]" label="Loading month overview" />
            ) : (
              <div className="grid grid-cols-7">
                {monthGrid.cells.map((cell) => {
                  const summary = monthSummaries.get(cell.adDateKey);
                  const isSelected = selectedDayDetailsDate === cell.adDateKey;
                  return (
                    <button
                      className={`min-h-20 border-b border-r border-[var(--border)] px-2 py-2 text-left ${
                        isSelected ? "bg-[var(--surface-muted)]" : "bg-white"
                      }`}
                      key={cell.adDateKey}
                      onClick={() => {
                        onSelectDayDetailsDate(cell.adDateKey);
                        onSelectDate(cell.adDateKey);
                      }}
                      type="button"
                    >
                      <div className="text-sm font-semibold text-[var(--foreground)]">
                        {calendarMode === "BS" ? cell.dual.bsDay : cell.dual.adDay}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {calendarMode === "BS" ? cell.dual.adDay : cell.dual.bsDay}
                      </div>
                      <div className="mt-2 text-[10px] text-[var(--text-muted)]">
                        {summary?.appointmentCount ?? 0}
                      </div>
                      <div className="mt-2 flex gap-1">
                        {(summary?.providerMarkers ?? []).slice(0, 3).map((marker) => (
                          <span
                            className="h-2 w-2 rounded-full"
                            key={`${cell.adDateKey}-${marker.providerId}`}
                            style={{ backgroundColor: marker.color }}
                          />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>
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

function WeekPanel({
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
    <Panel title="Week view">
      {isLoading ? (
        <KoiSectionLoader className="min-h-[520px]" label="Loading weekly board" />
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[980px] grid-cols-7 divide-x divide-[var(--border)]">
            {weekDateKeys.map((dateKey) => {
              const summary = weekSummaryByDate.get(dateKey);
              const appointments = appointmentsByDate.get(dateKey) ?? [];
              return (
                <div className="flex min-h-[640px] flex-col bg-white" key={dateKey}>
                  <button
                    className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-4 text-left transition hover:bg-white"
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
                            style={{ boxShadow: `inset 3px 0 0 ${providerColor}` }}
                            type="button"
                          >
                            <div className="text-xs font-semibold text-[var(--text-muted)]">
                              {formatClockLabel(appointment.startsAtIso)}
                            </div>
                            <div className="mt-1 font-semibold text-[var(--foreground)]">
                              {appointment.customer?.name ?? "Unknown Client"}
                            </div>
                            <div className="mt-1 text-sm text-[var(--text-muted)]">
                              {appointment.services[0]?.name ?? "Scheduled appointment"}
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                              <span style={{ color: providerColor }}>
                                {appointment.provider?.name ?? "Provider"}
                              </span>
                              <StatusPill status={appointment.status} />
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
          <AppointmentDateHeader adDateKey={dateKey} mode={calendarMode} />
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
            body="No active provider is available in this view."
            title="Nothing to schedule"
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
  return (
    <Panel title="Month view">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div>
          <div className="font-medium text-[var(--foreground)]">{grid.primaryMonthLabel}</div>
          <div className="text-sm text-[var(--text-muted)]">{grid.secondaryMonthLabel}</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="flex size-8 items-center justify-center rounded-md border border-[var(--border)]"
            onClick={() => onChangeMonth(-1)}
            type="button"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="flex size-8 items-center justify-center rounded-md border border-[var(--border)]"
            onClick={() => onChangeMonth(1)}
            type="button"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {summaryLoading ? (
        <KoiSectionLoader className="min-h-[420px]" label="Loading month overview" />
      ) : (
        <>
          <div className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--surface-muted)] text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
              <div className="px-2 py-2" key={label}>
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {grid.cells.map((cell) => {
              const summary = summaries.get(cell.adDateKey);
              const selected = selectedDate === cell.adDateKey;
              return (
                <div
                  className={`relative min-h-28 border-b border-r border-[var(--border)] ${
                    selected ? "bg-white ring-1 ring-inset ring-[var(--accent)]" : "bg-white"
                  }`}
                  key={cell.adDateKey}
                >
                  <button
                    aria-label={`Select ${cell.adDateKey}, ${summary?.appointmentCount ?? 0} appointments`}
                    className="block min-h-28 w-full px-2 py-2 text-left"
                    onClick={() => onDaySelect(cell.adDateKey)}
                    type="button"
                  >
                    <span className="block text-base font-semibold text-[var(--foreground)]">
                      {calendarMode === "BS" ? cell.dual.bsDay : cell.dual.adDay}
                    </span>
                    <span className="block text-xs text-[var(--text-muted)]">
                      {calendarMode === "BS" ? cell.dual.adDay : cell.dual.bsDay}
                    </span>
                    <span className="mt-3 block text-xs text-[var(--text-muted)]">
                      {summary?.appointmentCount ?? 0} appointments
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1">
                      {(summary?.providerMarkers ?? []).slice(0, 4).map((marker) => (
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          key={`${cell.adDateKey}-${marker.providerId}`}
                          style={{ backgroundColor: marker.color }}
                        />
                      ))}
                    </span>
                    <span className="mt-3 block pr-8 text-[11px] text-[var(--text-muted)]">
                      {summary?.hasAvailability ? "Open capacity" : "Low capacity"}
                    </span>
                  </button>
                  {summary?.appointmentCount || selected ? (
                    <button
                      aria-label={`Open day schedule for ${cell.adDateKey}`}
                      className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:bg-white hover:text-[var(--foreground)]"
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
        </>
      )}
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
        <DualDateDisplay adDateKey={dateKey} mode={calendarMode} />
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
  onAppointmentClick,
}: {
  appointments: ReturnType<typeof buildAppointmentView>[];
  calendarMode: "BS" | "AD";
  dateKey: string;
  isLoading: boolean;
  onAppointmentClick: (appointment: Appointment) => void;
}) {
  return (
    <Panel title="Daily list">
      <div className="border-b border-[var(--border)] p-4">
        <DualDateDisplay adDateKey={dateKey} mode={calendarMode} />
      </div>
      <div className="divide-y divide-[var(--border)]">
        {isLoading ? (
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
            </button>
          ))
        ) : (
          <div className="p-4 text-sm text-[var(--text-muted)]">No reservations on this day.</div>
        )}
      </div>
    </Panel>
  );
}

const ScheduleGridTable = memo(function ScheduleGridTable({
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
  const slotStarts = useMemo(() => {
    const starts = new Set<string>();
    scheduleGrid.providers.forEach((provider) => {
      provider.slots.forEach((slot) => starts.add(slot.startTime));
    });
    return Array.from(starts).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  }, [scheduleGrid.providers]);
  const slotsByProvider = useMemo(() => {
    const index = new Map<
      string,
      Map<string, ProviderDayScheduleGrid["providers"][number]["slots"][number]>
    >();
    scheduleGrid.providers.forEach((provider) => {
      index.set(
        provider.providerId,
        new Map(provider.slots.map((slot) => [slot.startTime, slot])),
      );
    });
    return index;
  }, [scheduleGrid.providers]);

  return (
    <div className="max-h-[70vh] overflow-auto bg-white [scrollbar-gutter:stable]">
      <div
        className="grid min-w-[860px]"
        style={{
          gridTemplateColumns: `92px repeat(${scheduleGrid.providers.length}, minmax(220px, 1fr))`,
        }}
      >
        <div className="sticky left-0 top-0 z-30 border-b border-r border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Time
        </div>
        {scheduleGrid.providers.map((provider) => (
          <div
            className="sticky top-0 z-20 border-b border-r border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3"
            key={provider.providerId}
          >
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: provider.providerColor }} />
              <div className="font-medium text-[var(--foreground)]">{provider.providerName}</div>
            </div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">{provider.specialty}</div>
          </div>
        ))}

        {slotStarts.map((slotStart) => (
          <ScheduleGridRow
            appointmentById={appointmentById}
            key={slotStart}
            lockedProviderId={lockedProviderId}
            onBookedSlotClick={onBookedSlotClick}
            onOpenBooking={onOpenBooking}
            scheduleGrid={scheduleGrid}
            slotsByProvider={slotsByProvider}
            slotStart={slotStart}
          />
        ))}
      </div>
    </div>
  );
});

const ScheduleGridRow = memo(function ScheduleGridRow({
  appointmentById,
  lockedProviderId,
  onBookedSlotClick,
  onOpenBooking,
  scheduleGrid,
  slotsByProvider,
  slotStart,
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
  slotsByProvider: Map<
    string,
    Map<string, ProviderDayScheduleGrid["providers"][number]["slots"][number]>
  >;
  slotStart: string;
}) {
  return (
    <>
      <div className="sticky left-0 z-10 border-b border-r border-[var(--border)] bg-white px-3 py-3 text-sm text-[var(--text-muted)]">
        {formatClockLabel(slotStart)}
      </div>
      {scheduleGrid.providers.map((provider) => {
        const slot = slotsByProvider.get(provider.providerId)?.get(slotStart);
        const appointmentView = slot?.appointmentId
          ? appointmentById.get(slot.appointmentId)
          : undefined;
        const canBookThisProvider = !lockedProviderId || lockedProviderId === provider.providerId;
        const interactive =
          slot?.state === "BOOKED" || (slot?.state === "AVAILABLE" && canBookThisProvider);
        const isBooked = slot?.state === "BOOKED";
        return (
          <button
            className={`min-h-16 border-b border-r border-[var(--border)] px-3 py-2 text-left transition ${
              slot?.state === "BOOKED" || slot?.state === "AVAILABLE"
                ? "hover:bg-[var(--surface-muted)]"
                : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
            }`}
            disabled={!interactive}
            key={`${provider.providerId}-${slotStart}`}
            style={
              isBooked
                ? {
                    backgroundColor: `${provider.providerColor}16`,
                    boxShadow: `inset 4px 0 0 ${provider.providerColor}`,
                  }
                : slot?.state === "AVAILABLE"
                  ? {
                      backgroundColor: "#fcfffe",
                      opacity: canBookThisProvider ? 1 : 0.7,
                    }
                  : undefined
            }
            onClick={() =>
              slot?.state === "BOOKED" && appointmentView
                ? onBookedSlotClick(appointmentView)
                : onOpenBooking(provider.providerId, scheduleGrid.date, undefined, slot?.startTime)
            }
            type="button"
          >
            {slot?.state === "BOOKED" && appointmentView ? (
              <div>
                <div className="truncate font-semibold text-[var(--foreground)]">
                  {slot.appointmentSummary?.customerName ?? appointmentView.customer?.name ?? "Client"}
                </div>
                <div className="mt-1 text-xs text-[var(--text-muted)]">
                  {slot.appointmentSummary?.serviceName ?? "Booked"}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="text-[11px] font-medium" style={{ color: provider.providerColor }}>
                    {slot.appointmentSummary?.status ?? "Booked"}
                  </div>
                  {appointmentView.priority === "Urgent" ? (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                      Urgent
                    </span>
                  ) : null}
                </div>
              </div>
            ) : slot?.state === "AVAILABLE" ? (
              <div className="text-xs text-[var(--text-muted)]">
                {canBookThisProvider ? "Open slot" : "View only"}
              </div>
            ) : (
              <div className="text-xs text-[var(--text-muted)]">
                {slot?.state === "BLOCKED" ? "Blocked" : "Unavailable"}
              </div>
            )}
          </button>
        );
      })}
    </>
  );
});

function MobileDayScheduleList({
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
        .flatMap((provider) =>
          provider.slots
            .filter((slot) => slot.state === "BOOKED" || slot.state === "AVAILABLE")
            .map((slot) => ({ provider, slot })),
        )
        .sort((left, right) => {
          const timeDifference =
            new Date(left.slot.startTime).getTime() -
            new Date(right.slot.startTime).getTime();
          return timeDifference ||
            left.provider.providerName.localeCompare(right.provider.providerName);
        }),
    [scheduleGrid.providers],
  );

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap gap-2" aria-label="Provider colours">
        {scheduleGrid.providers.map((provider) => (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-2.5 py-1 text-xs text-[var(--text-muted)]"
            key={provider.providerId}
          >
            <span className="size-2 rounded-full" style={{ backgroundColor: provider.providerColor }} />
            {provider.providerName}
          </span>
        ))}
      </div>
      <div className="relative space-y-2 before:absolute before:bottom-4 before:left-[3.15rem] before:top-4 before:w-px before:bg-[var(--border)]">
        {timeline.map(({ provider, slot }) => {
          const appointmentView = slot.appointmentId
            ? appointmentById.get(slot.appointmentId)
            : undefined;
          const isBooked = slot.state === "BOOKED";
          const canBookThisProvider =
            !lockedProviderId || lockedProviderId === provider.providerId;
          return (
            <div className="relative grid grid-cols-[3.35rem_minmax(0,1fr)] gap-3" key={`${provider.providerId}-${slot.startTime}`}>
              <time className="pt-3 text-xs font-semibold tabular-nums text-[var(--text-muted)]">
                {formatClockLabel(slot.startTime)}
              </time>
              <span
                aria-hidden="true"
                className="absolute left-[2.86rem] top-4 size-2.5 rounded-full border-2 border-white"
                style={{ backgroundColor: provider.providerColor }}
              />
              <button
                className="min-w-0 rounded-xl border border-[var(--border)] px-3 py-3 text-left disabled:opacity-60"
                disabled={!isBooked && !canBookThisProvider}
                style={{
                  backgroundColor: isBooked ? `${provider.providerColor}18` : "white",
                  boxShadow: `inset 3px 0 0 ${provider.providerColor}`,
                }}
                onClick={() =>
                  isBooked && appointmentView
                    ? onBookedSlotClick(appointmentView)
                    : canBookThisProvider
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
                        ? slot.appointmentSummary?.customerName ?? "Booked appointment"
                        : "Available"}
                    </strong>
                    <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                      {provider.providerName}
                      {isBooked && slot.appointmentSummary?.serviceName
                        ? ` · ${slot.appointmentSummary.serviceName}`
                        : canBookThisProvider
                          ? " · Tap to book"
                          : " · View only"}
                    </span>
                  </span>
                  {isBooked ? (
                    <StatusPill status={slot.appointmentSummary?.status ?? "Scheduled"} />
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
  const nextAction =
    appointment.status === "Scheduled"
      ? { label: "Confirm appointment", status: "Confirmed" as const }
      : appointment.status === "Confirmed"
        ? { label: "Check in Client", status: "CheckedIn" as const }
        : appointment.status === "CheckedIn"
          ? { label: "Start appointment", status: "InProgress" as const }
          : appointment.status === "InProgress"
            ? { label: "Complete appointment", status: "Completed" as const }
            : null;

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
                {appointment.customer?.name ?? "Unknown Client"}
              </div>
              <div className="mt-1 text-sm text-[var(--text-muted)]">
                {appointment.services.map((service) => service.name).join(", ") || "Service not specified"}
              </div>
            </div>
            <StatusPill status={appointment.status} />
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
