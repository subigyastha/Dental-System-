"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, Panel } from "@/components/ui";
import { KoiSectionLoader } from "@/components/koi-loader";
import { Drawer, EmptyState, Field, PageHeader, inputClassName } from "./elements";
import { useQuickBook } from "./quick-book-provider";
import { apiFetchJson } from "@/lib/api-client";
import { isAbortedRequest, requestErrorMessage } from "@/lib/request-error";
import { type FollowupResponse } from "@/lib/followup-work";
import { StaffFollowupDialog } from "./staff-followup-actions";
import { FollowupClientSuggestions } from "./followup-client-suggestions";
import { followupDateLabel } from "@/lib/staff-followup";
import { NewFollowupDrawer } from "./new-followup-drawer";
import { DataTable, DataTableControls, type TableSort } from "./data-table";

type Response = { label: string; note: string | null; atIso: string; nextContactAtIso: string | null; response?: string | null };
export type FollowupWorkTask = {
  id: string; customerId: string; appointmentId: string | null; type: string; status: string;
  summary: string; nextAction: string; dueAtIso: string; updatedAtIso: string; canManage: boolean;
  dateOnly?: boolean | null;
  client: { name: string; phone: string; code: string | null };
  visit: { startsAtIso: string; label: string | null; locationId: string | null; provider: string; providerId?: string } | null;
  lastResponse: Response | null;
};
type Queue = { items: FollowupWorkTask[]; total: number; statusCounts: Record<string, number>; page: { hasMore: boolean; nextCursor: string | null } };
type Detail = { task: FollowupWorkTask; history: Array<Response & { id: string; actor: string }>; hasOlderHistory: boolean; nextHistoryCursor: string | null };
export const followupStatuses = [["Open", "To contact"], ["InProgress", "In progress"], ["Waiting", "Waiting"], ["Blocked", "Provider review"], ["Done", "Done"]] as const;
const statusLabel = (status: string) => followupStatuses.find(([key]) => key === status)?.[1] ?? status;
const dateTime = followupDateLabel;
const taskType = (type: string) => type === "Recall" ? "Routine recall" : type === "TreatmentContinuation" ? "Post-visit follow-up" : type === "Reminder" ? "Client check-in" : "Visit recovery";

