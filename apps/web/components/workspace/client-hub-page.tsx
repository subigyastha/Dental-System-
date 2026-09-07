"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Archive, GitMerge, Plus, Search } from "lucide-react";

import { KoiSectionLoader } from "@/components/koi-loader";
import { Button, Panel } from "@/components/ui";
import { EmptyState, Field, Modal, PageHeader, inputClassName, textareaClassName } from "@/components/workspace/elements";
import { useWorkspaceApp } from "@/components/workspace/app-state";
import { NewClientDrawer } from "@/components/workspace/new-client-drawer";
import { apiFetchJson } from "@/lib/api-client";
import { isAbortedRequest, requestErrorMessage } from "@/lib/request-error";

type Client = {
  id: string;
  clientCode: string | null;
  name: string;
  phone: string;
  email: string | null;
  risk: string;
  lastVisitIso: string;
};
type Envelope<T> = { data: T };
type Directory = { items: Client[] };
type Profile = {
  client: Client & { allergies: string | null; medicalNotes: string | null; dateOfBirthIso: string | null };
  mergeHistory: Array<{ id: string; atIso: string; reason: string; secondaryClient: Client }>;
  timeline: Array<{ id: string; atIso: string; title: string; detail: string }>;
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
  const [items, setItems] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const canCreateClient =
    workspaceBootstrap.context.capabilities.canCreateClient;

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void request<Directory>(
        "/v1/clients?limit=25&query=" + encodeURIComponent(query),
        { signal: controller.signal },
      )
        .then((result) => setItems(result.items))
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
    };
  }, [loadRevision, query]);

  useEffect(() => {
    const handleBookingCompleted = () => {
      setLoadRevision((current) => current + 1);
    };
    window.addEventListener("clinicflow:client-changed", handleBookingCompleted);
    return () =>
      window.removeEventListener("clinicflow:client-changed", handleBookingCompleted);
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
      <Panel title="Client directory">
        <div className="border-b border-[var(--border)] p-4">
          <div className="flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3">
            <Search aria-hidden="true" className="text-[var(--text-muted)]" size={16} />
            <input
              aria-label="Search Clients"
              className="w-full border-none bg-transparent p-0 text-sm outline-none"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, phone, email, or Client code"
              value={query}
            />
          </div>
        </div>
        {loading ? <KoiSectionLoader label="Loading Clients" /> : null}
        {!loading && error ? <div className="p-4"><EmptyState actionLabel="Retry" body={error} onAction={() => setLoadRevision((current) => current + 1)} title="Client directory unavailable" /></div> : null}
        {!loading && !error && items.length ? (
          <div className="divide-y divide-[var(--border)]">
            {items.map((client) => (
              <Link
                className="grid gap-3 px-4 py-4 transition hover:bg-[var(--surface-muted)] md:grid-cols-[minmax(0,1.2fr)_160px_120px]"
                href={"/clients/" + client.id}
                key={client.id}
              >
                <div>
                  <div className="font-medium text-[var(--foreground)]">{client.name}</div>
                  <div className="mt-1 text-sm text-[var(--text-muted)]">{client.clientCode ?? "Code pending"} · {client.phone}</div>
                </div>
                <div className="text-sm text-[var(--text-muted)]"><b className="text-[var(--foreground)]">Last activity</b><div className="mt-1">{date(client.lastVisitIso)}</div></div>
                <div className="text-sm text-[var(--text-muted)]"><b className="text-[var(--foreground)]">Risk</b><div className="mt-1">{client.risk}</div></div>
              </Link>
            ))}
          </div>
        ) : null}
        {!loading && !error && !items.length ? (
          <div className="p-4">
            <EmptyState
              actionLabel={canCreateClient ? "Create Client" : undefined}
              body="No active Client matches that search. Shared household contacts are allowed."
              onAction={
                canCreateClient ? () => setCreating(true) : undefined
              }
              title="No Clients found"
            />
          </div>
        ) : null}
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

export function ClientProfilePage({ clientId }: { clientId: string }) {
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
    return () =>
      window.removeEventListener("clinicflow:client-changed", handleBookingCompleted);
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
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Client details">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Detail label="Email" value={client.email ?? "Not recorded"} />
            <Detail label="Risk" value={client.risk} />
            <Detail label="Date of birth" value={client.dateOfBirthIso ? date(client.dateOfBirthIso) : "Not recorded"} />
            <Detail label="Allergies" value={client.allergies ?? "None recorded"} />
            <Detail label="Medical notes" value={client.medicalNotes ?? "None recorded"} />
          </div>
        </Panel>
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
                }).then(() => window.location.assign("/clients"))
                  .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to archive Client."))
                  .finally(() => setArchiving(false));
              }}
              variant="secondary"
            ><Archive size={16} />Archive Client</Button>
            {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
          </div>
        </Panel>
      </div>
      <Panel title="Timeline">
        {profile.timeline.length ? <div className="divide-y divide-[var(--border)]">
          {profile.timeline.map((item) => <div className="flex gap-4 px-4 py-3" key={item.id}>
            <div className="w-24 shrink-0 text-xs text-[var(--text-muted)]">{date(item.atIso)}</div>
            <div><div className="text-sm font-medium text-[var(--foreground)]">{item.title}</div><div className="mt-1 text-sm text-[var(--text-muted)]">{item.detail}</div></div>
          </div>)}
        </div> : <div className="p-4"><EmptyState body="This Client has no operational history yet." title="No timeline activity" /></div>}
      </Panel>
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
