"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";

import { DualCalendarDatePicker, DualDateDisplay } from "@/components/calendar-ui";
import { Button, Panel, PriorityTag, StatusPill } from "@/components/ui";
import { useWorkspaceApp } from "@/components/workspace/app-state";
import {
  MetricTile,
  PageHeader,
} from "@/components/workspace/elements";
import {
  MobileWorkspaceBottomNav,
  MobileWorkspaceMoreSheet,
} from "@/components/workspace/mobile-workspace-nav";
import {
  buildAppointmentView,
  buildFollowUpView,
  formatClockRange,
  formatDualDate,
} from "@/components/workspace/workspace-utils";
import { toDateKey } from "@/lib/calendar";

const billingRoles = new Set(["Owner", "Admin", "Manager", "Receptionist", "Scheduler"]);

type MobileOverviewTab = "agenda" | "followups" | "clinic";

export function DashboardPage() {
  const router = useRouter();
  const {
    data,
    calendarMode,
    selectedDate,
    sessionUser,
    logout,
    setCalendarMode,
    setSelectedDate,
    updateAppointmentStatus,
  } = useWorkspaceApp();
  const [agendaMode, setAgendaMode] = useState<"today" | "tomorrow" | "date">("today");
  const [mobileTab, setMobileTab] = useState<MobileOverviewTab>("agenda");
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  const agendaDateKey = useMemo(() => {
    if (agendaMode === "today") {
      return todayDateKey();
    }
    if (agendaMode === "tomorrow") {
      return addDaysToDateKey(todayDateKey(), 1);
    }
    return selectedDate;
  }, [agendaMode, selectedDate]);

  const appointmentViews = useMemo(
    () =>
      data.appointments.map((appointment) =>
        buildAppointmentView(appointment, data.customers, data.providers, data.services),
      ),
    [data.appointments, data.customers, data.providers, data.services],
  );

  const followUpViews = useMemo(
    () =>
      data.followUps
        .filter((task) => task.status !== "Done")
        .map((task) => buildFollowUpView(task, data.customers, data.providers))
        .sort((a, b) => new Date(a.dueIso).getTime() - new Date(b.dueIso).getTime()),
    [data.customers, data.followUps, data.providers],
  );

  const dayAppointments = useMemo(
    () =>
      appointmentViews
        .filter((appointment) => toDateKey(appointment.startsAtIso) === agendaDateKey)
        .sort((a, b) => new Date(a.startsAtIso).getTime() - new Date(b.startsAtIso).getTime()),
    [agendaDateKey, appointmentViews],
  );

  const unconfirmedCount = dayAppointments.filter(
    (appointment) => appointment.communicationState !== "Confirmed by phone",
  ).length;
  const providerPressureCount = data.providers.filter(
    (provider) => provider.status !== "Available",
  ).length;
  const urgentFollowUps = followUpViews.filter((task) => task.priority === "Urgent");
  const scheduleLabel = sessionUser?.providerId ? "Schedule" : "Reservations";
  const scheduleHref = sessionUser?.providerId ? "/my-schedule" : "/reservations";

  return (
    <>
      <div className="hidden space-y-5 md:block">
        <PageHeader
          title="Overview"
          subtitle="Fast clinic picture with today, tomorrow, or any picked date."
          action={
            <Link
              className="text-sm font-medium text-[var(--accent)] hover:text-[var(--accent-strong)]"
              href="/reservations"
            >
              Open reservations
            </Link>
          }
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricTile
            hint={`${dayAppointments.filter((appointment) => appointment.status === "Confirmed").length} confirmed`}
            label={agendaMode === "tomorrow" ? "Tomorrow" : agendaMode === "date" ? "Selected day" : "Today"}
            value={String(dayAppointments.length)}
          />
          <MetricTile
            hint={`${urgentFollowUps.length} urgent`}
            label="Open follow-ups"
            value={String(followUpViews.length)}
          />
          <MetricTile hint="Needs calls or reminders" label="Unconfirmed" value={String(unconfirmedCount)} />
          <MetricTile
            hint="Providers marked busy or away"
            label="Provider pressure"
            value={String(providerPressureCount)}
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.9fr)]">
          <Panel
            action={
              <div className="flex gap-2">
                <QuickTab active={agendaMode === "today"} label="Today" onClick={() => setAgendaMode("today")} />
                <QuickTab active={agendaMode === "tomorrow"} label="Tomorrow" onClick={() => setAgendaMode("tomorrow")} />
                <QuickTab active={agendaMode === "date"} label="Pick date" onClick={() => setAgendaMode("date")} />
              </div>
            }
            title={`Agenda - ${formatDualDate(agendaDateKey, calendarMode)}`}
          >
            {agendaMode === "date" ? (
              <div className="border-b border-[var(--border)] p-4">
                <DualCalendarDatePicker
                  mode={calendarMode}
                  onChange={setSelectedDate}
                  onModeChange={setCalendarMode}
                  value={selectedDate}
                />
              </div>
            ) : null}
            <AppointmentAgendaList
              appointments={dayAppointments}
              emptyMessage="No appointments booked for this day yet."
              onComplete={(appointmentId) => void updateAppointmentStatus(appointmentId, "Completed")}
              onConfirm={(appointmentId) => void updateAppointmentStatus(appointmentId, "Confirmed")}
            />
          </Panel>

          <Panel title="Follow-ups">
            <FollowUpList followUps={followUpViews.slice(0, 6)} />
          </Panel>
        </div>
      </div>

      <div className="space-y-4 pb-24 md:hidden">
        <div className="sticky top-[57px] z-10 -mx-4 border-b border-[var(--border)] bg-[var(--surface)]/95 px-4 pb-3 pt-3 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-[var(--foreground)]">Overview</div>
              <div className="mt-1">
                <DualDateDisplay
                  adDateKey={agendaDateKey}
                  mode={calendarMode}
                  primaryClassName="text-base font-semibold"
                  secondaryClassName="text-xs"
                />
              </div>
            </div>
            <Button onClick={() => router.push(scheduleHref)} variant="secondary">
              <ArrowRight size={16} />
              {scheduleLabel}
            </Button>
          </div>

          <div className="mt-3 flex rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-1">
            <MobileOverviewTabButton
              active={mobileTab === "agenda"}
              label="Agenda"
              onClick={() => setMobileTab("agenda")}
            />
            <MobileOverviewTabButton
              active={mobileTab === "followups"}
              label="Follow-ups"
              onClick={() => setMobileTab("followups")}
            />
            <MobileOverviewTabButton
              active={mobileTab === "clinic"}
              label="Clinic"
              onClick={() => setMobileTab("clinic")}
            />
          </div>
        </div>

        {mobileTab === "agenda" ? (
          <div className="space-y-4">
            <Panel
              action={
                <div className="flex items-center gap-2">
                  <button
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)]"
                    onClick={() => {
                      const nextDate = addDaysToDateKey(agendaDateKey, -1);
                      setAgendaMode("date");
                      setSelectedDate(nextDate);
                    }}
                    type="button"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <DateModeChip active={agendaMode === "today"} label="Today" onClick={() => setAgendaMode("today")} />
                  <DateModeChip active={agendaMode === "tomorrow"} label="Tomorrow" onClick={() => setAgendaMode("tomorrow")} />
                  <button
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)]"
                    onClick={() => {
                      const nextDate = addDaysToDateKey(agendaDateKey, 1);
                      setAgendaMode("date");
                      setSelectedDate(nextDate);
                    }}
                    type="button"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              }
              title="Day flow"
            >
              <div className="space-y-4 p-4">
                <div className="grid grid-cols-2 gap-3">
                  <MobileMetricCard
                    label={agendaMode === "tomorrow" ? "Tomorrow load" : agendaMode === "date" ? "Selected day" : "Today load"}
                    value={String(dayAppointments.length)}
                  />
                  <MobileMetricCard label="Needs follow-up" value={String(unconfirmedCount)} />
                </div>
                <DualCalendarDatePicker
                  mode={calendarMode}
                  onChange={(dateKey) => {
                    setAgendaMode("date");
                    setSelectedDate(dateKey);
                  }}
                  onModeChange={setCalendarMode}
                  value={agendaDateKey}
                />
              </div>
            </Panel>

            <Panel title="Appointments">
              <AppointmentAgendaList
                appointments={dayAppointments}
                compact
                emptyMessage="No appointments lined up for this day."
                onComplete={(appointmentId) => void updateAppointmentStatus(appointmentId, "Completed")}
                onConfirm={(appointmentId) => void updateAppointmentStatus(appointmentId, "Confirmed")}
              />
            </Panel>
          </div>
        ) : null}

        {mobileTab === "followups" ? (
          <div className="space-y-4">
            <Panel title="Urgent now">
              {urgentFollowUps.length ? (
                <div className="space-y-3 p-4">
                  {urgentFollowUps.slice(0, 3).map((task) => (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4" key={task.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-[var(--foreground)]">{task.summary}</div>
                          <div className="mt-1 text-sm text-[var(--text-muted)]">{task.nextAction}</div>
                        </div>
                        <PriorityTag priority={task.priority} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-sm text-[var(--text-muted)]">Nothing urgent is waiting right now.</div>
              )}
            </Panel>

            <Panel title="Open follow-ups">
              <FollowUpList followUps={followUpViews} compact />
            </Panel>
          </div>
        ) : null}

        {mobileTab === "clinic" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <MobileMetricCard label="Open follow-ups" value={String(followUpViews.length)} />
              <MobileMetricCard label="Provider pressure" value={String(providerPressureCount)} />
              <MobileMetricCard label="Confirmed today" value={String(dayAppointments.filter((appointment) => appointment.status === "Confirmed").length)} />
              <MobileMetricCard label="Urgent tasks" value={String(urgentFollowUps.length)} />
            </div>

            <Panel title="Quick actions">
              <div className="space-y-3 p-4">
                <QuickLinkCard
                  body="Open the full provider board and move into booking from there."
                  href={scheduleHref}
                  label={scheduleLabel}
                />
                <QuickLinkCard
                  body="Review patient records and move into visit history from one place."
                  href="/patients"
                  label="Patients"
                />
                {billingRoles.has(sessionUser?.role ?? "") ? (
                  <QuickLinkCard
                    body="Check unpaid invoices and record payments without leaving mobile flow."
                    href="/billing"
                    label="Billing"
                  />
                ) : null}
              </div>
            </Panel>
          </div>
        ) : null}

        {mobileMoreOpen ? (
          <MobileWorkspaceMoreSheet
            hasBillingAccess={billingRoles.has(sessionUser?.role ?? "")}
            hasMySchedule={Boolean(sessionUser?.providerId)}
            onClose={() => setMobileMoreOpen(false)}
            onLogout={logout}
            onNavigate={(href) => {
              setMobileMoreOpen(false);
              router.push(href);
            }}
          />
        ) : null}

        <MobileWorkspaceBottomNav
          active="overview"
          canViewBilling={billingRoles.has(sessionUser?.role ?? "")}
          onBilling={() => router.push("/billing")}
          onBook={() => router.push(`/reservations?book=1&date=${agendaDateKey}`)}
          onMore={() => setMobileMoreOpen(true)}
          onOverview={() => {}}
          onSchedule={() => router.push(scheduleHref)}
          scheduleLabel={scheduleLabel}
        />
      </div>
    </>
  );
}

