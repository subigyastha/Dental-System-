"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { apiFetchJson, ApiRequestError } from "@/lib/api-client";
import { requestErrorMessage } from "@/lib/request-error";
import { clinicDateTime, contactPreset } from "@/lib/followup-work";
import { staffFollowupDate } from "@/lib/staff-followup";
import { Drawer, Field, inputClassName } from "./elements";

export type StaffFollowupContext = { customerId: string; appointmentId?: string | null; name: string; taskId?: string; updatedAtIso?: string; dueAtIso?: string; dateOnly?: boolean | null; reason?: string };

export function StaffFollowupActions({ context, scheduleContext, canManage = true }: { context: StaffFollowupContext; scheduleContext?: StaffFollowupContext; canManage?: boolean }) {
  const [action, setAction] = useState<"log" | "schedule" | null>(null);
  const [notice, setNotice] = useState("");
  const noticeRef = useRef<HTMLParagraphElement>(null);
  if (!canManage) return <p className="text-xs text-[var(--text-muted)]">This record is read-only for follow-ups.</p>;
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2 [&_button]:h-auto [&_button]:min-h-10 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:py-2"><Button variant="secondary" onClick={() => { setNotice(""); setAction("log"); }}>Log follow-up</Button><Button variant="ghost" onClick={() => { setNotice(""); setAction("schedule"); }}>Schedule follow-up</Button></div>
    {notice ? <p ref={noticeRef} tabIndex={-1} role="status" className="text-sm">{notice}</p> : null}
    {action ? <StaffFollowupDialog action={action} context={action === "schedule" ? scheduleContext ?? context : context} onClose={() => setAction(null)} onSaved={() => {
      setAction(null); setNotice(action === "log" ? "Contact recorded. No new reminder was created." : "Follow-up scheduled.");
      window.dispatchEvent(new CustomEvent("clinicflow:followup-changed", { detail: { clientId: context.customerId } }));
      window.requestAnimationFrame(() => noticeRef.current?.focus());
    }} /> : null}
  </div>;
}

export function StaffFollowupDialog({ action, context, onClose, onSaved }: { action: "log" | "schedule"; context: StaffFollowupContext; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(context.dueAtIso ? clinicDateTime(new Date(context.dueAtIso)).date : "");
  const [time, setTime] = useState(context.dueAtIso && context.dateOnly !== true && (context.dateOnly === false || clinicDateTime(new Date(context.dueAtIso)).time !== "00:00") ? clinicDateTime(new Date(context.dueAtIso)).time : "");
  const [result, setResult] = useState("");
  const [reason, setReason] = useState(context.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const busy = useRef(false);
  const today = clinicDateTime(new Date()).date;
  const later = contactPreset("today");
  const save = async () => {
    if (busy.current) return;
    let body: string;
    try {
      if (action === "log" && !result) throw new Error("Choose whether you spoke to the client.");
      body = pending ?? JSON.stringify({ action, requestId, appointmentId: context.appointmentId ?? undefined,
        taskId: context.taskId, expectedUpdatedAtIso: context.updatedAtIso,
        ...(action === "log" ? { result } : { ...staffFollowupDate(date, time), reason: reason.trim() || undefined }) });
    } catch (cause) { setError(requestErrorMessage(cause, "Check the details.")); return; }
    busy.current = true; setSaving(true); setError(null); setPending(body);
    try {
      await apiFetchJson("/followups/clients/" + encodeURIComponent(context.customerId) + "/actions", { method: "POST", headers: { "content-type": "application/json" }, body });
      onSaved();
    } catch (cause) {
      if (cause instanceof ApiRequestError && [400, 403, 404, 409].includes(cause.status)) setPending(null);
      if (cause instanceof ApiRequestError && cause.status === 409) setConflict(true);
      setError(requestErrorMessage(cause, "Save not confirmed. Retry the same save to avoid duplicates."));
    } finally { busy.current = false; setSaving(false); }
  };
  const disabled = saving || Boolean(pending);
  return <Drawer title={action === "log" ? "Log follow-up" : "Schedule follow-up"} context={context.name} onClose={onClose} closeDisabled={saving || Boolean(pending)}>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      {action === "log" ? <>
        <p className="text-sm text-[var(--text-muted)]">Record this contact attempt. Another follow-up is scheduled only if you choose to add one.</p>
        <Field label="Did you speak to the client?"><select required disabled={disabled} className={inputClassName} value={result} onChange={event => setResult(event.target.value)}><option value="">Choose a result</option><option value="reached">Spoke to client</option><option value="no_answer">No answer</option></select></Field>
        {result === "no_answer" && context.taskId ? <p className="text-sm">This reminder stays open so staff can decide what to do next.</p> : null}
      </> : <>
        <p className="text-sm text-[var(--text-muted)]">Choose when to check in. A doctor’s instruction can be added as the reason.</p>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={disabled || later.date !== today} onClick={() => { setDate(later.date); setTime(later.time); }}>Later today</Button><Button variant="secondary" disabled={disabled} onClick={() => { setDate(contactPreset("tomorrow").date); setTime(""); }}>Tomorrow</Button></div>
        <div className="grid grid-cols-2 gap-3 [&>label]:min-w-0"><Field label="Follow-up date"><input required disabled={disabled} className={inputClassName + " min-w-0"} type="date" min={today} value={date} onChange={event => setDate(event.target.value)} /></Field><Field label="Time (optional, Nepal)"><input disabled={disabled} className={inputClassName + " min-w-0"} type="time" value={time} onChange={event => setTime(event.target.value)} /></Field></div>
        <Field label="Reason or doctor’s instruction (optional)"><input disabled={disabled} maxLength={500} className={inputClassName} value={reason} onChange={event => setReason(event.target.value)} /></Field>
      </>}
      {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
      {conflict ? <Button variant="secondary" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("clinicflow:followup-changed", { detail: { clientId: context.customerId } })); }}>Close and refresh</Button> : <Button type="submit" loading={saving}>{pending && !saving ? "Retry save" : action === "log" ? "Save contact" : "Schedule follow-up"}</Button>}
      {pending && !saving ? <p className="text-sm" role="status">Retry to confirm this save before closing or editing.</p> : null}
    </form>
  </Drawer>;
}
