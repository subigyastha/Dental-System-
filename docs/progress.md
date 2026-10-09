# Current progress

Updated: 2026-10-09. Branch: `main`. [PR #6](https://github.com/subigyastha/Dental-System-/pull/6) approved and merged as `138c1a9`. Further workflow acceptance will use production, as requested.

## Completed
- Full-duration occupancy/buffers and self-overlapping reschedules; custom procedure snapshots and 15-minute duration choices throughout booking/holds/confirmation/edit/reschedule.
- Reception: Confirm → Check in → Complete; client-profile links and clinical signing permissions preserved.
- Six-calendar-month recalls, staff adjustments/outcomes, due call list and explicit historical recall review.
- Wider sticky Week columns, weekday labels, shared responsive Month and continuous Day blocks.
- Completed/no-show/cancelled Day records retained; replacement cards show cancellation reasons. Desktop overlap lanes/mobile entries preserve history without reserving capacity.
- Defensive fixes: cross-location summary leakage, stale controls after failed Day loading, historical availability candidates and duplicate mobile keys. Retry uses existing cache invalidation. [DD-2026-10-09](36-defensive-schedule-review.md).

## Verified release evidence
- [PR CI](https://github.com/subigyastha/Dental-System-/actions/runs/37960532386) passed migrations, tests, PostgreSQL transactions, types/lint/builds, data boundary, route inventory, secrets and dependency audit. Local suite: 388 passed, 0 failed, 1 HTTP database check skipped; separate isolated database run passed all 4 integration checks and 27 migrations.
- Live local Edge: 1440/390/320px, no overflow, history details and failed-load Retry recovery verified. [Local walkthrough](35-clinic-eye-test.md).
- Production Supabase migration `20261008_000027_custom_booking_procedures` applied before merge, exit 0; migration ledger confirms completion. Evidence: `.codex-temp/release-production-migration.log`, `release-production-db-status.log`.
- Vercel reports successful production deployment of merge `138c1a9`. Login/manifest return 200; anonymous Reservations returns 307 to `/login`. [Production web](https://dental-system-web.vercel.app).
- Render live/ready retry returned 200; database is reachable. First checks timed out, then recovered. Exact deployed API revision still needs hosting-dashboard verification. Evidence: `.codex-temp/release-api-health-retry.log`.
- Main merge CI passed: [merge run](https://github.com/subigyastha/Dental-System-/actions/runs/37961448420). Consult GitHub for its latest result; documentation commits trigger their own run.

## Next session
1. Verify Render deployed the merged API revision. Health/readiness pass, but they expose no commit identifier; check hosting logs/version before treating the full rollout as verified.
2. Signed-in production acceptance: Schedule time/duration/continuations, custom booking, hold recovery, 15-minute self-overlap reschedule, Confirm → Check in → Complete, retained completed/cancelled history, cancellation reason after replacement, recall overrides and permissions. Do not copy the local synthetic fixture into production.
3. Physical iOS/Android: PWA installation, keyboard/safe areas, tapping/scrolling, AD/BS date alignment and Day/Week/Month layouts.
4. Reconcile historical recalls through staff review; agree a clinic rule for clients without completed visits.

Messaging, broadcasts, Google/procedure reviews remain later work; phone contacts are deferred. Local API/web and isolated `workflow_eye_test_20261009` remain available. Production database is separate. Requirements: [weekly feedback](33-weekly-client-feedback-2026-10-08.md); [booking rules](32-schedule-occupancy-and-duration.md).
