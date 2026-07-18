"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button, Panel, PriorityTag, StatusPill } from "@/components/ui";
import { useWorkspaceApp } from "@/components/workspace/app-state";
import { EmptyState, MetricTile, PageHeader } from "@/components/workspace/elements";
import {
  MobileWorkspaceBottomNav,
  MobileWorkspaceMoreSheet,
} from "@/components/workspace/mobile-workspace-nav";
import { ApiRequestError, apiFetchJson } from "@/lib/api-client";
import type { AppointmentStatus, Priority } from "@/lib/domain";

const billingRoles = new Set(["Owner", "Admin", "Manager", "Receptionist", "Scheduler"]);

type V1Envelope<T> = { data: T; meta: { apiVersion: "v1"; requestId?: string } };

export type DashboardBootstrap = {
  context: {
    organization: { id: string; name: string; timezone: string; primaryCalendar: "AD" | "BS" };
    actor: { id: string; name: string; roles: string[]; roleSource: string; capabilities: string[] };
  };
  summary: {
    activeClientCount: number;
    appointmentsNext24Hours: number;
    overdueFollowUpCount: number;
    generatedAtIso: string;
  };
  schedule: {
    items: Array<{
      id: string;
      startsAtIso: string;
      endsAtIso: string;
      status: AppointmentStatus;
      priority: Priority;
      client: { id: string; name: string; clientCode: string | null };
      provider: { id: string; name: string };
      location: { id: string; name: string } | null;
    }>;
    page: { limit: number; count: number; hasMore: boolean };
  };
  followUps: {
    items: Array<{
      id: string;
      dueAtIso: string;
      status: string;
      priority: Priority;
      type: string;
      summary: string;
      nextAction: string;
      client: { id: string; name: string; clientCode: string | null };
    }>;
    page: { limit: number; count: number; hasMore: boolean };
  };
};

export function unwrapDashboardBootstrap(envelope: V1Envelope<DashboardBootstrap>) {
  if (envelope.meta?.apiVersion !== "v1" || !envelope.data) {
    throw new Error("The dashboard service returned an unsupported response.");
  }
  return envelope.data;
}

export function dashboardBootstrapError(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 403) {
    return "You do not have permission to view this dashboard.";
  }
  if (error instanceof ApiRequestError && error.status === 401) {
    return "Your session has expired. Please sign in again.";
  }
  return error instanceof Error ? error.message : "The dashboard could not be loaded.";
}

