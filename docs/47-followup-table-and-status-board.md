# Follow-up Table and Status board

2026-10-10. Local implementation; no deployment or migration. Supersedes the three-view navigation proposed in [research](46-followup-work-page-style-research.md). The user chose exactly two display modes and common table controls.

## Behavior

- Table and Status board display the same queue and retain search, filters, ordering and loaded pages when switching.
- Shared controls: search by client/phone/reason; status and due-date filters; sort by due date, client, status or last update; ascending/descending; Reset filters. Sortable table headers expose `aria-sort`. Filters apply to the entire server result before pagination, not only loaded rows.
- Board columns map existing records: Open → To contact; InProgress → In progress; Waiting → Waiting; Blocked → Provider review; Done → Done. Logging/rescheduling continues through the existing staff forms and authorization. There is no drag-to-change-state shortcut or automatic reminder creation.
- Each column shows matching total and loaded count. A column with unloaded records tells staff to load more rather than claiming it is empty. Shared Load more adds the next 25-record page. Desktop board scrolls horizontally; column height is bounded with vertical scrolling. Phones stack columns and retain contact details, outcomes and optional notes.
- Done and unauthorized tasks offer history only. Booking appears when the recorded outcome requires an appointment and booking is authorized. Clinical/provider permissions, idempotency and finance behavior remain unchanged.
- Recent visits / Not contacted remain under Find clients to contact. Suggestions load only when opened and create no reminders.

## Shared table contract

`apps/web/components/workspace/data-table.tsx` provides DataTable, typed column definitions, sortable accessible headers and DataTableControls. The follow-up task and client-suggestion tables now share its table markup. The work queue uses its search/sort/reset toolbar with task-specific filters as children.

Use this template for subsequent table work. Keep data loading and domain filters in each page; validate allowed sort fields server-side, preserve tenant/location predicates, apply ordering before pagination, add a stable ID tie-breaker and reset the cursor after any filter/sort change. Never label a loaded-page sort as a full-result sort. Existing Clients/Finance/Inventory and other domain pages have not been migrated wholesale in this follow-up slice. Client suggestions retain their existing server ordering and search/interval controls; they do not claim the task queue's sort options.

API additions: `view=all`, optional `status`, `period=today|overdue|future`, `sort=due|client|status|updated`, `direction=asc|desc`. Existing view parameters remain compatible. Independent period filtering includes completed records when explicitly requested. Due periods use the Nepal clinic date. Board totals and cursor checks use the same authorization and filter scope. No new routes or schema fields.

## Evidence

- Full suite: 424 passed, 0 failed, one HTTP database check initially skipped. Separate isolated-database HTTP run passed that check; combined 425 passed, no unresolved skips. Logs: `.codex-temp/followup-table-full-tests.log`, `followup-table-http-check.log`.
- Focused UI: 67 passed; API follow-up: 21 passed. Types, lint, API build and web production build passed. The web compiler needed normal Windows filesystem access after the sandbox attempt returned access denied.
- Signed-in Edge: 29 actual-data assertions plus 10 pagination/dialog assertions passed, at 1440/390/320px. Actual tests cover both views, server sorting/filtering and shared state. Thirty-record browser fixtures test unloaded columns, Load more, retained rows and cursor reset without database writes. Existing log dialog opens/closes without saving. Logs: `.codex-temp/followup-table-browser-check.log`, `followup-table-pagination-check.log`.
- Format, Prisma boundary, 150-route inventory, secrets and whitespace checks passed. Screenshots: `output/playwright/followup-table-controls-desktop.png`, `followup-status-board-desktop.png`.

Local review: <http://localhost:3102/followups>. Synthetic clinic only. Research previews at 3133/3134 remain references. Clinic acceptance and broader table adoption remain next steps; production/migration limits in [progress](progress.md) still apply.
