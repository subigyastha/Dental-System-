# Follow-up workflow

**Earlier implementation:** automatic scheduling has been replaced by [the staff-directed flow](41-staff-directed-followups.md). Optional client feedback is a later phase. The implementation and checks below document the superseded local version.

Implemented locally on October 10, 2026. Open [Follow-ups](http://localhost:3102/followups). Port 3000 is now occupied by another local app; the clinic app runs on 3102 against the separate `workflow_eye_test_20261009` database. Synthetic sign-in accounts are documented in [the earlier clinic walkthrough](35-clinic-eye-test.md). The prototype on 3101 remains a reference only.

## Staff flow

1. Complete a visit. Its transaction queues one linked post-visit contact for **the next calendar day at 09:00 Nepal time**, alongside the separate six-calendar-month recall. This is an operational contact default, adjustable by staff, not a clinical recovery interval. Only new completion transitions queue contact; existing completed visits are not backfilled.
2. The completed appointment stays open and shows a small follow-up card. **Log follow-up**, **Change date**, and **Not needed** are immediately accessible. Schedule's card excludes routine recalls.
3. **Follow-ups** in the sidebar/mobile More menu opens the work list. Needs attention includes due/overdue work; Upcoming includes later-today contacts; Done shows finished history. Rows show client/contact, visit/reason, last response with optional note, next action, and controls. A client's tasks retain separate outcomes.
4. Choose one response. Reached/no further action finishes the task. No answer/contact later requires a future contact time. Later today and Tomorrow are shortcuts. Provider attention requires a reason and remains actionable, naming the treating provider; staff contact that provider directly. Not needed requires a reason and preserves history.
5. Appointment needed stays open. Save and book uses the existing booking flow with the current client and treating provider selected. A saved appointment-needed task also offers direct Book appointment, without logging another attempt. Opening/leaving booking does not finish the follow-up; staff log its resolution.
6. The client profile puts the same queue above record details and shows response history through the shared drawer. Manual creation from older completed visits is collapsed under a disclosure. Historical recall review remains explicit.

Notes and retry times survive response switching and drawer close/reopen within the current page. Unsaved drafts do not survive a reload. Finished tasks are read-only. History loads older responses in bounded pages. Search misses and failed loads have distinct messages and retry controls.

## Data and permissions

Reuse `FollowUpTask` and append structured `AuditLog` entries containing response, note, actor, server time, next contact and request ID. No schema migration or messaging provider is needed. Date changes are distinguished from contact results. Legacy outcome audit records remain readable.

Completion claims, customer locks, optimistic task timestamps and replay checks protect against duplicate completion, duplicate response submissions and conflicting edits. A changed payload cannot reuse a saved request ID. Response/audit/next-recall changes commit together. Completing a procedure task never creates another routine recall; completing a recall preserves the existing recurring behavior.

Queue, history and cursor queries are tenant/location scoped. Booking/client capability checks and treating-provider write restrictions remain in force. Archived/merged clients cannot receive new response logs; an inactive or mismatched booking client reference is rejected. Drawers make background controls inert, trap visible keyboard focus, and isolate nested Escape handling.

## Verified checks

- Full suite: **417 passed, 0 failures, 0 skips**, including real PostgreSQL HTTP tests of concurrent completion, retry replay/conflicts, later-today timing, provider review, history pagination and tenant/cursor isolation. Evidence: `.codex-temp/followup-implementation-suite.log`.
- Separate booking/client/finance PostgreSQL tests: **3 passed**, exit 0. Evidence: `.codex-temp/followup-{booking,client,finance}-postgres.log`.
- API/web types, web lint, API/web builds, route inventory, Prisma boundary, secret scan, format and diff whitespace checks passed, exit 0. Logs: `.codex-temp/followup-implementation-*.log`.
- Signed-in Edge: **40 browser assertions** across completion, saved notes, draft retention, nested focus/Escape, past-time rejection, queue/profile continuity, prefilled booking and 1440/390/320px layouts. No page/drawer horizontal overflow. Evidence: `.codex-temp/followup-browser-{flow,table,profile,book-prefill}.log`. Screenshots: `output/playwright/followups-desktop.png`, `followups-mobile-drawer.png`.

## Remaining

Local implementation is not deployed. Confirm clinic contact timing/working-day policy before rollout; no holiday calendar or automatic retry limit is assumed. Production acceptance and physical-device checks remain pending. SMS, WhatsApp, calling, Google review requests and automatic provider notifications remain later integrations. This slice logs staff actions; it sends no external communication.
