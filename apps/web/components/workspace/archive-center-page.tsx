"use client";

import { ArchiveRestore, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, Panel } from "@/components/ui";
import { EmptyState, Field, Modal, PageHeader, inputClassName, textareaClassName } from "@/components/workspace/elements";
import { useWorkspaceApp } from "@/components/workspace/app-state";
import { ApiRequestError, apiFetchJson } from "@/lib/api-client";
import type { SessionUser } from "@/lib/domain";

export type ArchivedClient = {
  id: string;
  fullName: string;
  patientCode: string | null;
  archivedAt: string;
  archiveReason: string | null;
  archivedByUserId: string | null;
  retentionUntil: string | null;
  legalHoldAt: string | null;
  legalHoldReason: string | null;
};

export function canManageArchive(role?: SessionUser["role"] | null) {
  return role === "Owner" || role === "Admin";
}

export function archiveProtectionLabel(client: ArchivedClient) {
  if (client.legalHoldAt) {
    return client.legalHoldReason ? `Legal hold: ${client.legalHoldReason}` : "Legal hold";
  }
  if (client.retentionUntil && new Date(client.retentionUntil).getTime() > Date.now()) {
    return `Retained until ${formatDate(client.retentionUntil)}`;
  }
  return "Retention review required";
}

function formatDate(value?: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function archiveErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 403) {
    return "You do not have permission to manage the client archive.";
  }
  return error instanceof Error ? error.message : "Could not load the client archive.";
}

