# Defensive schedule review — DD-2026-10-09

Reviewed October 9, 2026, on `codex/weekly-clinic-workflow`. Scope: Day timeline records, booking capacity, lifecycle transitions and failed Day navigation. This is a focused source review and local synthetic workflow check; production rollout is pending.

## Resulting behavior

Confirmed visits remain occupied records. Completed, no-show and cancelled visits remain visible at their original time, including on past dates. Desktop uses separate lanes for overlapping records; mobile lists each record chronologically. Cancellation reasons remain visible after replacement. Active visits sharing a cancelled interval show **Rebooked time**, with the cancellation count and reasons. Completed records use **Cancellation history**, without assuming event order.

History is a separate display layer. It never creates bookable start candidates or changes the API's capacity rules. Booking uses the original availability cells, including desktop **+** controls beside historical records. Cancelled/completed/no-show records do not reserve capacity under the existing lifecycle rules. Active reservations and buffers still block their full interval.

## Findings and fixes

| Severity | Finding | Resolution |
| --- | --- | --- |
| P1 | A provider shared across locations could expose another location's client name, service and cancellation reason in the grid. | Keep cross-location occupancy, but omit appointment IDs/summaries and cancellation details outside the requested location. Details actions remain unavailable. API regression passed. |
| P2 | Failed Day navigation could retain the previous day's grid beneath a new date heading. | Clear grid/records before fetching, ignore aborted requests, reject mismatched date/provider responses and show an unavailable state. Retry invalidates existing planning caches. Live failure/recovery passed. |
| P2 | Historical off-grid times could become availability candidates or split one active visit into multiple blocks. | Generate extra candidates only from blocking appointments. Project history onto existing rows and group consecutive cells with the same appointment ID. Regression passed. |
| P2 | Mobile history and availability at the same start time could share React keys. | Keys include state and record ID; mixed grid/record snapshots deduplicate appointment IDs. Regression passed. |

The final independent source review found no remaining P1/P2 issues in this changed behavior. This does not certify every application route.

## Preserved defenses

- Organization/location access filters and cross-tenant rejection remain in place. Missing detail records never enable booking on occupied cells.
- Conditional lifecycle updates prevent duplicate completion/recall transitions.
- Existing idempotency scopes/payload hashes, provider row locks, exclusion constraints and buffer checks remain authoritative. No new booking or lifecycle write path was added.
- Invalid history dates/durations, other providers/dates and duplicate IDs are ignored. A partially refreshed snapshot remains conservatively occupied.

## Verification

- Full suite: **388 passed, 0 failed; 1 database-dependent HTTP check skipped**, exit 0. Final focused web run: **48 passed**; API scheduling: **25 passed**.
- API/web typecheck, lint (0 warnings), API/web builds, formatting, web data boundary and secret checks passed, exit 0. Logs: `.codex-temp/history-*.log`.
- Isolated local database: actual Confirm → Check in → Complete, cancellation with reason, then confirmed replacement. October 17, Dr. Pratik, 10:00–10:30 has three separate records. No real patient data or messages were used.
- Live Edge: three distinct records, two history cards and zero page overflow at 1440/390/320px. Completed details show the correct status/client/time without a repeat Complete action. Screenshots: `output/playwright/history-overlap-desktop.png`, `history-mobile-390.png`.
- Injected a scheduling HTTP 503 only into the test browser. Old records/grids/slot controls disappeared; removing the failure and pressing Retry restored October 10's 35 current records and enabled availability controls. User eye-test changes were preserved.
- Earlier isolated PostgreSQL release checks: all 27 migrations and all 4 integration tests passed. See [eye-test setup](35-clinic-eye-test.md).

## Limits and remaining work

Overlapping history can widen desktop columns; scrolling stays inside the grid. Mobile uses a list. Cancellation markers express an interval overlap, not a permanent successor relationship; they do not infer chronology for terminal visits. Archived/deleted records follow existing visibility rules. History outside the day's existing grid is not projected onto invented booking rows.

Private upload approval, CI and production verification remain pending. Apply migration `20261008_000027_custom_booking_procedures` before the dependent rollout. Confirm behavior on physical phones and with production permissions after deployment. [Current handoff](progress.md).
