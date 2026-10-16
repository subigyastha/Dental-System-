"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Archive, GitMerge, Plus } from "lucide-react";

import { KoiSectionLoader } from "@/components/koi-loader";
import { Button, Panel } from "@/components/ui";
import { EmptyState, Field, Modal, PageHeader, inputClassName, textareaClassName } from "@/components/workspace/elements";
import { useWorkspaceApp } from "@/components/workspace/app-state";
import { NewClientDrawer } from "@/components/workspace/new-client-drawer";
import { apiFetchJson } from "@/lib/api-client";
import { isAbortedRequest, requestErrorMessage } from "@/lib/request-error";
import { toDateKey } from "@/lib/calendar/conversion";
import { buildFollowupUpdate } from "@/lib/followup-update";
import { FollowupClientSuggestions } from "./followup-client-suggestions";
import { ClientPaymentHistory } from "./finance/visit-payment";
import { DataTable, DataTableControls, type TableColumn, type TableSort } from "./data-table";

type Client = {
  id: string;
  clientCode: string | null;
  name: string;
  phone: string;
  email: string | null;
  risk: string;
  lastVisitIso: string;
  lastRecordedVisitIso?: string | null;
  dueFollowUps?: Array<{ id: string; dueAtIso: string; type: string; summary: string; nextAction: string }>;
  dueFollowUpCount?: number;
  needsRecallReview?: boolean;
};
type Envelope<T> = { data: T };
type Directory = { items: Client[]; total?: number; page?: { hasMore: boolean; nextCursor: string | null } };
type FollowUp = { id: string; dueAtIso: string; status: string; type: string; summary: string; nextAction: string; canManage: boolean };
type Profile = {
  client: Client & { allergies: string | null; medicalNotes: string | null; dateOfBirthIso: string | null };
  mergeHistory: Array<{ id: string; atIso: string; reason: string; secondaryClient: Client }>;
  timeline: Array<{ id: string; atIso: string; title: string; detail: string; kind?: string }>;
  followUps?: FollowUp[];
  recallReview?: { needsReview: boolean; canCreate: boolean; lastCompletedVisitIso: string | null };
  procedureReviewVisits?: Array<{ id: string; startsAtIso: string; label: string }>;
};
async function request<T>(path: string, init?: RequestInit) {
  return (await apiFetchJson<Envelope<T>>(path, init)).data;
}

function date(value: string) {
  return new Intl.DateTimeFormat("en-NP", { dateStyle: "medium", timeZone: "Asia/Kathmandu" }).format(new Date(value));
}

