"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";

import { Button, Panel } from "@/components/ui";
import { KoiInlineLoader } from "@/components/koi-loader";
import type { Customer, CustomerMatch } from "@/lib/domain";
import {
  useWorkspaceApp,
  type CustomerDraft,
  type ResolveCustomerDraft,
} from "@/components/workspace/app-state";
import {
  EmptyState,
  Field,
  Modal,
  PageHeader,
  inputClassName,
  textareaClassName,
} from "@/components/workspace/elements";
import { formatDualDate } from "@/components/workspace/workspace-utils";

export function PatientsPage() {
  const { calendarMode, data, resolveCustomerForAppointment } = useWorkspaceApp();
  const [query, setQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return data.customers
      .filter((customer) => {
        if (!normalized) {
          return true;
        }

        return [
          customer.name,
          customer.phone,
          customer.email,
          customer.patientCode,
          customer.risk,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data.customers, query]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Patients"
        subtitle="Patient records, visit history, and clinical follow-through in one place."
        action={
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus size={16} />
            New patient
          </Button>
        }
      />

      <Panel title="Directory">
        <div className="border-b border-[var(--border)] p-4">
          <div className="flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3">
            <Search size={16} className="text-[var(--text-muted)]" />
            <input
              className="w-full border-none bg-transparent p-0 text-sm outline-none"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, phone, email, or patient code"
              value={query}
            />
          </div>
        </div>

        {rows.length ? (
          <div className="divide-y divide-[var(--border)]">
            {rows.map((customer) => (
              <Link
                className="grid gap-3 px-4 py-4 transition hover:bg-[var(--surface-muted)] md:grid-cols-[minmax(0,1.2fr)_160px_160px_100px]"
                href={`/patients/${customer.id}`}
                key={customer.id}
              >
                <div>
                  <div className="font-medium text-[var(--foreground)]">{customer.name}</div>
                  <div className="mt-1 text-sm text-[var(--text-muted)]">
                    {customer.patientCode ?? "Pending code"} · {customer.phone}
                  </div>
                </div>
                <div className="text-sm text-[var(--text-muted)]">
                  <div className="font-medium text-[var(--foreground)]">Last visit</div>
                  <div className="mt-1">{formatDualDate(customer.lastVisitIso, calendarMode, "short")}</div>
                </div>
                <div className="text-sm text-[var(--text-muted)]">
                  <div className="font-medium text-[var(--foreground)]">Risk</div>
                  <div className="mt-1">{customer.risk}</div>
                </div>
                <div className="text-sm text-[var(--accent)]">Open</div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="p-4">
            <EmptyState
              actionLabel="Create patient"
              body="No patient matched that search. Add a new record or widen the query."
              onAction={() => setIsCreateOpen(true)}
              title="No patients found"
            />
          </div>
        )}
      </Panel>

      {isCreateOpen ? (
        <PatientFormModal
          onClose={() => setIsCreateOpen(false)}
          onSubmit={async (draft) => {
            const resolveDraft = draft as ResolveCustomerDraft;
            await resolveCustomerForAppointment(resolveDraft);
            setIsCreateOpen(false);
          }}
          title="New patient"
        />
      ) : null}
    </div>
  );
}

export function PatientFormModal({
  initialCustomer,
  onClose,
  onSubmit,
  title,
}: {
  initialCustomer?: Customer;
  onClose: () => void;
  onSubmit: (draft: CustomerDraft | ResolveCustomerDraft) => Promise<void>;
  title: string;
}) {
  const { matchCustomers } = useWorkspaceApp();
  const [form, setForm] = useState<CustomerDraft>({
    name: initialCustomer?.name ?? "",
    patientCode: initialCustomer?.patientCode ?? "",
    phone: initialCustomer?.phone ?? "",
    email: initialCustomer?.email ?? "",
    gender: initialCustomer?.gender ?? "",
    dateOfBirthIso: initialCustomer?.dateOfBirthIso?.slice(0, 10) ?? "",
    address: initialCustomer?.address ?? "",
    emergencyContactName: initialCustomer?.emergencyContactName ?? "",
    emergencyContactPhone: initialCustomer?.emergencyContactPhone ?? "",
    allergies: initialCustomer?.allergies ?? "",
    medicalNotes: initialCustomer?.medicalNotes ?? "",
    risk: initialCustomer?.risk ?? "Routine",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [matches, setMatches] = useState<CustomerMatch[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [selectedMatchAction, setSelectedMatchAction] = useState<{
    mode: "use_existing" | "update_existing";
    customer: Customer;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isCreateMode = !initialCustomer;

  function updateField<Key extends keyof CustomerDraft>(key: Key, value: CustomerDraft[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  useEffect(() => {
    if (!isCreateMode) {
      return;
    }

    if (!form.name.trim() && !form.phone.trim()) {
      setMatches([]);
      setMatchesLoading(false);
      return;
    }

    let cancelled = false;
    setMatchesLoading(true);

    const timeout = window.setTimeout(() => {
      void matchCustomers({
        name: form.name,
        phone: form.phone,
        email: form.email || undefined,
      })
        .then((nextMatches) => {
          if (!cancelled) {
            setMatches(nextMatches);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setMatches([]);
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
  }, [form.email, form.name, form.phone, isCreateMode, matchCustomers]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const baseDraft = {
        ...form,
        patientCode: form.patientCode || undefined,
        email: form.email || undefined,
        gender: form.gender || undefined,
        dateOfBirthIso: form.dateOfBirthIso || undefined,
        address: form.address || undefined,
        emergencyContactName: form.emergencyContactName || undefined,
        emergencyContactPhone: form.emergencyContactPhone || undefined,
        allergies: form.allergies || undefined,
        medicalNotes: form.medicalNotes || undefined,
      };

      if (isCreateMode) {
        await onSubmit({
          ...baseDraft,
          mode: selectedMatchAction?.mode ?? "create_new",
          existingCustomerId: selectedMatchAction?.customer.id,
        });
        return;
      }

      await onSubmit(baseDraft);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : "Unable to save patient.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title={title}>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Full name">
            <input
              className={inputClassName}
              onChange={(event) => updateField("name", event.target.value)}
              required
              value={form.name}
            />
          </Field>
          <Field label="Patient code">
            <input
              className={inputClassName}
              onChange={(event) => updateField("patientCode", event.target.value)}
              value={form.patientCode}
            />
          </Field>
          <Field label="Phone">
            <input
              className={inputClassName}
              onChange={(event) => updateField("phone", event.target.value)}
              required
              value={form.phone}
            />
          </Field>
          <Field label="Email">
            <input
              className={inputClassName}
              onChange={(event) => updateField("email", event.target.value)}
              type="email"
              value={form.email}
            />
          </Field>
          <Field label="Gender">
            <input
              className={inputClassName}
              onChange={(event) => updateField("gender", event.target.value)}
              value={form.gender}
            />
          </Field>
          <Field label="Date of birth">
            <input
              className={inputClassName}
              onChange={(event) => updateField("dateOfBirthIso", event.target.value)}
              type="date"
              value={form.dateOfBirthIso}
            />
          </Field>
          <Field label="Risk">
            <select
              className={inputClassName}
              onChange={(event) => updateField("risk", event.target.value as Customer["risk"])}
              value={form.risk}
            >
              <option value="Routine">Routine</option>
              <option value="Needs attention">Needs attention</option>
              <option value="High priority">High priority</option>
            </select>
          </Field>
          <Field label="Emergency contact">
            <input
              className={inputClassName}
              onChange={(event) => updateField("emergencyContactName", event.target.value)}
              value={form.emergencyContactName}
            />
          </Field>
        </div>

        <Field label="Emergency contact phone">
          <input
            className={inputClassName}
            onChange={(event) => updateField("emergencyContactPhone", event.target.value)}
            value={form.emergencyContactPhone}
          />
        </Field>

        <Field label="Address">
          <textarea
            className={textareaClassName}
            onChange={(event) => updateField("address", event.target.value)}
            value={form.address}
          />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Allergies">
            <textarea
              className={textareaClassName}
              onChange={(event) => updateField("allergies", event.target.value)}
              value={form.allergies}
            />
          </Field>
          <Field label="Medical notes">
            <textarea
              className={textareaClassName}
              onChange={(event) => updateField("medicalNotes", event.target.value)}
              value={form.medicalNotes}
            />
          </Field>
        </div>

        {isCreateMode ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <div className="text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Possible existing patients
            </div>
            <div className="mt-3">
              {matchesLoading ? (
                <KoiInlineLoader label="Checking for existing patients" />
              ) : matches.length ? (
                <div className="space-y-2">
                  {matches.map((match) => {
                    const tone =
                      match.confidence === "strong"
                        ? "border-emerald-300 bg-emerald-50"
                        : match.confidence === "moderate"
                          ? "border-amber-300 bg-amber-50"
                          : "border-rose-300 bg-rose-50";
                    const active = selectedMatchAction?.customer.id === match.customer.id;
                    const label =
                      match.confidence === "strong"
                        ? "Perfect match"
                        : match.confidence === "moderate"
                          ? "Suggested match"
                          : "Possible match";

                    return (
                      <div className={`rounded-md border px-3 py-3 ${tone}`} key={match.customer.id}>
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
                <div className="text-sm text-[var(--text-muted)]">
                  No likely duplicate found.
                </div>
              )}
            </div>
          </div>
        ) : null}

        {error ? <div className="text-sm text-[var(--danger)]">{error}</div> : null}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button loading={isSaving} loadingLabel="Saving patient" type="submit">
            Save patient
          </Button>
        </div>
      </form>
    </Modal>
  );
}
