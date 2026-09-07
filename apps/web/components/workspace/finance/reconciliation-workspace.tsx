"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { DualDateDisplay } from "@/components/calendar-ui";
import { Button, Panel } from "@/components/ui";
import { EmptyState, Field, inputClassName } from "@/components/workspace/elements";
import { loadFinanceReconciliation } from "@/lib/finance-api";
import {
  formatNpr,
  maskFinanceReference,
  type FinanceReconciliation,
} from "@/lib/finance-domain";
import { isAbortedRequest, requestErrorMessage } from "@/lib/request-error";

import { formatFinanceDate } from "./invoice-ledger";

export function ReconciliationWorkspace({
  canReconcile,
  refreshKey,
}: {
  canReconcile: boolean;
  refreshKey: number;
}) {
  const [date, setDate] = useState(todayInNepal());
  const [data, setData] = useState<FinanceReconciliation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    if (!canReconcile) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void loadFinanceReconciliation({ date, signal: controller.signal })
      .then(setData)
      .catch((cause: unknown) => {
        if (!isAbortedRequest(cause)) {
          setData(null);
          setError(
            requestErrorMessage(
              cause,
              "The reconciliation view could not be loaded.",
            ),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canReconcile, date, loadKey, refreshKey]);

  if (!canReconcile) {
    return (
      <EmptyState
        body="Receptionists may record eligible payments but cannot reconcile financial settlements."
        title="Reconciliation permission required"
      />
    );
  }

  return (
    <div className="space-y-5">
      <Panel title="Daily reconciliation">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between">
          <Field label="Reconciliation date (AD)">
            <input
              className={inputClassName}
              onChange={(event) => setDate(event.target.value)}
              type="date"
              value={date}
            />
          </Field>
          <div className="flex items-center gap-3">
            <DualDateDisplay adDateKey={date} mode="AD" variant="short" />
            <Button
              className="min-h-11"
              disabled={loading}
              onClick={() => setLoadKey((value) => value + 1)}
              variant="secondary"
            >
              <RefreshCw aria-hidden="true" size={15} />
              Refresh
            </Button>
          </div>
        </div>
      </Panel>

      {loading && !data ? (
        <p aria-live="polite" className="p-6 text-center text-sm text-[var(--text-muted)]">
          Loading reconciliation…
        </p>
      ) : null}
      {error ? (
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
      ) : null}
      {data ? (
        <>
          <section
            aria-label="Reconciliation totals"
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
          >
            <Summary label="Issued" value={data.totals.issuedNpr} />
            <Summary label="Collected" value={data.totals.collectedNpr} />
            <Summary label="Corrected" value={data.totals.correctedNpr} />
            <Summary label="Outstanding" value={data.totals.outstandingNpr} />
            <Summary
              label="Cash expected"
              value={data.totals.cashExpectedNpr ?? "0.00"}
            />
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="Collections by method">
              {data.byMethod.length ? (
                <div className="divide-y divide-[var(--border)]">
                  {data.byMethod.map((item) => (
                    <div
                      className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                      key={item.method}
                    >
                      <div>
                        <p className="font-medium">{item.method}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {item.paymentCount} payment
                          {item.paymentCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      <p className="font-semibold tabular-nums">
                        {formatNpr(item.amountNpr)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4">
                  <EmptyState
                    body="No completed collections were returned for this date."
                    title="No collections"
                  />
                </div>
              )}
            </Panel>

            <Panel title={`Exceptions · ${data.exceptions.length}`}>
              {data.exceptions.length ? (
                <div className="divide-y divide-[var(--border)]">
                  {data.exceptions.map((item) => (
                    <article className="px-4 py-3" key={item.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{item.summary}</p>
                          <p className="mt-1 text-xs text-[var(--text-muted)]">
                            {item.kind} · {item.status}
                          </p>
                          <p className="mt-1 text-xs text-[var(--text-muted)]">
                            {[item.invoiceNumber, maskFinanceReference(item.reference)]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {item.occurredAtIso ? (
                            <p className="mt-1 text-xs text-[var(--text-muted)]">
                              {formatFinanceDate(item.occurredAtIso)}
                            </p>
                          ) : null}
                        </div>
                        {item.amountNpr ? (
                          <p className="shrink-0 text-sm font-semibold tabular-nums">
                            {formatNpr(item.amountNpr)}
                          </p>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="p-4">
                  <EmptyState
                    body="No reconciliation exceptions need Finance attention."
                    title="No exceptions"
                  />
                </div>
              )}
            </Panel>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white p-4">
      <p className="text-xs font-semibold text-[var(--text-muted)]">{label}</p>
      <p className="mt-2 text-lg font-bold tabular-nums">{formatNpr(value)}</p>
    </div>
  );
}

function todayInNepal() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
