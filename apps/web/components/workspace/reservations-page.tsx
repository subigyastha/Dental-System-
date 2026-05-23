"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarPlus2,
  ChevronLeft,
  ChevronRight,
  Eye,
  PencilLine,
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
  ProviderDayScheduleGrid,
} from "@/lib/domain";

type CalendarView = "day" | "month";
const selfBookingRestrictedRoles = new Set(["Provider", "Assistant"]);

export function ReservationsPage({
  providerScope,
  visibleProviderScope,
}: {
  providerScope?: string;
  visibleProviderScope?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    calendarMode,
    data,
    deleteAppointment,
    fetchAppointmentDaySummaries,
    fetchAppointmentsRange,
    fetchScheduleGridForDay,
    logout,
    selectedDate,
    sessionUser,
    setCalendarMode,
    setSelectedDate,
    updateAppointmentStatus,
  } = useWorkspaceApp();
  const [calendarView, setCalendarView] = useState<CalendarView>("day");
  const [selectedProviderId, setSelectedProviderId] = useState("all");
  const [rangeAppointments, setRangeAppointments] = useState<Appointment[]>([]);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [monthSummaries, setMonthSummaries] = useState<AppointmentDaySummary[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [dayScheduleGrid, setDayScheduleGrid] = useState<ProviderDayScheduleGrid | null>(null);
  const [dayGridLoading, setDayGridLoading] = useState(false);
  const [monthAnchorDate, setMonthAnchorDate] = useState(selectedDate);
  const [selectedDayDetailsDate, setSelectedDayDetailsDate] = useState(selectedDate);
  const [bookingState, setBookingState] = useState<{
    customerId?: string;
    date?: string;
    providerId?: string;
    appointment?: Appointment;
    slotIso?: string;
  } | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  const activeDate = calendarView === "month" ? selectedDayDetailsDate : selectedDate;
  const sessionBookingScope =
    sessionUser?.providerId && selfBookingRestrictedRoles.has(sessionUser.role)
      ? sessionUser.providerId
      : undefined;
  const bookingProviderLimit = visibleProviderScope ?? providerScope ?? sessionBookingScope;
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

  const monthGrid = useMemo(
    () => buildCalendarGrid(monthAnchorDate, calendarMode),
    [calendarMode, monthAnchorDate],
  );

  const selectedDayAppointments = useMemo(
    () =>
      appointmentViews.filter((appointment) => toDateKey(appointment.startsAtIso) === activeDate),
    [activeDate, appointmentViews],
  );

  const openBooking = useCallback((
    providerId?: string,
    date?: string,
    appointment?: Appointment,
    slotIso?: string,
  ) => {
    setBookingState({
      customerId: searchParams.get("customerId") ?? undefined,
      providerId,
      date,
      appointment,
      slotIso,
    });
  }, [searchParams]);

  useEffect(() => {
    setSelectedDayDetailsDate(selectedDate);
    setMonthAnchorDate(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    if (searchParams.get("book") !== "1" || bookingState) {
      return;
    }

    const queryDate = searchParams.get("date") ?? selectedDate;
    const queryProviderId =
      bookingProviderLimit ?? searchParams.get("providerId") ?? undefined;
    openBooking(queryProviderId, queryDate);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("book");
    nextParams.delete("providerId");
    nextParams.delete("date");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `/reservations?${nextQuery}` : "/reservations", { scroll: false });
  }, [bookingProviderLimit, bookingState, openBooking, router, searchParams, selectedDate]);

  useEffect(() => {
    let cancelled = false;
    const { fromIso, toIso } = getVisibleRange(calendarView, selectedDate, monthAnchorDate);
    setRangeLoading(true);

    void fetchAppointmentsRange({
      fromIso,
      toIso,
      providerId: selectedProviderId === "all" ? undefined : selectedProviderId,
      locationId: data.locations[0]?.id,
    })
      .then((appointments) => {
        if (!cancelled) {
          setRangeAppointments(appointments);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRangeLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    calendarView,
    data.locations,
    fetchAppointmentsRange,
    monthAnchorDate,
    selectedDate,
    selectedProviderId,
  ]);

  useEffect(() => {
    if (calendarView !== "month") {
      return;
    }
    let cancelled = false;
    const monthKeys = getMonthDateKeys(monthGrid.cells);
    setSummaryLoading(true);
    void fetchAppointmentDaySummaries({
      fromDateKey: monthKeys.fromDateKey,
      toDateKey: monthKeys.toDateKey,
      providerId: selectedProviderId === "all" ? undefined : selectedProviderId,
      locationId: data.locations[0]?.id,
    })
      .then((summaries) => {
        if (!cancelled) {
          setMonthSummaries(summaries);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSummaryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    calendarView,
    data.locations,
    fetchAppointmentDaySummaries,
    monthGrid.cells,
    selectedProviderId,
  ]);

  useEffect(() => {
    if (calendarView !== "day" || !visibleProviders.length) {
      setDayScheduleGrid(null);
      return;
    }
    let cancelled = false;
    setDayGridLoading(true);
    void Promise.all(
      visibleProviders.map((provider) =>
        fetchScheduleGridForDay({
          providerId: provider.id,
          date: selectedDate,
          locationId: data.locations[0]?.id,
        }),
      ),
    )
      .then((grids) => {
        if (cancelled) {
          return;
        }
        setDayScheduleGrid({
          date: selectedDate,
          timezone: "Asia/Kathmandu",
          providers: grids.flatMap((grid) => grid.providers),
        });
      })
      .finally(() => {
        if (!cancelled) {
          setDayGridLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [calendarView, data.locations, fetchScheduleGridForDay, selectedDate, visibleProviders]);

  const summaryByDate = useMemo(
    () => new Map(monthSummaries.map((summary) => [summary.dateKey, summary])),
    [monthSummaries],
  );

  return (
    <div className="space-y-5 md:space-y-5">
      <div className="hidden md:block">
        <PageHeader
          title={title}
          subtitle={subtitle}
          action={
            <Button onClick={() => openBooking(bookingProviderLimit, activeDate)}>
              <CalendarPlus2 size={16} />
              New appointment
            </Button>
          }
        />

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground)] transition hover:bg-white"
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
              className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground)] transition hover:bg-white"
              onClick={() => handleNext(calendarView, selectedDate, monthAnchorDate, setSelectedDate, setMonthAnchorDate)}
              type="button"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!visibleProviderScope ? (
              <select
                className={inputClassName}
                onChange={(event) => setSelectedProviderId(event.target.value)}
                value={selectedProviderId}
              >
                <option value="all">All providers</option>
                {data.providers
                  .filter((provider) => provider.status !== "Inactive")
                  .map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
              </select>
            ) : null}
            <ViewToggle current={calendarView} onChange={setCalendarView} />
          </div>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_320px]">
          <div className="space-y-5">
            {calendarView === "day" ? (
              <DayGridPanel
                appointmentById={appointmentById}
                calendarMode={calendarMode}
                dateKey={selectedDate}
                isLoading={dayGridLoading || rangeLoading}
                lockedProviderId={bookingProviderLimit}
                onBookedSlotClick={setSelectedAppointment}
                onOpenBooking={(providerId, date) => openBooking(providerId, date)}
                scheduleGrid={dayScheduleGrid}
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
            <Panel title="Date">
              <div className="p-4">
                <DualCalendarDatePicker
                  mode={calendarMode}
                  onChange={setSelectedDate}
                  onModeChange={setCalendarMode}
                  value={selectedDate}
                />
              </div>
            </Panel>

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
            ) : (
              <DayListPanel
                appointments={selectedDayAppointments}
                calendarMode={calendarMode}
                dateKey={selectedDate}
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
          calendarMode={calendarMode}
          calendarView={calendarView}
          dayGridLoading={dayGridLoading || rangeLoading}
          monthAnchorDate={monthAnchorDate}
          monthGrid={monthGrid}
          monthSummaries={summaryByDate}
          onChangeMonth={(months) =>
            setMonthAnchorDate(shiftCalendarPage(monthAnchorDate, calendarMode, months))
          }
          onChangeView={setCalendarView}
          onLogout={logout}
          onMoreOpenChange={setMobileMoreOpen}
          onOpenAppointment={setSelectedAppointment}
          onOpenBooking={openBooking}
          onSelectDate={setSelectedDate}
          onSelectDayDetailsDate={setSelectedDayDetailsDate}
          moreOpen={mobileMoreOpen}
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
        />
      </div>

      {bookingState ? (
        <AppointmentBookingModal
          defaultCustomerId={bookingState.customerId}
          defaultProviderId={bookingState.providerId}
          fixedProviderId={bookingProviderLimit ? bookingProviderLimit : undefined}
          initialDate={bookingState.date}
          initialAppointment={bookingState.appointment}
          initialSlotIso={bookingState.slotIso}
          onClose={() => setBookingState(null)}
        />
      ) : null}

      {selectedAppointment ? (
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
          onStatusChange={async (status) => {
            await updateAppointmentStatus(selectedAppointment.id, status);
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
  calendarMode,
  calendarView,
  dayGridLoading,
  dayScheduleGrid,
  monthAnchorDate,
  monthGrid,
  monthSummaries,
  onChangeMonth,
  onChangeView,
  onLogout,
  onMoreOpenChange,
  onOpenAppointment,
  onOpenBooking,
  onSelectDate,
  onSelectDayDetailsDate,
  moreOpen,
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
}: {
  appointmentById: Map<string, ReturnType<typeof buildAppointmentView>>;
  appointments: ReturnType<typeof buildAppointmentView>[];
  calendarMode: "BS" | "AD";
  calendarView: CalendarView;
  dayGridLoading: boolean;
  dayScheduleGrid: ProviderDayScheduleGrid | null;
  monthAnchorDate: string;
  monthGrid: ReturnType<typeof buildCalendarGrid>;
  monthSummaries: Map<string, AppointmentDaySummary>;
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
  providerOptions: Array<{ id: string; name: string; status: string }>;
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
          hasMySchedule={Boolean(visibleProviderScope)}
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
        canViewBilling={["Owner", "Admin", "Manager", "Receptionist", "Scheduler"].includes(
          sessionUser.role,
        )}
        scheduleLabel={visibleProviderScope ? "Schedule" : "Reservations"}
        onBilling={() => router.push("/billing")}
        onBook={() => onOpenBooking(providerScope, selectedDate)}
        onMore={() => onMoreOpenChange(true)}
        onOverview={() => router.push("/dashboard")}
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
    <div className="flex rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-1">
      {(["month", "day"] as CalendarView[]).map((view) => (
        <button
          className={`rounded px-3 py-1.5 text-sm font-medium transition ${
            current === view ? "bg-white text-[var(--foreground)]" : "text-[var(--text-muted)]"
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
      <div className="border-b border-[var(--border)] px-4 py-4">
        <AppointmentDateHeader adDateKey={dateKey} mode={calendarMode} />
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

function MonthPanel({
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
                <button
                  className={`min-h-28 border-b border-r border-[var(--border)] px-2 py-2 text-left ${
                    selected ? "bg-white ring-1 ring-inset ring-[var(--accent)]" : "bg-white"
                  }`}
                  key={cell.adDateKey}
                  onClick={() => onDaySelect(cell.adDateKey)}
                  type="button"
                >
                  <div className="text-base font-semibold text-[var(--foreground)]">
                    {calendarMode === "BS" ? cell.dual.bsDay : cell.dual.adDay}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {calendarMode === "BS" ? cell.dual.adDay : cell.dual.bsDay}
                  </div>
                  <div className="mt-3 text-xs text-[var(--text-muted)]">
                    {summary?.appointmentCount ?? 0} appointments
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(summary?.providerMarkers ?? []).slice(0, 4).map((marker) => (
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        key={`${cell.adDateKey}-${marker.providerId}`}
                        style={{ backgroundColor: marker.color }}
                      />
                    ))}
                  </div>
                  <div className="mt-3 text-[11px] text-[var(--text-muted)]">
                    {summary?.hasAvailability ? "Open capacity" : "Low capacity"}
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      aria-label="View day schedule"
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:bg-white hover:text-[var(--foreground)]"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenDay(cell.adDateKey);
                      }}
                      type="button"
                    >
                      <Eye size={14} />
                    </button>
                  </div>
                </button>
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
                  {appointment.customer?.name ?? "Unknown patient"}
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
  onAppointmentClick,
}: {
  appointments: ReturnType<typeof buildAppointmentView>[];
  calendarMode: "BS" | "AD";
  dateKey: string;
  onAppointmentClick: (appointment: Appointment) => void;
}) {
  return (
    <Panel title="Daily list">
      <div className="border-b border-[var(--border)] p-4">
        <DualDateDisplay adDateKey={dateKey} mode={calendarMode} />
      </div>
      <div className="divide-y divide-[var(--border)]">
        {appointments.length ? (
          appointments.map((appointment) => (
            <button
              className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left"
              key={appointment.id}
              onClick={() => onAppointmentClick(appointment)}
              type="button"
            >
              <div>
                <div className="font-medium text-[var(--foreground)]">
                  {appointment.customer?.name ?? "Unknown patient"}
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

  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-[760px]"
        style={{
          gridTemplateColumns: `88px repeat(${scheduleGrid.providers.length}, minmax(180px, 1fr))`,
        }}
      >
        <div className="border-b border-r border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Time
        </div>
        {scheduleGrid.providers.map((provider) => (
          <div
            className="border-b border-r border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2"
            key={provider.providerId}
          >
            <div className="font-medium text-[var(--foreground)]">{provider.providerName}</div>
            <div className="text-xs text-[var(--text-muted)]">{provider.specialty}</div>
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
  slotStart: string;
}) {
  return (
    <>
      <div className="border-b border-r border-[var(--border)] px-3 py-3 text-sm text-[var(--text-muted)]">
        {formatClockLabel(slotStart)}
      </div>
      {scheduleGrid.providers.map((provider) => {
        const slot = provider.slots.find((entry) => entry.startTime === slotStart);
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
                    backgroundColor: `${provider.providerColor}18`,
                    boxShadow: `inset 3px 0 0 ${provider.providerColor}`,
                  }
                : slot?.state === "AVAILABLE"
                  ? {
                      backgroundColor: "#ffffff",
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
                    <div className="truncate font-medium text-[var(--foreground)]">
                      {slot.appointmentSummary?.customerName ?? appointmentView.customer?.name ?? "Patient"}
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">
                      {slot.appointmentSummary?.serviceName ?? "Booked"}
                    </div>
                    <div className="mt-1 text-[11px] font-medium" style={{ color: provider.providerColor }}>
                      {slot.appointmentSummary?.status ?? "Booked"}
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
  return (
    <div className="space-y-4 p-4">
      {scheduleGrid.providers.map((provider) => {
        const visibleSlots = provider.slots.filter(
          (slot) => slot.state === "BOOKED" || slot.state === "AVAILABLE",
        );
        return (
          <div className="rounded-lg border border-[var(--border)]" key={provider.providerId}>
            <div className="border-b border-[var(--border)] px-4 py-3">
              <div className="font-medium text-[var(--foreground)]">{provider.providerName}</div>
              <div className="text-sm text-[var(--text-muted)]">{provider.specialty}</div>
            </div>
            <div className="space-y-2 p-3">
              {visibleSlots.slice(0, 8).map((slot) => {
                const appointmentView = slot.appointmentId
                  ? appointmentById.get(slot.appointmentId)
                  : undefined;
                const isBooked = slot.state === "BOOKED";
                const canBookThisProvider =
                  !lockedProviderId || lockedProviderId === provider.providerId;
                return (
                  <button
                    className="flex w-full items-center justify-between rounded-md border border-[var(--border)] px-3 py-3 text-left"
                    disabled={!isBooked && !canBookThisProvider}
                    key={slot.startTime}
                    style={
                      isBooked
                        ? {
                            backgroundColor: `${provider.providerColor}18`,
                            boxShadow: `inset 3px 0 0 ${provider.providerColor}`,
                          }
                        : undefined
                    }
                    onClick={() =>
                      slot.state === "BOOKED" && appointmentView
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
                    <div>
                      <div className="font-medium text-[var(--foreground)]">
                        {formatClockLabel(slot.startTime)}
                      </div>
                      <div className="text-sm text-[var(--text-muted)]">
                        {slot.state === "BOOKED"
                          ? slot.appointmentSummary?.customerName ?? "Booked"
                          : canBookThisProvider
                            ? "Open slot"
                            : "View only"}
                      </div>
                    </div>
                    <StatusPill
                      status={slot.state === "BOOKED" ? slot.appointmentSummary?.status ?? "Scheduled" : "Scheduled"}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AppointmentDetailModal({
  appointment,
  onClose,
  onDelete,
  onEdit,
  onStatusChange,
}: {
  appointment: ReturnType<typeof buildAppointmentView>;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onEdit: () => void;
  onStatusChange: (status: "Confirmed" | "Completed") => Promise<void>;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  return (
    <Modal onClose={onClose} title="Appointment details">
      <div className="space-y-4">
        <div>
          <div className="text-lg font-medium text-[var(--foreground)]">
            {appointment.customer?.name ?? "Unknown patient"}
          </div>
          <div className="mt-1 text-sm text-[var(--text-muted)]">
            {appointment.provider?.name ?? "Unassigned"} ·{" "}
            {formatClockRange(
              appointment.startsAtIso,
              appointment.durationMinutes,
              appointment.bufferMinutes,
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <PriorityTag priority={appointment.priority} />
          <StatusPill status={appointment.status} />
        </div>

        <div className="text-sm text-[var(--text-muted)]">
          {appointment.services.map((service) => service.name).join(", ") || "No service"}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {appointment.status === "Scheduled" ? (
            <Button onClick={() => void onStatusChange("Confirmed")} variant="secondary">
              Confirm
            </Button>
          ) : null}
          {appointment.status !== "Completed" ? (
            <Button onClick={() => void onStatusChange("Completed")} variant="secondary">
              Complete
            </Button>
          ) : null}
          <Button onClick={onEdit} variant="secondary">
            <PencilLine size={16} />
            Edit
          </Button>
          <Button
            onClick={async () => {
              setIsDeleting(true);
              try {
                await onDelete();
              } finally {
                setIsDeleting(false);
              }
            }}
            variant="ghost"
          >
            <Trash2 size={16} />
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>
    </Modal>
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
  setSelectedDate(addDaysToDateKey(selectedDate, 1));
}

function addMonthsToDateKey(dateKey: string, months: number) {
  const date = new Date(`${dateKey}T12:00:00+05:45`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}
