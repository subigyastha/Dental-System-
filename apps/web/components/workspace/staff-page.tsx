"use client";

import { useMemo, useState } from "react";
import { CalendarRange, KeyRound, Plus, UserCog } from "lucide-react";

import { Button, Panel } from "@/components/ui";
import type { StaffMember } from "@/lib/domain";
import {
  buildBlockedTimeIso,
  formatDualDate,
} from "@/components/workspace/workspace-utils";
import { dateKeyInTimeZone, getMinutesInNepalFromIso, NEPAL_TIME_ZONE } from "@/lib/calendar";
import {
  AvailabilityDraft,
  BlockedTimeDraft,
  RecurringBlockDraft,
  StaffDraft,
  useWorkspaceApp,
} from "@/components/workspace/app-state";
import {
  EmptyState,
  Field,
  Modal,
  PageHeader,
  inputClassName,
  textareaClassName,
} from "@/components/workspace/elements";

const roleOptions: StaffMember["role"][] = [
  "Owner",
  "Admin",
  "Manager",
  "Receptionist",
  "Scheduler",
  "Provider",
  "Assistant",
];

const staffStatusOptions: StaffMember["status"][] = ["Active", "Invited", "Inactive", "Suspended"];
const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function StaffPage() {
  const {
    createStaff,
    data,
    deactivateStaff,
    restoreStaff,
    resetStaffPassword,
    updateProviderSchedule,
    updateStaff,
  } = useWorkspaceApp();
  const [query, setQuery] = useState("");
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [scheduleStaff, setScheduleStaff] = useState<StaffMember | null>(null);
  const [passwordStaff, setPasswordStaff] = useState<StaffMember | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return data.staff.filter((member) => {
      if (!normalized) {
        return true;
      }

      return [
        member.name,
        member.email,
        member.role,
        member.staffLabel,
        member.department,
        member.employeeCode,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [data.staff, query]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Staff"
        subtitle="Clinic accounts, role details, and schedule ownership."
        action={
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus size={16} />
            Add staff
          </Button>
        }
      />

      <Panel title="Team">
        <div className="border-b border-[var(--border)] p-4">
          <input
            className={inputClassName}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, email, role, or department"
            value={query}
          />
        </div>

        {rows.length ? (
          <div className="divide-y divide-[var(--border)]">
            {rows.map((member) => (
              <div className="grid gap-3 px-4 py-4 xl:grid-cols-[minmax(0,1.2fr)_160px_160px_260px]" key={member.id}>
                <div>
                  <div className="font-medium text-[var(--foreground)]">{member.name}</div>
                  <div className="mt-1 text-sm text-[var(--text-muted)]">
                    {member.email} · {member.staffLabel}
                  </div>
                </div>
                <div className="text-sm">
                  <div className="font-medium text-[var(--foreground)]">{member.role}</div>
                  <div className="mt-1 text-[var(--text-muted)]">{member.status}</div>
                </div>
                <div className="text-sm text-[var(--text-muted)]">
                  {member.isSchedulable ? "Schedulable" : "No schedule profile"}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setEditingStaff(member)} variant="secondary">
                    <UserCog size={16} />
                    Edit
                  </Button>
                  <Button
                    onClick={() => setScheduleStaff(member)}
                    variant="secondary"
                  >
                    <CalendarRange size={16} />
                    Schedule
                  </Button>
                  <Button
                    onClick={() => setPasswordStaff(member)}
                    variant="secondary"
                  >
                    <KeyRound size={16} />
                    Password
                  </Button>
                  <Button
                    onClick={() =>
                      void (member.status === "Inactive"
                        ? restoreStaff(member.id)
                        : deactivateStaff(member.id))
                    }
                    variant="ghost"
                  >
                    {member.status === "Inactive" ? "Restore" : "Archive"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4">
            <EmptyState
              actionLabel="Add staff"
              body="No staff account matched that search."
              onAction={() => setIsCreateOpen(true)}
              title="No staff found"
            />
          </div>
        )}
      </Panel>

      {isCreateOpen ? (
        <StaffFormModal
          onClose={() => setIsCreateOpen(false)}
          onSubmit={async (draft) => {
            await createStaff(draft);
            setIsCreateOpen(false);
          }}
          title="Add staff"
        />
      ) : null}

      {editingStaff ? (
        <StaffFormModal
          initialStaff={editingStaff}
          onClose={() => setEditingStaff(null)}
          onSubmit={async (draft) => {
            await updateStaff(editingStaff.id, draft);
            setEditingStaff(null);
          }}
          title="Edit staff"
        />
      ) : null}

      {scheduleStaff ? (
        <ScheduleModal
          onClose={() => setScheduleStaff(null)}
          onSubmit={async (availability, recurringBlocks, blockedTimes) => {
            if (!scheduleStaff.providerId) {
              return;
            }

            await updateProviderSchedule(
              scheduleStaff.providerId,
              availability,
              recurringBlocks,
              blockedTimes,
            );
            setScheduleStaff(null);
          }}
          staff={scheduleStaff}
        />
      ) : null}

      {passwordStaff ? (
        <ResetPasswordModal
          onClose={() => setPasswordStaff(null)}
          onSubmit={async (password) => {
            await resetStaffPassword(passwordStaff.id, password);
            setPasswordStaff(null);
          }}
          staff={passwordStaff}
        />
      ) : null}
    </div>
  );
}

function StaffFormModal({
  initialStaff,
  onClose,
  onSubmit,
  title,
}: {
  initialStaff?: StaffMember;
  onClose: () => void;
  onSubmit: (draft: StaffDraft) => Promise<void>;
  title: string;
}) {
  const [form, setForm] = useState<StaffDraft>({
    name: initialStaff?.name ?? "",
    email: initialStaff?.email ?? "",
    phone: initialStaff?.phone ?? "",
    role: initialStaff?.role ?? "Receptionist",
    staffLabel: initialStaff?.staffLabel ?? "Reception",
    department: initialStaff?.department ?? "",
    employeeCode: initialStaff?.employeeCode ?? "",
    licenseNumber: initialStaff?.licenseNumber ?? "",
    employmentType: initialStaff?.employmentType ?? "",
    startDateIso: initialStaff?.startDateIso?.slice(0, 10) ?? "",
    emergencyContactName: initialStaff?.emergencyContactName ?? "",
    emergencyContactPhone: initialStaff?.emergencyContactPhone ?? "",
    notes: initialStaff?.notes ?? "",
    status: initialStaff?.status ?? "Active",
    isSchedulable: initialStaff?.isSchedulable ?? false,
    specialty: initialStaff?.provider?.specialty ?? "",
    color: initialStaff?.provider?.color ?? "#0ea5a4",
    providerStatus: initialStaff?.provider?.status ?? "Available",
    password: "",
  });
  const [isSaving, setIsSaving] = useState(false);

  function updateField<Key extends keyof StaffDraft>(key: Key, value: StaffDraft[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    try {
      await onSubmit({
        ...form,
        phone: form.phone || undefined,
        department: form.department || undefined,
        employeeCode: form.employeeCode || undefined,
        licenseNumber: form.licenseNumber || undefined,
        employmentType: form.employmentType || undefined,
        startDateIso: form.startDateIso || undefined,
        emergencyContactName: form.emergencyContactName || undefined,
        emergencyContactPhone: form.emergencyContactPhone || undefined,
        notes: form.notes || undefined,
        specialty: form.specialty || undefined,
        color: form.color || undefined,
        password: form.password || undefined,
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title={title}>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name">
            <input
              className={inputClassName}
              onChange={(event) => updateField("name", event.target.value)}
              required
              value={form.name}
            />
          </Field>
          <Field label="Email">
            <input
              className={inputClassName}
              onChange={(event) => updateField("email", event.target.value)}
              required
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
          <Field label="Role">
            <select
              className={inputClassName}
              onChange={(event) => updateField("role", event.target.value as StaffMember["role"])}
              value={form.role}
            >
              {roleOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Role label">
            <input
              className={inputClassName}
              onChange={(event) => updateField("staffLabel", event.target.value)}
              required
              value={form.staffLabel}
            />
          </Field>
          <Field label="Status">
            <select
              className={inputClassName}
              onChange={(event) => updateField("status", event.target.value as StaffMember["status"])}
              value={form.status}
            >
              {staffStatusOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Department">
            <input
              className={inputClassName}
              onChange={(event) => updateField("department", event.target.value)}
              value={form.department}
            />
          </Field>
          <Field label="Employee code">
            <input
              className={inputClassName}
              onChange={(event) => updateField("employeeCode", event.target.value)}
              value={form.employeeCode}
            />
          </Field>
          <Field label="Employment type">
            <input
              className={inputClassName}
              onChange={(event) => updateField("employmentType", event.target.value)}
              value={form.employmentType}
            />
          </Field>
          <Field label="Start date">
            <input
              className={inputClassName}
              onChange={(event) => updateField("startDateIso", event.target.value)}
              type="date"
              value={form.startDateIso}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3 text-sm">
          <input
            checked={form.isSchedulable}
            onChange={(event) => updateField("isSchedulable", event.target.checked)}
            type="checkbox"
          />
          This staff account should own a provider schedule
        </label>

        {form.isSchedulable ? (
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Specialty">
              <input
                className={inputClassName}
                onChange={(event) => updateField("specialty", event.target.value)}
                value={form.specialty}
              />
            </Field>
            <Field label="Color">
              <input
                className={`${inputClassName} h-10`}
                onChange={(event) => updateField("color", event.target.value)}
                type="color"
                value={form.color}
              />
            </Field>
            <Field label="Schedule status">
              <select
                className={inputClassName}
                onChange={(event) =>
                  updateField("providerStatus", event.target.value as NonNullable<StaffDraft["providerStatus"]>)
                }
                value={form.providerStatus}
              >
                <option value="Available">Available</option>
                <option value="Busy">Busy</option>
                <option value="Away">Away</option>
                <option value="Inactive">Inactive</option>
              </select>
            </Field>
          </div>
        ) : null}

        {!initialStaff ? (
          <Field label="Password">
            <input
              className={inputClassName}
              minLength={8}
              onChange={(event) => updateField("password", event.target.value)}
              required
              type="password"
              value={form.password}
            />
          </Field>
        ) : null}

        <Field label="Notes">
          <textarea
            className={textareaClassName}
            onChange={(event) => updateField("notes", event.target.value)}
            value={form.notes}
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button type="submit">{isSaving ? "Saving..." : "Save staff"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ScheduleModal({
  onClose,
  onSubmit,
  staff,
}: {
  onClose: () => void;
  onSubmit: (
    availability: AvailabilityDraft[],
    recurringBlocks: RecurringBlockDraft[],
    blockedTimes: BlockedTimeDraft[],
  ) => Promise<void>;
  staff: StaffMember;
}) {
  const { calendarMode } = useWorkspaceApp();
  const [availability, setAvailability] = useState<AvailabilityDraft[]>(
    staff.provider?.availability ?? [],
  );
  const [recurringBlocks, setRecurringBlocks] = useState<RecurringBlockDraft[]>(
    staff.provider?.recurringBlocks ?? [],
  );
  const [blockedTimes, setBlockedTimes] = useState<BlockedTimeDraft[]>(
    staff.provider?.blockedTimes ?? [],
  );
  const [isSaving, setIsSaving] = useState(false);

  if (!staff.providerId || !staff.provider) {
    return (
      <Modal onClose={onClose} title="Schedule">
        <EmptyState
          body="This account does not yet own a schedule profile. Mark it schedulable first."
          title="No provider schedule"
        />
      </Modal>
    );
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      await onSubmit(availability, recurringBlocks, blockedTimes);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      subtitle="Weekly windows define when the provider can be booked. Blocks carve out specific dates."
      title={`${staff.name} schedule`}
    >
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="text-sm font-medium text-[var(--foreground)]">Weekly availability</div>
          {availability.length ? (
            availability.map((entry, index) => (
              <div className="grid gap-3 rounded-md border border-[var(--border)] p-3 md:grid-cols-[120px_1fr_1fr_130px_130px_80px]" key={entry.id ?? `${entry.dayOfWeek}-${index}`}>
                <select
                  className={inputClassName}
                  onChange={(event) =>
                    setAvailability((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, dayOfWeek: Number(event.target.value) } : item,
                      ),
                    )
                  }
                  value={entry.dayOfWeek}
                >
                  {dayLabels.map((label, dayIndex) => (
                    <option key={label} value={dayIndex}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  className={inputClassName}
                  onChange={(event) =>
                    setAvailability((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, startsAtLocal: event.target.value } : item,
                      ),
                    )
                  }
                  type="time"
                  value={entry.startsAtLocal}
                />
                <input
                  className={inputClassName}
                  onChange={(event) =>
                    setAvailability((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, endsAtLocal: event.target.value } : item,
                      ),
                    )
                  }
                  type="time"
                  value={entry.endsAtLocal}
                />
                <input
                  className={inputClassName}
                  disabled
                  type="number"
                  value={entry.slotDurationMinutes}
                />
                <input
                  className={inputClassName}
                  min={0}
                  onChange={(event) =>
                    setAvailability((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, bufferMinutes: Number(event.target.value) }
                          : item,
                      ),
                    )
                  }
                  type="number"
                  value={entry.bufferMinutes}
                />
                <Button
                  onClick={() =>
                    setAvailability((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                  variant="ghost"
                >
                  Remove
                </Button>
              </div>
            ))
          ) : (
            <div className="text-sm text-[var(--text-muted)]">
              No recurring windows set yet.
            </div>
          )}
          <Button
            onClick={() =>
              setAvailability((current) => [
                ...current,
                {
                  dayOfWeek: 1,
                  startsAtLocal: "09:00",
                  endsAtLocal: "17:00",
                  slotDurationMinutes: 60,
                  bufferMinutes: 10,
                  isActive: true,
                },
              ])
            }
            variant="secondary"
          >
            Add weekly window
          </Button>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium text-[var(--foreground)]">Recurring blocks</div>
          {recurringBlocks.map((entry, index) => (
            <div className="grid gap-3 rounded-md border border-[var(--border)] p-3 md:grid-cols-[120px_1fr_1fr_minmax(0,1fr)_80px]" key={entry.id ?? `${entry.dayOfWeek}-${index}`}>
              <select
                className={inputClassName}
                onChange={(event) =>
                  setRecurringBlocks((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, dayOfWeek: Number(event.target.value) } : item,
                    ),
                  )
                }
                value={entry.dayOfWeek}
              >
                {dayLabels.map((label, dayIndex) => (
                  <option key={label} value={dayIndex}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                className={inputClassName}
                onChange={(event) =>
                  setRecurringBlocks((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, startsAtLocal: event.target.value } : item,
                    ),
                  )
                }
                type="time"
                value={entry.startsAtLocal}
              />
              <input
                className={inputClassName}
                onChange={(event) =>
                  setRecurringBlocks((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, endsAtLocal: event.target.value } : item,
                    ),
                  )
                }
                type="time"
                value={entry.endsAtLocal}
              />
              <input
                className={inputClassName}
                onChange={(event) =>
                  setRecurringBlocks((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, reason: event.target.value } : item,
                    ),
                  )
                }
                placeholder="Lunch, rounds, admin"
                value={entry.reason}
              />
              <Button
                onClick={() =>
                  setRecurringBlocks((current) => current.filter((_, itemIndex) => itemIndex !== index))
                }
                variant="ghost"
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            onClick={() =>
              setRecurringBlocks((current) => [
                ...current,
                {
                  dayOfWeek: 1,
                  startsAtLocal: "13:00",
                  endsAtLocal: "14:00",
                  reason: "Break",
                  isActive: true,
                },
              ])
            }
            variant="secondary"
          >
            Add recurring block
          </Button>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium text-[var(--foreground)]">Unavailable blocks</div>
          {blockedTimes.map((entry, index) => (
            <BlockedTimeEditor
              calendarMode={calendarMode}
              entry={entry}
              key={entry.id ?? `${entry.startsAtIso}-${index}`}
              onChange={(nextEntry) =>
                setBlockedTimes((current) =>
                  current.map((item, itemIndex) => (itemIndex === index ? nextEntry : item)),
                )
              }
              onRemove={() =>
                setBlockedTimes((current) => current.filter((_, itemIndex) => itemIndex !== index))
              }
            />
          ))}
          <Button
            onClick={() =>
            setBlockedTimes((current) => [
                ...current,
                {
                  startsAtIso: buildBlockedTimeIso(dateKeyInTimeZone(NEPAL_TIME_ZONE), "12:00"),
                  endsAtIso: buildBlockedTimeIso(dateKeyInTimeZone(NEPAL_TIME_ZONE), "13:00"),
                  reason: "Break",
                },
              ])
            }
            variant="secondary"
          >
            Add time block
          </Button>
        </div>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button onClick={() => void handleSave()}>{isSaving ? "Saving..." : "Save schedule"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function BlockedTimeEditor({
  calendarMode,
  entry,
  onChange,
  onRemove,
}: {
  calendarMode: "BS" | "AD";
  entry: BlockedTimeDraft;
  onChange: (entry: BlockedTimeDraft) => void;
  onRemove: () => void;
}) {
  const adDate = dateKeyInTimeZone(NEPAL_TIME_ZONE, new Date(entry.startsAtIso));
  const startTime = minutesToTimeInput(getMinutesInNepalFromIso(entry.startsAtIso));
  const endTime = minutesToTimeInput(getMinutesInNepalFromIso(entry.endsAtIso));

  return (
    <div className="grid gap-3 rounded-md border border-[var(--border)] p-3 md:grid-cols-[1.3fr_140px_140px_minmax(0,1fr)_80px]">
      <div className="space-y-1">
        <input
          className={inputClassName}
          onChange={(event) =>
            onChange({
              ...entry,
              startsAtIso: buildBlockedTimeIso(event.target.value, startTime),
              endsAtIso: buildBlockedTimeIso(event.target.value, endTime),
            })
          }
          type="date"
          value={adDate}
        />
        <div className="text-xs text-[var(--text-muted)]">{formatDualDate(adDate, calendarMode, "short")}</div>
      </div>
      <input
        className={inputClassName}
        onChange={(event) =>
          onChange({
            ...entry,
            startsAtIso: buildBlockedTimeIso(adDate, event.target.value),
          })
        }
        type="time"
        value={startTime}
      />
      <input
        className={inputClassName}
        onChange={(event) =>
          onChange({
            ...entry,
            endsAtIso: buildBlockedTimeIso(adDate, event.target.value),
          })
        }
        type="time"
        value={endTime}
      />
      <input
        className={inputClassName}
        onChange={(event) => onChange({ ...entry, reason: event.target.value })}
        placeholder="Break, procedure, leave"
        value={entry.reason}
      />
      <Button onClick={onRemove} variant="ghost">
        Remove
      </Button>
    </div>
  );
}

function minutesToTimeInput(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function ResetPasswordModal({
  onClose,
  onSubmit,
  staff,
}: {
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
  staff: StaffMember;
}) {
  const [password, setPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    try {
      await onSubmit(password);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title={`Reset password · ${staff.name}`}>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Field label="New password">
          <input
            className={inputClassName}
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button type="submit">{isSaving ? "Saving..." : "Update password"}</Button>
        </div>
      </form>
    </Modal>
  );
}
