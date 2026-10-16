# Follow-up UI and visit payments

2026-10-10. Implemented locally, uncommitted; production is unchanged. Builds on the [staff-directed workflow](41-staff-directed-followups.md) and [contact model](43-followup-data-model.md). No new migration in this UI slice.

## Resources reviewed before implementation

- [HubSpot task views](https://knowledge.hubspot.com/tasks/filter-tasks-and-manage-task-views): Today, Overdue and Upcoming views help staff find time-based work.
- [Pipedrive activities](https://support.pipedrive.com/en/article/activities): activities stay linked to the relevant contact and can be scheduled from that context.
- [Pipedrive contacts timeline](https://support.pipedrive.com/en/article/contacts-timeline): contact recency helps staff find people needing attention.
- Existing clinic resources: [earlier research](38-followup-ux-research.md), invoice/payment drawers, appointment details and client profile. Official vendor documentation was reviewed; no vendor account trials were performed.

These patterns informed separate work views and contact history. Staff retain control over whether and when a reminder is created.

## Implemented screens

**Appointment details:** completed visits have a compact Follow-up section with Log follow-up, Schedule follow-up and the next planned reminder, if any. Log payment sits alongside it. Logging does not require a reminder. Before completion, the sheet explains when post-visit follow-up becomes available; payment entry is available independently.

**Follow-ups:** New follow-up opens a searchable client picker, then a date form. The picker shows an already-planned follow-up. Views are Today, Overdue, Upcoming, Done, Not contacted and Recent visits. Tables retain headers; phone layouts keep information/actions visible. Existing response notes remain visible.

Today covers the entire Nepal calendar day, including contacts planned for later today. Overdue means before today's midnight; Upcoming starts tomorrow. Original attention/upcoming API filters remain compatible. No default date is submitted when opening a new form. Later today and Tomorrow require a staff click.

Not contacted has an editable interval, initially 30 days, with Apply and search. Filtering happens before pagination in PostgreSQL. It uses successful contact rather than unanswered attempts and includes clients with no recorded contact. Tenant/location boundaries also apply to recency. This is a search view, not a reminder rule. Recent visits remain separate suggestions and create no tasks.

**Client profile:** details appear first, followed by follow-ups, payment history and visits. Follow-ups show the next planned reminder or its absence, last attempt, last successful contact and a timeline. Earlier due reminders stay discoverable. Schedule edits an existing manageable upcoming reminder; otherwise it opens an empty form. Cancelling creates nothing. The timeline includes older task responses and shared communication records without mirrored audit duplicates. Client response text and staff notes remain distinct.

Payment history shows the latest 50 payments from recent invoices, with date, invoice, amount, method and status. This is bounded recent history, not a complete ledger. Mobile rows show all five details without sideways scrolling. Archive controls sit below care history.

## Payment flow

Log payment queries invoices for the selected visit/client. The API validates organization/location and returns the authoritative visit location. Existing draft creation, invoice issue, payment recording and idempotency rules are reused. Visit drafts lock client/location and prefill the procedure description; staff enter the price. Opening a sheet never creates or issues an invoice.

Reception can create a draft and record payment against an issued invoice. Issuing requires Owner, Admin or Finance, as before; the sheet explains that handoff. Payments record money already received. A synthetic browser check created a NPR 500 draft for TEST P04, issued it as the local owner, recorded Cash as reception and verified the receipt in client history. Fixtures remain in the isolated local database.

## Verification

- Full root suite: **420 passed, 0 failed/skipped**, exit 0. PostgreSQL HTTP checks cover clinic-day views, contact-age filtering, legacy timeline entries, deduplication and foreign-visit rejection. `.codex-temp/followup-ui-suite.log`.
- Final web subset after layout/copy refinements: **65 passed**, no failures/skips. `.codex-temp/followup-ui-web-tests.log`.
- Web/API types, full web lint and both builds passed. `.codex-temp/followup-ui-{types,lint,api-build,web-build}.log`.
- Signed-in Edge: **57 assertions passed** across queue/profile/pickers and 1440/390/320px. Saved a manual reminder; checked next-date visibility, existing reminder editing/cancellation, contact filters, response notes, payment role handoff/receipt history, nested Escape and overflow. Corrected asynchronous invoice-selection focus. No application runtime errors in inspected console logs.
- Formatting, web/Prisma boundary, route inventory (150 handlers), secrets and whitespace passed. `.codex-temp/followup-ui-{format,boundary,routes,secrets}.log`.
- Screenshots: `output/playwright/followup-ui-{desktop,mobile,client-desktop,client-mobile,appointment,payment}.png`. Browser scripts/logs: `.codex-temp/followup-ui-browser-*`.

Local entry: [Follow-ups](http://localhost:3102/followups). API 4000; database `workflow_eye_test_20261009` only. Optional method/feedback inputs and outreach integrations remain later work. Migration 28 rollout, fresh rehearsal and production/physical-device acceptance retain the [previous release limits](43-followup-data-model.md).
