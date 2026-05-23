"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, PencilLine, Trash2 } from "lucide-react";

import { KoiInlineLoader } from "@/components/koi-loader";

import { Button, Panel, PriorityTag, StatusPill } from "@/components/ui";
import { AppointmentBookingModal } from "@/components/workspace/appointment-booking-modal";
import { useWorkspaceApp, type VisitReportDraft } from "@/components/workspace/app-state";
import {
  EmptyState,
  Field,
  Modal,
  PageHeader,
  inputClassName,
  textareaClassName,
} from "@/components/workspace/elements";
import { PatientFormModal } from "@/components/workspace/patients-page";
import {
  buildAppointmentView,
  formatClockRange,
  formatDualDate,
} from "@/components/workspace/workspace-utils";

export function PatientDetailPage({ customerId }: { customerId: string }) {
  const router = useRouter();
  const {
    calendarMode,
    createVisitReport,
    data,
    deleteCustomer,
    invoices,
    invoicesLoading,
    loadInvoices,
    updateCustomer,
  } = useWorkspaceApp();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const customer = data.customers.find((item) => item.id === customerId);

  const appointments = useMemo(
    () =>
      data.appointments
        .filter((appointment) => appointment.customerId === customerId)
        .map((appointment) =>
          buildAppointmentView(appointment, data.customers, data.providers, data.services),
        )
        .sort((a, b) => new Date(b.startsAtIso).getTime() - new Date(a.startsAtIso).getTime()),
    [customerId, data.appointments, data.customers, data.providers, data.services],
  );

  const reports = data.visitReports
    .filter((report) => report.customerId === customerId)
    .sort(
      (a, b) =>
        new Date(b.appointmentStartsAtIso).getTime() -
        new Date(a.appointmentStartsAtIso).getTime(),
    );

  const nextAppointment = [...appointments]
    .filter((appointment) => new Date(appointment.startsAtIso).getTime() > Date.now())
    .sort((a, b) => new Date(a.startsAtIso).getTime() - new Date(b.startsAtIso).getTime())[0];
  const customerInvoices = invoices.filter((invoice) => invoice.customerId === customerId);

  useEffect(() => {
    void loadInvoices(customerId);
  }, [customerId, loadInvoices]);

  if (!customer) {
    return (
      <div className="space-y-5">
        <PageHeader title="Patient not found" subtitle="This record is no longer available." />
        <EmptyState
          actionHref="/patients"
          actionLabel="Back to patients"
          body="The patient may have been deleted or the link is outdated."
          title="Missing patient"
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={customer.name}
        subtitle={`${customer.patientCode ?? "Patient record"} · ${customer.phone}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setIsBookingOpen(true)}>Schedule visit</Button>
            <Button onClick={() => setIsReportOpen(true)} variant="secondary">
              <FilePlus2 size={16} />
              Visit report
            </Button>
            <Button onClick={() => setIsEditOpen(true)} variant="secondary">
              <PencilLine size={16} />
              Edit
            </Button>
            <Button
              onClick={async () => {
                await deleteCustomer(customer.id);
                router.replace("/patients");
              }}
              variant="ghost"
            >
              <Trash2 size={16} />
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="Patient details">
          <div className="grid gap-5 p-4 lg:grid-cols-2">
            <div className="space-y-4 text-sm">
              <Fact label="Risk" value={customer.risk} />
              <Fact label="Email" value={customer.email ?? "Not set"} />
              <Fact label="Date of birth" value={customer.dateOfBirthIso?.slice(0, 10) ?? "Not set"} />
              <Fact
                label="Emergency"
                value={
                  customer.emergencyContactName
                    ? `${customer.emergencyContactName} · ${customer.emergencyContactPhone ?? ""}`
                    : "Not set"
                }
              />
              <Fact label="Allergies" value={customer.allergies ?? "None recorded"} />
              <Fact label="Medical notes" value={customer.medicalNotes ?? "None recorded"} />
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="text-sm font-medium text-[var(--foreground)]">Current dental chart</div>
              <div className="mt-3 min-h-52 rounded-md border border-dashed border-[var(--border)] bg-white p-4 text-sm text-[var(--text-muted)]">
                The future 3D chart mounts here. For now the patient record already tracks chart version history and whether a visit updated the chart.
              </div>
              <div className="mt-3 text-xs text-[var(--text-muted)]">
                Version {customer.dentalChart?.version ?? 0}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Next step">
          <div className="p-4 text-sm">
            {nextAppointment ? (
              <div>
                <div className="font-medium text-[var(--foreground)]">Upcoming visit booked</div>
                <div className="mt-2 text-[var(--text-muted)]">
                  {formatDualDate(nextAppointment.startsAtIso, calendarMode)}
                </div>
              </div>
            ) : (
              <EmptyState
                actionLabel="Schedule next visit"
                body="No future visit is on the board right now."
                onAction={() => setIsBookingOpen(true)}
                title="No upcoming visit"
              />
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Appointments">
          <div className="divide-y divide-[var(--border)]">
            {appointments.length ? (
              appointments.map((appointment) => (
                <div className="px-4 py-4" key={appointment.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-[var(--foreground)]">
                        {appointment.services.map((service) => service.name).join(", ") || "Visit"}
                      </div>
                      <div className="mt-1 text-sm text-[var(--text-muted)]">
                        {formatDualDate(appointment.startsAtIso, calendarMode)} ·{" "}
                        {formatClockRange(
                          appointment.startsAtIso,
                          appointment.durationMinutes,
                          appointment.bufferMinutes,
                        )}
                      </div>
                      <div className="mt-1 text-sm text-[var(--text-muted)]">
                        {appointment.provider?.name ?? "Unassigned provider"}
                      </div>
                    </div>
                    <StatusPill status={appointment.status} />
                  </div>
                </div>
              ))
            ) : (
              <div className="p-4">
                <EmptyState
                  actionLabel="Schedule visit"
                  body="This patient has no booked visits yet."
                  onAction={() => setIsBookingOpen(true)}
                  title="No visit history"
                />
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Visit reports">
          <div className="divide-y divide-[var(--border)]">
            {reports.length ? (
              reports.map((report) => {
                const service = data.services.find((item) => item.id === report.serviceId);
                return (
                  <div className="px-4 py-4" key={report.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-[var(--foreground)]">
                          {service?.name ?? "Visit report"}
                        </div>
                        <div className="mt-1 text-sm text-[var(--text-muted)]">
                          {formatDualDate(report.appointmentStartsAtIso, calendarMode)}
                        </div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">
                          {report.dentalChartUpdated ? "Dental chart updated on this visit" : "No chart update saved"}
                        </div>
                        <div className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
                          {report.visitSummary}
                        </div>
                      </div>
                      {report.followUpRequired ? (
                        <PriorityTag priority="High" />
                      ) : (
                        <StatusPill status="Completed" />
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-4">
                <EmptyState
                  actionLabel="Create report"
                  body="No visit reports yet. The placeholder chart contract is already wired in for later 3D work."
                  onAction={() => setIsReportOpen(true)}
                  title="No visit reports yet"
                />
              </div>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Billing history">
        <div className="divide-y divide-[var(--border)]">
          {invoicesLoading ? (
            <KoiInlineLoader label="Loading billing" />
          ) : customerInvoices.length ? (
            customerInvoices.map((invoice) => (
              <div className="flex items-start justify-between gap-3 px-4 py-4" key={invoice.id}>
                <div>
                  <div className="font-medium text-[var(--foreground)]">{invoice.invoiceNumber}</div>
                  <div className="mt-1 text-sm text-[var(--text-muted)]">
                    Total {invoice.totalAmount.toFixed(2)} · Balance {invoice.balanceAmount.toFixed(2)}
                  </div>
                </div>
                <StatusPill status={invoice.status === "Paid" ? "Completed" : "Scheduled"} />
              </div>
            ))
          ) : (
            <div className="p-4 text-sm text-[var(--text-muted)]">No billing history yet.</div>
          )}
        </div>
      </Panel>

      {isEditOpen ? (
        <PatientFormModal
          initialCustomer={customer}
          onClose={() => setIsEditOpen(false)}
          onSubmit={async (draft) => {
            await updateCustomer(customer.id, draft);
            setIsEditOpen(false);
          }}
          title="Edit patient"
        />
      ) : null}

      {isReportOpen ? (
        <VisitReportModal
          appointments={appointments}
          onClose={() => setIsReportOpen(false)}
          onSubmit={async (draft) => {
            await createVisitReport(customer.id, draft);
            setIsReportOpen(false);
          }}
        />
      ) : null}

      {isBookingOpen ? (
        <AppointmentBookingModal
          defaultCustomerId={customer.id}
          onClose={() => setIsBookingOpen(false)}
        />
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-[var(--foreground)]">{value}</div>
    </div>
  );
}

function VisitReportModal({
  appointments,
  onClose,
  onSubmit,
}: {
  appointments: ReturnType<typeof buildAppointmentView>[];
  onClose: () => void;
  onSubmit: (draft: VisitReportDraft) => Promise<void>;
}) {
  const [appointmentId, setAppointmentId] = useState(appointments[0]?.id ?? "");
  const [visitSummary, setVisitSummary] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [doctorNotes, setDoctorNotes] = useState("");
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpDateIso, setFollowUpDateIso] = useState("");
  const [updateDentalChart, setUpdateDentalChart] = useState(false);
  const [chartNote, setChartNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const selectedAppointment =
    appointments.find((appointment) => appointment.id === appointmentId) ?? appointments[0];

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAppointment) {
      return;
    }

    setIsSaving(true);
    try {
      await onSubmit({
        appointmentId: selectedAppointment.id,
        providerId: selectedAppointment.providerId,
        serviceId: selectedAppointment.serviceIds[0] ?? "",
        visitSummary,
        symptoms: symptoms || undefined,
        clinicalNotes: clinicalNotes || undefined,
        doctorNotes: doctorNotes || undefined,
        followUpRequired,
        followUpDateIso: followUpDateIso ? `${followUpDateIso}T09:00:00+05:45` : undefined,
        updateDentalChart,
        chartNote: chartNote || undefined,
        chartData: updateDentalChart
          ? {
              appointmentId: selectedAppointment.id,
              summary: visitSummary,
            }
          : undefined,
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Create visit report">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Field label="Appointment">
          <select
            className={inputClassName}
            onChange={(event) => setAppointmentId(event.target.value)}
            value={appointmentId}
          >
            {appointments.map((appointment) => (
              <option key={appointment.id} value={appointment.id}>
                {appointment.services.map((service) => service.name).join(", ")} · {appointment.startsAtIso.slice(0, 10)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Visit summary">
          <textarea
            className={textareaClassName}
            onChange={(event) => setVisitSummary(event.target.value)}
            required
            value={visitSummary}
          />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Symptoms">
            <textarea
              className={textareaClassName}
              onChange={(event) => setSymptoms(event.target.value)}
              value={symptoms}
            />
          </Field>
          <Field label="Clinical notes">
            <textarea
              className={textareaClassName}
              onChange={(event) => setClinicalNotes(event.target.value)}
              value={clinicalNotes}
            />
          </Field>
        </div>

        <Field label="Doctor notes">
          <textarea
            className={textareaClassName}
            onChange={(event) => setDoctorNotes(event.target.value)}
            value={doctorNotes}
          />
        </Field>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
            <input
              checked={updateDentalChart}
              onChange={(event) => setUpdateDentalChart(event.target.checked)}
              type="checkbox"
            />
            Update dental chart for this visit
          </label>
          <div className="mt-3 min-h-28 rounded-md border border-dashed border-[var(--border)] bg-white p-4 text-sm text-[var(--text-muted)]">
            Future 3D dental chart editor mounts here.
          </div>
          <Field label="Chart note">
            <input
              className={inputClassName}
              onChange={(event) => setChartNote(event.target.value)}
              placeholder="What changed in the chart during this visit?"
              value={chartNote}
            />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-[200px_1fr]">
          <label className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3">
            <input
              checked={followUpRequired}
              onChange={(event) => setFollowUpRequired(event.target.checked)}
              type="checkbox"
            />
            <span className="text-sm text-[var(--foreground)]">Follow-up required</span>
          </label>

          <Field label="Follow-up date">
            <input
              className={inputClassName}
              onChange={(event) => setFollowUpDateIso(event.target.value)}
              type="date"
              value={followUpDateIso}
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button loading={isSaving} loadingLabel="Saving report" type="submit">`r`n            Save report`r`n          </Button>
        </div>
      </form>
    </Modal>
  );
}