export function DashboardPage() {
  const router = useRouter();
  const { sessionUser, logout, updateAppointmentStatus } = useWorkspaceApp();
  const [bootstrap, setBootstrap] = useState<DashboardBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"agenda" | "followups" | "clinic">("agenda");
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  const loadBootstrap = useCallback(async () => {
    setError(null);
    try {
      const response = await apiFetchJson<V1Envelope<DashboardBootstrap>>("/v1/dashboard/bootstrap?limit=12", {
        cache: "no-store",
      });
      setBootstrap(unwrapDashboardBootstrap(response));
    } catch (loadError) {
      setBootstrap(null);
      setError(dashboardBootstrapError(loadError));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  const scheduleLabel = sessionUser?.providerId ? "Schedule" : "Reservations";
  const scheduleHref = sessionUser?.providerId ? "/my-schedule" : "/reservations";
  const updateStatus = async (appointmentId: string, status: "Completed" | "Confirmed") => {
    setUpdatingId(appointmentId);
    try {
      await updateAppointmentStatus(appointmentId, status);
      await loadBootstrap();
    } finally {
      setUpdatingId(null);
    }
  };

  if (isLoading) {
    return <DashboardState body="Loading the server-confirmed dashboard snapshot..." title="Loading overview" />;
  }

  if (error || !bootstrap) {
    return (
      <DashboardState
        actionLabel="Retry"
        body={error ?? "The dashboard service returned no data."}
        onAction={() => {
          setIsLoading(true);
          void loadBootstrap();
        }}
        title={error?.includes("permission") ? "Dashboard permission denied" : "Overview unavailable"}
      />
    );
  }

  return (
    <>
      <div className="hidden space-y-5 md:block">
        <PageHeader
          title="Overview"
          subtitle={`Server-confirmed clinic snapshot · generated ${formatDateTime(bootstrap.summary.generatedAtIso, bootstrap.context.organization.timezone)}`}
          action={
            <div className="flex items-center gap-3">
              <Button
                disabled={isRefreshing}
                onClick={() => {
                  setIsRefreshing(true);
                  void loadBootstrap();
                }}
                variant="ghost"
              >
                <RefreshCw aria-hidden="true" size={16} />
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </Button>
              <Link className="text-sm font-medium text-[var(--accent)] hover:text-[var(--accent-strong)]" href="/reservations">
                Open reservations
              </Link>
            </div>
          }
        />

        <DashboardMetrics bootstrap={bootstrap} />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.9fr)]">
          <Panel title="Upcoming appointments · next 24 hours">
            <BootstrapAppointments
              appointments={bootstrap.schedule.items}
              hasMore={bootstrap.schedule.page.hasMore}
              isUpdatingId={updatingId}
              onComplete={(id) => void updateStatus(id, "Completed")}
              onConfirm={(id) => void updateStatus(id, "Confirmed")}
              timezone={bootstrap.context.organization.timezone}
            />
          </Panel>
          <Panel title="Overdue follow-ups">
            <BootstrapFollowUps followUps={bootstrap.followUps.items} hasMore={bootstrap.followUps.page.hasMore} timezone={bootstrap.context.organization.timezone} />
          </Panel>
        </div>
      </div>

      <div className="space-y-4 pb-24 md:hidden">
        <div className="sticky top-[57px] z-10 -mx-4 border-b border-[var(--border)] bg-[var(--surface)]/95 px-4 pb-3 pt-3 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-[var(--foreground)]">Overview</div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">Next 24 hours · server-confirmed</div>
            </div>
            <Button onClick={() => router.push(scheduleHref)} variant="secondary">
              <ArrowRight aria-hidden="true" size={16} />
              {scheduleLabel}
            </Button>
          </div>
          <div className="mt-3 flex rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-1">
            <MobileTabButton active={mobileTab === "agenda"} label="Agenda" onClick={() => setMobileTab("agenda")} />
            <MobileTabButton active={mobileTab === "followups"} label="Follow-ups" onClick={() => setMobileTab("followups")} />
            <MobileTabButton active={mobileTab === "clinic"} label="Clinic" onClick={() => setMobileTab("clinic")} />
          </div>
        </div>

        {mobileTab === "agenda" ? (
          <div className="space-y-4">
            <DashboardMetrics bootstrap={bootstrap} compact />
            <Panel title="Upcoming appointments">
              <BootstrapAppointments
                appointments={bootstrap.schedule.items}
                hasMore={bootstrap.schedule.page.hasMore}
                isUpdatingId={updatingId}
                onComplete={(id) => void updateStatus(id, "Completed")}
                onConfirm={(id) => void updateStatus(id, "Confirmed")}
                timezone={bootstrap.context.organization.timezone}
              />
            </Panel>
          </div>
        ) : null}

        {mobileTab === "followups" ? (
          <Panel title="Overdue follow-ups">
            <BootstrapFollowUps followUps={bootstrap.followUps.items} hasMore={bootstrap.followUps.page.hasMore} timezone={bootstrap.context.organization.timezone} />
          </Panel>
        ) : null}

        {mobileTab === "clinic" ? (
          <div className="space-y-4">
            <DashboardMetrics bootstrap={bootstrap} compact />
            <Panel title="Quick actions">
              <div className="space-y-3 p-4">
                <QuickLink body="Open the provider board and move into booking from there." href={scheduleHref} label={scheduleLabel} />
                <QuickLink body="Review client records and visit history from one place." href="/patients" label="Clients" />
                {billingRoles.has(sessionUser?.role ?? "") ? <QuickLink body="Check invoices and record payments." href="/billing" label="Billing" /> : null}
              </div>
            </Panel>
          </div>
        ) : null}

        {mobileMoreOpen ? (
          <MobileWorkspaceMoreSheet
            hasArchiveAccess={["Owner", "Admin"].includes(sessionUser?.role ?? "")}
            hasBillingAccess={billingRoles.has(sessionUser?.role ?? "")}
            hasMySchedule={Boolean(sessionUser?.providerId)}
            hasSettingsAccess={["Owner", "Admin", "Manager"].includes(sessionUser?.role ?? "")}
            onClose={() => setMobileMoreOpen(false)}
            onLogout={logout}
            onNavigate={(href) => {
              setMobileMoreOpen(false);
              router.push(href);
            }}
          />
        ) : null}
        <MobileWorkspaceBottomNav
          active="more"
          onBook={() => router.push("/reservations?book=1")}
          onMore={() => setMobileMoreOpen(true)}
          onSchedule={() => router.push(scheduleHref)}
        />
      </div>
    </>
  );
}

function DashboardMetrics({ bootstrap, compact = false }: { bootstrap: DashboardBootstrap; compact?: boolean }) {
  const metrics = [
    { label: "Active clients", value: String(bootstrap.summary.activeClientCount), hint: "Current clinic records" },
    { label: "Next 24 hours", value: String(bootstrap.summary.appointmentsNext24Hours), hint: "Active appointments" },
    { label: "Overdue follow-ups", value: String(bootstrap.summary.overdueFollowUpCount), hint: "Needs action" },
  ];
  if (compact) {
    return <div className="grid grid-cols-3 gap-3">{metrics.map((metric) => <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3" key={metric.label}><div className="text-xs text-[var(--text-muted)]">{metric.label}</div><div className="mt-2 text-xl font-semibold text-[var(--foreground)]">{metric.value}</div></div>)}</div>;
  }
  return <div className="grid gap-4 md:grid-cols-3">{metrics.map((metric) => <MetricTile hint={metric.hint} key={metric.label} label={metric.label} value={metric.value} />)}</div>;
}

function BootstrapAppointments({ appointments, hasMore, isUpdatingId, onComplete, onConfirm, timezone }: { appointments: DashboardBootstrap["schedule"]["items"]; hasMore: boolean; isUpdatingId: string | null; onComplete: (id: string) => void; onConfirm: (id: string) => void; timezone: string }) {
  if (!appointments.length) return <div className="px-4 py-6 text-sm text-[var(--text-muted)]">No active appointments in the next 24 hours.</div>;
  return <div className="divide-y divide-[var(--border)]">{appointments.map((appointment) => <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between" key={appointment.id}><div className="min-w-0"><div className="truncate font-medium text-[var(--foreground)]">{appointment.client.name}</div><div className="mt-1 text-sm text-[var(--text-muted)]">{formatTimeRange(appointment.startsAtIso, appointment.endsAtIso, timezone)} · {appointment.provider.name}</div><div className="mt-1 text-sm text-[var(--text-muted)]">{appointment.location?.name ?? "No location assigned"}</div></div><div className="flex flex-wrap items-center gap-2"><PriorityTag priority={appointment.priority} /><StatusPill status={appointment.status} />{appointment.status === "Scheduled" ? <button className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--foreground)] disabled:opacity-60" disabled={isUpdatingId === appointment.id} onClick={() => onConfirm(appointment.id)} type="button">Confirm</button> : null}{appointment.status !== "Completed" ? <button className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--foreground)] disabled:opacity-60" disabled={isUpdatingId === appointment.id} onClick={() => onComplete(appointment.id)} type="button">Complete</button> : null}</div></div>)}{hasMore ? <div className="px-4 py-3 text-sm text-[var(--text-muted)]">More appointments are available in Reservations.</div> : null}</div>;
}

function BootstrapFollowUps({ followUps, hasMore, timezone }: { followUps: DashboardBootstrap["followUps"]["items"]; hasMore: boolean; timezone: string }) {
  if (!followUps.length) return <div className="px-4 py-6 text-sm text-[var(--text-muted)]">No overdue follow-ups right now.</div>;
  return <div className="divide-y divide-[var(--border)]">{followUps.map((task) => <div className="px-4 py-4" key={task.id}><div className="flex items-start justify-between gap-3"><div><div className="font-medium text-[var(--foreground)]">{task.summary}</div><div className="mt-1 text-sm text-[var(--text-muted)]">{task.client.name} · due {formatDateTime(task.dueAtIso, timezone)}</div><div className="mt-2 text-sm text-[var(--text-muted)]">{task.nextAction}</div></div><PriorityTag priority={task.priority} /></div></div>)}{hasMore ? <div className="px-4 py-3 text-sm text-[var(--text-muted)]">More overdue follow-ups are available in the work queue.</div> : null}</div>;
}

function DashboardState({ actionLabel, body, onAction, title }: { actionLabel?: string; body: string; onAction?: () => void; title: string }) {
  return <div className="p-4 md:p-0"><EmptyState actionLabel={actionLabel} body={body} onAction={onAction} title={title} /></div>;
}

function MobileTabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-[var(--surface)] text-[var(--foreground)]" : "text-[var(--text-muted)]"}`} onClick={onClick} type="button">{label}</button>;
}

function QuickLink({ body, href, label }: { body: string; href: string; label: string }) {
  return <Link className="block rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-4" href={href}><div className="flex items-start justify-between gap-3"><div><div className="font-medium text-[var(--foreground)]">{label}</div><div className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{body}</div></div><ArrowRight aria-hidden="true" className="mt-0.5 text-[var(--accent)]" size={16} /></div></Link>;
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
}

function formatTimeRange(start: string, end: string, timezone: string) {
  const format = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: timezone });
  return `${format.format(new Date(start))}–${format.format(new Date(end))}`;
}
