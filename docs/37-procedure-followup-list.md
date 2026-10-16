# Due follow-ups and procedure reviews

Recorded: 2026-10-09. Local implementation; not deployed.

## Agreed scope

The owner clarified that procedure reviews mean post-treatment follow-ups. Google review requests are a separate later feature. Start with the due-follow-up list; SMS, WhatsApp and calling integration follow later.

## Behavior

- Reuse Clients and client profiles. The existing due filter shows task reasons, due dates and next actions, with up to three previews and the full due count per client. Each profile shows every outstanding task.
- Clients now uses a semantic table with a top header row and All clients / Due follow-ups view buttons. The due columns are Client, Contact, Follow-up / reason, Due date, Next action and Actions. Horizontal scrolling stays inside the table on mobile. References: [HubSpot index columns](https://knowledge.hubspot.com/records/customize-index-page-columns), [Salesforce data table](https://www.lightningdesignsystem.com/2e1ef8501/p/86f13a-data-table/b/09e06c).
- Due tasks include Open, InProgress, Waiting and Blocked with dueAt at or before now. Completed tasks and future attempts are excluded. Search and client pagination remain available; clients retain the directory's name ordering.
- Historical completed visits without an active recall remain available for explicit staff review. A client included only for that reason is labeled as historical recall review, rather than presented as having an overdue task. Reads do not create tasks.
- From a client profile, staff may schedule a procedure follow-up against one of the most recent 15 appointments, provided that visit is completed and authorized. Staff enter the agreed date, procedure/reason and next action. No clinical timing is inferred.
- Case tasks use the existing TreatmentContinuation type and assigned visit provider. Routine six-calendar-month recalls remain separate.
- An active case task for the same visit prevents another. Identical retries return the existing task; a different request returns a conflict directing staff to update it. Creation and audit share a transaction under the client lock.
- Staff use existing outcome, next-date and completion controls. Case-task completion does not create another routine recall. Dates use the existing Nepal clinic civil-date convention.
- No automated sends, dialing, Google requests, clinical record amendments or production data changes.

## Checks

All commands below exited 0 after the test query-limit correction:

- API v1: 154 passed; API auth: 45 passed; web phase-two: 51 passed. Total: 250 passed, zero failures/skips. Corrected client fixture recheck: 24 passed.
- Web/API types and production builds; web lint; formatting; diff whitespace; route inventory (145 handlers), web Prisma boundary and secrets scan.
- Logs: `.codex-temp/procedure-followup-*.log`. The first final API type pass caught a missing required limit in a test; corrected API type and client-test rechecks passed.

Table revision: web phase-two 51 passed, web types and targeted lint passed, exit 0. The local API was restarted through the existing isolated eye-test launcher to load its compiled changes; readiness returned 200. Signed-in local Edge verified the six headers and populated rows at 1440px and contained table scrolling at 390px (page width 390px). Screenshots: `output/playwright/followup-table-desktop.png` and `followup-table-mobile.png`.

No schema migration or dependencies changed. Interactive production acceptance remains pending deployment. No production acceptance or physical mobile walkthrough was performed for this slice.

## Later decisions

Choose clinic/provider follow-up timing rules if automatic task planning is wanted. Confirm clinic country and sender accounts before provider selection. Keep marketing eligibility separate, and do not equate a Google review request with a verified client review.

Related: [weekly requirements](33-weekly-client-feedback-2026-10-08.md), [workflow baseline](12-workflow-and-state-machine-catalog.md), [current progress](progress.md).
