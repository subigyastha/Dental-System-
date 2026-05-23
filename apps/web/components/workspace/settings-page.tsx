"use client";

import { useState } from "react";

import { Button, Panel } from "@/components/ui";
import { useWorkspaceApp } from "@/components/workspace/app-state";
import {
  Field,
  PageHeader,
  inputClassName,
} from "@/components/workspace/elements";

export function SettingsPage() {
  const { calendarMode, data, updateOrganization } = useWorkspaceApp();
  const [form, setForm] = useState({
    name: data.organization.name,
    email: data.organization.email ?? "",
    phone: data.organization.phone ?? "",
    address: data.organization.address ?? "",
    primaryCalendar: data.organization.primaryCalendar,
    businessDayStartsAt: data.organization.businessDayStartsAt ?? "09:00",
    businessDayEndsAt: data.organization.businessDayEndsAt ?? "17:00",
    defaultBufferMinutes: data.organization.defaultBufferMinutes ?? 10,
    reminderLeadMinutes: data.organization.reminderLeadMinutes ?? 60,
    allowOverlaps: data.organization.allowOverlaps ?? false,
  });
  const [isSaving, setIsSaving] = useState(false);

  function updateField<Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    try {
      await updateOrganization({
        ...form,
        primaryCalendar: calendarMode,
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        subtitle="Clinic identity and scheduling defaults."
      />

      <Panel title="Clinic details">
        <form className="space-y-5 p-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Clinic name">
              <input
                className={inputClassName}
                onChange={(event) => updateField("name", event.target.value)}
                value={form.name}
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
            <Field label="Phone">
              <input
                className={inputClassName}
                onChange={(event) => updateField("phone", event.target.value)}
                value={form.phone}
              />
            </Field>
            <Field label="Address">
              <input
                className={inputClassName}
                onChange={(event) => updateField("address", event.target.value)}
                value={form.address}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Day starts">
              <input
                className={inputClassName}
                onChange={(event) => updateField("businessDayStartsAt", event.target.value)}
                type="time"
                value={form.businessDayStartsAt}
              />
            </Field>
            <Field label="Day ends">
              <input
                className={inputClassName}
                onChange={(event) => updateField("businessDayEndsAt", event.target.value)}
                type="time"
                value={form.businessDayEndsAt}
              />
            </Field>
            <Field label="Default buffer (min)">
              <input
                className={inputClassName}
                min={0}
                onChange={(event) => updateField("defaultBufferMinutes", Number(event.target.value))}
                type="number"
                value={form.defaultBufferMinutes}
              />
            </Field>
            <Field label="Reminder lead (min)">
              <input
                className={inputClassName}
                min={0}
                onChange={(event) => updateField("reminderLeadMinutes", Number(event.target.value))}
                type="number"
                value={form.reminderLeadMinutes}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3 text-sm">
            <input
              checked={form.allowOverlaps}
              onChange={(event) => updateField("allowOverlaps", event.target.checked)}
              type="checkbox"
            />
            Allow schedule overlaps
          </label>

          <div className="flex justify-end">
            <Button type="submit">{isSaving ? "Saving..." : "Save settings"}</Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
