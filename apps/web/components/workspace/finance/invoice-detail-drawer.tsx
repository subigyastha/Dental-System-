"use client";

import { ArrowDownLeft, CreditCard, RefreshCw, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { Drawer } from "@/components/workspace/elements";
import { loadFinanceInvoice } from "@/lib/finance-api";
import {
  canRecordPaymentForStatus,
  formatNpr,
  maskFinanceReference,
  type FinanceCapabilities,
  type FinanceInvoiceDetail,
  type FinanceLedgerEntry,
} from "@/lib/finance-domain";
import { isAbortedRequest, requestErrorMessage } from "@/lib/request-error";

import { formatFinanceDate, InvoiceStatus } from "./invoice-ledger";

export type CorrectionTarget = {
  invoice: FinanceInvoiceDetail;
  payment: FinanceLedgerEntry;
};

export function InvoiceDetailDrawer({
  capabilities,
  invoiceId,
  onClose,
  onIssue,
  onRecordPayment,
  onStartCorrection,
  refreshKey,
}: {
  capabilities: FinanceCapabilities;
  invoiceId: string;
  onClose: () => void;
  onIssue: (invoice: FinanceInvoiceDetail) => Promise<void>;
  onRecordPayment: (invoice: FinanceInvoiceDetail) => void;
  onStartCorrection: (target: CorrectionTarget) => void;
  refreshKey: number;
}) {
  const [invoice, setInvoice] = useState<FinanceInvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const [issuing, setIssuing] = useState(false);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const effectiveCapabilities = invoice?.capabilities ?? capabilities;

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void loadFinanceInvoice(invoiceId, controller.signal)
      .then(setInvoice)
      .catch((cause: unknown) => {
        if (!isAbortedRequest(cause)) {
          setError(
            requestErrorMessage(cause, "The invoice could not be loaded."),
          );
        }
      });
    return () => controller.abort();
  }, [invoiceId, loadKey, refreshKey]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  return (
    <Drawer
      context="Issued invoice snapshots and completed receipts are immutable."
      onClose={onClose}
      title={invoice?.invoiceNumber ?? "Invoice details"}
      width="wide"
    >
      {!invoice && !error ? (
        <div aria-live="polite" className="py-16 text-center text-sm text-[var(--text-muted)]">
          Loading invoice ledger…
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
            onClick={() => setLoadKey((current) => current + 1)}
            variant="secondary"
          >
            <RefreshCw aria-hidden="true" size={15} />
            Retry
          </Button>
        </div>
      ) : null}
      {invoice ? (
        <div className="space-y-5">
          <section className="rounded-lg border border-[var(--border)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{invoice.clientName}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {invoice.clientCode ?? "Client code unavailable"}
                </p>
              </div>
              <InvoiceStatus status={invoice.status} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MoneyStat label="Total" value={invoice.totalNpr} />
              <MoneyStat label="Paid" value={invoice.paidNpr} />
              <MoneyStat label="Corrected" value={invoice.correctedNpr} />
              <MoneyStat label="Balance" value={invoice.balanceNpr} strong />
            </dl>
            <div className="mt-4 flex flex-col gap-2 border-t border-[var(--border)] pt-4 sm:flex-row">
              {effectiveCapabilities.canIssue && invoice.status === "Draft" ? (
                <Button
                  className="min-h-11"
                  loading={issuing}
                  loadingLabel="Issuing invoice"
                  onClick={async () => {
                    setIssuing(true);
                    setError(null);
                    try {
                      await onIssue(invoice);
                    } catch (cause) {
                      setError(
                        requestErrorMessage(cause, "The invoice could not be issued."),
                      );
                    } finally {
                      setIssuing(false);
                    }
                  }}
                >
                  <Send aria-hidden="true" size={15} />
                  Issue invoice
                </Button>
              ) : null}
              {effectiveCapabilities.canRecordPayment &&
              canRecordPaymentForStatus(invoice.status) &&
              Number(invoice.balanceNpr) > 0 ? (
                <Button
                  className="min-h-11"
                  onClick={() => onRecordPayment(invoice)}
                  variant="secondary"
                >
                  <CreditCard aria-hidden="true" size={15} />
                  Record payment
                </Button>
              ) : null}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold">Frozen invoice snapshot</h3>
            <div className="mt-2 overflow-hidden rounded-lg border border-[var(--border)]">
              {invoice.lineItems.map((item) => (
                <div
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-[var(--border)] px-4 py-3 text-sm last:border-b-0"
                  key={item.id}
                >
                  <div>
                    <p className="font-medium">{item.description}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {item.quantity} × {formatNpr(item.unitPriceNpr)}
                    </p>
                  </div>
                  <p className="text-right font-semibold tabular-nums">
                    {formatNpr(item.lineTotalNpr)}
                  </p>
                </div>
              ))}
              {!invoice.lineItems.length ? (
                <p className="p-4 text-sm text-[var(--text-muted)]">
                  No line items were returned.
                </p>
              ) : null}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold">Payment and correction ledger</h3>
            <div className="mt-2 space-y-2">
              {invoice.ledger.map((entry) => {
                const canCorrect =
                  effectiveCapabilities.canInitiateCorrection &&
                  entry.type === "PaymentCompleted" &&
                  entry.paymentId &&
                  Number(entry.correctableNpr ?? entry.amountNpr) > 0;
                return (
                  <article
                    className="rounded-lg border border-[var(--border)] p-4"
                    key={entry.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          {ledgerEntryLabel(entry.type)}
                        </p>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          {formatFinanceDate(entry.occurredAtIso)} · {entry.status}
                        </p>
                        {entry.method ? (
                          <p className="mt-1 text-xs text-[var(--text-muted)]">
                            {entry.method} · {maskFinanceReference(entry.reference)}
                          </p>
                        ) : null}
                        {entry.reason ? (
                          <p className="mt-2 text-sm">{entry.reason}</p>
                        ) : null}
                      </div>
                      <p className="shrink-0 text-right font-semibold tabular-nums">
                        {formatNpr(entry.amountNpr)}
                      </p>
                    </div>
                    {canCorrect ? (
                      <Button
                        className="mt-3 min-h-11 w-full sm:w-auto"
                        onClick={() => onStartCorrection({ invoice, payment: entry })}
                        variant="secondary"
                      >
                        <ArrowDownLeft aria-hidden="true" size={15} />
                        Refund or reverse
                      </Button>
                    ) : null}
                  </article>
                );
              })}
              {!invoice.ledger.length ? (
                <p className="rounded-lg bg-[var(--surface-muted)] p-4 text-sm text-[var(--text-muted)]">
                  No financial ledger events were returned.
                </p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}

function MoneyStat({
  label,
  strong = false,
  value,
}: {
  label: string;
  strong?: boolean;
  value: string;
}) {
  return (
    <div>
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
      <dd
        className={`mt-1 tabular-nums ${strong ? "font-bold text-[var(--accent-strong)]" : "font-semibold"}`}
      >
        {formatNpr(value)}
      </dd>
    </div>
  );
}

function ledgerEntryLabel(type: string) {
  return type
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (value) => value.toUpperCase());
}
