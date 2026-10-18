# Current progress

Updated: 2026-10-18. Latest release [PR #8](https://github.com/subigyastha/Dental-System-/pull/8), 0918d48; workflow release [PR #7](https://github.com/subigyastha/Dental-System-/pull/7). Local main and Render/Vercel production match 0918d48. Free plans retained.

## Current slice

User confirmed the PWA schedule-loading fix works. Current slice: mobile scroll layout. Heading/date/filter/view controls scroll away; Day pins provider context, Week pins synchronized day headers with one page scroll, Month pins month/weekdays only within the calendar. Workspace header measured for sticky offsets. No domain/API/schema changes. [Layout/evidence](52-mobile-schedule-scroll.md).

Local UI 69 passed; types/lint/format/whitespace/webpack build passed. Interactive synthetic Edge checks: all three views at 320/390/767px; horizontal sync both directions, provider selection, month release and desktop 70vh behavior passed. CI/release pending; physical PWA acceptance remains.
Released staff-directed follow-up logging/scheduling, Table/Status board, shared client table, calendar AD/BS navigation and booking date limits, client histories and visit payments. Tenant/auth, booking idempotency and billing permissions remain. [Workflow](41-staff-directed-followups.md), [model](43-followup-data-model.md), [UI/payments](44-followup-ui-and-visit-payments.md), [follow-up table](47-followup-table-and-status-board.md), [client table](48-client-directory-shared-table.md).

Free-plan improvements: one coalesced sign-in wake request, 60-second sign-in/initial bootstrap deadlines, grouped follow-up status counts and API revision metadata. Render SUPABASE_POOL_MODE=session replaces transaction pooling on the existing database. No recurring keep-alive, paid plan or region migration. [Release evidence](50-free-plan-performance-release.md).

## Verified

- [Release CI](https://github.com/subigyastha/Dental-System-/actions/runs/38935475067): 436 passed, zero failures/skips. Fresh migration rehearsal, authenticated/cross-tenant HTTP, booking/client/finance transactions, types, lint, boundary/routes/secrets, dependency audit and standard Linux builds passed.
- Local Node 24: 432 passed, zero failures, one HTTP test skipped. Isolated attempt could not connect to stopped local PostgreSQL. API and webpack web production builds passed; Windows Turbopack child-process startup failed. Evidence: `.codex-temp/release-20261016-*.log`.
- Production migration 28 applied; all nine follow-up columns confirmed. All four existing reminders retained ids/statuses/dates; communication count preserved. No schema push. Existing index naming/provider-slot-default drift remains outside this release.
- Render confirmed Free/Singapore; Supabase pooler Tokyo. Both hosting deployments succeeded at application merge SHA; public API revision matched. Twelve public post-release probes returned 200; four protected endpoints denied anonymous access with 401.
- Warm Nest SELECT 1 processing approximately 366ms before versus 73ms after session pooling (80% lower). Direct readiness 469–475ms before versus 163–184ms warm after. Small samples, not authenticated page p95. Raw `.codex-temp/production-latency-after-20261016.json`.
- Prior browser evidence: 42 client-table, 39 follow-up and 117 calendar assertions across desktop/narrow widths.

## Remaining

1. Signed-in production clinic acceptance and physical iOS/Android checks. Browser has no clinic session; no synthetic production bookings/payments were created.
2. Render idle sleep still applies. Benchmark authenticated page latency and investigate remaining sequential database work; regions remain Singapore/Tokyo.
3. Staff review historical recalls/clients without completed visits; optional method/client-feedback inputs, messaging, broadcasts, reviews and provider notifications.

Local eye-test database workflow_eye_test_20261009, API 4102/web 3102; PostgreSQL stopped. Launcher `.codex-temp/eye-test-servers.cjs api|web`.