export function FollowupWorkQueue({ customerId, appointmentId, compact = false }: { customerId?: string; appointmentId?: string; compact?: boolean }) {
  const [layout, setLayout] = useState<"table" | "board">("table");
  const [status, setStatus] = useState("");
  const [period, setPeriod] = useState(appointmentId ? "future" : "");
  const [sort, setSort] = useState<TableSort>({ key: "due", direction: "asc" });
  const [discovery, setDiscovery] = useState<"recent" | "not_contacted">("recent");
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  const selectedTask = useRef<FollowupWorkTask | null>(null);
  const [selectedAction, setSelectedAction] = useState<"log" | "schedule" | "history">("log");
  const { canOpen: canBook, openQuickBook } = useQuickBook();
  const params = new URLSearchParams({ view: "all", query, sort: sort.key, direction: sort.direction });
  if (status) params.set("status", status);
  if (period) params.set("period", period);
  if (customerId) params.set("customerId", customerId);
  if (appointmentId) { params.set("appointmentId", appointmentId); params.set("purpose", "post_visit"); }
  const path = "/followups?" + params.toString();
  const startBooking = (task: FollowupWorkTask) => openQuickBook({ locationId: task.visit?.locationId ?? undefined,
    refs: { customerId: task.customerId, ...(task.visit?.providerId ? { providerId: task.visit.providerId } : {}) } });
  const openTask = (id: string, response?: FollowupResponse) => {
    const task = queue?.items.find(item => item.id === id);
    if (!task) return;
    selectedTask.current = task;
    setSelectedAction(task.status === "Done" || !task.canManage ? "history" : response === "reschedule" ? "schedule" : "log");
    setSelected(id);
  };

  useEffect(() => {
    const refresh = () => { setCursor(null); setRevision(n => n + 1); };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("clinicflow:client-changed", refresh);
    window.addEventListener("clinicflow:followup-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("clinicflow:client-changed", refresh); window.removeEventListener("clinicflow:followup-changed", refresh); window.removeEventListener("focus", refresh); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (!cursor) setQueue(null);
    setError(null); setLoadingMore(Boolean(cursor));
    const timer = window.setTimeout(() => {
      void apiFetchJson<Queue>(path + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""), { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) setQueue(current => cursor && current ? { ...result, items: [...current.items, ...result.items.filter(item => !current.items.some(existing => existing.id === item.id))] } : result); })
        .catch(cause => { if (!isAbortedRequest(cause)) setError(requestErrorMessage(cause, "Unable to load follow-ups.")); })
        .finally(() => { if (!controller.signal.aborted) setLoadingMore(false); });
    }, query ? 200 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [path, revision, cursor, query]);

  const changeSort = (value: TableSort) => { setCursor(null); setSort(value); };
  const reset = () => { setCursor(null); setQuery(""); setStatus(""); setPeriod(""); setSort({ key: "due", direction: "asc" }); };

  return <div className="min-w-0 space-y-4">
    {!compact ? <PageHeader title="Follow-ups" subtitle="Plan contact, see what needs attention, and record the result." action={<Button onClick={() => setCreating(true)}>New follow-up</Button>} /> : null}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-2" role="group" aria-label="Follow-up display">{([ ["table", "Table"], ["board", "Status board"] ] as const).map(([key, label]) => <button type="button" key={key} className={"min-h-10 rounded-md border px-3 text-sm font-medium " + (layout === key ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border)] bg-[var(--surface)]")} aria-pressed={layout === key} onClick={() => setLayout(key)}>{label}</button>)}</div>
    </div>
    <DataTableControls search={query} onSearch={value => { setCursor(null); setQuery(value); }} searchLabel="Search follow-ups" placeholder="Client, phone or reason" sort={sort} sortOptions={[{ value: "due", label: "Due date" }, { value: "client", label: "Client" }, { value: "status", label: "Status" }, { value: "updated", label: "Last updated" }]} onSort={changeSort} onReset={reset}>
      <Field label="Status"><select className={inputClassName} value={status} onChange={event => { setCursor(null); setStatus(event.target.value); }}><option value="">All statuses</option>{followupStatuses.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      <Field label="Due date"><select className={inputClassName} value={period} onChange={event => { setCursor(null); setPeriod(event.target.value); }}><option value="">Any date</option><option value="overdue">Overdue</option><option value="today">Today</option><option value="future">Upcoming</option></select></Field>
    </DataTableControls>
    {notice ? <p className="text-sm" ref={noticeRef} role="status" tabIndex={-1}>{notice}</p> : null}
    {error ? <EmptyState title="Follow-ups could not be loaded" body={error} actionLabel="Refresh list" onAction={() => { setCursor(null); setRevision(n => n + 1); }} /> : !queue ? <KoiSectionLoader label="Loading follow-ups" /> : <>
      <p className="text-sm text-[var(--text-muted)]" role="status">Showing {queue.items.length} of {queue.total} matching follow-ups</p>
      {!queue.items.length ? <EmptyState title="No matching follow-ups" body="Try another search or reset filters. Create a follow-up when needed." actionLabel="Reset filters" onAction={reset} /> : layout === "table" ? <Panel><FollowupWorkTable items={queue.items} sort={sort} onSort={changeSort} onOpen={openTask} onSchedule={id => openTask(id, "reschedule")} onHistory={id => { openTask(id); setSelectedAction("history"); }} onBook={canBook ? startBooking : undefined} /></Panel>
        : <FollowupStatusBoard items={queue.items} counts={queue.statusCounts} onOpen={openTask} onSchedule={id => openTask(id, "reschedule")} onBook={canBook ? startBooking : undefined} />}
      {queue.page.hasMore ? <Button loading={loadingMore} onClick={() => setCursor(queue.page.nextCursor)} variant="secondary">Load more follow-ups</Button> : null}
    </>}
    {!compact ? <details className="rounded-lg border border-[var(--border)] p-4" onToggle={event => setDiscoveryOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">Find clients to contact</summary><div className="mt-4 space-y-4"><div className="flex flex-wrap gap-2">{([ ["recent", "Recent visits"], ["not_contacted", "Not contacted"] ] as const).map(([key, label]) => <Button key={key} variant={discovery === key ? "primary" : "secondary"} onClick={() => setDiscovery(key)}>{label}</Button>)}</div>{discoveryOpen ? <FollowupClientSuggestions key={discovery} preset={discovery} /> : null}</div></details> : null}
    {creating ? <NewFollowupDrawer onClose={() => setCreating(false)} /> : null}
    {selected && selectedTask.current && selectedAction !== "history" ? <StaffFollowupDialog key={selected} action={selectedAction} context={{ customerId: selectedTask.current.customerId, appointmentId: selectedTask.current.appointmentId, name: selectedTask.current.client.name, taskId: selected, updatedAtIso: selectedTask.current.updatedAtIso, dueAtIso: selectedTask.current.dueAtIso, dateOnly: selectedTask.current.dateOnly, reason: selectedTask.current.nextAction }} onClose={() => setSelected(null)} onSaved={() => { const clientId = selectedTask.current!.customerId; setNotice(selectedAction === "log" ? "Contact recorded. No new reminder was created." : "Follow-up scheduled."); setSelected(null); setCursor(null); setRevision(n => n + 1); window.dispatchEvent(new CustomEvent("clinicflow:followup-changed", { detail: { clientId } })); window.requestAnimationFrame(() => noticeRef.current?.focus()); }} /> : null}
    {selected && selectedAction === "history" ? <FollowupResponseDrawer key={selected} id={selected} onClose={() => setSelected(null)} /> : null}
  </div>;
}

export function FollowupWorkTable({ items, onOpen, onBook, onSchedule, onHistory, sort, onSort }: { items: FollowupWorkTask[]; onOpen: (id: string) => void; onBook?: (task: FollowupWorkTask) => void; onSchedule?: (id: string) => void; onHistory?: (id: string) => void; sort?: TableSort; onSort?: (value: TableSort) => void }) {
  return <DataTable caption="Follow-up work list, one task per visit or recall" sort={sort} onSort={onSort} columns={[
    { key: "client", label: "Client / contact", sortable: true }, { key: "visit", label: "Visit / reason", className: "hidden sm:table-cell" },
    { key: "response", label: "Last response", className: "hidden sm:table-cell" }, { key: "due", label: "Next action", sortable: true, className: "hidden sm:table-cell" },
    { key: "status", label: "Status", sortable: true, className: "hidden sm:table-cell" }, { key: "action", label: "Action" },
  ]}>{items.map(task => <tr key={task.id}>
      <td className="break-words px-3 py-4 align-top sm:px-4"><Link className="font-medium text-[var(--accent)] underline underline-offset-2" href={"/clients/" + encodeURIComponent(task.customerId)}>{task.client.name}</Link><p className="mt-1">{task.client.phone || "No phone recorded"}</p><p className="text-xs text-[var(--text-muted)]">{task.client.code}</p><div className="mt-3 space-y-2 text-xs sm:hidden"><p>{task.summary}</p><p>{task.status === "Done" ? "Finished" : dateTime(task.dueAtIso, task.dateOnly)}</p><p>{task.nextAction}</p>{task.lastResponse ? <div><p>{task.lastResponse.label}</p>{task.lastResponse.note ? <p className="mt-1 whitespace-pre-wrap">{task.lastResponse.note}</p> : null}</div> : null}</div></td>
      <td className="hidden break-words px-4 py-4 align-top sm:table-cell"><p className="font-medium">{task.summary}</p><p className="mt-1 text-xs text-[var(--text-muted)]">{taskType(task.type)}</p>{task.visit ? <p className="mt-1 text-xs text-[var(--text-muted)]">{dateTime(task.visit.startsAtIso)} · {task.visit.provider}</p> : null}</td>
      <td className="hidden break-words px-4 py-4 align-top sm:table-cell">{task.lastResponse ? <><p>{task.lastResponse.label}</p>{task.lastResponse.note ? <p className="mt-1 whitespace-pre-wrap text-[var(--text-muted)]">{task.lastResponse.note}</p> : null}<p className="mt-2 text-xs text-[var(--text-muted)]">{dateTime(task.lastResponse.atIso)}</p></> : <span className="text-[var(--text-muted)]">No response recorded</span>}</td>
      <td className="hidden break-words px-4 py-4 align-top sm:table-cell"><p className="font-medium">{task.status === "Done" ? "Finished" : dateTime(task.dueAtIso, task.dateOnly)}</p><p className="mt-1 text-[var(--text-muted)]">{task.nextAction}</p>{task.status === "Blocked" ? <p className="mt-1 text-xs">Provider review required</p> : null}</td>
      <td className="hidden break-words px-4 py-4 align-top sm:table-cell">{statusLabel(task.status)}</td>
      <td className="space-y-2 px-3 py-4 align-top sm:px-4 [&_button]:h-auto [&_button]:min-h-10 [&_button]:w-full [&_button]:whitespace-normal [&_button]:py-2"><p className="text-xs text-[var(--text-muted)] sm:hidden">{statusLabel(task.status)}</p>{task.status !== "Done" && task.canManage && task.lastResponse?.response === "appointment_needed" && onBook ? <Button onClick={() => onBook(task)}>Book appointment</Button> : null}<Button onClick={() => onOpen(task.id)} variant="secondary">{task.status === "Done" || !task.canManage ? "View history" : "Log follow-up"}</Button>{task.status !== "Done" && task.canManage ? <>{onSchedule ? <Button variant="ghost" onClick={() => onSchedule(task.id)}>Reschedule</Button> : null}{onHistory ? <Button variant="ghost" onClick={() => onHistory(task.id)}>View history</Button> : null}</> : null}</td>
    </tr>)}</DataTable>;
}

export function FollowupStatusBoard({ items, counts, onOpen, onSchedule, onBook }: { items: FollowupWorkTask[]; counts: Record<string, number>; onOpen: (id: string) => void; onSchedule: (id: string) => void; onBook?: (task: FollowupWorkTask) => void }) {
  return <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:flex lg:items-start lg:overflow-x-auto lg:pb-3" role="region" tabIndex={0} aria-label="Follow-up status board">{followupStatuses.map(([status, label]) => {
    const tasks = items.filter(task => task.status === status);
    return <section key={status} aria-label={label} className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 lg:max-h-[70vh] lg:w-72 lg:shrink-0 lg:overflow-y-auto">
      <h2 className="mb-3 text-sm font-semibold">{label} · {counts[status] ?? 0}</h2>
      <p className="mb-3 text-xs text-[var(--text-muted)]">{tasks.length} loaded of {counts[status] ?? 0}</p>
      <div className="space-y-3">{tasks.map(task => <article key={task.id} className="min-w-0 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
        <Link className="break-words font-medium text-[var(--accent)] underline" href={"/clients/" + encodeURIComponent(task.customerId)}>{task.client.name}</Link>
        <p className="break-words">{task.client.phone || "No phone recorded"}</p><p className="break-words">{task.summary}</p>
        <p>Due: {dateTime(task.dueAtIso, task.dateOnly)}</p><p className="break-words text-[var(--text-muted)]">{task.nextAction}</p>
        {task.lastResponse ? <div className="break-words border-t border-[var(--border)] pt-2"><p>{task.lastResponse.label}</p>{task.lastResponse.note ? <p className="mt-1 whitespace-pre-wrap text-[var(--text-muted)]">{task.lastResponse.note}</p> : null}<p className="mt-1 text-xs text-[var(--text-muted)]">{dateTime(task.lastResponse.atIso)}</p></div> : <p className="text-[var(--text-muted)]">No response recorded</p>}
        <div className="flex flex-wrap gap-2">{task.canManage && task.status !== "Done" ? <>{task.lastResponse?.response === "appointment_needed" && onBook ? <Button onClick={() => onBook(task)}>Book appointment</Button> : null}<Button onClick={() => onOpen(task.id)}>Log follow-up</Button><Button variant="ghost" onClick={() => onSchedule(task.id)}>Reschedule</Button></> : <Button variant="secondary" onClick={() => onOpen(task.id)}>View history</Button>}</div>
      </article>)}</div>
      {!tasks.length ? <p className="text-sm text-[var(--text-muted)]">{counts[status] ? "More records available. Use Load more follow-ups below." : "No matching follow-ups."}</p> : null}
    </section>;
  })}</div>;
}

function FollowupResponseDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const historyRequest = useRef<AbortController | null>(null);
  useEffect(() => () => historyRequest.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController(); setDetail(null);
    void apiFetchJson<Detail>("/followups/" + encodeURIComponent(id), { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setDetail(result); } })
      .catch(cause => { if (!isAbortedRequest(cause)) setError(requestErrorMessage(cause, "Unable to load this follow-up.")); });
    return () => controller.abort();
  }, [id, revision]);
  const loadHistory = async () => {
    if (!detail?.nextHistoryCursor) return;
    const controller = new AbortController(); historyRequest.current = controller; setLoadingHistory(true);
    try {
      const older = await apiFetchJson<Detail>("/followups/" + encodeURIComponent(id) + "?cursor=" + encodeURIComponent(detail.nextHistoryCursor), { signal: controller.signal });
      if (!controller.signal.aborted) setDetail(current => current ? { ...current, history: [...current.history, ...older.history], hasOlderHistory: older.hasOlderHistory, nextHistoryCursor: older.nextHistoryCursor } : current);
    } catch (cause) { if (!isAbortedRequest(cause)) setError(requestErrorMessage(cause, "Unable to load older responses.")); }
    finally { if (!controller.signal.aborted) setLoadingHistory(false); }
  };
  return <Drawer title="Follow-up history" context={detail ? detail.task.client.name + " · " + detail.task.summary : undefined} onClose={onClose}>
    {!detail ? error ? <EmptyState title="Follow-up unavailable" body={error} actionLabel="Retry" onAction={() => { setError(null); setRevision(n => n + 1); }} /> : <KoiSectionLoader label="Loading follow-up" /> : <div className="space-y-5">
      <div className="break-words rounded-lg border border-[var(--border)] p-3 text-sm"><p>{detail.task.client.phone || "No phone recorded"}</p><p className="mt-1">{taskType(detail.task.type)} · Due {dateTime(detail.task.dueAtIso)}</p><p className="mt-1 text-[var(--text-muted)]">{detail.task.nextAction}</p></div>
      <section className="space-y-3 border-t border-[var(--border)] pt-4"><h3 className="text-sm font-semibold">Response history</h3>{detail.history.length ? detail.history.map(row => <div key={row.id} className="rounded-lg border border-[var(--border)] p-3 text-sm"><p className="font-medium">{row.label}</p>{row.note ? <p className="mt-1 whitespace-pre-wrap break-words">{row.note}</p> : null}<p className="mt-2 text-xs text-[var(--text-muted)]">{dateTime(row.atIso)} · {row.actor}</p>{row.nextContactAtIso ? <p className="mt-1 text-xs">Next contact: {dateTime(row.nextContactAtIso)}</p> : null}</div>) : <p className="text-sm text-[var(--text-muted)]">No response recorded yet.</p>}{detail.hasOlderHistory ? <Button loading={loadingHistory} onClick={() => void loadHistory()} variant="secondary">Load older responses</Button> : null}</section>
    </div>}
  </Drawer>;
}
