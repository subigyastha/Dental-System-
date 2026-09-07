"use client";

import { Check, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button, Panel } from "@/components/ui";
import {
  Drawer,
  EmptyState,
  Field,
  textareaClassName,
} from "@/components/workspace/elements";
import {
  approveFinanceCorrection,
  loadPendingFinanceCorrections,
  rejectFinanceCorrection,
} from "@/lib/finance-api";
import {
  formatNpr,
  type FinanceCorrection,
} from "@/lib/finance-domain";
import { isAbortedRequest, requestErrorMessage } from "@/lib/request-error";

import { formatFinanceDate } from "./invoice-ledger";

export function CorrectionApprovalQueue({
  canApprove,
  onChanged,
  refreshKey,
}: {
  canApprove: boolean;
  onChanged: () => void;
  refreshKey: number;
}) {
  const [items, setItems] = useState<FinanceCorrection[]>([]);
  const [selected, setSelected] = useState<FinanceCorrection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    if (!canApprove) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void loadPendingFinanceCorrections(controller.signal)
      .then(setItems)
      .catch((cause: unknown) => {
        if (!isAbortedRequest(cause)) {
          setError(
            requestErrorMessage(
              cause,
              "Pending corrections could not be loaded.",
            ),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canApprove, loadKey, refreshKey]);

  if (!canApprove) {
    return (
      <EmptyState
        body="Only an Owner or Admin may approve a correction, and nobody may approve their own request."
        title="Correction approval permission required"
      />
    );
  }

  return (
    <>
      <Panel
        action={
          <Button
            className="min-h-11"
            disabled={loading}
            onClick={() => setLoadKey((value) => value + 1)}
            variant="ghost"
          >
            <RefreshCw aria-hidden="true" size={15} />
            Refresh
          </Button>
        }
        title="Pending correction approvals"
      >
        {loading ? (
          <p aria-live="polite" className="p-6 text-sm text-[var(--text-muted)]">
            Loading approval queue…
          </p>
        ) : error ? (
          <div className="p-4">
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4" role="alert">
              <p className="text-sm text-[var(--danger)]">{error}</p>
              <Button
                className="mt-3 min-h-11"
                onClick={() => setLoadKey((value) => value + 1)}
                variant="secondary"
              >
                Retry
              </Button>
            </div>
          </div>
        ) : items.length ? (
          <div className="divide-y divide-[var(--border)]">
            {items.map((item) => (
              <button
                className="grid min-h-20 w-full gap-2 px-4 py-4 text-left transition hover:bg-[var(--surface-muted)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                key={item.id}
                onClick={() => setSelected(item)}
                type="button"
              >
                <span>
                  <span className="block font-semibold">
                    {item.kind} · {item.invoiceNumber}
                  </span>
                  <span className="mt-1 block text-sm text-[var(--text-muted)]">
                    {item.clientName ? `${item.clientName} · ` : ""}requested by{" "}
                    {item.initiatedByName ?? "Finance user"}
                  </span>
                </span>
                <span className="font-bold tabular-nums">
                  {formatNpr(item.amountNpr)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-4">
            <EmptyState
              body="There are no financial corrections awaiting an independent decision."
              title="Approval queue is clear"
            />
          </div>
        )}
      </Panel>
      {selected ? (
        <CorrectionApprovalDrawer
          correction={selected}
          onClose={() => setSelected(null)}
          onResolved={() => {
            setSelected(null);
            setLoadKey((value) => value + 1);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function CorrectionApprovalDrawer({
  correction,
  onClose,
  onResolved,
}: {
  correction: FinanceCorrection;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lockRef = useRef(false);

  async function decide(decision: "approve" | "reject") {
    if (lockRef.current) return;
    if (decision === "reject" && !reason.trim()) {
      setError("A rejection reason is required.");
      return;
    }
    lockRef.current = true;
    setSaving(true);
    setError(null);
    try {
      if (decision === "approve") {
        await approveFinanceCorrection({
          correctionId: correction.id,
          expectedVersion: correction.version,
        });
      } else {
        await rejectFinanceCorrection({
          correctionId: correction.id,
          expectedVersion: correction.version,
          reason: reason.trim(),
        });
      }
      onResolved();
    } catch (cause) {
      setError(
        requestErrorMessage(
          cause,
          "The correction decision could not be saved. Refresh before retrying.",
        ),
      );
    } finally {
      lockRef.current = false;
      setSaving(false);
    }
  }

  const approvalBlocked =
    correction.canApprove === false || Boolean(correction.approvalBlockedReason);

  return (
    <Drawer
      closeDisabled={saving}
      context={
        correction.clientName
          ? `${correction.invoiceNumber} · ${correction.clientName}`
          : correction.invoiceNumber
      }
      onClose={onClose}
      stepLabel="Independent financial approval"
      title="Review correction"
    >
      <div className="space-y-5">
        <section className="rounded-lg border border-[var(--border)] p-4">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Value label="Type" value={correction.kind} />
            <Value label="Amount" value={formatNpr(correction.amountNpr)} />
            <Value
              label="Requested"
              value={formatFinanceDate(correction.initiatedAtIso)}
            />
            <Value
              label="Initiator"
              value={correction.initiatedByName ?? correction.initiatedByUserId}
            />
          </dl>
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <p className="text-xs text-[var(--text-muted)]">Required reason</p>
            <p className="mt-1 text-sm">{correction.reason}</p>
          </div>
        </section>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          Approval does not rewrite the original completed receipt. The
          correction and its execution remain separate ledger events.
        </div>

        {approvalBlocked ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm" role="status">
            {correction.approvalBlockedReason ??
              "You cannot approve this correction. Self-approval is prohibited."}
          </p>
        ) : null}

        {rejecting ? (
          <Field label="Required rejection reason">
            <textarea
              className={textareaClassName}
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
          </Field>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-[var(--danger)]" role="alert">
            {error}
          </p>
        ) : null}

        <div className="sticky -bottom-5 -mx-5 flex flex-col-reverse gap-2 border-t border-[var(--border)] bg-white px-5 py-4 sm:flex-row sm:justify-end">
          <Button
            className="min-h-11"
            disabled={saving}
            onClick={() => {
              if (!rejecting) {
                setRejecting(true);
                return;
              }
              void decide("reject");
            }}
            variant="secondary"
          >
            <X aria-hidden="true" size={15} />
            {rejecting ? "Confirm rejection" : "Reject"}
          </Button>
          <Button
            className="min-h-11"
            disabled={approvalBlocked || rejecting}
            loading={saving}
            loadingLabel="Approving correction"
            onClick={() => void decide("approve")}
          >
            <Check aria-hidden="true" size={15} />
            Approve correction
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
}
