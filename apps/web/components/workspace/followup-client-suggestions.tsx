"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Panel } from "@/components/ui";
import { KoiSectionLoader } from "@/components/koi-loader";
import { apiFetchJson } from "@/lib/api-client";
import { isAbortedRequest, requestErrorMessage } from "@/lib/request-error";
import { contactAge, followupDateLabel } from "@/lib/staff-followup";
import { EmptyState, Field, inputClassName } from "./elements";
import { StaffFollowupActions } from "./staff-followup-actions";
import { DataTable } from "./data-table";

export type FollowupClient = { customerId: string; name: string; phone: string; code: string | null; canManage: boolean;
  visit: { id: string; atIso: string; label: string; provider: string } | null;
  lastAttemptAtIso: string | null; lastReachedAtIso: string | null; nextContactAtIso: string | null; upcomingVisitAtIso: string | null };
type PlannedFollowup = { id: string; appointmentId: string | null; dueAtIso: string; dateOnly?: boolean | null; updatedAtIso: string; reason: string; canManage: boolean };
export type FollowupClientWithPlan = FollowupClient & { upcomingFollowup?: PlannedFollowup | null };
type Clients = { items: FollowupClientWithPlan[]; history: Array<{ id: string; label: string; atIso: string; actor: string; dueAtIso: string | null; responseText?: string | null; note?: string | null; channel?: string | null }>; page: { hasMore: boolean; nextCursor: string | null } };

