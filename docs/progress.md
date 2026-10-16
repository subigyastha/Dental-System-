# Current progress

Updated: 2026-10-16. Release branch: codex/production-followups-performance. User authorized release of pending work on existing free hosting plans. Production rollout is pending CI and migration checks.

## Current slice

Release includes staff-directed follow-up logging/scheduling, Table/Status board, shared client table, calendar AD/BS navigation and booking date limits, client histories and visit payments. Existing tenant/auth, booking idempotency and billing permissions remain. [Workflow](41-staff-directed-followups.md), [model](43-followup-data-model.md), [UI/payment evidence](44-followup-ui-and-visit-payments.md), [follow-up table](47-followup-table-and-status-board.md), [client table](48-client-directory-shared-table.md).

Free-plan performance changes: single coalesced sign-in API wake request; 60-second sign-in/initial bootstrap deadlines; one grouped status count replacing five database statements; validated API revision metadata. No recurring keep-alive or paid plan changes. [Release details](50-free-plan-performance-release.md).

## Verified

- Node 24 local suite: 432 passed, zero failures, one database HTTP test skipped. Isolated HTTP attempt failed because local PostgreSQL is stopped (P1001); CI disposable PostgreSQL must pass before rollout.
- API/web types, lint, formatting, boundary, routes, secrets, Prisma validation and whitespace passed, exit 0. Production dependency audit: zero vulnerabilities.
- API build and web webpack production build passed. Windows Turbopack child-process startup failed inside/outside sandbox; Linux CI uses the standard build. Logs: `.codex-temp/release-20261016-*.log`.
- Prior UI acceptance: 42 client-table, 39 follow-up and 117 calendar assertions across desktop/narrow widths. Physical-device acceptance remains open.
- Oct 16 production baseline: 12 public probes returned 200. First API liveness 42.6s, warm 101–112ms; SELECT 1 readiness spends approximately 366ms inside Nest. Remote main/local starting HEAD and Vercel deployment match 4d243bc. Configured Supabase ends at migration 27, with migration 28/nine follow-up columns absent. Render SHA/plan/region unverified. [Assessment](49-production-status-and-latency.md).

## Remaining

1. CI fresh migration rehearsal, HTTP and booking/client/finance transaction gates; apply migration 28, deploy matched API/web, verify production revision/readiness and authenticated scope.
2. Inspect hosting region/effective pool settings and benchmark authenticated page latency. Free sleep and database network latency remain infrastructure limits.
3. Clinic/physical iOS/Android acceptance; review historical recalls and clients without completed visits.
4. Optional contact method/client-feedback inputs, messaging, broadcasts, Google reviews and provider notifications.

Local eye-test database: workflow_eye_test_20261009, API 4102/web 3102. PostgreSQL currently stopped. Launcher `.codex-temp/eye-test-servers.cjs api|web`. No production schema push; pre-existing index naming/provider-slot-default drift remains separate.
