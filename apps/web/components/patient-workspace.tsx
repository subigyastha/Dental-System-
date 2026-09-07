"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileText,
  Filter,
  Phone,
  Plus,
  Search,
  Stethoscope,
  UserRound,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import { Button, Panel, PriorityTag, StatusPill } from "@/components/ui";
import { Drawer } from "@/components/workspace/elements";
import {
  getDualCalendarDay,
  minutesToLabel,
  toDateKey,
} from "@/lib/date-localization";
import type {
  Appointment,
  CalendarMode,
  Customer,
  FollowUpTask,
  Priority,
  Provider,
  Service,
  VisitReport,
} from "@/lib/domain";

type AppointmentView = Appointment & {
  customer?: Customer;
  provider?: Provider;
  services: Service[];
};

type FollowUpView = FollowUpTask & {
  customer?: Customer;
  owner?: Provider;
};

export type VisitReportInput = {
  customerId: string;
  appointmentId: string;
  providerId: string;
  serviceId: string;
  visitSummary: string;
  symptoms: string;
  clinicalNotes: string;
  doctorNotes: string;
  followUpRequired: boolean;
  followUpDateIso?: string;
};

export function PatientWorkspace({
  appointments,
  calendarMode,
  customers,
  followUps,
  onBook,
  onCreate,
  onCreateVisitReport,
  providers,
  services,
  visitReports,
}: {
  appointments: AppointmentView[];
  calendarMode: CalendarMode;
  customers: Customer[];
  followUps: FollowUpView[];
  onBook: (customerId: string) => void;
  onCreate: () => void;
  onCreateVisitReport: (input: VisitReportInput) => void;
  providers: Provider[];
  services: Service[];
  visitReports: VisitReport[];
}) {
  const [query, setQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<"all" | Customer["risk"]>("all");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  const customerStats = useMemo(() => {
    const totalPatients = customers.length;
    const scheduledThisWeek = appointments.filter((appointment) => {
      const appointmentTime = new Date(appointment.startsAtIso).getTime();
      const now = new Date("2026-05-06T00:00:00+05:45").getTime();
      const inWeek = appointmentTime >= now && appointmentTime <= now + 7 * 24 * 60 * 60 * 1000;
      return inWeek;
    }).length;
    const openRecovery = followUps.filter((task) => task.status !== "Done").length;
    const monitoring = customers.filter(
      (customer) => customer.risk === "High priority" || customer.risk === "Needs attention",
    ).length;

    return { totalPatients, scheduledThisWeek, openRecovery, monitoring };
  }, [appointments, customers, followUps]);

  const patientRows = useMemo(() => {
    return customers
      .map((customer) => {
        const patientAppointments = appointments
          .filter((appointment) => appointment.customerId === customer.id)
          .sort(
            (a, b) =>
              new Date(a.startsAtIso).getTime() - new Date(b.startsAtIso).getTime(),
          );
        const reports = visitReports
          .filter((report) => report.customerId === customer.id)
          .sort(
            (a, b) =>
              new Date(b.appointmentStartsAtIso).getTime() -
              new Date(a.appointmentStartsAtIso).getTime(),
          );
        const activeFollowUps = followUps.filter(
          (task) => task.customerId === customer.id && task.status !== "Done",
        );

        const nextAppointment = patientAppointments.find(
          (appointment) => new Date(appointment.startsAtIso).getTime() >= Date.now(),
        );
        const mostRecentAppointment = [...patientAppointments]
          .reverse()
          .find(
            (appointment) =>
              new Date(appointment.startsAtIso).getTime() <= Date.now(),
          );

        const status = derivePatientStatus(nextAppointment, activeFollowUps, customer);

        return {
          customer,
          reports,
          activeFollowUps,
          nextAppointment,
          mostRecentAppointment,
          status,
          nextAction:
            activeFollowUps[0]?.summary ??
            nextAppointment?.services.map((service) => service.name).join(", ") ??
            "No next step scheduled",
        };
      })
      .filter(({ customer, nextAction, nextAppointment, status }) => {
        if (riskFilter !== "all" && customer.risk !== riskFilter) {
          return false;
        }

        if (!query.trim()) {
          return true;
        }

        const haystack = [
          customer.name,
          customer.patientCode,
          customer.phone,
          customer.email,
          customer.risk,
          status.label,
          nextAction,
          nextAppointment?.provider?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(query.trim().toLowerCase());
      })
      .sort((a, b) => {
        const riskScore = riskWeight(b.customer.risk) - riskWeight(a.customer.risk);
        if (riskScore !== 0) {
          return riskScore;
        }
        return a.customer.name.localeCompare(b.customer.name);
      });
  }, [appointments, customers, followUps, query, riskFilter, visitReports]);

  const selectedCustomerRow =
    patientRows.find((row) => row.customer.id === selectedCustomerId) ?? null;

  if (selectedCustomerRow) {
    return (
      <PatientDetailWorkspace
        appointmentViews={appointments.filter(
          (appointment) => appointment.customerId === selectedCustomerRow.customer.id,
        )}
        calendarMode={calendarMode}
        customer={selectedCustomerRow.customer}
        followUps={selectedCustomerRow.activeFollowUps}
        onBack={() => setSelectedCustomerId(null)}
        onBook={() => onBook(selectedCustomerRow.customer.id)}
        onCreateVisitReport={onCreateVisitReport}
        providers={providers}
        services={services}
        visitReports={selectedCustomerRow.reports}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="font-['Hanken_Grotesk','Segoe_UI',sans-serif] text-4xl font-bold text-[var(--ink)]">
            Patient Directory
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">
            Keep every patient record, upcoming visit, recovery task, and visit report
            in one clinical workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-11 items-center gap-2 rounded-full border border-[var(--border)] bg-white px-4 text-sm text-[var(--text-muted)]">
            <Search size={16} />
            <input
              className="w-56 border-none bg-transparent p-0 outline-none placeholder:text-[var(--text-muted)]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search patients, records, or follow-ups..."
              value={query}
            />
          </div>
          <Button variant="secondary">
            <Filter size={16} />
            Filters
          </Button>
          <Button onClick={onCreate}>
            <Plus size={16} />
            New patient
          </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<UserRound size={20} />}
          label="Total Patients"
          value={String(customerStats.totalPatients)}
        />
        <MetricCard
          icon={<CalendarDays size={20} />}
          label="Scheduled This Week"
          value={String(customerStats.scheduledThisWeek)}
        />
        <MetricCard
          icon={<ClipboardList size={20} />}
          label="Open Follow-ups"
          value={String(customerStats.openRecovery)}
        />
        <MetricCard
          icon={<AlertTriangle size={20} />}
          label="Monitoring Queue"
          value={String(customerStats.monitoring)}
          tone="warning"
        />
      </section>

      <Panel
        action={
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "Routine", "Needs attention", "High priority"] as const).map((risk) => (
              <button
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  riskFilter === risk
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
                }`}
                key={risk}
                onClick={() => setRiskFilter(risk)}
                type="button"
              >
                {risk === "all" ? "All risks" : risk}
              </button>
            ))}
          </div>
        }
        title="Patients"
      >
        <div className="hidden xl:block">
          <div className="grid grid-cols-[2.1fr_1fr_1fr_1.4fr_120px] border-b border-[var(--border)] bg-[var(--surface-muted)] px-6 py-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            <span>Patient</span>
            <span>Status</span>
            <span>Last visit</span>
            <span>Next step</span>
            <span className="text-right">Actions</span>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {patientRows.map((row) => (
              <button
                className="grid w-full grid-cols-[2.1fr_1fr_1fr_1.4fr_120px] items-center px-6 py-5 text-left transition hover:bg-[var(--surface-muted)]"
                key={row.customer.id}
                onClick={() => setSelectedCustomerId(row.customer.id)}
                type="button"
              >
                <div className="flex items-center gap-4">
                  <div className="flex size-12 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-sm font-bold text-[var(--accent-strong)]">
                    {initials(row.customer.name)}
                  </div>
                  <div>
                    <div className="text-base font-semibold text-[var(--ink)]">
                      {row.customer.name}
                    </div>
                    <div className="mt-1 text-sm text-[var(--text-muted)]">
                      {row.customer.patientCode ?? formatPatientCode(row.customer.id)} - {row.customer.phone}
                    </div>
                  </div>
                </div>
                <span>
                  <PatientStatusChip label={row.status.label} tone={row.status.tone} />
                </span>
                <div className="text-sm text-[var(--ink)]">
                  <div>{formatVisitDate(row.customer.lastVisitIso, calendarMode)}</div>
                  <div className="mt-1 text-[var(--text-muted)]">
                    {row.mostRecentAppointment?.services[0]?.name ?? "No recorded visit"}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--ink)]">
                    {row.nextAppointment
                      ? formatVisitDate(row.nextAppointment.startsAtIso, calendarMode)
                      : "No upcoming visit"}
                  </div>
                  <div className="mt-1 truncate text-sm text-[var(--text-muted)]">
                    {row.nextAction}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-3">
                  <Button
                    onClick={() => onBook(row.customer.id)}
                    variant="secondary"
                  >
                    Book
                  </Button>
                  <ChevronRight size={18} className="text-[var(--text-muted)]" />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 p-4 xl:hidden">
          {patientRows.map((row) => (
            <button
              className="rounded-2xl border border-[var(--border)] bg-white p-4 text-left"
              key={row.customer.id}
              onClick={() => setSelectedCustomerId(row.customer.id)}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-sm font-bold text-[var(--accent-strong)]">
                    {initials(row.customer.name)}
                  </div>
                  <div>
                    <div className="font-semibold text-[var(--ink)]">{row.customer.name}</div>
                    <div className="text-sm text-[var(--text-muted)]">
                      {row.customer.patientCode ?? formatPatientCode(row.customer.id)}
                    </div>
                  </div>
                </div>
                <PatientStatusChip label={row.status.label} tone={row.status.tone} />
              </div>
              <div className="mt-4 grid gap-2 text-sm text-[var(--text-muted)]">
                <span>Last visit: {formatVisitDate(row.customer.lastVisitIso, calendarMode)}</span>
                <span>{row.nextAction}</span>
              </div>
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function PatientDetailWorkspace({
  appointmentViews,
  calendarMode,
  customer,
  followUps,
  onBack,
  onBook,
  onCreateVisitReport,
  providers,
  services,
  visitReports,
}: {
  appointmentViews: AppointmentView[];
  calendarMode: CalendarMode;
  customer: Customer;
  followUps: FollowUpView[];
  onBack: () => void;
  onBook: () => void;
  onCreateVisitReport: (input: VisitReportInput) => void;
  providers: Provider[];
  services: Service[];
  visitReports: VisitReport[];
}) {
  const [isReportOpen, setIsReportOpen] = useState(false);
  const nextAppointment = [...appointmentViews]
    .filter((appointment) => new Date(appointment.startsAtIso).getTime() >= Date.now())
    .sort(
      (a, b) =>
        new Date(a.startsAtIso).getTime() - new Date(b.startsAtIso).getTime(),
    )[0];

  const reportReadyAppointments = [...appointmentViews].sort(
    (a, b) =>
      new Date(b.startsAtIso).getTime() - new Date(a.startsAtIso).getTime(),
  );

  return (
    <>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onBack} variant="ghost">
            <ArrowLeft size={16} />
            Back to directory
          </Button>
          <div className="text-sm text-[var(--text-muted)]">
            Patient workspace / {customer.patientCode ?? formatPatientCode(customer.id)}
          </div>
        </div>

        <Panel>
          <div className="flex flex-col gap-5 p-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex size-20 items-center justify-center rounded-[24px] bg-[var(--surface-subtle)] text-[var(--accent-strong)]">
                <UserRound size={34} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-['Hanken_Grotesk','Segoe_UI',sans-serif] text-4xl font-bold text-[var(--ink)]">
                    {customer.name}
                  </h2>
                  <PatientStatusChip
                    label={customer.status ?? "Active"}
                    tone={customer.risk === "High priority" ? "danger" : "good"}
                  />
                </div>
                <p className="mt-2 text-lg text-[var(--text-muted)]">
                  {customer.patientCode ?? formatPatientCode(customer.id)} - {customer.gender ?? "Not set"} - {customer.age} years
                </p>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--text-muted)]">
                  <span className="inline-flex items-center gap-2">
                    <Phone size={14} />
                    {customer.phone}
                  </span>
                  {customer.email ? (
                    <span>{customer.email}</span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-start gap-3 xl:items-end">
              {customer.allergies ? (
                <div className="inline-flex items-center gap-2 rounded-2xl bg-[#ffede8] px-4 py-3 text-sm font-semibold text-[#9f2f1f]">
                  <AlertTriangle size={18} />
                  Allergies: {customer.allergies}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setIsReportOpen(true)} variant="secondary">
                  <FileText size={16} />
                  Create visit report
                </Button>
                <Button onClick={onBook}>
                  <CalendarDays size={16} />
                  Schedule visit
                </Button>
              </div>
            </div>
          </div>
        </Panel>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            <Panel
              action={
                <div className="text-sm font-semibold text-[var(--text-muted)]">
                  Teeth chart pending integration
                </div>
              }
              title="Clinical map"
            >
              <div className="rounded-[20px] bg-[var(--surface-muted)] p-10 text-center">
                <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-8">
                  <Stethoscope size={32} className="text-[var(--accent)]" />
                  <h3 className="text-xl font-semibold text-[var(--ink)]">
                    Dental chart will plug in here
                  </h3>
                  <p className="text-sm leading-6 text-[var(--text-muted)]">
                    Keep the patient workspace ready for future tooth-mapping or scan
                    overlays while visit reports and continuity notes work today.
                  </p>
                </div>
              </div>
            </Panel>

            <Panel
              action={
                <Button onClick={() => setIsReportOpen(true)}>
                  <Plus size={16} />
                  Create visit report
                </Button>
              }
              title="Visit reports"
            >
              <div className="divide-y divide-[var(--border)]">
                {visitReports.length ? (
                  visitReports.map((report) => {
                    const appointment = appointmentViews.find(
                      (item) => item.id === report.appointmentId,
                    );
                    const provider = providers.find(
                      (item) => item.id === report.providerId,
                    );
                    const service = services.find(
                      (item) => item.id === report.serviceId,
                    );

                    return (
                      <div className="grid gap-4 px-5 py-5 md:grid-cols-[88px_1fr_auto]" key={report.id}>
                        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-4 text-center">
                          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                            {monthShort(report.appointmentStartsAtIso)}
                          </div>
                          <div className="mt-1 text-3xl font-bold text-[var(--ink)]">
                            {dayOfMonth(report.appointmentStartsAtIso)}
                          </div>
                        </div>
                        <div>
                          <h3 className="text-xl font-semibold text-[var(--ink)]">
                            {service?.name ?? appointment?.services[0]?.name ?? "Visit report"}
                          </h3>
                          <div className="mt-2 text-sm text-[var(--text-muted)]">
                            {provider?.name ?? appointment?.provider?.name ?? "Assigned provider"} - {minutesToLabel(appointment?.durationMinutes ?? 0)}
                          </div>
                          <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
                            {report.visitSummary}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--text-muted)]">
                              {service?.category ?? "Clinical"}
                            </span>
                            {report.followUpRequired ? (
                              <PriorityTag priority={"High" as Priority} />
                            ) : (
                              <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--brand-strong)]">
                                Closed
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3 md:justify-end">
                          {report.followUpRequired ? (
                            <div className="rounded-full bg-[var(--secondary-surface)] px-3 py-1 text-xs font-semibold text-[var(--secondary-text)]">
                              Follow-up due{" "}
                              {report.followUpDateIso
                                ? formatVisitDate(report.followUpDateIso, calendarMode)
                                : "soon"}
                            </div>
                          ) : (
                            <StatusPill status="Completed" />
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <EmptyState
                    actionLabel="Create the first visit report"
                    onAction={() => setIsReportOpen(true)}
                    text="No clinical visit reports have been logged for this patient yet."
                    title="Visit reports start here"
                  />
                )}
              </div>
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel title="Clinical profile">
              <div className="space-y-4 p-5">
                <DetailFact label="Risk" value={customer.risk} />
                <DetailFact
                  label="Date of birth"
                  value={customer.dateOfBirthIso ? formatVisitDate(customer.dateOfBirthIso, "AD") : "Not set"}
                />
                <DetailFact label="Address" value={customer.address ?? "Not recorded"} />
                <DetailFact
                  label="Emergency contact"
                  value={
                    customer.emergencyContactName
                      ? `${customer.emergencyContactName} - ${customer.emergencyContactPhone ?? ""}`
                      : "Not recorded"
                  }
                />
                <DetailFact
                  label="Medical note"
                  value={customer.medicalNotes ?? "No clinical note recorded yet"}
                />
              </div>
            </Panel>

            <Panel title="Clinical assets">
              <div className="p-5">
                <div className="rounded-[20px] border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-6 text-sm leading-6 text-[var(--text-muted)]">
                  Tooth scans, panoramic images, and intraoral assets can live here once
                  imaging is connected. The patient workspace stays ready without blocking
                  visit reporting.
                </div>
              </div>
            </Panel>

            <Panel title="Care continuity">
              <div className="space-y-3 p-5">
                {followUps.length ? (
                  followUps.map((task) => (
                    <div
                      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4"
                      key={task.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold text-[var(--ink)]">
                            {task.summary}
                          </div>
                          <div className="mt-2 text-sm text-[var(--text-muted)]">
                            {task.nextAction}
                          </div>
                        </div>
                        <PriorityTag priority={task.priority} />
                      </div>
                    </div>
                  ))
                ) : nextAppointment ? (
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <div className="text-base font-semibold text-[var(--ink)]">
                      Upcoming visit booked
                    </div>
                    <div className="mt-2 text-sm text-[var(--text-muted)]">
                      {formatVisitDate(nextAppointment.startsAtIso, calendarMode)} -{" "}
                      {nextAppointment.services.map((service) => service.name).join(", ")}
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    actionLabel="Schedule next visit"
                    onAction={onBook}
                    text="There are no open follow-ups or upcoming visits for this patient."
                    title="Care continuity is clear"
                  />
                )}
              </div>
            </Panel>
          </div>
        </div>
      </div>

      {isReportOpen ? (
        <CreateVisitReportDialog
          appointments={reportReadyAppointments}
          customer={customer}
          onClose={() => setIsReportOpen(false)}
          onCreate={(input) => {
            onCreateVisitReport(input);
            setIsReportOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function MetricCard({
  icon,
  label,
  tone = "neutral",
  value,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "neutral" | "warning";
  value: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-[24px] border border-[var(--border)] bg-white p-5 shadow-[var(--card-shadow)]">
      <div
        className={`flex size-14 items-center justify-center rounded-full ${
          tone === "warning"
            ? "bg-[var(--secondary-surface)] text-[var(--secondary-text)]"
            : "bg-[var(--surface-muted)] text-[var(--accent)]"
        }`}
      >
        {icon}
      </div>
      <div>
        <div className="text-sm text-[var(--text-muted)]">{label}</div>
        <div className="mt-1 text-3xl font-bold text-[var(--ink)]">{value}</div>
      </div>
    </div>
  );
}

function PatientStatusChip({
  label,
  tone,
}: {
  label: string;
  tone: "neutral" | "good" | "warning" | "danger";
}) {
  const tones = {
    neutral: "bg-[var(--surface-muted)] text-[var(--text-muted)]",
    good: "bg-[var(--accent-soft)] text-[var(--brand-strong)]",
    warning: "bg-[var(--secondary-surface)] text-[var(--secondary-text)]",
    danger: "bg-[var(--danger-soft)] text-[var(--danger)]",
  };

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${tones[tone]}`}>
      {label}
    </span>
  );
}

function DetailFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-2 text-sm leading-6 text-[var(--ink)]">{value}</div>
    </div>
  );
}

