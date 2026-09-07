"use client";

import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui";
import { EmptyState } from "@/components/workspace/elements";
import {
  formatNpr,
  type FinanceInvoiceRow,
} from "@/lib/finance-domain";

export function InvoiceLedger({
  invoices,
  onOpen,
}: {
  invoices: FinanceInvoiceRow[];
  onOpen: (invoiceId: string) => void;
}) {
  if (!invoices.length) {
    return (
      <div className="p-4">
        <EmptyState
          body="No invoices match the current Finance view."
          title="No invoices"
        />
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--border)]">
      {invoices.map((invoice) => (
        <article
          className="grid gap-3 px-4 py-4 transition hover:bg-[var(--surface-muted)] md:grid-cols-[minmax(0,1.2fr)_minmax(150px,.7fr)_minmax(160px,.8fr)_auto] md:items-center"
          key={invoice.id}
        >
          <div className="min-w-0">
            <button
              className="block min-h-11 w-full text-left"
              onClick={() => onOpen(invoice.id)}
              type="button"
            >
              <span className="block truncate font-semibold text-[var(--foreground)]">
                {invoice.invoiceNumber}
              </span>
              <span className="mt-1 block truncate text-sm text-[var(--text-muted)]">
                {invoice.clientName}
                {invoice.clientCode ? ` · ${invoice.clientCode}` : ""}
              </span>
            </button>
          </div>
          <div className="text-sm">
            <InvoiceStatus status={invoice.status} />
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              {invoice.dueAtIso
                ? `Due ${formatFinanceDate(invoice.dueAtIso)}`
                : `Issued ${formatFinanceDate(invoice.issuedAtIso)}`}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm md:block md:text-right">
            <div>
              <dt className="text-xs text-[var(--text-muted)]">Total</dt>
              <dd className="font-semibold tabular-nums">
                {formatNpr(invoice.totalNpr)}
              </dd>
            </div>
            <div className="md:mt-1">
              <dt className="text-xs text-[var(--text-muted)]">Balance</dt>
              <dd className="font-semibold tabular-nums text-[var(--accent-strong)]">
                {formatNpr(invoice.balanceNpr)}
              </dd>
            </div>
          </dl>
          <Button
            className="min-h-11 justify-self-stretch md:justify-self-end"
            onClick={() => onOpen(invoice.id)}
            variant="secondary"
          >
            Details
            <ChevronRight aria-hidden="true" size={15} />
          </Button>
        </article>
      ))}
    </div>
  );
}

export function InvoiceStatus({
  status,
}: {
  status: FinanceInvoiceRow["status"];
}) {
  const tone = {
    Draft: "bg-[var(--surface-muted)] text-[var(--text-muted)]",
    Issued: "bg-sky-50 text-sky-800",
    PartiallyPaid: "bg-amber-50 text-amber-900",
    Paid: "bg-emerald-50 text-emerald-800",
    Cancelled: "bg-rose-50 text-rose-800",
    Void: "bg-rose-50 text-rose-800",
  }[status];
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {status === "PartiallyPaid" ? "Partially paid" : status}
    </span>
  );
}

export function formatFinanceDate(value: string) {
  return new Intl.DateTimeFormat("en-NP", {
    dateStyle: "medium",
    timeZone: "Asia/Kathmandu",
  }).format(new Date(value));
}
