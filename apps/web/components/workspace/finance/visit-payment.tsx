"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { KoiSectionLoader } from "@/components/koi-loader";
import { Drawer, EmptyState } from "../elements";
import { useWorkspaceApp } from "../app-state";
import { CreateInvoiceDrawer } from "./create-invoice-drawer";
import { RecordPaymentDrawer } from "./record-payment-drawer";
import { loadFinanceInvoice, loadFinanceWorkspace, issueFinanceInvoice } from "@/lib/finance-api";
import { canRecordPaymentForStatus, formatNpr, type FinanceInvoiceDetail, type FinanceWorkspaceData } from "@/lib/finance-domain";
import { isAbortedRequest, requestErrorMessage } from "@/lib/request-error";

export function VisitPaymentButton({ appointmentId, clientId, clientName, description }: {
  appointmentId: string; clientId: string; clientName: string; description: string;
}) {
  const [open, setOpen] = useState(false);
  return <><Button variant="secondary" onClick={() => setOpen(true)}>Log payment</Button>{open ? <VisitPaymentDrawer appointmentId={appointmentId} clientId={clientId} clientName={clientName} description={description} onClose={() => setOpen(false)} /> : null}</>;
}

function VisitPaymentDrawer({ appointmentId, clientId, clientName, description, onClose }: {
  appointmentId: string; clientId: string; clientName: string; description: string; onClose: () => void;
}) {
  const { workspaceBootstrap } = useWorkspaceApp();
  const [data, setData] = useState<FinanceWorkspaceData | null>(null);
  const [invoice, setInvoice] = useState<FinanceInvoiceDetail | null>(null);
  const [paying, setPaying] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const issueKey = useRef<string | null>(null);
  const actionLock = useRef(false);
  const invoiceSummaryRef = useRef<HTMLElement | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (invoice) invoiceSummaryRef.current?.focus(); }, [invoice]);
  useEffect(() => {
    const controller = new AbortController(); setError(null); setData(null);
    void loadFinanceWorkspace({ clientId, appointmentId, signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(cause => { if (!isAbortedRequest(cause)) setError(requestErrorMessage(cause, "Visit invoices could not be loaded.")); });
    return () => controller.abort();
  }, [clientId, appointmentId, revision]);
  async function selectInvoice(id: string) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError(null);
    try { const selected = await loadFinanceInvoice(id); if (mounted.current) { setInvoice(selected); issueKey.current = null; } }
    catch (cause) { if (mounted.current) setError(requestErrorMessage(cause, "Invoice could not be loaded.")); }
    finally { actionLock.current = false; if (mounted.current) setBusy(false); }
  }
  async function issue() {
    if (!invoice || actionLock.current) return;
    actionLock.current = true; setBusy(true); setError(null);
    try {
      issueKey.current ??= crypto.randomUUID(); await issueFinanceInvoice(invoice.id, issueKey.current);
      const updated = await loadFinanceInvoice(invoice.id); if (mounted.current) { setInvoice(updated); setRevision(value => value + 1); }
    } catch (cause) { if (mounted.current) setError(requestErrorMessage(cause, "Invoice issue was not confirmed. Retry this action.")); }
    finally { actionLock.current = false; if (mounted.current) setBusy(false); }
  }
  const locationId = data?.visitContext?.locationId;
  const locations = workspaceBootstrap.locations.filter(location => location.id === locationId && (!data?.createLocationIds || data.createLocationIds.includes(location.id)));
  if (creating && locationId) return <CreateInvoiceDrawer locations={locations} preset={{ clientId, clientName, appointmentId, locationId, description }} onClose={() => setCreating(false)} onCreated={id => { setCreating(false); setRevision(value => value + 1); void selectInvoice(id); }} />;
  if (paying && invoice) return <RecordPaymentDrawer invoice={invoice} onClose={() => setPaying(false)} onRecorded={() => { window.dispatchEvent(new CustomEvent("clinicflow:client-changed", { detail: { clientId } })); onClose(); }} />;
  return <Drawer title="Visit payment" context={clientName + " · " + description} onClose={onClose} closeDisabled={busy}>
    <div className="space-y-4">
      {error ? <EmptyState title="Payment action unavailable" body={error} actionLabel="Retry" onAction={() => setRevision(value => value + 1)} /> : null}
      {!data && !error ? <KoiSectionLoader label="Loading visit invoices" /> : null}
      {invoice ? <section ref={invoiceSummaryRef} tabIndex={-1} className="space-y-3 rounded-lg border border-[var(--border)] p-4"><p className="font-semibold">{invoice.invoiceNumber} · {invoice.status}</p><p>Balance: {formatNpr(invoice.balanceNpr)}</p>
        {invoice.status === "Draft" ? <><p className="text-sm text-[var(--text-muted)]">{invoice.capabilities.canIssue ? "Issue this invoice before recording money received." : "An owner, admin or finance staff member must issue this invoice before reception can record payment."}</p>{invoice.capabilities.canIssue ? <Button loading={busy} onClick={() => void issue()}>Issue invoice</Button> : null}</> : invoice.capabilities.canRecordPayment && canRecordPaymentForStatus(invoice.status) && Number(invoice.balanceNpr) > 0 ? <Button onClick={() => setPaying(true)}>Record payment</Button> : <p className="text-sm text-[var(--text-muted)]">{Number(invoice.balanceNpr) <= 0 ? "No payment is due on this invoice." : "This invoice cannot receive a payment."}</p>}
      </section> : null}
      {data ? <><div className="divide-y divide-[var(--border)]">{data.invoices.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="text-sm"><p className="font-medium">{row.invoiceNumber} · {row.status}</p><p>Balance: {formatNpr(row.balanceNpr)}</p></div><Button disabled={busy} variant="secondary" onClick={() => void selectInvoice(row.id)}>Open invoice</Button></div>)}</div>
        {!data.invoices.length ? <p className="text-sm">No invoice is linked to this visit. Create one before recording payment.</p> : null}
        {data.capabilities.canCreateDraft && locations.length && !data.invoices.length ? <Button onClick={() => setCreating(true)}>Create visit invoice</Button> : null}
        {!locationId ? <p className="text-sm text-[var(--text-muted)]">A clinic location is required to create a visit invoice.</p> : null}
      </> : null}
    </div>
  </Drawer>;
}

