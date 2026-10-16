# Follow-up data model

Implemented locally: October 10, 2026. This updates the data behind [the staff-directed flow](41-staff-directed-followups.md). The current interface keeps its existing inputs; view optimization and feedback inputs are the next design step.

## What is stored

| Detail | Storage | Meaning |
| --- | --- | --- |
| Planned date/time | `FollowUpTask.dueAt`, `dateOnly` | Staff choose the date and optional time. `dateOnly = true` means no specific time; `null` means legacy precision is unknown. |
| Actual contact time | `CommunicationLog.occurredAt` | When the call, conversation or reply happened. Separate from the reminder date. |
| Contact result | `CommunicationLog.result` | `reached` means staff spoke to the client or received a response; `no_answer` means an unanswered attempt. A future delivery-only record can have no result. |
| Client response | `CommunicationLog.responseText` | Optional text describing what the client said, up to 2,000 characters. An unanswered attempt cannot contain a client response. |
| Method used | Existing `CommunicationLog.channel` | `call`, `whatsapp`, `sms`, `email`, `in_person`, `other`, or `unknown`. Future integrations use this same field. |
| Record source | `CommunicationLog.source` | `manual` for staff-entered records. `integration` and `import` are supported by the model for later work. Source describes how the record entered the system. |
| Direction | Existing `CommunicationLog.direction` | Outbound contact or an inbound reply/callback. Legacy direction stays unknown. |
| Logged by/when | `recordedByUserId`, `recordedAt` | Staff attribution and server save time, separate from actual contact time. |

Client and clinic links are required. Visit and reminder links are optional, so a client can have a check-in without a scheduled task. The existing task status, provider ownership and instruction remain useful. Audit history remains intact. `requestId` and the existing locked transaction/audit replay checks prevent duplicate staff saves; changing the method, response or time on the same save reference causes a conflict.

No extra receptionist inputs are necessary yet. The current interface supplies the result and scheduling details; the contact method stays unknown until it is actually selected or supplied. It does not silently record every follow-up as a phone call.

## API and future outreach

The existing client action endpoint accepts optional `channel`, `direction`, `responseText`, and `occurredAtIso` when logging contact. Contact time requires an explicit timezone and cannot be in the future; omitted time uses the server's current time. Scheduling rejects contact-specific fields. Scheduling never counts as a contact attempt.

The manual endpoint assigns `source = manual` itself. Manually logging a WhatsApp conversation is still a manual record with `channel = whatsapp`. A future verified WhatsApp callback would use `source = integration` and the same channel/response fields. Existing `metadata` can retain provider message references and delivery details; integration-specific validation and deduplication remain future work.

Sending or delivering a message does not mean the client responded. Only an explicit contact result updates contact recency; delivery-only records do not update either the last logged attempt or last successful contact. Reception-entered feedback remains optional. Legacy notes mix staff instructions and feedback, so they retain their original meaning instead of being relabelled as client responses.

Both current staff logging and retained legacy response logging write communication records for actual contact outcomes. Pure rescheduling and closing a task as unnecessary create no contact record. Reads include older audit-based outcomes, use actual contact time for recency, and avoid showing domain/audit duplicates. Communication records participate in the existing client merge handling; archived profiles remain read-only. Profile communication reads preserve the actor's location scope.

Google review requests remain a separate purpose for later work. No external messaging or automatic scheduling was added.

## Migration and checks

Migration `20261010_000028_followup_contact_records` adds the fields and relations, checks valid follow-up methods/results/responses, and copies existing independent contact audits into communication records. It keeps the original audits, unknown historical methods/direction, and original timestamps. Existing staff scheduling audits recover known date-only precision only when their due date still matches the reminder. Older records without that evidence remain unknown.

- Applied only to isolated local `workflow_eye_test_20261009`: all 28 migrations are recorded, status up to date. Nine independent contact logs preserved; all 14 reminder IDs, statuses and dates unchanged. `.codex-temp/followup-model-migration-{deploy,status,preservation}.log`.
- Full suite: 418 passed, zero failures/skips. Final targeted API/HTTP checks cover shared contact storage, channel/response/time validation, retries, backdated contacts, delivery versus response, tenant boundaries, location scope and archived writes. `.codex-temp/followup-model-{suite,unit,http}.log`.
- Prisma validation/generation, API types/build and formatting passed. Local API restarted with the updated model; readiness returned 200.
- Fresh-database rehearsal remains pending: the local application database role lacks CREATE DATABASE. The PowerShell rehearsal wrapper also failed on native stderr handling; direct Prisma deploy/status succeeded. `.codex-temp/followup-model-{fresh-migrations,migration-rehearsal}.log`.
- Whole-schema comparison reports existing index differences and a provider-slot default mismatch (baseline migration: 30; schema: 60). The new communication columns/relations match the applied migration. Those unrelated differences need separate release review; no schema sync was performed. `.codex-temp/followup-model-schema-diff.log`.

Production is unchanged. Before rollout, run the full migration rehearsal in CI and clinic acceptance. The [next UI slice](44-followup-ui-and-visit-payments.md) implements work views, compact appointment controls, client timelines and visit payments. Optional response/method inputs remain pending.
