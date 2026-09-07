"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Clock3, Pencil, ShieldCheck } from "lucide-react";

import { Button, Panel } from "@/components/ui";
import {
  Drawer,
  EmptyState,
  Field,
  MetricTile,
  PageHeader,
  inputClassName,
} from "@/components/workspace/elements";
import { isAbortedRequest, requestErrorMessage } from "@/lib/request-error";
import {
  loadClinicSettings,
  updateClinicSettings,
  type ClinicSettingsData,
  type ClinicSettingsDraft,
  type SlotStartInterval,
} from "@/lib/settings-api";

const slotIntervals: SlotStartInterval[] = [5, 10, 15, 20, 30, 60];

export function SettingsPage() {
  const [settings, setSettings] = useState<ClinicSettingsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load(signal?: AbortSignal) {
    setIsLoading(true);
    setError(null);
    try {
      setSettings(await loadClinicSettings(signal));
    } catch (requestError) {
      if (!isAbortedRequest(requestError)) {
        setError(requestErrorMessage(requestError, "Could not load clinic settings."));
      }
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  if (isLoading && !settings) return <SettingsSkeleton />;
  if (!settings) {
    return (
      <div className="space-y-5">
        <PageHeader title="Settings" subtitle="Clinic identity and scheduling policy." />
        <Panel>
          <div className="p-5">
            <EmptyState
              actionLabel="Retry"
              body={error ?? "Settings are temporarily unavailable."}
              onAction={() => void load()}
              title="Settings could not load"
            />
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        subtitle="Organization-wide clinic identity and scheduling defaults. All stored dates remain Gregorian AD/ISO."
        action={settings.capabilities.canEdit ? (
          <Button onClick={() => setIsEditing(true)}>
            <Pencil size={16} /> Edit settings
          </Button>
        ) : null}
      />
      {error ? <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]" role="alert">{error}</div> : null}
      {message ? <div className="rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] p-4 text-sm text-[var(--brand-strong)]" role="status">{message}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Slot starts" value={`${settings.scheduling.slotStartIntervalMinutes} min`} />
        <MetricTile label="Booking hold" value={`${settings.scheduling.bookingHoldMinutes} min`} />
        <MetricTile label="Default buffer" value={`${settings.scheduling.defaultBufferMinutes} min`} />
        <MetricTile label="Schedule version" value={String(settings.scheduling.scheduleConfigurationVersion)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Clinic identity">
          <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2">
            <SettingValue label="Clinic name" value={settings.organization.name} />
            <SettingValue label="Timezone" value={settings.organization.timezone} />
            <SettingValue label="Email" value={settings.organization.email ?? "Not set"} />
            <SettingValue label="Phone" value={settings.organization.phone ?? "Not set"} />
            <div className="sm:col-span-2"><SettingValue label="Address" value={settings.organization.address ?? "Not set"} /></div>
          </dl>
        </Panel>
        <Panel title="Scheduling policy">
          <div className="space-y-4 p-5 text-sm">
            <PolicyRow icon={Clock3} title="Business day">{settings.scheduling.businessDayStartsAt}–{settings.scheduling.businessDayEndsAt}</PolicyRow>
            <PolicyRow icon={CalendarClock} title="AD-first calendar">Gregorian dates and ISO timestamps are authoritative. BS is a converted display only.</PolicyRow>
            <PolicyRow icon={ShieldCheck} title="Conflict-safe booking">Overbooking is disabled and cannot be enabled from clinic settings.</PolicyRow>
          </div>
        </Panel>
      </div>

      {isEditing ? (
        <SettingsDrawer
          initial={settings}
          onClose={() => setIsEditing(false)}
          onSaved={(updated) => {
            setSettings(updated);
            setIsEditing(false);
            setMessage("Clinic settings saved.");
            window.dispatchEvent(new Event("clinicflow:workspace-settings-changed"));
          }}
        />
      ) : null}
    </div>
  );
}

function SettingValue({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</dt><dd className="mt-1 font-medium text-[var(--foreground)]">{value}</dd></div>;
}

function PolicyRow({ children, icon: Icon, title }: { children: React.ReactNode; icon: typeof Clock3; title: string }) {
  return <div className="flex items-start gap-3"><Icon className="mt-0.5 shrink-0 text-[var(--accent)]" size={18} /><div><div className="font-semibold">{title}</div><div className="mt-1 text-[var(--text-muted)]">{children}</div></div></div>;
}

function SettingsDrawer({ initial, onClose, onSaved }: {
  initial: ClinicSettingsData;
  onClose: () => void;
  onSaved: (settings: ClinicSettingsData) => void;
}) {
  const [form, setForm] = useState<ClinicSettingsDraft>({
    name: initial.organization.name,
    email: initial.organization.email ?? "",
    phone: initial.organization.phone ?? "",
    address: initial.organization.address ?? "",
    businessDayStartsAt: initial.scheduling.businessDayStartsAt,
    businessDayEndsAt: initial.scheduling.businessDayEndsAt,
    defaultBufferMinutes: initial.scheduling.defaultBufferMinutes,
    bookingHoldMinutes: initial.scheduling.bookingHoldMinutes,
    slotStartIntervalMinutes: initial.scheduling.slotStartIntervalMinutes,
    reminderLeadMinutes: initial.scheduling.reminderLeadMinutes,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<Key extends keyof ClinicSettingsDraft>(key: Key, value: ClinicSettingsDraft[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      onSaved(await updateClinicSettings({
        ...form,
        email: form.email?.trim() || undefined,
        phone: form.phone?.trim() || undefined,
        address: form.address?.trim() || undefined,
      }));
    } catch (requestError) {
      setError(requestErrorMessage(requestError, "Could not save clinic settings."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Drawer closeDisabled={isSaving} context="Organization-wide settings with audited schedule changes." onClose={onClose} title="Edit clinic settings" width="wide">
      <form className="space-y-6" onSubmit={submit}>
        {error ? <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]" role="alert">{error}</div> : null}
        <section className="space-y-4" aria-labelledby="identity-settings-title">
          <h3 className="font-semibold" id="identity-settings-title">Clinic identity</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Clinic name"><input className={inputClassName} maxLength={160} onChange={(event) => set("name", event.target.value)} required value={form.name} /></Field>
            <Field label="Email"><input className={inputClassName} onChange={(event) => set("email", event.target.value)} type="email" value={form.email} /></Field>
            <Field label="Phone"><input className={inputClassName} onChange={(event) => set("phone", event.target.value)} value={form.phone} /></Field>
            <Field label="Address"><input className={inputClassName} onChange={(event) => set("address", event.target.value)} value={form.address} /></Field>
          </div>
        </section>

        <section className="space-y-4" aria-labelledby="schedule-settings-title">
          <div><h3 className="font-semibold" id="schedule-settings-title">Scheduling</h3><p className="mt-1 text-sm text-[var(--text-muted)]">Changing timing increments the schedule version and invalidates generated availability.</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business day starts"><input className={inputClassName} onChange={(event) => set("businessDayStartsAt", event.target.value)} required type="time" value={form.businessDayStartsAt} /></Field>
            <Field label="Business day ends"><input className={inputClassName} min={form.businessDayStartsAt} onChange={(event) => set("businessDayEndsAt", event.target.value)} required type="time" value={form.businessDayEndsAt} /></Field>
            <Field label="Offered slot starts">
              <select className={inputClassName} disabled={!initial.capabilities.canManageSlotInterval} onChange={(event) => set("slotStartIntervalMinutes", Number(event.target.value) as SlotStartInterval)} value={form.slotStartIntervalMinutes}>
                {slotIntervals.map((minutes) => <option key={minutes} value={minutes}>Every {minutes} minutes</option>)}
              </select>
            </Field>
            <Field label="Booking hold"><input className={inputClassName} max={10} min={1} onChange={(event) => set("bookingHoldMinutes", Number(event.target.value))} required type="number" value={form.bookingHoldMinutes} /></Field>
            <Field label="Default buffer"><input className={inputClassName} max={240} min={0} onChange={(event) => set("defaultBufferMinutes", Number(event.target.value))} required type="number" value={form.defaultBufferMinutes} /></Field>
            <Field label="Reminder lead"><input className={inputClassName} max={10080} min={0} onChange={(event) => set("reminderLeadMinutes", Number(event.target.value))} required type="number" value={form.reminderLeadMinutes} /></Field>
          </div>
          {!initial.capabilities.canManageSlotInterval ? <p className="text-xs text-[var(--text-muted)]">Only an organization Owner can change the offered slot-start interval.</p> : null}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm"><strong>Calendar authority:</strong> Gregorian AD/ISO remains canonical. Nepali BS dates are generated for display and conversion only. Overbooking remains disabled.</div>
        </section>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          <Button disabled={isSaving} onClick={onClose} variant="ghost">Cancel</Button>
          <Button loading={isSaving} loadingLabel="Saving..." type="submit">Save settings</Button>
        </div>
      </form>
    </Drawer>
  );
}

function SettingsSkeleton() {
  return <div aria-busy="true" className="space-y-5" role="status"><span className="sr-only">Loading clinic settings</span><div className="h-16 animate-pulse rounded-xl bg-[var(--surface-muted)] motion-reduce:animate-none" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div className="h-28 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] motion-reduce:animate-none" key={index} />)}</div><div className="grid gap-5 xl:grid-cols-2"><div className="h-64 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] motion-reduce:animate-none" /><div className="h-64 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] motion-reduce:animate-none" /></div></div>;
}
