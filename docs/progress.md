# Current progress

Updated: 2026-10-09. Branch: `codex/weekly-clinic-workflow`. Current slice: calendar presentation after the owner's eye test. Changes remain local; not deployed.

## Completed locally
- Verified lean context setup: 149-word instructions, bounded handoff, optional integrations disabled. [Maintenance details](34-usage-and-context-budget.md).
- Schedule blocks every occupied 15-minute cell, permits self-overlapping reschedules, shows weekdays and sticky Week headings.
- Week columns doubled to 280px on desktop and fill the mobile panel, with contained horizontal scrolling. Day's main date label includes the weekday.
- Desktop/mobile share Month's seven weekday headings, dual dates, today/selection markers and provider dots. Consecutive cells for one appointment render as one Day block; separate visits retain gaps and chronological keyboard order.
- Custom procedure snapshots and 15-minute duration choices flow through availability, holds, confirmation, edits and rescheduling.
- Yellow unconfirmed, provider color confirmed/arrived, red cancelled history with reason. Cancelled time stays bookable; overlapping replacements hide the notice.
- Reception actions: Confirm → Check in → Complete. Appointment links open client profiles; clinical signing authority is unchanged.
- Six-calendar-month recall defaults, adjustable dates/actions, due call list, recorded outcomes and next recall. Staff overrides survive later visits. Historical missing recalls require an explicit staff review action; no writes on reads.
- Fixed two runtime dependency audit findings with compatible locked updates.

## Verified
- Latest `npm test`: 379 passed, 0 failed; one database-dependent HTTP check skipped (exit 0). Final focused calendar/workflow run: 42 passed, 0 failed, 0 skipped (exit 0).
- API/web typecheck, lint (0 warnings), web/API builds, formatting, schema validation, route inventory, data boundary and secret checks: exit 0.
- Runtime dependency audit: 0 vulnerabilities (exit 0).
- Live signed-in Edge at 320/390/1440px: zero page overflow, Week sticky drift 0px, 360px mobile columns. AD/BS Month keeps 42 distinct civil dates and the selected date aligned. Day has no duplicate active visit blocks; details and cancelled-slot booking retain their correct doctor/time. [Walkthrough and evidence](35-clinic-eye-test.md); `.codex-temp/calendar-*.log`.
- Found existing WSL PostgreSQL; created an isolated `workflow_eye_test_20261009` database. All 27 migrations and all 4 PostgreSQL/HTTP integration tests passed (0 skipped).
- [Eye test](35-clinic-eye-test.md): API/web running on localhost:4000/3000. October 10, 08:00–18:00: 33 synthetic appointments for Pratik/Mira plus 3 recall cases. Live reception login, custom-procedure Complete action, self-overlapping 10:15 reschedule choice and 390px layout (0 overflow) verified; cases left unchanged.

## Remaining and release gates
- Push/draft PR await explicit approval: automatic review rejected uploading private code to `subigyastha/Dental-System-`, branch `codex/weekly-clinic-workflow`. Approval requested in this chat; do not retry until granted.
- CI remains pending; local migration and PostgreSQL gates pass. The owner accepted the base eye test; revised layouts are ready for another look.
- Apply migration `20261008_000027_custom_booking_procedures` before dependent API/web rollout; verify deployment and signed-in mobile/keyboard booking/recall behavior.
- Reconcile existing-client recalls through the staff review action; clients without completed visits need a clinic rule.
- Clarify “procedure review.” WhatsApp/SMS, broadcasts and Google reviews are planned later. Phone contacts remain deferred.

Requirements and messaging plan: [weekly feedback](33-weekly-client-feedback-2026-10-08.md). Booking behavior: [Schedule notes](32-schedule-occupancy-and-duration.md). Update this file in place; keep under 500 words.