function AppointmentAgendaList({
  appointments,
  compact = false,
  emptyMessage,
  onComplete,
  onConfirm,
}: {
  appointments: ReturnType<typeof buildAppointmentView>[];
  compact?: boolean;
  emptyMessage: string;
  onComplete: (appointmentId: string) => void;
  onConfirm: (appointmentId: string) => void;
}) {
  if (!appointments.length) {
    return <div className="px-4 py-6 text-sm text-[var(--text-muted)]">{emptyMessage}</div>;
  }

  return (
    <div className="divide-y divide-[var(--border)]">
      {appointments.map((appointment) => (
        <div
          className={`flex flex-col gap-3 px-4 py-4 ${compact ? "" : "sm:flex-row sm:items-center sm:justify-between"}`}
          key={appointment.id}
        >
          <div className="min-w-0">
            <div className="truncate font-medium text-[var(--foreground)]">
              {appointment.customer?.name ?? "Unknown patient"}
            </div>
            <div className="mt-1 text-sm text-[var(--text-muted)]">
              {formatClockRange(
                appointment.startsAtIso,
                appointment.durationMinutes,
                appointment.bufferMinutes,
              )}{" "}
              - {appointment.provider?.name ?? "Unassigned"}
            </div>
            <div className="mt-1 text-sm text-[var(--text-muted)]">
              {appointment.services.map((service) => service.name).join(", ") || "No service"}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <PriorityTag priority={appointment.priority} />
            <StatusPill status={appointment.status} />
            {appointment.status === "Scheduled" ? (
              <button
                className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--foreground)]"
                onClick={() => onConfirm(appointment.id)}
                type="button"
              >
                Confirm
              </button>
            ) : null}
            {appointment.status !== "Completed" ? (
              <button
                className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--foreground)]"
                onClick={() => onComplete(appointment.id)}
                type="button"
              >
                Complete
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function FollowUpList({
  followUps,
  compact = false,
}: {
  followUps: ReturnType<typeof buildFollowUpView>[];
  compact?: boolean;
}) {
  if (!followUps.length) {
    return <div className="px-4 py-6 text-sm text-[var(--text-muted)]">No open follow-ups right now.</div>;
  }

  return (
    <div className="divide-y divide-[var(--border)]">
      {followUps.map((task) => (
        <div className={`${compact ? "px-4 py-4" : "px-4 py-4"}`} key={task.id}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium text-[var(--foreground)]">{task.summary}</div>
              <div className="mt-1 text-sm text-[var(--text-muted)]">
                {task.customer?.name ?? "Unknown patient"} - {task.provider?.name ?? "Unassigned"}
              </div>
              <div className="mt-2 text-sm text-[var(--text-muted)]">{task.nextAction}</div>
            </div>
            <PriorityTag priority={task.priority} />
          </div>
        </div>
      ))}
    </div>
  );
}

function QuickTab({
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
      className={`rounded-md px-3 py-1.5 text-sm ${active ? "bg-white text-[var(--foreground)]" : "text-[var(--text-muted)]"}`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function MobileOverviewTabButton({
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
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
        active ? "bg-white text-[var(--foreground)] shadow-sm" : "text-[var(--text-muted)]"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function DateModeChip({
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
      className={`rounded-md border px-3 py-1.5 text-sm ${
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

function MobileMetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <div className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{value}</div>
    </div>
  );
}

function QuickLinkCard({
  body,
  href,
  label,
}: {
  body: string;
  href: string;
  label: string;
}) {
  return (
    <Link
      className="block rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4"
      href={href}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-[var(--foreground)]">{label}</div>
          <div className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{body}</div>
        </div>
        <div className="mt-0.5 rounded-full bg-white p-2 text-[var(--accent)]">
          <ArrowRight size={16} />
        </div>
      </div>
    </Link>
  );
}

function todayDateKey() {
  return toDateKey(new Date().toISOString());
}

function addDaysToDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00+05:45`);
  date.setDate(date.getDate() + days);
  return toDateKey(date.toISOString());
}
