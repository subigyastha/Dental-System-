"use client";

import { ClipboardCheck, FileText, Plus, RefreshCw, Scale } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button, Panel } from "@/components/ui";
import { useWorkspaceApp } from "@/components/workspace/app-state";
import { EmptyState, PageHeader } from "@/components/workspace/elements";
import {
  issueFinanceInvoice,
  loadFinanceWorkspace,
} from "@/lib/finance-api";
import {
  formatNpr,
  type FinanceWorkspaceData,
} from "@/lib/finance-domain";
import { isAbortedRequest, requestErrorMessage } from "@/lib/request-error";

import { CorrectionApprovalQueue } from "./correction-approval-queue";
import { CreateInvoiceDrawer } from "./create-invoice-drawer";
import { FinancialCorrectionDrawer } from "./financial-correction-drawer";
import {
  type CorrectionTarget,
  InvoiceDetailDrawer,
} from "./invoice-detail-drawer";
import { InvoiceLedger } from "./invoice-ledger";
import { ReconciliationWorkspace } from "./reconciliation-workspace";
import { RecordPaymentDrawer } from "./record-payment-drawer";

type FinanceView = "invoices" | "approvals" | "reconciliation";

export function FinanceWorkspace() {
  const { data } = useWorkspaceApp();
  const [workspace, setWorkspace] = useState<FinanceWorkspaceData | null>(null);
  const [view, setView] = useState<FinanceView>("invoices");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [correctionTarget, setCorrectionTarget] =
    useState<CorrectionTarget | null>(null);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [paymentInvoice, setPaymentInvoice] =
    useState<import("@/lib/finance-domain").FinanceInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const issueAttempts = useRef(new Map<string, string>());

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void loadFinanceWorkspace({ signal: controller.signal })
      .then(setWorkspace)
      .catch((cause: unknown) => {
        if (!isAbortedRequest(cause)) {
          setError(
            requestErrorMessage(cause, "Finance data could not be loaded."),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function refresh(message?: string) {
    if (message) setNotice(message);
    setRefreshKey((value) => value + 1);
  }

  const capabilities = workspace?.capabilities;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Finance"
        subtitle="Invoices, append-only payment records, corrections, approvals, and daily reconciliation."
        action={
          capabilities?.canCreateDraft ? (
            <Button className="min-h-11" onClick={() => setCreatingInvoice(true)}>
              <Plus aria-hidden="true" size={16} />
              New invoice
            </Button>
          ) : undefined
        }
      />

      {notice ? (
        <div
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"
          role="status"
        >
          {notice}
        </div>
      ) : null}

      {error ? (
        <div
          className="rounded-lg border border-rose-200 bg-rose-50 p-4"
          ref={errorRef}
          role="alert"
          tabIndex={-1}
        >
          <p className="text-sm text-[var(--danger)]">{error}</p>
          <Button
            className="mt-3 min-h-11"
            onClick={() => refresh()}
            variant="secondary"
          >
            <RefreshCw aria-hidden="true" size={15} />
            Retry
          </Button>
        </div>
      ) : null}

      {loading && !workspace ? (
        <FinanceWorkspaceSkeleton />
      ) : null}

      {workspace ? (
        <>
          <section
            aria-label="Finance summary"
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
          >
            <Summary label="Issued" value={workspace.summary.issuedNpr} />
            <Summary label="Collected" value={workspace.summary.collectedNpr} />
            <Summary label="Corrected" value={workspace.summary.correctedNpr} />
            <Summary label="Outstanding" value={workspace.summary.outstandingNpr} />
            <Summary
              label="Pending approvals"
              value={String(workspace.summary.pendingApprovalCount)}
              money={false}
            />
          </section>

          <nav
            aria-label="Finance sections"
            className="flex gap-1 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1"
          >
            <ViewButton
              active={view === "invoices"}
              icon={<FileText aria-hidden="true" size={16} />}
              label="Invoices"
              onClick={() => setView("invoices")}
            />
            {workspace.capabilities.canApproveCorrection ? (
              <ViewButton
                active={view === "approvals"}
                badge={workspace.summary.pendingApprovalCount}
                icon={<ClipboardCheck aria-hidden="true" size={16} />}
                label="Approvals"
                onClick={() => setView("approvals")}
              />
            ) : null}
            {workspace.capabilities.canReconcile ? (
              <ViewButton
                active={view === "reconciliation"}
                icon={<Scale aria-hidden="true" size={16} />}
                label="Reconciliation"
                onClick={() => setView("reconciliation")}
              />
            ) : null}
          </nav>

          {view === "invoices" ? (
            <Panel
              action={
                <Button
                  className="min-h-11"
                  disabled={loading}
                  onClick={() => refresh()}
                  variant="ghost"
                >
                  <RefreshCw aria-hidden="true" size={15} />
                  Refresh
                </Button>
              }
              title="Invoice ledger"
            >
              {workspace.invoices.length ? (
                <InvoiceLedger
                  invoices={workspace.invoices}
                  onOpen={setSelectedInvoiceId}
                />
              ) : (
                <div className="p-4">
                  <EmptyState
                    body="Create a draft invoice when a client has billable services."
                    title="No invoices yet"
                  />
                </div>
              )}
            </Panel>
          ) : null}

          {view === "approvals" ? (
            <CorrectionApprovalQueue
              canApprove={workspace.capabilities.canApproveCorrection}
              onChanged={() => refresh("Correction decision saved.")}
              refreshKey={refreshKey}
            />
          ) : null}

          {view === "reconciliation" ? (
            <ReconciliationWorkspace
              canReconcile={workspace.capabilities.canReconcile}
              refreshKey={refreshKey}
            />
          ) : null}

          {selectedInvoiceId ? (
            <InvoiceDetailDrawer
              capabilities={
                workspace.invoices.find(
                  (invoice) => invoice.id === selectedInvoiceId,
                )?.capabilities ?? {
                  canCreateDraft: false,
                  canIssue: false,
                  canRecordPayment: false,
                  canInitiateCorrection: false,
                  canApproveCorrection: false,
                  canReconcile: false,
                }
              }
              invoiceId={selectedInvoiceId}
              onClose={() => setSelectedInvoiceId(null)}
              onIssue={async (invoice) => {
                const existingKey = issueAttempts.current.get(invoice.id);
                const key =
                  existingKey ??
                  (typeof crypto !== "undefined" && "randomUUID" in crypto
                    ? crypto.randomUUID()
                    : `issue-${Date.now()}-${Math.random().toString(36).slice(2)}`);
                issueAttempts.current.set(invoice.id, key);
                await issueFinanceInvoice(invoice.id, key);
                issueAttempts.current.delete(invoice.id);
                refresh("Invoice issued and its snapshot is now frozen.");
              }}
              onRecordPayment={(invoice) => {
                setSelectedInvoiceId(null);
                setPaymentInvoice(invoice);
              }}
              onStartCorrection={(target) => {
                setSelectedInvoiceId(null);
                setCorrectionTarget(target);
              }}
              refreshKey={refreshKey}
            />
          ) : null}

          {correctionTarget ? (
            <FinancialCorrectionDrawer
              onBack={() => {
                setSelectedInvoiceId(correctionTarget.invoice.id);
                setCorrectionTarget(null);
              }}
              onClose={() => setCorrectionTarget(null)}
              onSubmitted={(correction) => {
                setCorrectionTarget(null);
                refresh(
                  correction.status === "PendingApproval"
                    ? "Correction requested and sent for independent approval."
                    : "Correction recorded in the financial ledger.",
                );
              }}
              target={correctionTarget}
            />
          ) : null}

          {creatingInvoice ? (
            <CreateInvoiceDrawer
              locations={data.locations
                .filter(
                  (location) =>
                    location.isActive &&
                    (workspace.createLocationIds === null ||
                      workspace.createLocationIds.includes(location.id)),
                )
                .map(({ id, name }) => ({ id, name }))}
              onClose={() => setCreatingInvoice(false)}
              onCreated={(invoiceId) => {
                setCreatingInvoice(false);
                setSelectedInvoiceId(invoiceId);
                refresh("Draft invoice created.");
              }}
            />
          ) : null}

          {paymentInvoice ? (
            <RecordPaymentDrawer
              invoice={paymentInvoice}
              onClose={() => setPaymentInvoice(null)}
              onRecorded={() => {
                setPaymentInvoice(null);
                setSelectedInvoiceId(paymentInvoice.id);
                refresh("Payment recorded after server confirmation.");
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function FinanceWorkspaceSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4" role="status">
      <span className="sr-only">Loading finance workspace</span>
      <div className="grid animate-pulse gap-3 sm:grid-cols-2 xl:grid-cols-5 motion-reduce:animate-none">
        {[0, 1, 2, 3, 4].map((item) => (
          <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" key={item}>
            <div className="h-3 w-24 rounded bg-[color:rgba(112,140,151,0.16)]" />
            <div className="h-7 w-32 rounded bg-[color:rgba(112,140,151,0.20)]" />
          </div>
        ))}
      </div>
      <div className="animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 motion-reduce:animate-none">
        <div className="mb-5 h-10 w-full max-w-md rounded bg-[color:rgba(112,140,151,0.14)]" />
        {[0, 1, 2, 3, 4].map((item) => (
          <div className="flex items-center gap-4 border-b border-[var(--border)] py-4" key={item}>
            <div className="h-4 w-24 rounded bg-[color:rgba(112,140,151,0.16)]" />
            <div className="h-4 flex-1 rounded bg-[color:rgba(112,140,151,0.12)]" />
            <div className="h-8 w-20 rounded bg-[color:rgba(112,140,151,0.14)]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Summary({
  label,
  money = true,
  value,
}: {
  label: string;
  money?: boolean;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white p-4">
      <p className="text-xs font-semibold text-[var(--text-muted)]">{label}</p>
      <p className="mt-2 text-lg font-bold tabular-nums">
        {money ? formatNpr(value) : value}
      </p>
    </div>
  );
}

function ViewButton({
  active,
  badge,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  badge?: number;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold transition ${
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
          : "text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
      }`}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
      {badge ? (
        <span className="rounded-full bg-[var(--danger)] px-1.5 py-0.5 text-[10px] leading-none text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