export function ArchiveCenterPage() {
  const { sessionUser } = useWorkspaceApp();
  const canManage = canManageArchive(sessionUser?.role);
  const isOwner = sessionUser?.role === "Owner";
  const [clients, setClients] = useState<ArchivedClient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(canManage);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<ArchivedClient | null>(null);

  const loadArchive = useCallback(async () => {
    if (!canManage) return;

    setError(null);
    try {
      const response = await apiFetchJson<ArchivedClient[]>("/customers/archive", { cache: "no-store" });
      setClients(response);
    } catch (requestError) {
      setError(archiveErrorMessage(requestError));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [canManage]);

  useEffect(() => {
    void loadArchive();
  }, [loadArchive]);

  const archivedCount = useMemo(() => clients.length, [clients]);

  if (!canManage) {
    return (
      <div className="space-y-5">
        <PageHeader title="Archive center" subtitle="Archived client records and lifecycle controls." />
        <Panel title="Permission denied">
          <div className="p-5">
            <EmptyState
              body="Only an Owner or Admin can view archived client records."
              title="Archive access is restricted"
            />
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Archive center"
        subtitle="Restore archived client records or review retention and legal-hold protections."
      />
      <Panel
        action={
          <Button
            disabled={isLoading || isRefreshing}
            onClick={() => {
              setIsRefreshing(true);
              void loadArchive();
            }}
            variant="ghost"
          >
            <RefreshCw aria-hidden="true" size={16} />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </Button>
        }
        title="Archived clients"
      >
        <div className="border-b border-[var(--border)] px-4 py-3 text-sm text-[var(--text-muted)]">
          {archivedCount} archived client record{archivedCount === 1 ? "" : "s"}. Restoration and deletion outcomes are confirmed by the server and recorded in the audit trail.
        </div>
        {notice ? (
          <div aria-live="polite" className="border-b border-[var(--border)] bg-[var(--color-selected)] px-4 py-3 text-sm text-[var(--color-primary-hover)]">
            {notice}
          </div>
        ) : null}
        {isLoading ? (
          <div className="p-4 text-sm text-[var(--text-muted)]">Loading archived client records...</div>
        ) : error ? (
          <div className="p-4">
            <EmptyState
              actionLabel="Retry"
              body={error}
              onAction={() => {
                setIsLoading(true);
                void loadArchive();
              }}
              title="Archive could not be loaded"
            />
          </div>
        ) : clients.length ? (
          <div className="divide-y divide-[var(--border)]">
            {clients.map((client) => (
              <ArchivedClientRow
                client={client}
                isOwner={isOwner}
                isRestoring={restoringId === client.id}
                key={client.id}
                onPurge={() => setPurgeTarget(client)}
                onRestore={async () => {
                  setNotice(null);
                  setError(null);
                  setRestoringId(client.id);
                  try {
                    await apiFetchJson(`/customers/${client.id}/restore`, { method: "POST" });
                    setNotice(`${client.fullName} was restored from the archive.`);
                    await loadArchive();
                  } catch (requestError) {
                    setError(archiveErrorMessage(requestError));
                  } finally {
                    setRestoringId(null);
                  }
                }}
              />
            ))}
          </div>
        ) : (
          <div className="p-4">
            <EmptyState
              body="Archived client records will appear here after they are archived from the client workspace."
              title="No archived clients"
            />
          </div>
        )}
      </Panel>

      {!isOwner ? (
        <Panel title="Permanent deletion">
          <div className="flex gap-3 p-4 text-sm text-[var(--text-muted)]">
            <ShieldAlert aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--color-warning)]" size={18} />
            <p>Permanent client deletion is restricted to the Owner. Admins can restore archived clients but cannot remove them permanently.</p>
          </div>
        </Panel>
      ) : null}

      {purgeTarget ? (
        <PermanentDeleteModal
          client={purgeTarget}
          onClose={() => setPurgeTarget(null)}
          onDeleted={async () => {
            setPurgeTarget(null);
            setNotice(`${purgeTarget.fullName} was permanently deleted after server confirmation.`);
            await loadArchive();
          }}
        />
      ) : null}
    </div>
  );
}

function ArchivedClientRow({
  client,
  isOwner,
  isRestoring,
  onPurge,
  onRestore,
}: {
  client: ArchivedClient;
  isOwner: boolean;
  isRestoring: boolean;
  onPurge: () => void;
  onRestore: () => Promise<void>;
}) {
  return (
    <div className="grid gap-4 px-4 py-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(180px,0.8fr)_minmax(180px,0.9fr)_auto] xl:items-center">
      <div>
        <div className="font-medium text-[var(--foreground)]">{client.fullName}</div>
        <div className="mt-1 text-sm text-[var(--text-muted)]">
          {client.patientCode ?? "No client code"} · ID: <span className="font-mono text-xs">{client.id}</span>
        </div>
      </div>
      <div className="text-sm text-[var(--text-muted)]">
        <div className="font-medium text-[var(--foreground)]">Archived {formatDate(client.archivedAt)}</div>
        <div className="mt-1">{client.archiveReason ?? "No archive reason recorded"}</div>
      </div>
      <div className="text-sm text-[var(--text-muted)]">
        <div className={client.legalHoldAt ? "font-medium text-[var(--color-danger)]" : "font-medium text-[var(--foreground)]"}>
          {archiveProtectionLabel(client)}
        </div>
        {client.legalHoldAt ? <div className="mt-1">Placed {formatDate(client.legalHoldAt)}</div> : null}
      </div>
      <div className="flex flex-wrap gap-2 xl:justify-end">
        <Button loading={isRestoring} loadingLabel="Restoring..." onClick={() => void onRestore()} variant="secondary">
          <ArchiveRestore aria-hidden="true" size={16} />
          Restore
        </Button>
        {isOwner ? (
          <Button
            className="border border-[var(--color-danger)] bg-[var(--color-danger)] text-white hover:bg-[#9f2a23]"
            onClick={onPurge}
          >
            <Trash2 aria-hidden="true" size={16} />
            Delete permanently
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PermanentDeleteModal({
  client,
  onClose,
  onDeleted,
}: {
  client: ArchivedClient;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [confirmationId, setConfirmationId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      await apiFetchJson(`/customers/${client.id}/purge`, {
        body: JSON.stringify({ confirmCustomerId: confirmationId, reason }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      });
      await onDeleted();
    } catch (requestError) {
      setError(archiveErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      subtitle="This action is permanent. The server will still block deletion if legal-hold, retention, clinical, operational, or financial safeguards apply."
      title={`Delete ${client.fullName} permanently`}
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="rounded-md border border-[var(--color-danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--foreground)]">
          <div className="font-medium">Archived client ID</div>
          <code className="mt-1 block break-all text-xs">{client.id}</code>
        </div>
        <Field label="Type the client ID to confirm">
          <input
            autoComplete="off"
            className={inputClassName}
            onChange={(event) => setConfirmationId(event.target.value)}
            required
            value={confirmationId}
          />
        </Field>
        <Field label="Reason for permanent deletion">
          <textarea
            className={textareaClassName}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is permanent deletion permitted?"
            required
            value={reason}
          />
        </Field>
        {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button
            className="border border-[var(--color-danger)] bg-[var(--color-danger)] text-white hover:bg-[#9f2a23]"
            disabled={confirmationId !== client.id || !reason.trim()}
            loading={isSaving}
            loadingLabel="Deleting..."
            type="submit"
          >
            Delete permanently
          </Button>
        </div>
      </form>
    </Modal>
  );
}
