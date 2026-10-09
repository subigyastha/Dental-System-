# Current progress

Updated: 2026-10-09. Branch: `codex/weekly-clinic-workflow`. Current slice: release readiness after retained Day history and defensive review. Owner authorized commit/push on October 9; production is not deployed.

## Completed locally
- Occupied 15-minute cells and buffers block booking; self-overlapping reschedules exclude only the original visit.
- Custom procedure snapshots and 15-minute duration choices flow through availability, holds, confirmation, edits and rescheduling.
- Reception: Confirm → Check in → Complete. Client-profile links and clinical signing permissions preserved.
- Six-calendar-month recalls, adjustable dates/outcomes, due call list and explicit historical recall review; staff overrides preserved.
- Wider Week columns, sticky headings, weekday labels, shared desktop/mobile Month and continuous Day blocks. Compatible dependency fixes completed.
- Completed/no-show/cancelled records remain on Day timeline. Overlapping history uses desktop lanes/mobile entries; replacement cards retain cancellation reasons. Capacity remains separate, with available-time **+** controls.
- Defensive review fixed cross-location summary leakage, stale actionable grids after failed navigation, historical availability candidates and duplicate mobile keys. Retry reuses existing cache invalidation. [DD-2026-10-09](36-defensive-schedule-review.md).

## Verified
- Full suite: 388 passed, 0 failed; 1 database-dependent HTTP check skipped (exit 0). Final focused web: 48 passed; API scheduling: 25 passed.
- API/web typecheck, lint (0 warnings), API/web builds, formatting, web data boundary and secret checks: exit 0. Evidence: `.codex-temp/history-*.log`.
- Live Edge: three distinct overlapping Completed/Cancelled/Confirmed records at 1440/390/320px, zero page overflow, correct completed details. Injected Day HTTP 503 removed stale records/slot controls; Retry restored the correct date.
- Prior release gates passed: schema/routes, dependency audit (0 vulnerabilities), all 27 migrations and all 4 PostgreSQL/HTTP integration tests against the isolated local database.
- Local API/web remain on localhost:4000/3000; Supabase unchanged. [Eye-test guide](35-clinic-eye-test.md): October 10 full day for Pratik/Mira; original 33 records plus 3 recall cases, with later user edits preserved. Added October 17 Pratik 10:00 history/replacement cases through real lifecycle APIs.

## Remaining and blockers
- Owner authorized private branch upload; the earlier approval blocker is resolved. Push/draft PR and CI are the current release step. No blocking code gaps found in this clinic-workflow slice; messaging/review work is excluded.
- CI, production migration/deployment and physical-device acceptance remain pending. Apply `20261008_000027_custom_booking_procedures` before dependent rollout.
- Dense history may widen desktop grids; overlap markers do not establish permanent successor relationships. Review scope/limits are documented.
- Reconcile missing historical recalls through staff review; agree a rule for clients without completed visits.
- Clarify “procedure review.” WhatsApp/SMS, broadcasts and Google reviews remain later work. Phone contacts deferred.

Requirements: [weekly feedback](33-weekly-client-feedback-2026-10-08.md). Booking rules: [schedule notes](32-schedule-occupancy-and-duration.md). Update in place; keep under 500 words.
