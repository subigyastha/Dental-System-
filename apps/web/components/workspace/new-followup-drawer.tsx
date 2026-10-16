"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { apiFetchJson } from "@/lib/api-client";
import { isAbortedRequest, requestErrorMessage } from "@/lib/request-error";
import { KoiSectionLoader } from "@/components/koi-loader";
import { Drawer, EmptyState, Field, inputClassName } from "./elements";
import { StaffFollowupDialog } from "./staff-followup-actions";
import type { FollowupClientWithPlan } from "./followup-client-suggestions";
import { followupDateLabel } from "@/lib/staff-followup";

export function NewFollowupDrawer({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<FollowupClientWithPlan[] | null>(null);
  const [selected, setSelected] = useState<FollowupClientWithPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setItems(null); setError(null);
    const timer = window.setTimeout(() => {
      void apiFetchJson<{ items: FollowupClientWithPlan[] }>("/followups/clients?view=all&query=" + encodeURIComponent(query), { signal: controller.signal })
        .then(data => { if (!controller.signal.aborted) setItems(data.items); })
        .catch(cause => { if (!isAbortedRequest(cause)) setError(requestErrorMessage(cause, "Unable to load clients.")); });
    }, query ? 200 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, revision]);
  if (selected) return <StaffFollowupDialog action="schedule" context={{ customerId: selected.customerId, appointmentId: selected.visit?.id, name: selected.name }} onClose={() => setSelected(null)} onSaved={() => {
    window.dispatchEvent(new CustomEvent("clinicflow:followup-changed", { detail: { clientId: selected.customerId } })); onClose();
  }} />;
  return <Drawer title="New follow-up" context="Choose a client, then choose when to follow up." onClose={onClose}>
    <div className="space-y-4"><Field label="Find client"><input className={inputClassName} maxLength={100} value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or phone" /></Field>
      {error ? <EmptyState title="Clients unavailable" body={error} actionLabel="Retry" onAction={() => setRevision(value => value + 1)} /> : !items ? <KoiSectionLoader label="Loading clients" /> : <>
        <div className="divide-y divide-[var(--border)]">{items.map(client => <div className="flex flex-wrap items-center justify-between gap-3 py-3" key={client.customerId}><div className="min-w-0 text-sm"><p className="font-medium">{client.name}</p><p className="text-[var(--text-muted)]">{client.phone} · {client.code}</p>{client.upcomingFollowup ? <p className="mt-1 text-xs text-[var(--text-muted)]">Already planned: {followupDateLabel(client.upcomingFollowup.dueAtIso, client.upcomingFollowup.dateOnly)}</p> : null}</div><Button disabled={!client.canManage} onClick={() => setSelected(client)} variant="secondary">Select client</Button></div>)}</div>
        <p className="text-sm text-[var(--text-muted)]">{items.length ? "Showing up to 25 clients. Search to find another client." : "No clients match this search."}</p>
      </>}
    </div>
  </Drawer>;
}
