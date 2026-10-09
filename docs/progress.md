# Current progress

Updated: 2026-10-09. Branch: `codex/weekly-clinic-workflow`. Weekly feedback is implemented locally; not deployed.

## Completed locally
- Verified lean context setup: 149-word instructions, bounded handoff, optional integrations disabled. [Maintenance details](34-usage-and-context-budget.md).
- Schedule blocks every occupied 15-minute cell, permits self-overlapping reschedules, shows weekdays and sticky Week headings.
- Custom procedure snapshots and 15-minute duration choices flow through availability, holds, confirmation, edits and rescheduling.
- Yellow unconfirmed, provider color confirmed/arrived, red cancelled history with reason. Cancelled time stays bookable; overlapping replacements hide the notice.
- Reception actions: Confirm → Check in → Complete. Appointment links open client profiles; clinical signing authority is unchanged.
- Six-calendar-month recall defaults, adjustable dates/actions, due call list, recorded outcomes and next recall. Staff overrides survive later visits. Historical missing recalls require an explicit staff review action; no writes on reads.
- Fixed two runtime dependency audit findings with compatible locked updates.

## Verified
- `npm test`: 365 passed, 0 failed; one HTTP integration check skipped without a disposable database (exit 0).
- API/web typecheck, lint (0 warnings), web/API builds, formatting, schema validation, route inventory, data boundary and secret checks: exit 0.
- Runtime dependency audit: 0 vulnerabilities (exit 0).
- Edge synthetic Schedule fixture at 390px and 1280px: sticky drift 0px after scrolling 300px; page overflow 0px; cancellation reason and booking hint visible. Layout evidence, not authenticated end-to-end acceptance.
- Local logs: `.codex-temp/feedback-*.log`; recall checks: `.codex-temp/recall-*.log`.

## Remaining and release gates
- Draft PR/CI: rehearse all 27 migrations and run PostgreSQL booking/client/finance and HTTP containment tests. No local disposable PostgreSQL is installed/configured.
- Apply migration `20261008_000027_custom_booking_procedures` before dependent API/web rollout; verify deployment and signed-in mobile/keyboard booking/recall behavior.
- Reconcile existing-client recalls through the staff review action; clients without completed visits need a clinic rule.
- Clarify “procedure review.” WhatsApp/SMS, broadcasts and Google reviews are planned later. Phone contacts remain deferred.

Requirements and messaging plan: [weekly feedback](33-weekly-client-feedback-2026-10-08.md). Booking behavior: [Schedule notes](32-schedule-occupancy-and-duration.md). Update this file in place; keep under 500 words.
