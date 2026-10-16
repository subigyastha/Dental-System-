# Simplifying client and follow-up views

2026-10-10. Research only. No application code, reminders, contact records or billing permissions changed. The user asked to collect relevant product styles before the next UI implementation.

## Current view inspected

Signed-in local historical-client profile at 1440px: client identity is repeated in the header and details card; several empty fields consume space; full follow-up, payment and visit histories stack vertically. Merge duplicate is prominent despite being an occasional administrative action.

The historical client has an unfinished reminder earlier today, but the leading message is “No upcoming follow-up.” Both are technically compatible; together they make the next action unclear. A simpler summary should lead with the due reminder. Reschedule should edit that reminder, rather than create another just because no future reminder exists. Preserve all open tasks and existing provider-review restrictions.

## Collected product styles

| Product / official resource | Observed pattern | Useful adaptation |
| --- | --- | --- |
| [Jane patient dashboard](https://jane.app/guide/patient-profile-dashboard) | Compact identity/visit header, patient-section navigation, appointment/billing metrics with links. | Name, phone and client code first; a small amount of visit/contact context. Avoid copying a large metric dashboard. |
| [Pipedrive contact detail](https://support.pipedrive.com/en/article/contact-detail-view) | Summary/details beside separate Focus and History sections. | One obvious current-follow-up area; keep its actions separate from historical entries. |
| [Cliniko communications](https://help.cliniko.com/en/articles/1023851-using-the-communications-log) | Patient-specific communications section, compact entries and detail on selection. | Predictable Follow-ups, Payments and Visits navigation; reveal more only when needed. |
| [HubSpot record layout](https://knowledge.hubspot.com/records/work-with-records) | Record sections/tabs, activity filters and expandable/collapsible timeline details. | Short outcome/date rows, optional note preview and expandable staff/channel details. |
| [Dentally Account tab](https://help.dentally.com/en/articles/9690921-how-to-use-the-account-tab) | Separate invoice/payment views with expandable related items. | Keep payment history in its own view and retain a header-row table. |

Official documentation and its public screenshots were inspected. No vendor account trial or usability test was performed; suitability for clinic staff remains a design judgment. Browser screenshots of public guide images are in `output/playwright/reference-{jane,pipedrive,cliniko,hubspot}.png`, with source attribution in the board. They contain vendor demonstration records, not our clinic clients.

## Three layout directions

1. **Compact summary + tabs — recommended.** Client details stay first. Default Summary shows the relevant reminder, Log/Schedule controls and the latest recorded contact result. Follow-ups, Payments and Visits contain their full histories. This limits the initial reading/scrolling, at the cost of one click to open a history.
2. **Compact summary + collapsible sections.** Lowest structural change; staff can expand histories on one page. Opening everything recreates the current long page.
3. **Sidebar + work timeline.** Useful on large desktop screens, but adds complexity on phones. Borrow its hierarchy, rather than adopting the complete CRM layout.

The [visual reference board](design/followup-style-board.html) includes real product examples and an interactive, fictional-data sketch of direction 1. Live local preview: [UI references](http://127.0.0.1:3133/). Source screenshots are served locally from ignored browser artifacts; archive them with the board if it needs to be shared outside this workspace.

## Proposed behavior, not yet implemented

- Compact identity first; More client details reveals less-used fields. Clinical alerts remain visible when present. Missing information must retain “not recorded” semantics.
- Lead with an outstanding due reminder when one exists; otherwise show the next planned reminder, then a plain unscheduled state. Multiple reminders remain accessible. Task state is not a permanent state for the entire client.
- For a due reminder: Log follow-up / Reschedule. For a planned reminder: Log follow-up / Change time. With none: Schedule follow-up / Log follow-up. Staff still choose dates; no automatic reminders or recurrence.
- Show the latest contact result and its optional note near the actions. Keep staff notes distinct from client feedback. Detailed feedback/method inputs remain a separate planned slice.
- Move Merge/Archive into More actions. Preserve permissions and historical access.
- For the queue, make Today/Overdue/Upcoming the main work views. Put Recent visits/Not contacted in a discovery area and keep completed history easy to reach. Suggestions remain suggestions. Retain optional notes, search, table headers and visible mobile actions.

## Validation / next step

Board validation: 14 assertions passed for source-image loading, reminder states, tabs/keyboard, image expansion and 1440/390/320px fit. Formatting and whitespace checks passed. This checks the research artifact, not the proposed application implementation. Results: `.codex-temp/followup-style-board-check.log`; formatting: `.codex-temp/followup-style-format.log`. The initial board load logged a harmless missing favicon; the board now uses an inline icon.

Next: review the layout direction, then test a temporary client-view prototype against due/upcoming/no-reminder clients, multiple reminders, provider review, long notes and phone screens before updating the application. Previous implementation/evidence remains in [doc 44](44-followup-ui-and-visit-payments.md).