function EmptyState({
  actionLabel,
  onAction,
  text,
  title,
}: {
  actionLabel: string;
  onAction: () => void;
  text: string;
  title: string;
}) {
  return (
    <div className="p-5">
      <div className="rounded-[20px] border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-6">
        <h3 className="text-base font-semibold text-[var(--ink)]">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{text}</p>
        <div className="mt-4">
          <Button onClick={onAction}>{actionLabel}</Button>
        </div>
      </div>
    </div>
  );
}

function CreateVisitReportDialog({
  appointments,
  customer,
  onClose,
  onCreate,
}: {
  appointments: AppointmentView[];
  customer: Customer;
  onClose: () => void;
  onCreate: (input: VisitReportInput) => void;
}) {
  const initialAppointment = appointments[0];
  const [appointmentId, setAppointmentId] = useState(initialAppointment?.id ?? "");
  const [visitSummary, setVisitSummary] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [doctorNotes, setDoctorNotes] = useState("");
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");

  const selectedAppointment =
    appointments.find((appointment) => appointment.id === appointmentId) ?? appointments[0];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAppointment) {
      return;
    }

    onCreate({
      customerId: customer.id,
      appointmentId: selectedAppointment.id,
      providerId: selectedAppointment.providerId,
      serviceId: selectedAppointment.serviceIds[0] ?? selectedAppointment.services[0]?.id ?? "",
      visitSummary,
      symptoms,
      clinicalNotes,
      doctorNotes,
      followUpRequired,
      followUpDateIso: followUpDate ? `${followUpDate}T09:00:00+05:45` : undefined,
    });
  }

  return (
    <Drawer
      context={`Save a visit outcome for ${customer.name} against one scheduled appointment.`}
      onClose={onClose}
      title="Create visit report"
    >
        <form className="space-y-5" onSubmit={submit}>
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-[var(--ink)]">Appointment</span>
            <select
              className="h-11 w-full rounded-xl border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] outline-none"
              onChange={(event) => setAppointmentId(event.target.value)}
              value={appointmentId}
            >
              {appointments.map((appointment) => (
                <option key={appointment.id} value={appointment.id}>
                  {formatVisitDate(appointment.startsAtIso, "AD")} - {appointment.services.map((service) => service.name).join(", ")}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-4">
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-[var(--ink)]">Symptoms</span>
              <textarea
                className="min-h-28 w-full rounded-2xl border border-[var(--border)] px-3 py-3 text-sm text-[var(--ink)] outline-none"
                onChange={(event) => setSymptoms(event.target.value)}
                value={symptoms}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-[var(--ink)]">Visit summary</span>
              <textarea
                className="min-h-28 w-full rounded-2xl border border-[var(--border)] px-3 py-3 text-sm text-[var(--ink)] outline-none"
                onChange={(event) => setVisitSummary(event.target.value)}
                required
                value={visitSummary}
              />
            </label>
          </div>

          <div className="grid gap-4">
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-[var(--ink)]">Clinical notes</span>
              <textarea
                className="min-h-32 w-full rounded-2xl border border-[var(--border)] px-3 py-3 text-sm text-[var(--ink)] outline-none"
                onChange={(event) => setClinicalNotes(event.target.value)}
                value={clinicalNotes}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-[var(--ink)]">Doctor notes</span>
              <textarea
                className="min-h-32 w-full rounded-2xl border border-[var(--border)] px-3 py-3 text-sm text-[var(--ink)] outline-none"
                onChange={(event) => setDoctorNotes(event.target.value)}
                value={doctorNotes}
              />
            </label>
          </div>

          <div className="grid gap-4">
            <label className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm font-semibold text-[var(--ink)]">
              <input
                checked={followUpRequired}
                onChange={(event) => setFollowUpRequired(event.target.checked)}
                type="checkbox"
              />
              Follow-up required
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-[var(--ink)]">Follow-up date</span>
              <input
                className="h-11 w-full rounded-xl border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] outline-none"
                onChange={(event) => setFollowUpDate(event.target.value)}
                type="date"
                value={followUpDate}
              />
            </label>
          </div>

          <div className="sticky -bottom-5 -mx-5 flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-4">
            <Button onClick={onClose} variant="secondary">
              Cancel
            </Button>
            <Button type="submit">
              <CheckCircle2 size={16} />
              Save visit report
            </Button>
          </div>
        </form>
    </Drawer>
  );
}

function derivePatientStatus(
  nextAppointment: AppointmentView | undefined,
  followUps: FollowUpView[],
  customer: Customer,
) {
  if (followUps.some((task) => task.priority === "Urgent")) {
    return { label: "Overdue", tone: "danger" as const };
  }

  if (nextAppointment?.status === "CheckedIn" || nextAppointment?.status === "InProgress") {
    return { label: "In Chair", tone: "good" as const };
  }

  if (nextAppointment?.status === "Confirmed") {
    return { label: "Confirmed", tone: "good" as const };
  }

  if (nextAppointment) {
    return { label: "Booked", tone: "neutral" as const };
  }

  if (customer.risk === "High priority" || customer.risk === "Needs attention") {
    return { label: "Needs Review", tone: "warning" as const };
  }

  return { label: "Active", tone: "good" as const };
}

function riskWeight(risk: Customer["risk"]) {
  if (risk === "High priority") return 3;
  if (risk === "Needs attention") return 2;
  return 1;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatPatientCode(customerId: string) {
  return `KD-${customerId.slice(-4).toUpperCase()}`;
}

function formatVisitDate(iso: string, mode: CalendarMode) {
  const dual = getDualCalendarDay(toDateKey(iso));
  return mode === "BS"
    ? `${dual.bsLabel} / ${dual.adLabel}`
    : `${dual.adLabel} / ${dual.bsLabel}`;
}

function monthShort(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short" }).toUpperCase();
}

function dayOfMonth(iso: string) {
  return new Date(iso).getDate();
}