export function ClientPaymentHistory({ clientId }: { clientId: string }) {
  const [data, setData] = useState<FinanceWorkspaceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError(null);
    void loadFinanceWorkspace({ clientId, signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(cause => { if (!isAbortedRequest(cause)) setError(requestErrorMessage(cause, "Payment history could not be loaded.")); });
    return () => controller.abort();
  }, [clientId, revision]);
  if (error) return <EmptyState title="Payment history unavailable" body={error} actionLabel="Retry" onAction={() => setRevision(value => value + 1)} />;
  if (!data) return <KoiSectionLoader label="Loading payment history" />;
  return <div className="space-y-3"><p className="text-sm text-[var(--text-muted)]">Latest 50 payments from recent invoices. Outstanding balance: {formatNpr(data.summary.outstandingNpr)}</p>
    {data.paymentHistory?.length ? <div className="max-w-full overflow-x-auto"><table className="w-full table-fixed text-left text-sm"><caption className="sr-only">Client payment history</caption><thead className="bg-[var(--surface-muted)]"><tr><th scope="col" className="px-3 py-3">Received<span className="sm:hidden"> / invoice</span></th><th scope="col" className="hidden px-3 py-3 sm:table-cell">Invoice</th><th scope="col" className="px-3 py-3">Amount / method</th><th scope="col" className="hidden px-3 py-3 sm:table-cell">Status</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{data.paymentHistory.map(row => <tr key={row.id}><td className="break-words px-3 py-3">{new Date(row.paidAtIso).toLocaleDateString("en-NP", { timeZone: "Asia/Kathmandu" })}<p className="mt-1 break-all text-xs sm:hidden">{row.invoiceNumber}</p></td><td className="hidden break-all px-3 py-3 sm:table-cell">{row.invoiceNumber}</td><td className="break-words px-3 py-3">{formatNpr(row.amountNpr)}<p className="text-xs text-[var(--text-muted)]">{row.method}</p><p className="mt-1 text-xs sm:hidden">{row.status}</p></td><td className="hidden break-words px-3 py-3 sm:table-cell">{row.status}</td></tr>)}</tbody></table></div> : <p className="text-sm text-[var(--text-muted)]">No payments in recent invoices.</p>}
  </div>;
}
