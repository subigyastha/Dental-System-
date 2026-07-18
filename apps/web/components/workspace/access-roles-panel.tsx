"use client";

import { ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, Panel } from "@/components/ui";
import { EmptyState, Field, Modal, inputClassName, textareaClassName } from "@/components/workspace/elements";
import { ApiRequestError, apiFetchJson } from "@/lib/api-client";
import type { Location, SessionUser, StaffMember } from "@/lib/domain";

type GovernableRole =
  | "Owner"
  | "Admin"
  | "Manager"
  | "Receptionist"
  | "Scheduler"
  | "Provider"
  | "Assistant"
  | "Finance"
  | "InventoryManager";

export type RoleAssignment = {
  id: string;
  role: GovernableRole;
  locationId: string | null;
  location: { id: string; name: string } | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  grantReason: string | null;
};

type Membership = {
  id: string;
  userId: string;
  status: "Active" | "Suspended" | "Revoked";
  effectiveFrom: string;
  effectiveTo: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  user: { id: string; name: string; email: string; status: string };
  roleAssignments: RoleAssignment[];
};

type AssignRolePayload = {
  userId: string;
  role: GovernableRole;
  reason: string;
  locationId?: string;
  effectiveFromIso?: string;
  effectiveToIso?: string;
};

const governableRoles: GovernableRole[] = [
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

export function isOwnerOrAdmin(role?: SessionUser["role"] | null) {
  return role === "Owner" || role === "Admin";
}

function formatEffectiveDate(value?: string | null) {
  if (!value) return "No end date";

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function isRoleActive(assignment: RoleAssignment) {
  const now = Date.now();
  return (
    !assignment.revokedAt &&
    new Date(assignment.effectiveFrom).getTime() <= now &&
    (!assignment.effectiveTo || new Date(assignment.effectiveTo).getTime() > now)
  );
}

export function AccessRolesPanel({
  currentUser,
  locations,
  staff,
}: {
  currentUser?: SessionUser | null;
  locations: Location[];
  staff: StaffMember[];
}) {
  const canGovern = isOwnerOrAdmin(currentUser?.role);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(canGovern);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<
    { assignment?: RoleAssignment; membership: Membership; type: "membership" | "role" } | null
  >(null);

  const loadMemberships = useCallback(async () => {
    if (!canGovern) return;

    setError(null);
    try {
      const response = await apiFetchJson<Membership[]>("/auth/role-governance/memberships");
      setMemberships(response);
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError && requestError.status === 403
          ? "You do not have permission to view organization access."
          : requestError instanceof Error
            ? requestError.message
            : "Could not load organization access.",
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [canGovern]);

  useEffect(() => {
    void loadMemberships();
  }, [loadMemberships]);

  const visibleMemberships = useMemo(() => {
    if (showRevoked) return memberships;
    return memberships.filter((membership) => membership.status !== "Revoked");
  }, [memberships, showRevoked]);

  if (!canGovern) {
    return (
      <Panel title="Access & roles">
        <div className="p-4 text-sm text-[var(--text-muted)]">
          Only Owners and Admins can view or change organization access.
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      action={
        <div className="flex items-center gap-2">
          <Button
            disabled={isLoading || isRefreshing}
            onClick={() => {
              setIsRefreshing(true);
              void loadMemberships();
            }}
            variant="ghost"
          >
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </Button>
          <Button onClick={() => setGrantOpen(true)}>
            <UserPlus size={16} />
            Grant role
          </Button>
        </div>
      }
      title="Access & roles"
    >
      <div className="border-b border-[var(--border)] px-4 py-3 text-sm text-[var(--text-muted)]">
        Manage organization roles by staff member. Changes require a reason and take effect only after the server confirms them.
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
          <input
            checked={showRevoked}
            onChange={(event) => setShowRevoked(event.target.checked)}
            type="checkbox"
          />
          Include revoked access
        </label>
        <div className="text-xs text-[var(--text-muted)]">{visibleMemberships.length} membership(s)</div>
      </div>

      {isLoading ? (
        <div className="p-4 text-sm text-[var(--text-muted)]">Loading organization access...</div>
      ) : error ? (
        <div className="p-4">
          <EmptyState
            actionLabel="Retry"
            body={error}
            onAction={() => {
              setIsLoading(true);
              void loadMemberships();
            }}
            title="Access could not be loaded"
          />
        </div>
      ) : visibleMemberships.length ? (
        <div className="divide-y divide-[var(--border)]">
          {visibleMemberships.map((membership) => (
            <MembershipRow
              key={membership.id}
              membership={membership}
              onRevokeMembership={() => setRevokeTarget({ membership, type: "membership" })}
              onRevokeRole={(assignment) => setRevokeTarget({ assignment, membership, type: "role" })}
              showRevoked={showRevoked}
            />
          ))}
        </div>
      ) : (
        <div className="p-4">
          <EmptyState
            actionLabel="Grant role"
            body="No active organization memberships are available yet. Start by granting a role to a staff account."
            onAction={() => setGrantOpen(true)}
            title="No organization access"
          />
        </div>
      )}

      {grantOpen ? (
        <GrantRoleModal
          currentUser={currentUser}
          locations={locations}
          onClose={() => setGrantOpen(false)}
          onGranted={async () => {
            setGrantOpen(false);
            setIsRefreshing(true);
            await loadMemberships();
          }}
          staff={staff}
        />
      ) : null}
      {revokeTarget ? (
        <RevokeAccessModal
          onClose={() => setRevokeTarget(null)}
          onRevoked={async () => {
            setRevokeTarget(null);
            setIsRefreshing(true);
            await loadMemberships();
          }}
          target={revokeTarget}
        />
      ) : null}
    </Panel>
  );
}

function MembershipRow({
  membership,
  onRevokeMembership,
  onRevokeRole,
  showRevoked,
}: {
  membership: Membership;
  onRevokeMembership: () => void;
  onRevokeRole: (assignment: RoleAssignment) => void;
  showRevoked: boolean;
}) {
  const assignments = showRevoked
    ? membership.roleAssignments
    : membership.roleAssignments.filter((assignment) => !assignment.revokedAt);

  return (
    <div className="p-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="font-medium text-[var(--foreground)]">{membership.user.name}</div>
          <div className="mt-1 text-sm text-[var(--text-muted)]">{membership.user.email}</div>
          <div className="mt-2 text-xs text-[var(--text-muted)]">
            Membership: {membership.status} · Effective {formatEffectiveDate(membership.effectiveFrom)}
            {membership.effectiveTo ? ` to ${formatEffectiveDate(membership.effectiveTo)}` : ""}
            {membership.revokedAt ? ` · Revoked ${formatEffectiveDate(membership.revokedAt)}` : ""}
          </div>
        </div>
        {membership.status !== "Revoked" ? (
          <Button onClick={onRevokeMembership} variant="ghost">
            <UserMinus size={16} />
            Revoke access
          </Button>
        ) : null}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-y border-[var(--border)] text-xs text-[var(--text-muted)]">
            <tr>
              <th className="px-2 py-2 font-medium">Role</th>
              <th className="px-2 py-2 font-medium">Scope</th>
              <th className="px-2 py-2 font-medium">Effective</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((assignment) => {
              const active = isRoleActive(assignment);
              return (
                <tr className="border-b border-[var(--border)] last:border-b-0" key={assignment.id}>
                  <td className="px-2 py-2 font-medium text-[var(--foreground)]">{assignment.role}</td>
                  <td className="px-2 py-2 text-[var(--text-muted)]">
                    {assignment.location?.name ?? "All locations"}
                  </td>
                  <td className="px-2 py-2 text-[var(--text-muted)]">
                    {formatEffectiveDate(assignment.effectiveFrom)}
                    {assignment.effectiveTo ? ` – ${formatEffectiveDate(assignment.effectiveTo)}` : " onward"}
                  </td>
                  <td className="px-2 py-2 text-[var(--text-muted)]">
                    {assignment.revokedAt
                      ? `Revoked ${formatEffectiveDate(assignment.revokedAt)}`
                      : active
                        ? "Active"
                        : "Scheduled or expired"}
                  </td>
                  <td className="px-2 py-2">
                    {!assignment.revokedAt ? (
                      <Button onClick={() => onRevokeRole(assignment)} variant="ghost">
                        Revoke
                      </Button>
                    ) : assignment.revokedReason ? (
                      <span className="text-xs text-[var(--text-muted)]" title={assignment.revokedReason}>
                        Reason recorded
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GrantRoleModal({
  currentUser,
  locations,
  onClose,
  onGranted,
  staff,
}: {
  currentUser?: SessionUser | null;
  locations: Location[];
  onClose: () => void;
  onGranted: () => Promise<void>;
  staff: StaffMember[];
}) {
  const [form, setForm] = useState<AssignRolePayload>({
    userId: "",
    role: "Receptionist",
    reason: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const availableRoles = currentUser?.role === "Owner" ? governableRoles : governableRoles.filter((role) => role !== "Owner");
  const staffById = useMemo(() => new Map(staff.map((member) => [member.id, member])), [staff]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      await apiFetchJson<RoleAssignment>("/auth/role-governance/roles", {
        body: JSON.stringify({
          ...form,
          locationId: form.locationId || undefined,
          effectiveFromIso: form.effectiveFromIso || undefined,
          effectiveToIso: form.effectiveToIso || undefined,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      await onGranted();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not grant the role.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      subtitle="A grant is recorded in the organization audit trail and is not applied locally until the API confirms it."
      title="Grant organization role"
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Field label="Staff member">
          <select
            className={inputClassName}
            onChange={(event) => setForm((current) => ({ ...current, userId: event.target.value }))}
            required
            value={form.userId}
          >
            <option value="">Select a staff member</option>
            {staff.map((member) => (
              <option disabled={member.id === currentUser?.id} key={member.id} value={member.id}>
                {member.name} · {member.email}
              </option>
            ))}
          </select>
        </Field>
        {form.userId && !staffById.has(form.userId) ? (
          <p className="text-sm text-[var(--danger)]">The selected account is no longer available.</p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role">
            <select
              className={inputClassName}
              onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as GovernableRole }))}
              value={form.role}
            >
              {availableRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Location scope">
            <select
              className={inputClassName}
              onChange={(event) => setForm((current) => ({ ...current, locationId: event.target.value || undefined }))}
              value={form.locationId ?? ""}
            >
              <option value="">All locations</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Effective from">
            <input
              className={inputClassName}
              onChange={(event) => setForm((current) => ({ ...current, effectiveFromIso: event.target.value || undefined }))}
              type="date"
              value={form.effectiveFromIso ?? ""}
            />
          </Field>
          <Field label="Effective until">
            <input
              className={inputClassName}
              min={form.effectiveFromIso}
              onChange={(event) => setForm((current) => ({ ...current, effectiveToIso: event.target.value || undefined }))}
              type="date"
              value={form.effectiveToIso ?? ""}
            />
          </Field>
        </div>
        <Field label="Reason">
          <textarea
            className={textareaClassName}
            onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
            placeholder="Why is this access required?"
            required
            value={form.reason}
          />
        </Field>
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button disabled={!form.userId || !form.reason.trim()} loading={isSaving} loadingLabel="Granting..." type="submit">
            <ShieldCheck size={16} />
            Grant role
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RevokeAccessModal({
  onClose,
  onRevoked,
  target,
}: {
  onClose: () => void;
  onRevoked: () => Promise<void>;
  target: { assignment?: RoleAssignment; membership: Membership; type: "membership" | "role" };
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const description =
    target.type === "role"
      ? `${target.assignment?.role} for ${target.membership.user.name}`
      : `all organization access for ${target.membership.user.name}`;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const path =
        target.type === "role"
          ? `/auth/role-governance/roles/${target.assignment?.id}/revoke`
          : `/auth/role-governance/memberships/${target.membership.id}/revoke`;
      await apiFetchJson(path, {
        body: JSON.stringify({ reason }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      await onRevoked();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not revoke access.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      subtitle="This consequential action is audited. The access view refreshes only after the server confirms the revocation."
      title="Confirm access revocation"
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <p className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--foreground)]">
          You are revoking {description}.
        </p>
        <Field label="Reason">
          <textarea
            className={textareaClassName}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this access being removed?"
            required
            value={reason}
          />
        </Field>
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button disabled={!reason.trim()} loading={isSaving} loadingLabel="Revoking..." type="submit">
            Revoke access
          </Button>
        </div>
      </form>
    </Modal>
  );
}
