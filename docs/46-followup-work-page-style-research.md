# A simpler follow-up work page

2026-10-10. Research only, following the user's clarification: simplify the follow-up work page first. The client profile may use tabs, with important details always visible. No application code, records or automation changed.

## Current friction

Inspected the signed-in local `/followups` view and its implementation. Six peer views mix scheduled work, history and client discovery. Rows repeat visit/type/reason information and offer Log, Schedule and History together. Staff must decide where to work and which action to take before contacting anyone. The existing header-row table, phone numbers and optional last-contact notes are useful and should remain.

## Official product references

| Product | Documented pattern | Clinic adaptation |
| --- | --- | --- |
| [Cliniko recall report](https://help.cliniko.com/en/articles/1023943-recalling-patients) | Patient table with contact information and contact recording from the list. | Phone, due date and one main action visible per row. Record an outcome rather than only ticking completion. |
| [Dentally recall report](https://help.dentally.com/en/articles/3563878-how-to-use-the-recalls-report) | Phone and sticky Actions columns with Record a call / Book now. Its guide says these actions are still rolling out. | Work from the queue; show booking only when relevant. Do not adopt automatic recall generation. |
| [Pipedrive contextual activities](https://support.pipedrive.com/en/article/activity-contextual-view) | Open activity details within the list and navigate between activities. | A small log panel that preserves the list, filters and scroll position. |
| [HubSpot consecutive tasks](https://knowledge.hubspot.com/tasks/complete-tasks) | Start selected tasks and work through linked records in sequence. | Optional later “one client at a time” mode for a dedicated contact session. |
| [Todoist Today](https://www.todoist.com/help/todoist/get-started/plan-your-day-with-the-today-view-UVUXaiSs) | Today presents tasks dated for that day; Upcoming is separate. | A calm daily starting point with clinic-specific contact context. |

Four public guide screenshots were captured and visually inspected. Cliniko's screenshot is an older illustrative screen; vendor capability claims come from current guides. These are reference patterns, not vendor trials or proof of staff usability.

## Recommended direction

Use a daily list and a short result panel. Put Today, Upcoming and History in the main navigation. Today should include a separately labelled Overdue group, then today's contacts with later-today times explicit. This changes today's aggregation from the present implementation and will need implementation checks. Avoid making staff switch views to discover overdue work.

Keep New follow-up accessible. Put Recent visits and Not contacted in X days under “Find clients to contact”, as separate suggestion views. Show existing plans so staff do not create duplicates. Visiting a suggestion view creates no reminders.

Use three desktop columns: Client / reason; When / last contact; Action. Include phone, relevant completed visit and upcoming return context where available. Put the optional last-contact note beside its outcome; long notes can expand. On phones, combine context into the client cell and keep a visible Action header.

Main action: Log result. Secondary: Reschedule the existing reminder. History belongs inside the panel or client profile. Book appointment appears only when needed. Provider-review and permission restrictions remain visible and enforced.

Log result opens a small panel: choose response, optional note, save. Show next-date controls only for Contact later; date/time comes from staff, including later today. Method and actual contact time are available without dominating the form. Never invent a method. Feedback fields remain a separate planned decision. No answer preserves the reminder; successful contact follows the current explicit resolution rules. No automatic next reminder.

Compare this with a sequential contact mode (useful later, more disruptive during reception interruptions) and a status board (adds state/dragging work and obscures date-driven contact). Recommendation is design judgment pending clinic acceptance.

## Review artifact and checks

[Visual reference board](design/followup-work-style-board.html), served locally at <http://127.0.0.1:3134/>. It includes references, three approaches, a fictional work-list sketch and a non-saving result-form example. The preceding client board remains available at port 3133.

Verified: 18 browser assertions passed, including reference loading, Today/Upcoming/History navigation, conditional next-date input, explicit result selection, no-answer handling and no page overflow at 1440/390/320px. Screenshot: `output/playwright/followup-work-style-recommendation.png`; log: `.codex-temp/followup-work-style-check.log`. Formatting passed for 427 text files; whitespace check passed, exit 0. An initial sandbox-launched preview listener timed out; replacing only that temporary server restored the preview. No full application suite is required for this research-only artifact.