export function ClientDirectoryPage() {
  const { workspaceBootstrap } = useWorkspaceApp();
  const [query, setQuery] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [risk, setRisk] = useState("");
  const [sort, setSort] = useState<TableSort>({ key: "name", direction: "asc" });
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const moreRequest = useRef<AbortController | null>(null);
  const [items, setItems] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const canCreateClient =
    workspaceBootstrap.context.capabilities.canCreateClient;
  useEffect(() => { setDueOnly(new URLSearchParams(window.location.search).get("followUp") === "due"); }, []);
  const params = new URLSearchParams({ limit: "25", query, sort: sort.key, direction: sort.direction, includeTotal: "true" });
  if (dueOnly) params.set("followUp", "due");
  if (risk) params.set("risk", risk);
  const directoryPath = "/v1/clients?" + params.toString();
  const changeDueFilter = (value: boolean) => { setDueOnly(value); window.history.replaceState(window.history.state, "", value ? "/clients?followUp=due" : "/clients"); };
  const resetFilters = () => { setQuery(""); setRisk(""); setSort({ key: "name", direction: "asc" }); changeDueFilter(false); };

  useEffect(() => {
    const controller = new AbortController();
    moreRequest.current?.abort();
    setLoadingMore(false);
    setLoading(true);
    setNextCursor(null);
    const timer = window.setTimeout(() => {
      setError(null);
      void request<Directory>(
        directoryPath,
        { signal: controller.signal },
      )
        .then((result) => { if (!controller.signal.aborted) { setItems(result.items); setTotal(result.total ?? null); setNextCursor(result.page?.nextCursor ?? null); } })
        .catch((cause: unknown) => {
          if (!isAbortedRequest(cause)) {
            setError(requestErrorMessage(cause, "Unable to load Clients."));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      moreRequest.current?.abort();
    };
  }, [loadRevision, directoryPath]);

  useEffect(() => {
    const handleBookingCompleted = () => {
      setLoadRevision((current) => current + 1);
    };
    window.addEventListener("clinicflow:client-changed", handleBookingCompleted);
    window.addEventListener("clinicflow:followup-changed", handleBookingCompleted);
    return () =>
      { window.removeEventListener("clinicflow:client-changed", handleBookingCompleted); window.removeEventListener("clinicflow:followup-changed", handleBookingCompleted); };
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clients"
        subtitle="Organization-scoped identity, duplicate review, and care history."
        action={
          canCreateClient ? (
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} />
              New Client
            </Button>
          ) : undefined
        }
      />
      <DataTableControls search={query} onSearch={setQuery} searchLabel="Search clients" placeholder="Name, phone, email or code" sort={sort} sortOptions={[
        { value: "name", label: "Client" }, { value: "code", label: "Client code" }, { value: "phone", label: "Phone" }, { value: "visit", label: "Last visit" }, { value: "risk", label: "Risk" },
      ]} onSort={setSort} onReset={resetFilters}>
        <Field label="Follow-ups"><select className={inputClassName} value={dueOnly ? "due" : "all"} onChange={event => changeDueFilter(event.target.value === "due")}><option value="all">All clients</option><option value="due">Due follow-ups</option></select></Field>
        <Field label="Risk"><select className={inputClassName} value={risk} onChange={event => setRisk(event.target.value)}><option value="">All risks</option><option>Routine</option><option>Needs attention</option><option>High priority</option></select></Field>
      </DataTableControls>
      {dueOnly ? <p className="text-sm text-[var(--text-muted)]">Clients with scheduled follow-ups that are due or overdue. Open a client to log contact or change the date.</p> : null}
      {!loading && !error && total !== null ? <p role="status" className="text-sm text-[var(--text-muted)]">Showing {items.length} of {total} matching clients</p> : null}
      <Panel>
        {loading ? <KoiSectionLoader label="Loading Clients" /> : null}
        {!loading && error ? <div className="p-4"><EmptyState actionLabel="Retry" body={error} onAction={() => setLoadRevision((current) => current + 1)} title="Client directory unavailable" /></div> : null}
        {!loading && !error ? <ClientDirectoryTable items={items} dueOnly={dueOnly} sort={sort} onSort={setSort} /> : null}
        {!loading && !error && !items.length ? (
          <div className="p-4">
            <EmptyState
              actionLabel={!dueOnly && canCreateClient ? "Create Client" : undefined}
              body={dueOnly ? "No clients with due follow-ups match these filters." : "No active Client matches these filters. Try another search or reset filters."}
              onAction={
                canCreateClient ? () => setCreating(true) : undefined
              }
              title={dueOnly ? "No follow-ups due" : "No Clients found"}
            />
          </div>
        ) : null}
        {!loading && !error && nextCursor ? <div className="p-4"><Button loading={loadingMore} onClick={() => {
          moreRequest.current?.abort();
          const controller = new AbortController();
          moreRequest.current = controller;
          setLoadingMore(true);
          void request<Directory>(directoryPath + "&cursor=" + encodeURIComponent(nextCursor), { signal: controller.signal })
            .then((result) => { if (!controller.signal.aborted) { setItems((current) => [...current, ...result.items.filter(item => !current.some(existing => existing.id === item.id))]); setTotal(result.total ?? null); setNextCursor(result.page?.nextCursor ?? null); } })
            .catch((cause: unknown) => { if (!isAbortedRequest(cause)) setError(requestErrorMessage(cause, "Unable to load more Clients.")); })
            .finally(() => { if (!controller.signal.aborted) setLoadingMore(false); });
        }} variant="secondary">Load more Clients</Button></div> : null}
      </Panel>
      {creating ? (
        <NewClientDrawer
          onClose={() => setCreating(false)}
          onCreated={() => setLoadRevision((current) => current + 1)}
        />
      ) : null}
    </div>
  );
}

export function ClientDirectoryTable({ items, dueOnly, sort, onSort }: { items: Client[]; dueOnly: boolean; sort?: TableSort; onSort?: (value: TableSort) => void }) {
  const cell = "px-3 py-4 align-top break-words sm:px-4";
  const visitDate = (client: Client) => client.lastRecordedVisitIso === undefined ? date(client.lastVisitIso) : client.lastRecordedVisitIso ? date(client.lastRecordedVisitIso) : "Not recorded";
  const columns: TableColumn[] = [
    { key: "name", label: "Client", sortable: true }, { key: "phone", label: "Contact", sortable: true, className: "hidden sm:table-cell" },
    ...(dueOnly ? [{ key: "reason", label: "Follow-up / reason", className: "hidden sm:table-cell" }, { key: "due", label: "Due date", className: "hidden sm:table-cell" }, { key: "next", label: "Next action", className: "hidden sm:table-cell" }]
      : [{ key: "visit", label: "Last visit", sortable: true, className: "hidden sm:table-cell" }, { key: "risk", label: "Risk", sortable: true, className: "hidden sm:table-cell" }]),
    { key: "actions", label: "Actions" },
  ];
  return <DataTable caption={dueOnly ? "Clients with due follow-ups" : "Client directory"} columns={columns} sort={sort} onSort={onSort}>
        {items.flatMap((client) => {
          const tasks = dueOnly && client.dueFollowUps?.length ? client.dueFollowUps : [null];
          const remaining = (client.dueFollowUpCount ?? 0) - (client.dueFollowUps?.length ?? 0);
          const href = "/clients/" + encodeURIComponent(client.id);
          return tasks.map((task, index) => <tr className="hover:bg-[var(--surface-muted)]" key={client.id + ":" + (task?.id ?? "client")}>
            {index === 0 ? <>
              <td className={cell} rowSpan={tasks.length}><Link className="font-medium text-[var(--accent)] hover:underline" href={href}>{client.name}</Link><div className="mt-1 text-xs text-[var(--text-muted)]">{client.clientCode ?? "Code pending"}</div><div className="mt-3 space-y-2 text-xs sm:hidden"><p>{client.phone || "No phone recorded"}</p>{client.email ? <p>{client.email}</p> : null}{dueOnly ? tasks.map(item => item ? <div key={item.id} className="space-y-1"><p>{item.summary}</p><p>Due: {date(item.dueAtIso)}</p><p>{item.nextAction}</p></div> : <p key="review">Historical recall review · Not scheduled</p>) : <><p>Last visit: {visitDate(client)}</p><p>Risk: {client.risk}</p></>}</div></td>
              <td className={cell + " hidden sm:table-cell"} rowSpan={tasks.length}><div>{client.phone || "Not recorded"}</div>{client.email ? <div className="mt-1 text-xs text-[var(--text-muted)]">{client.email}</div> : null}</td>
            </> : null}
            {dueOnly ? <>
              <td className={cell + " hidden sm:table-cell"}><div className="font-medium">{task ? task.type === "TreatmentContinuation" ? "Procedure follow-up" : task.type === "Recall" ? "Routine recall" : "Follow-up" : "Historical recall review"}</div><div className="mt-1 text-[var(--text-muted)]">{task?.summary ?? "Review the last completed visit"}</div></td>
              <td className={cell + " hidden sm:table-cell"}>{task ? date(task.dueAtIso) : "Not scheduled"}</td>
              <td className={cell + " hidden sm:table-cell"}>{task?.nextAction ?? "Open the profile to review and schedule the recall"}</td>
            </> : <><td className={cell + " hidden sm:table-cell"}>{visitDate(client)}</td><td className={cell + " hidden sm:table-cell"}>{client.risk}</td></>}
            {index === 0 ? <td className={cell} rowSpan={tasks.length}><Link className="font-medium text-[var(--accent)] hover:underline" href={href}>{dueOnly ? "Review follow-ups" : "Open profile"}</Link>{remaining > 0 ? <div className="mt-2 text-xs text-[var(--text-muted)]">+{remaining} more due tasks</div> : null}</td> : null}
          </tr>);
        })}
  </DataTable>;
}

export function FollowUpCard({ task, onSaved }: { task: FollowUp; onSaved: () => void }) {
  const [dueDate, setDueDate] = useState(() => toDateKey(task.dueAtIso));
  const [outcome, setOutcome] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (status: "Done" | "Open") => {
    setSaving(true); setError(null);
    try {
      await apiFetchJson("/followups/" + task.id, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify(buildFollowupUpdate(status, outcome, status === "Open" ? dueDate : "")),
      });
      onSaved();
    } catch (cause) { setError(requestErrorMessage(cause, "Unable to update this follow-up.")); }
    finally { setSaving(false); }
  };
  return <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
    <div className="font-medium">{task.summary} · {task.status}</div>
    <div className="text-sm text-[var(--text-muted)]">Due {date(task.dueAtIso)} · {task.nextAction}</div>
    {task.status !== "Done" && task.canManage ? <>
      <Field label="Next follow-up date"><input className={inputClassName} disabled={saving} onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} /></Field>
      <Field label="Outcome / next action"><textarea className={textareaClassName} disabled={saving} maxLength={2000} onChange={(event) => setOutcome(event.target.value)} placeholder="For example: client asked to follow up next week" value={outcome} /></Field>
      <div className="flex flex-wrap gap-2"><Button disabled={saving} onClick={() => void save("Open")} variant="secondary">Save next date</Button><Button disabled={saving} onClick={() => void save("Done")}>Mark done</Button></div>
    </> : null}
    {error ? <p className="text-sm text-[var(--danger)]" role="alert">{error}</p> : null}
  </div>;
}

export function ClientProfilePage({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiving, setArchiving] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setProfile(null);
    setError(null);
    void request<Profile>(
      "/v1/clients/" + encodeURIComponent(clientId),
      { signal: controller.signal },
    )
      .then(setProfile)
      .catch((cause: unknown) => {
        if (!isAbortedRequest(cause)) {
          setError(requestErrorMessage(cause, "Unable to load Client."));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [clientId, loadRevision]);

  useEffect(() => {
    const handleBookingCompleted = (event: Event) => {
      const changedClientId = (event as CustomEvent<{ clientId?: string }>).detail?.clientId;
      if (!changedClientId || changedClientId === clientId) {
        setLoadRevision((current) => current + 1);
      }
    };
    window.addEventListener("clinicflow:client-changed", handleBookingCompleted);
    window.addEventListener("clinicflow:followup-changed", handleBookingCompleted);
    return () => {
      window.removeEventListener("clinicflow:client-changed", handleBookingCompleted);
      window.removeEventListener("clinicflow:followup-changed", handleBookingCompleted);
    };
  }, [clientId]);

  if (loading) return <KoiSectionLoader label="Loading Client profile" />;
  if (!profile) return <div className="space-y-5"><PageHeader title="Client unavailable" /><EmptyState actionLabel="Retry" body={error ?? "Client not found."} onAction={() => setLoadRevision((current) => current + 1)} title="Unable to open Client" /><Link className="text-sm font-medium text-[var(--accent)]" href="/clients">Back to Clients</Link></div>;

  const { client } = profile;
  return (
    <div className="space-y-5">
      <PageHeader
        title={client.name}
        subtitle={(client.clientCode ?? "Client record") + " · " + client.phone}
        action={<Button onClick={() => setMergeOpen(true)} variant="secondary"><GitMerge size={16} />Merge duplicate</Button>}
      />
      <div className="space-y-5">
        <Panel title="Client details">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Detail label="Phone" value={client.phone || "Not recorded"} />
            <Detail label="Client code" value={client.clientCode ?? "Not recorded"} />
            <Detail label="Email" value={client.email ?? "Not recorded"} />
            <Detail label="Risk" value={client.risk} />
            <Detail label="Date of birth" value={client.dateOfBirthIso ? date(client.dateOfBirthIso) : "Not recorded"} />
            <Detail label="Allergies" value={client.allergies ?? "None recorded"} />
            <Detail label="Medical notes" value={client.medicalNotes ?? "None recorded"} />
          </div>
        </Panel>

      </div>
      <Panel title="Follow-ups"><div className="p-4"><FollowupClientSuggestions customerId={client.id} /></div></Panel>
      <Panel title="Payment history"><div className="p-4"><ClientPaymentHistory clientId={client.id} /></div></Panel>
      <Panel title="Visit history">
        {profile.timeline.some(item => !item.kind || item.kind === "appointment") ? <div className="divide-y divide-[var(--border)]">
          {profile.timeline.filter(item => !item.kind || item.kind === "appointment").map((item) => <div className="flex gap-4 px-4 py-3" key={item.id}>
            <div className="w-24 shrink-0 text-xs text-[var(--text-muted)]">{date(item.atIso)}</div>
            <div><div className="text-sm font-medium text-[var(--foreground)]">{item.title}</div><div className="mt-1 text-sm text-[var(--text-muted)]">{item.detail}</div></div>
          </div>)}
        </div> : <div className="p-4"><EmptyState body="This Client has no operational history yet." title="No timeline activity" /></div>}
      </Panel>
      <details className="rounded-lg border border-[var(--border)] p-4"><summary className="cursor-pointer text-sm font-medium">Manage client</summary>
        <Panel title="Archive Client">
          <div className="space-y-3 p-4">
            <p className="text-sm text-[var(--text-muted)]">Archiving removes this Client from normal search. It never deletes the Client, its code, or history.</p>
            <textarea className={textareaClassName} onChange={(event) => setArchiveReason(event.target.value)} placeholder="Required archive reason" value={archiveReason} />
            <Button
              loading={archiving}
              loadingLabel="Archiving"
              onClick={() => {
                if (!archiveReason.trim()) { setError("An archive reason is required."); return; }
                setArchiving(true);
                void request("/v1/clients/" + client.id + "/archive", {
                  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: archiveReason }),
                }).then(() => router.push("/clients"))
                  .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to archive Client."))
                  .finally(() => setArchiving(false));
              }}
              variant="secondary"
            ><Archive size={16} />Archive Client</Button>
            {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
          </div>
        </Panel>
      </details>
      {profile.mergeHistory.length ? <Panel title="Merge history"><div className="divide-y divide-[var(--border)]">
        {profile.mergeHistory.map((item) => <div className="px-4 py-3" key={item.id}>
          <div className="text-sm font-medium text-[var(--foreground)]">{item.secondaryClient.name} merged into this Client</div>
          <div className="mt-1 text-sm text-[var(--text-muted)]">{item.reason} · {date(item.atIso)}</div>
        </div>)}
      </div></Panel> : null}
      {mergeOpen ? <MergeClientModal primary={client} onClose={() => setMergeOpen(false)} onMerged={() => window.location.reload()} /> : null}
    </div>
  );
}

/* B7 replaced this legacy unversioned create form with NewClientDrawer.
function CreateClientModal({ onClose, onCreated }: { onClose: () => void; onCreated: (client: Client) => void }) {
  const [form, setForm] = useState<ClientForm>(emptyForm);
  const [matches, setMatches] = useState<Match[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = <Key extends keyof ClientForm>(key: Key, value: ClientForm[Key]) => setForm((current) => ({ ...current, [key]: value }));
  const checkMatches = () => {
    if (!form.name.trim() || !form.phone.trim()) return;
    void request<{ matches: Match[] }>("/v1/clients/match", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: form.name, phone: form.phone, email: form.email || undefined }),
    }).then((result) => setMatches(result.matches)).catch(() => setMatches([]));
  };
  return <Modal onClose={onClose} subtitle="Server-generated Client codes are immutable. Shared family phone numbers are allowed." title="New Client">
    <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault(); setSaving(true); setError(null);
      void request<Client>("/v1/clients", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, email: form.email || undefined, duplicateCheckAcknowledged: acknowledged }),
      }).then(onCreated).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to create Client.")).finally(() => setSaving(false));
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name"><input className={inputClassName} onChange={(event) => update("name", event.target.value)} required value={form.name} /></Field>
        <Field label="Phone"><input className={inputClassName} onChange={(event) => update("phone", event.target.value)} required value={form.phone} /></Field>
        <Field label="Email"><input className={inputClassName} onChange={(event) => update("email", event.target.value)} type="email" value={form.email} /></Field>
        <Field label="Risk"><select className={inputClassName} onChange={(event) => update("risk", event.target.value as ClientForm["risk"])} value={form.risk}><option>Routine</option><option>Needs attention</option><option>High priority</option></select></Field>
      </div>
      <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
        <Button onClick={checkMatches} variant="secondary">Check possible matches</Button>
        {matches.length ? <div className="mt-3 space-y-2">
          <div className="text-sm font-medium">Possible existing Clients</div>
          {matches.map((match) => <Link className="block rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-sm" href={"/clients/" + match.client.id} key={match.client.id}>{match.client.name} · {match.client.clientCode} · {match.confidence} match</Link>)}
          <label className="flex gap-2 text-sm"><input checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} type="checkbox" />I reviewed the matches and need a separate Client.</label>
        </div> : null}
      </div>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      <div className="flex justify-end gap-2"><Button onClick={onClose} variant="ghost">Cancel</Button><Button loading={saving} loadingLabel="Creating" type="submit">Create Client</Button></div>
    </form>
  </Modal>;
}
*/

function MergeClientModal({ onClose, onMerged, primary }: { onClose: () => void; onMerged: () => void; primary: Client }) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Client[]>([]);
  const [secondary, setSecondary] = useState<Client | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (query.trim().length < 2) { setCandidates([]); return; }
    const timer = window.setTimeout(() => void request<Directory>("/v1/clients?limit=10&query=" + encodeURIComponent(query))
      .then((result) => setCandidates(result.items.filter((item) => item.id !== primary.id))).catch(() => setCandidates([])), 200);
    return () => window.clearTimeout(timer);
  }, [primary.id, query]);
  return <Modal onClose={onClose} subtitle="The secondary Client is archived and linked; its operational history is retained." title="Merge duplicate Client">
    <div className="space-y-4">
      <Field label="Search secondary Client"><input className={inputClassName} onChange={(event) => setQuery(event.target.value)} placeholder="Name, contact, or Client code" value={query} /></Field>
      {candidates.map((candidate) => <button className={"w-full rounded-md border p-3 text-left text-sm " + (secondary?.id === candidate.id ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)]")} key={candidate.id} onClick={() => setSecondary(candidate)} type="button"><b>{candidate.name}</b><div className="mt-1 text-[var(--text-muted)]">{candidate.clientCode} · {candidate.phone}</div></button>)}
      <Field label="Required merge reason"><textarea className={textareaClassName} onChange={(event) => setReason(event.target.value)} value={reason} /></Field>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      <div className="flex justify-end gap-2"><Button onClick={onClose} variant="ghost">Cancel</Button><Button disabled={!secondary || !reason.trim()} loading={saving} loadingLabel="Merging" onClick={() => {
        if (!secondary) return; setSaving(true); setError(null);
        void request<Client>("/v1/clients/" + primary.id + "/merge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secondaryClientId: secondary.id, reason }) })
          .then(onMerged).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to merge Clients.")).finally(() => setSaving(false));
      }}>Merge and archive secondary</Button></div>
    </div>
  </Modal>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</div><div className="mt-1 text-sm text-[var(--foreground)]">{value}</div></div>;
}
