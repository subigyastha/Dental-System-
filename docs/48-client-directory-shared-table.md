# Clients uses the shared table template

2026-10-10. Local change only. This slice updates the client directory table; client profile layout and production are unchanged.

## Changes

- Client directory and Due follow-ups tables use the same DataTable headers/spacing and DataTableControls toolbar as the follow-up work page.
- Search by name, phone, email or code; filter by All clients / Due follow-ups and the existing risk labels; Reset filters restores name ascending and all clients/risks.
- Sort by client name, client code, phone, last recorded visit or risk. Headers for Client, Contact, Last visit and Risk support keyboard activation and announce sort direction with `aria-sort`. Code sorting is available in the toolbar.
- Sorting and filters apply server-side before 25-client pagination, with a stable ID tie-breaker. Changing a filter/sort cancels pending page requests and resets pagination. Added pages are deduplicated.
- Matching client totals are shown separately from loaded count. Counts are opt-in (`includeTotal=true`), so booking/merge searches keep their existing bounded read behavior.
- Phone rows retain contact, risk/recorded visit or every due task preview, remaining-task count and profile/review actions. The desktop layout keeps separate columns. No page overflow at tested widths.
- `lastRecordedVisitIso` exposes the nullable recorded visit date. The directory says Not recorded when absent, rather than substituting a client-record update date. Existing `lastVisitIso` contracts remain compatible.
- Due-filter deep links (`/clients?followUp=due`) remain supported. Help text describes manually scheduled tasks; it no longer says unscheduled historical recalls are included. Suggestions still create no tasks.

Tenant/archive/merge exclusions, follow-up location scope, existing client creation/merge permissions and `order=recent` booking behavior are retained. A page cursor must still belong to the tenant and current filters; stale/foreign cursors fail with a refreshable conflict. No schema or route changes.

## Checks

- Full suite: 430 passed, 0 failed, one HTTP database check initially skipped. Separate isolated-database HTTP run passed that check: 431 combined, no unresolved skips. Logs: `.codex-temp/client-table-full-tests.log`, `client-table-http-check.log`.
- Focused tests: web 69/API client and DTO 30 passed. Types, lint, API/web production builds passed, exit 0. Logs: `.codex-temp/client-table-types.log`, `client-table-lint.log`, `client-table-api-build.log`, `client-table-web-build.log`.
- Signed-in Edge: 42 assertions passed at 1440/390/320px. Tests cover full-result sorting, real pagination, risk/code search, due filters, missing visit dates and responsive actions. Log: `.codex-temp/client-table-browser-check.log`.
- Format, Prisma boundary, 150-route inventory, secret scan and whitespace checks passed. Screenshots: `output/playwright/client-table-desktop.png`, `client-table-phone.png`, `client-table-due-phone.png`.

Review locally at <http://localhost:3102/clients>. API 4000 uses isolated `workflow_eye_test_20261009`; no production or client-data edits. Follow-up template details: [47](47-followup-table-and-status-board.md). Remaining rollout constraints: [progress](progress.md).
