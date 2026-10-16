# Staff-directed follow-up plan

Implemented locally: October 10, 2026. Open [Follow-ups](http://localhost:3102/followups). This flow supersedes the automatic scheduling described in [the earlier implementation](39-followup-workflow.md). Production is unchanged.

## Purpose

Help staff check in with clients after any completed service, including clients returning soon for continuing treatment and clients who will not return soon. A planned return does not replace a check-in. Staff should also be able to review clients who have not visited recently.

Doctors sometimes request follow-ups. The tool must let authorized staff record that request and choose when to contact the client. The system highlights relevant clients and contact history; staff decide whether and when to create a reminder.

## Phase 1: simple tracking — implemented

- After appointment completion, offer **Log follow-up** and **Schedule follow-up**. Keep the same actions accessible from the client profile and follow-up view.
- Show recent completed visits separately as suggestions, with client names and visit context. A suggestion is not a scheduled task and must not create one automatically.
- Today shows due/overdue reminders explicitly scheduled by staff. Preserve the familiar Today layout.
- Scheduling records the staff-selected date and optional time. It does not count as contact. Logging contact does not automatically schedule another reminder.
- Record the basic contact attempt/check-in, staff member and time. Show the client’s last visit, relevant upcoming appointment, contact recency and next planned contact to support staff decisions.
- Allow staff to schedule a follow-up requested by a doctor and retain its client/visit context. Do not infer timing from procedure type or send automatic provider notifications.
- Remove automatic follow-up scheduling, including post-visit tasks, six-month recalls and recurring next recalls. Review other automatic follow-up creation paths too. Preserve existing contact history and staff-created reminders; do not silently delete existing records.
- Do not introduce fixed retry intervals or automatic reminders for every completed visit. Check-ins for long-absent clients remain staff decisions.

Current defaults: show last attempt and last successful contact separately; keep suggestions visible after logging or scheduling, with their updated contact status. Recent visits uses a clearly labelled past-30-days browsing filter; All clients supports other check-ins without inventing a clinical contact interval. Future visit dates do not replace the latest past completed visit. Staff can use Later today or Tomorrow, but no date is prefilled for a new reminder.

Log requires only Spoke to client or No answer. Standalone contact logs create no task. For an existing reminder, No answer preserves its date and instruction; Spoke to client finishes that reminder without recurrence. A previously blocked provider-review task remains blocked for staff review. Rescheduling preserves the doctor’s instruction unless staff explicitly replace it. Existing reminders and previous notes are retained; no automatic-task cleanup or historical backfill runs.

Queue and suggestions use header-row tables. On phones, visit/contact details sit below the client so the main actions remain visible. Client profiles share contact recency, the two actions and recent contact/scheduling history. Existing task history remains available separately.

Contact records now use the shared `CommunicationLog` model, with retained `client_contact` audit history. Staff-created reminders use `FollowUpTask`. Tenant/location/provider checks, active-client writes, customer locking, task timestamp checks and matching-payload retry protection apply. Archived contact history remains read-only. A local additive migration stores method, source, response and actual/recording times; [model details and current checks](43-followup-data-model.md). External messaging remains later work.

## Verification

- Full suite: 416 passed, 0 failures/skips. `.codex-temp/staff-followup-suite.log`. Updated real PostgreSQL HTTP coverage includes no automatic tasks on concurrent completion, independent contact logs, manual schedule replay, contact recency, existing recall completion without recurrence, tenant isolation and archived history/write protection.
- Separate booking/client/finance PostgreSQL checks: 3 passed. Type checks, lint, API/web builds, route inventory (150 handlers), data boundary, secrets, formatting and whitespace passed, exit 0. Final targeted HTTP and web checks passed after the archived-history adjustment. See `.codex-temp/staff-followup-*.log`.
- Signed-in Edge: 44 assertions across completion, contact logging, manual scheduling/rescheduling, optional time, Later today, client history, nested keyboard/Escape and visible actions/no overflow at 1440/390/320px. `.codex-temp/staff-followup-browser.log`, `staff-followup-completion-browser.log`; screenshots in `output/playwright/staff-followups-*.png`.

## Phase 2: client feedback capture — planned

Add a simple, intuitive way for reception to type and save what the client says about how they are doing and their treatment experience. Support both continuing treatment and completed treatment. Feedback text is optional: not every contact or unanswered attempt needs a detailed response.

The model and API now support optional client response text; the interface input remains planned. Decide the smallest useful input and how it appears in client history before changing the views. Keep this separate from merely recording that contact happened. Reassess the existing local response drawer against this phase split rather than treating the prototype or earlier implementation as the final requirements.

SMS, WhatsApp, calling integration, broadcasts and Google review collection remain later work. All verification uses the isolated synthetic local clinic; no production records or external communications changed. Production rollout and physical-device acceptance remain pending.