export function FollowupClientSuggestions({ customerId, appointmentId, preset }: { customerId?: string; appointmentId?: string; preset?: "recent" | "all" | "not_contacted" }) {
  const [selectedView, setView] = useState("recent");
  const view = preset ?? selectedView;
  const [daysInput, setDaysInput] = useState("30");
  const [days, setDays] = useState(30);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Clients | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const params = new URLSearchParams({ view, query });
  if (view === "not_contacted") params.set("uncontactedDays", String(days));
  if (customerId) params.set("customerId", customerId);
  if (appointmentId) params.set("appointmentId", appointmentId);
  const path = "/followups/clients?" + params.toString();
  useEffect(() => {
    const refresh = () => { setCursor(null); setRevision(value => value + 1); };
    const focus = () => { if (!document.querySelector('[role="dialog"]')) refresh(); };
    window.addEventListener("clinicflow:followup-changed", refresh); window.addEventListener("focus", focus);
    window.addEventListener("clinicflow:client-changed", refresh);
    return () => { window.removeEventListener("clinicflow:followup-changed", refresh); window.removeEventListener("focus", focus); window.removeEventListener("clinicflow:client-changed", refresh); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setError(null); setLoadingMore(Boolean(cursor)); if (!cursor) setData(null);
    const timer = window.setTimeout(() => {
      void apiFetchJson<Clients>(path + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""), { signal: controller.signal }).then(result => {
        if (!controller.signal.aborted) setData(current => cursor && current ? { ...result, items: [...current.items, ...result.items.filter(item => !current.items.some(old => old.customerId === item.customerId))] } : result);
      }).catch(cause => { if (!isAbortedRequest(cause)) setError(requestErrorMessage(cause, "Unable to load clients.")); }).finally(() => { if (!controller.signal.aborted) setLoadingMore(false); });
    }, query ? 200 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [path, cursor, revision, query]);
  const compact = Boolean(customerId || appointmentId);
  return <section className="min-w-0 space-y-3">
    {!compact ? <><h2 className="font-semibold">{view === "not_contacted" ? "Clients not contacted" : view === "recent" ? "Recent completed visits" : "Choose a client"}</h2><p className="text-sm text-[var(--text-muted)]">{view === "not_contacted" ? `No successful conversation or reply in the past ${days} days, or none recorded. Unanswered attempts are shown separately.` : "Choose a client to log contact or schedule a follow-up. Recent visits cover the past 30 days."}</p>
      <div className="flex flex-wrap items-end gap-3">{!preset ? <div className="flex gap-2">{[["recent", "Recent visits"], ["all", "All clients"]].map(([key, label]) => <Button key={key} variant={view === key ? "primary" : "secondary"} onClick={() => { setCursor(null); setView(key); }}>{label}</Button>)}</div> : null}
      {view === "not_contacted" ? <form className="flex items-end gap-2" onSubmit={event => { event.preventDefault(); const value = Number(daysInput); if (!Number.isInteger(value) || value < 1 || value > 3650) { setError("Choose between 1 and 3650 days."); return; } setCursor(null); setDays(value); setError(null); }}><Field label="Days without contact"><input className={inputClassName + " max-w-28"} type="number" min={1} max={3650} required value={daysInput} onChange={event => setDaysInput(event.target.value)} /></Field><Button type="submit" variant="secondary">Apply</Button></form> : null}
      <Field label="Search clients"><input maxLength={100} className={inputClassName} value={query} onChange={event => { setCursor(null); setQuery(event.target.value); }} placeholder="Name or phone" /></Field></div></> : null}
    {error ? <EmptyState title="Client check-ins unavailable" body={error} actionLabel="Retry" onAction={() => { setCursor(null); setRevision(value => value + 1); }} /> : !data ? <KoiSectionLoader label="Loading client check-ins" /> : !data.items.length ? <p className="text-sm text-[var(--text-muted)]">{query ? "No matching clients." : view === "not_contacted" ? "No clients match this contact interval." : "No completed visits in the past 30 days. Use New follow-up to choose another client."}</p> : <>
      {compact ? data.items.map(client => <FollowupSummary key={client.customerId} client={client} showRecency={!appointmentId} />) : <Panel><FollowupClientTable items={data.items} /></Panel>}
      {data.page.hasMore ? <Button variant="secondary" loading={loadingMore} onClick={() => setCursor(data.page.nextCursor)}>Load more clients</Button> : null}
      {customerId ? <div className="border-t border-[var(--border)] pt-3"><h3 className="mb-3 text-sm font-semibold">Follow-up timeline</h3>{data.history.length ? <ol className="space-y-3">{data.history.map(item => <li key={item.id} className="border-l-2 border-[var(--border)] pl-3 text-sm"><p>{item.label}{item.dueAtIso ? " · " + followupDateLabel(item.dueAtIso) : ""}</p>{item.responseText ? <p className="mt-1 whitespace-pre-wrap text-[var(--text-muted)]">{item.responseText}</p> : null}{item.note ? <p className="mt-1 whitespace-pre-wrap text-[var(--text-muted)]">Staff note: {item.note}</p> : null}<p className="text-xs text-[var(--text-muted)]">{followupDateLabel(item.atIso)} · {item.actor}{item.channel && item.channel !== "unknown" ? " · " + item.channel : ""}</p></li>)}</ol> : <p className="text-sm text-[var(--text-muted)]">No follow-up activity recorded.</p>}</div> : null}
    </>}
  </section>;
}

export function FollowupSummary({ client, showRecency = false }: { client: FollowupClientWithPlan; showRecency?: boolean }) {
  const context = { customerId: client.customerId, appointmentId: client.visit?.id, name: client.name };
  const plan = client.upcomingFollowup;
  const scheduleContext = plan?.canManage ? { ...context, appointmentId: plan.appointmentId, taskId: plan.id, dueAtIso: plan.dueAtIso, dateOnly: plan.dateOnly, updatedAtIso: plan.updatedAtIso, reason: plan.reason } : undefined;
  return <div className="space-y-3 text-sm">
    {plan ? <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="font-medium">Next follow-up: {followupDateLabel(plan.dueAtIso, plan.dateOnly)}</p><p className="mt-1 text-[var(--text-muted)]">{plan.reason}</p></div> : <p className="text-[var(--text-muted)]">No upcoming follow-up. Schedule one when needed.</p>}
    {client.nextContactAtIso && (!plan || client.nextContactAtIso !== plan.dueAtIso) ? <p>Earlier reminder: {followupDateLabel(client.nextContactAtIso)} · <Link className="text-[var(--accent)] underline" href="/followups">Review follow-ups</Link></p> : null}
    {showRecency ? <div className="space-y-1"><p>Last attempt: {contactAge(client.lastAttemptAtIso)}</p><p>Last spoke to client: {contactAge(client.lastReachedAtIso)}</p></div> : null}
    <StaffFollowupActions context={context} scheduleContext={scheduleContext} canManage={client.canManage} />
  </div>;
}

function ContactRecency({ client }: { client: FollowupClient }) {
  return <div className="space-y-1 text-sm"><p>Last attempt: {contactAge(client.lastAttemptAtIso)}</p><p>Last spoke to client: {contactAge(client.lastReachedAtIso)}</p>{client.nextContactAtIso ? <p>Planned follow-up: {followupDateLabel(client.nextContactAtIso)}</p> : <p className="text-[var(--text-muted)]">No follow-up scheduled</p>}</div>;
}

export function FollowupClientTable({ items }: { items: FollowupClient[] }) {
  return <DataTable caption="Client check-in suggestions; these are not scheduled reminders" columns={[
    { key: "client", label: "Client" }, { key: "visit", label: "Last completed visit / return", className: "hidden sm:table-cell" },
    { key: "history", label: "Contact history", className: "hidden sm:table-cell" }, { key: "actions", label: "Actions" },
  ]}>{items.map(client => <tr key={client.customerId}><td className="break-words px-3 py-4 align-top sm:px-4"><Link href={"/clients/" + encodeURIComponent(client.customerId)} className="font-medium text-[var(--accent)] underline">{client.name}</Link><p className="mt-1">{client.phone || "No phone recorded"}</p><p className="text-xs text-[var(--text-muted)]">{client.code}</p><div className="mt-3 space-y-2 text-xs sm:hidden">{client.visit ? <p>{client.visit.label} · {contactAge(client.visit.atIso)}</p> : <p>No completed visit recorded</p>}<p>{client.upcomingVisitAtIso ? "Returning: " + followupDateLabel(client.upcomingVisitAtIso) : "No upcoming appointment"}</p><ContactRecency client={client} /></div></td>
      <td className="hidden break-words px-4 py-4 align-top sm:table-cell">{client.visit ? <><p>{client.visit.label}</p><p className="mt-1">{followupDateLabel(client.visit.atIso)} · {contactAge(client.visit.atIso)}</p><p className="text-xs text-[var(--text-muted)]">{client.visit.provider}</p></> : <p>No completed visit recorded</p>}<p className="mt-2 text-xs">{client.upcomingVisitAtIso ? "Returning: " + followupDateLabel(client.upcomingVisitAtIso) : "No upcoming appointment"}</p></td>
      <td className="hidden break-words px-4 py-4 align-top sm:table-cell"><ContactRecency client={client} /></td><td className="px-3 py-4 align-top sm:px-4"><StaffFollowupActions context={{ customerId: client.customerId, appointmentId: client.visit?.id, name: client.name }} canManage={client.canManage} /></td></tr>)}
  </DataTable>;
}
