"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, KeyRound, Plus, UserCog } from "lucide-react";

import { Button, Panel } from "@/components/ui";
import { AccessRolesPanel } from "@/components/workspace/access-roles-panel";
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
  createStaffMember,
  deactivateStaffMember,
  loadStaffDetail,
  loadStaffDirectory,
  resetStaffMemberPassword,
  restoreStaffMember,
  updateStaffMember,
  updateStaffProviderSchedule,
} from "@/lib/staff-api";
import {
  directoryItemToStaffMember,
  type StaffDirectoryData,
  type StaffDirectoryItem,
} from "@/lib/staff-domain";
import { isAbortedRequest, requestErrorMessage } from "@/lib/request-error";
import {
  EmptyState,
  Drawer,
  Field,
  MetricTile,
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
  "Finance",
  "InventoryManager",
];

const staffStatusOptions: StaffMember["status"][] = ["Active", "Invited", "Inactive", "Suspended"];
const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function StaffPage() {
  const { data, invalidatePlanningCaches, sessionUser, workspaceBootstrap } = useWorkspaceApp();
  const organizationId = workspaceBootstrap.context.organization.id;
  const canManageOwnerAccounts = workspaceBootstrap.context.actor.roles.includes("Owner");
  const assignableRoles = canManageOwnerAccounts
    ? roleOptions
    : roleOptions.filter((option) => option !== "Owner");
  const [directory, setDirectory] = useState<StaffDirectoryData | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [locationId, setLocationId] = useState("");
  const [sort, setSort] = useState<"name" | "role" | "status" | "lastLogin">("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [scheduleStaff, setScheduleStaff] = useState<StaffMember | null>(null);
  const [passwordStaff, setPasswordStaff] = useState<StaffMember | null>(null);
  const [lifecycleStaff, setLifecycleStaff] = useState<StaffDirectoryItem | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const refresh = useCallback(async (signal?: AbortSignal, background = false) => {
    if (background) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);
    try {
      const result = await loadStaffDirectory({
        page,
        limit: 25,
        query: debouncedQuery || undefined,
        role: role || undefined,
        status: status || undefined,
        locationId: locationId || undefined,
        sort,
        direction,
        signal,
      });
      setDirectory(result);
    } catch (requestError) {
      if (!isAbortedRequest(requestError)) {
        setError(requestErrorMessage(requestError, "Could not load Staff Management."));
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [debouncedQuery, direction, locationId, page, role, sort, status]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const staffForAccess = useMemo(
    () => directory?.items.map((item) => directoryItemToStaffMember(organizationId, item)) ?? [],
    [directory?.items, organizationId],
  );

  async function loadDetailFor(
    item: StaffDirectoryItem,
    target: "edit" | "schedule" | "password",
  ) {
    setActionLoadingId(item.id);
    setError(null);
    try {
      const detail = await loadStaffDetail(item.id);
      if (target === "edit") setEditingStaff(detail);
      else if (target === "schedule") setScheduleStaff(detail);
      else setPasswordStaff(detail);
    } catch (requestError) {
      setError(requestErrorMessage(requestError, "Could not load this staff account."));
    } finally {
      setActionLoadingId(null);
    }
  }

  async function lifecycle(item: StaffDirectoryItem) {
    setActionLoadingId(item.id);
    setError(null);
    try {
      if (item.status === "Inactive") await restoreStaffMember(item.id);
      else await deactivateStaffMember(item.id);
      setMessage(item.status === "Inactive" ? "Staff account restored." : "Staff account archived.");
      setLifecycleStaff(null);
      await refresh(undefined, true);
    } catch (requestError) {
      setError(requestErrorMessage(requestError, "Could not update this staff account."));
    } finally {
      setActionLoadingId(null);
    }
  }

  if (isLoading && !directory) return <StaffSkeleton />;

  if (!directory) {
    return <div className="space-y-5"><PageHeader title="Staff Management" subtitle="Clinic accounts, access, and schedule ownership." /><Panel><div className="p-5"><EmptyState actionLabel="Retry" body={error ?? "Staff Management is temporarily unavailable."} onAction={() => void refresh()} title="Staff could not load" /></div></Panel></div>;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Staff Management"
        subtitle="Find clinic accounts, coordinate schedules, and govern access from one bounded workspace."
        action={
          directory.capabilities.canManageStaff ? <Button onClick={() => setIsCreateOpen(true)}>
            <Plus size={16} />
            Add staff
          </Button> : null
        }
      />

      {error ? <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]" role="alert">{error}</div> : null}
      {message ? <div className="rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] p-4 text-sm text-[var(--brand-strong)]" role="status">{message}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricTile label="Active" value={String(directory.summary.active)} />
        <MetricTile label="Invited" value={String(directory.summary.invited)} />
        <MetricTile label="Inactive" value={String(directory.summary.inactive)} />
        <MetricTile label="Suspended" value={String(directory.summary.suspended)} />
        <MetricTile label="Schedule owners" value={String(directory.summary.schedulable)} />
      </div>

      <Panel>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_170px_170px_190px_160px_auto]">
          <input
            className={inputClassName}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, email, role, or department"
            value={query}
          />
          <select className={inputClassName} onChange={(event) => { setRole(event.target.value); setPage(1); }} value={role}><option value="">All roles</option>{roleOptions.map((option) => <option key={option} value={option}>{roleLabel(option)}</option>)}</select>
          <select className={inputClassName} onChange={(event) => { setStatus(event.target.value); setPage(1); }} value={status}><option value="">All statuses</option>{staffStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select>
          <select className={inputClassName} onChange={(event) => { setLocationId(event.target.value); setPage(1); }} value={locationId}><option value="">All permitted locations</option>{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select>
          <select className={inputClassName} onChange={(event) => { setSort(event.target.value as typeof sort); setPage(1); }} value={sort}><option value="name">Sort by name</option><option value="role">Sort by role</option><option value="status">Sort by status</option><option value="lastLogin">Sort by last login</option></select>
          <Button disabled={isRefreshing} onClick={() => { setDirection((value) => value === "asc" ? "desc" : "asc"); setPage(1); }} variant="secondary">{direction === "asc" ? "Ascending" : "Descending"}</Button>
        </div>
      </Panel>

      <StaffDirectory
        canManage={directory.capabilities.canManageStaff}
        canManageOwnerAccounts={canManageOwnerAccounts}
        isActionLoading={(id) => actionLoadingId === id}
        items={directory.items}
        onDetail={(item, target) => void loadDetailFor(item, target)}
        onLifecycle={setLifecycleStaff}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-[var(--text-muted)]">Page {directory.pagination.page} of {directory.pagination.pageCount} · {directory.pagination.total} account(s)</div>
        <div className="flex gap-2"><Button disabled={page <= 1 || isLoading} onClick={() => setPage((value) => Math.max(1, value - 1))} variant="secondary"><ChevronLeft size={16} /> Previous</Button><Button disabled={page >= directory.pagination.pageCount || isLoading} onClick={() => setPage((value) => value + 1)} variant="secondary">Next <ChevronRight size={16} /></Button></div>
      </div>

      {directory.capabilities.canManageAccess ? <AccessRolesPanel currentUser={sessionUser} locations={data.locations} staff={staffForAccess} /> : null}

      {isCreateOpen ? (
        <StaffFormModal
          allowedRoles={assignableRoles}
          onClose={() => setIsCreateOpen(false)}
          onSubmit={async (draft) => {
            await createStaffMember(organizationId, draft);
            setIsCreateOpen(false);
            setMessage("Staff account created.");
            await refresh(undefined, true);
          }}
          title="Add staff"
        />
      ) : null}

      {editingStaff ? (
        <StaffFormModal
          allowedRoles={assignableRoles}
          initialStaff={editingStaff}
          onClose={() => setEditingStaff(null)}
          onSubmit={async (draft) => {
            await updateStaffMember(organizationId, editingStaff.id, draft);
            setEditingStaff(null);
            setMessage("Staff account updated.");
            await refresh(undefined, true);
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

            await updateStaffProviderSchedule(
              organizationId,
              scheduleStaff.providerId,
              availability,
              recurringBlocks,
              blockedTimes,
            );
            invalidatePlanningCaches({ providerIds: [scheduleStaff.providerId] });
            setScheduleStaff(null);
            setMessage("Provider schedule updated.");
          }}
          staff={scheduleStaff}
        />
      ) : null}

      {passwordStaff ? (
        <ResetPasswordModal
          onClose={() => setPasswordStaff(null)}
          onSubmit={async (password) => {
            await resetStaffMemberPassword(passwordStaff.id, password);
            setPasswordStaff(null);
            setMessage("Password updated and active sessions revoked.");
          }}
          staff={passwordStaff}
        />
      ) : null}

      {lifecycleStaff ? (
        <StaffLifecycleDrawer
          isSaving={actionLoadingId === lifecycleStaff.id}
          onClose={() => setLifecycleStaff(null)}
          onConfirm={() => lifecycle(lifecycleStaff)}
          staff={lifecycleStaff}
        />
      ) : null}
    </div>
  );
}

function StaffLifecycleDrawer({
  isSaving,
  onClose,
  onConfirm,
  staff,
}: {
  isSaving: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  staff: StaffDirectoryItem;
}) {
  const restoring = staff.status === "Inactive";
  const [confirmation, setConfirmation] = useState("");
  const matches = confirmation.trim().toLowerCase() === staff.email.toLowerCase();

  return (
    <Drawer
      closeDisabled={isSaving}
      context={staff.email}
      onClose={onClose}
      title={restoring ? `Restore ${staff.name}` : `Archive ${staff.name}`}
    >
      <div className="space-y-5">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--foreground)]">
          {restoring
            ? "Restoring reactivates this account. Existing role assignments remain governed separately."
            : "Archiving removes this account from active clinic work. It can be restored later; this does not permanently delete the staff record."}
        </div>
        <Field label={`Type ${staff.email} to confirm`}>
          <input
            autoComplete="off"
            className={inputClassName}
            onChange={(event) => setConfirmation(event.target.value)}
            value={confirmation}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button disabled={isSaving} onClick={onClose} variant="ghost">Cancel</Button>
          <Button
            disabled={!matches}
            loading={isSaving}
            loadingLabel={restoring ? "Restoring..." : "Archiving..."}
            onClick={() => void onConfirm()}
          >
            {restoring ? "Restore account" : "Archive account"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

function StaffDirectory({ canManage, canManageOwnerAccounts, isActionLoading, items, onDetail, onLifecycle }: {
  canManage: boolean;
  canManageOwnerAccounts: boolean;
  isActionLoading: (id: string) => boolean;
  items: StaffDirectoryItem[];
  onDetail: (item: StaffDirectoryItem, target: "edit" | "schedule" | "password") => void;
  onLifecycle: (item: StaffDirectoryItem) => void;
}) {
  if (!items.length) return <Panel><div className="p-5"><EmptyState body="Adjust the search or filters to find another account." title="No staff found" /></div></Panel>;
  return <Panel><div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-[var(--surface-muted)] text-xs uppercase tracking-wide text-[var(--text-muted)]"><tr><th className="px-4 py-3">Staff member</th><th className="px-4 py-3">Roles and scope</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Last login</th><th className="px-4 py-3">Actions</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{items.map((item) => <StaffRow canManage={canManage} canManageOwnerAccounts={canManageOwnerAccounts} isLoading={isActionLoading(item.id)} item={item} key={item.id} onDetail={onDetail} onLifecycle={onLifecycle} />)}</tbody></table></div><div className="divide-y divide-[var(--border)] lg:hidden">{items.map((item) => <StaffCard canManage={canManage} canManageOwnerAccounts={canManageOwnerAccounts} isLoading={isActionLoading(item.id)} item={item} key={item.id} onDetail={onDetail} onLifecycle={onLifecycle} />)}</div></Panel>;
}

type StaffItemProps = { canManage: boolean; canManageOwnerAccounts: boolean; isLoading: boolean; item: StaffDirectoryItem; onDetail: (item: StaffDirectoryItem, target: "edit" | "schedule" | "password") => void; onLifecycle: (item: StaffDirectoryItem) => void };

function StaffRow({ canManage, canManageOwnerAccounts, isLoading, item, onDetail, onLifecycle }: StaffItemProps) {
  return <tr><td className="px-4 py-4"><StaffIdentity item={item} /></td><td className="px-4 py-4"><RoleChips item={item} /></td><td className="px-4 py-4"><StatusChip status={item.status} /><div className="mt-2 text-xs text-[var(--text-muted)]">{item.isSchedulable ? "Schedule owner" : "No schedule profile"}</div></td><td className="px-4 py-4 text-[var(--text-muted)]">{formatLastLogin(item.lastLoginAtIso)}</td><td className="px-4 py-4"><StaffActions canManage={canManage} canManageOwnerAccounts={canManageOwnerAccounts} isLoading={isLoading} item={item} onDetail={onDetail} onLifecycle={onLifecycle} /></td></tr>;
}

function StaffCard({ canManage, canManageOwnerAccounts, isLoading, item, onDetail, onLifecycle }: StaffItemProps) {
  return <article className="space-y-4 p-4"><div className="flex items-start justify-between gap-3"><StaffIdentity item={item} /><StatusChip status={item.status} /></div><RoleChips item={item} /><div className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--surface-muted)] p-3 text-xs"><div><span className="text-[var(--text-muted)]">Schedule</span><div className="mt-1 font-semibold">{item.isSchedulable ? "Provider profile" : "Not schedulable"}</div></div><div><span className="text-[var(--text-muted)]">Last login</span><div className="mt-1 font-semibold">{formatLastLogin(item.lastLoginAtIso)}</div></div></div><StaffActions canManage={canManage} canManageOwnerAccounts={canManageOwnerAccounts} isLoading={isLoading} item={item} onDetail={onDetail} onLifecycle={onLifecycle} /></article>;
}

function StaffIdentity({ item }: { item: StaffDirectoryItem }) { return <div><div className="font-semibold text-[var(--foreground)]">{item.name}</div><div className="mt-1 text-xs text-[var(--text-muted)]">{item.email}</div><div className="mt-1 text-xs text-[var(--text-muted)]">{item.staffLabel}{item.department ? ` · ${item.department}` : ""}</div></div>; }
function RoleChips({ item }: { item: StaffDirectoryItem }) { const assignments = item.assignments.length ? item.assignments : [{ id: `primary-${item.id}`, role: item.primaryRole, locationId: null, location: null }]; return <div className="flex max-w-sm flex-wrap gap-1.5">{assignments.slice(0, 4).map((assignment) => <span className="rounded-full bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--brand-strong)]" key={assignment.id}>{roleLabel(assignment.role)}{assignment.location ? ` · ${assignment.location.name}` : " · All locations"}</span>)}{assignments.length > 4 ? <span className="text-xs text-[var(--text-muted)]">+{assignments.length - 4} more</span> : null}</div>; }
function StatusChip({ status }: { status: StaffMember["status"] }) { return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${status === "Active" ? "bg-[var(--accent-soft)] text-[var(--brand-strong)]" : status === "Suspended" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--surface-muted)] text-[var(--text-muted)]"}`}>{status}</span>; }
function StaffActions({ canManage, canManageOwnerAccounts, isLoading, item, onDetail, onLifecycle }: StaffItemProps) { if (!canManage) return <span className="text-xs text-[var(--text-muted)]">Coordination view</span>; if (item.primaryRole === "Owner" && !canManageOwnerAccounts) return <span className="text-xs text-[var(--text-muted)]">Owner-managed account</span>; return <div className="flex flex-wrap gap-2"><Button disabled={isLoading} onClick={() => onDetail(item, "edit")} variant="secondary"><UserCog size={15} /> Edit</Button>{item.isSchedulable ? <Button disabled={isLoading} onClick={() => onDetail(item, "schedule")} variant="ghost"><CalendarRange size={15} /> Schedule</Button> : null}<Button disabled={isLoading} onClick={() => onDetail(item, "password")} variant="ghost"><KeyRound size={15} /> Password</Button><Button disabled={isLoading} onClick={() => onLifecycle(item)} variant="ghost">{item.status === "Inactive" ? "Restore" : "Archive"}</Button></div>; }
function formatLastLogin(value: string | null) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : "Never"; }
function roleLabel(role: StaffMember["role"]) { return role === "InventoryManager" ? "Inventory Manager" : role === "SuperAdmin" ? "Super Admin" : role; }
function StaffSkeleton() { return <div aria-busy="true" className="space-y-5" role="status"><span className="sr-only">Loading Staff Management</span><div className="h-16 animate-pulse rounded-xl bg-[var(--surface-muted)] motion-reduce:animate-none" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <div className="h-28 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] motion-reduce:animate-none" key={index} />)}</div><div className="h-96 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] motion-reduce:animate-none" /></div>; }

function StaffFormModal({
  allowedRoles,
  initialStaff,
  onClose,
  onSubmit,
  title,
}: {
  allowedRoles: StaffMember["role"][];
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
  const [error, setError] = useState<string | null>(null);

  function updateField<Key extends keyof StaffDraft>(key: Key, value: StaffDraft[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
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
    } catch (requestError) {
      setError(requestErrorMessage(requestError, "Could not save this staff account."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Drawer closeDisabled={isSaving} context="Account profile, primary role, and Provider linkage." onClose={onClose} title={title}>
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error ? <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]" role="alert">{error}</div> : null}
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
              {allowedRoles.map((option) => (
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
              minLength={15}
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
          <Button disabled={isSaving} onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button loading={isSaving} loadingLabel="Saving…" type="submit">Save staff</Button>
        </div>
      </form>
    </Drawer>
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
  const [error, setError] = useState<string | null>(null);

  if (!staff.providerId || !staff.provider) {
    return (
      <Drawer context={staff.name} onClose={onClose} title="Schedule">
        <EmptyState
          body="This account does not yet own a schedule profile. Mark it schedulable first."
          title="No provider schedule"
        />
      </Drawer>
    );
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      await onSubmit(availability, recurringBlocks, blockedTimes);
    } catch (requestError) {
      setError(requestErrorMessage(requestError, "Could not update this Provider schedule."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Drawer
      closeDisabled={isSaving}
      context="Weekly windows, recurring blocks, and date-specific exceptions."
      onClose={onClose}
      title={`${staff.name} schedule`}
    >
      <div className="space-y-6">
        {error ? <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]" role="alert">{error}</div> : null}
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
          <Button disabled={isSaving} onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button loading={isSaving} loadingLabel="Saving…" onClick={() => void handleSave()}>Save schedule</Button>
        </div>
      </div>
    </Drawer>
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
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await onSubmit(password);
    } catch (requestError) {
      setError(requestErrorMessage(requestError, "Could not reset this password."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Drawer closeDisabled={isSaving} context="This revokes every active session for the selected account." onClose={onClose} title={`Reset password · ${staff.name}`}>
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error ? <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]" role="alert">{error}</div> : null}
        <Field label="New password">
          <input
            className={inputClassName}
            minLength={15}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button disabled={isSaving} onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button loading={isSaving} loadingLabel="Saving…" type="submit">Update password</Button>
        </div>
      </form>
    </Drawer>
  );
}
