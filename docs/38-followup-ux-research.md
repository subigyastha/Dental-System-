# Follow-up UX research

2026-10-10. Discussion only; proposals are not implemented or approved clinic policy. Official documentation was reviewed; no vendor account trials were performed.

## Existing patterns

| Product | Documented behavior | What to borrow |
| --- | --- | --- |
| [Dentally recalls](https://help.dentally.com/en/articles/3563878-how-to-use-the-recalls-report) | Contact counts, phone, Record a call and Book now actions in the report; actions are still rolling out to some practices. | Act from the queue without opening the full profile. |
| [Open Dental recall list](https://www.opendental.com/manual/recalllist.html) | Completed recall procedures update due dates. Contacted patients can temporarily leave the active queue and return when another reminder is due. | Automatic eligibility and resurfacing replace staff memory. |
| [HubSpot tasks](https://knowledge.hubspot.com/tasks/create-tasks) | A logged activity can create the next task in the same editor, with quick due-date choices. | Record response and next action together. |
| [Dentally / FollowApp Care](https://www.dentally.com/en-ie/partners/followapp?hsLang=en-ie) | Post-visit monitoring and alerts for reported health updates. | Post-treatment care is distinct from routine recall and marketing. |

[Dentally's visit panel](https://help.dentally.com/en/articles/10184030-how-to-view-today-s-appointments-in-the-the-visit-management-panel/) also keeps context and outstanding actions beside the current screen. [HubSpot call outcomes](https://knowledge.hubspot.com/calling/create-custom-call-and-meeting-outcomes) demonstrates structured responses. These are patterns, not proof of the exact proposed flow below.

## Current implementation

The research informed the [earlier local implementation](39-followup-workflow.md), which creates post-visit contacts automatically. That design is superseded by the [staff-directed follow-up plan](41-staff-directed-followups.md): suggestions do not create tasks, staff choose timing, and detailed client feedback is a later phase. The sections below retain the earlier design discussion rather than current requirements.

## Proposed flow for discussion

1. Complete appointment → create one linked post-visit task automatically. Inherit client, visit, procedure label and provider. Use clinic-approved contact timing, with override; do not invent clinical intervals.
2. Completion acknowledgement tells staff the follow-up date. Schedule offers Log follow-up and Change date; no second creation form.
3. A prominent Follow-ups view within Clients defaults to due/overdue, ordered by next action date. Upcoming and Done are secondary views. Group a client's due items to reduce duplicate calls, retaining each task's own resolution. Label routine recall separately.
4. Each row shows contact, purpose, relevant visit, last response and one main Log follow-up action. Open a small drawer within the queue.
5. Require one response: Reached / no further action, No answer, Contact later, Appointment needed, Needs provider attention. Notes are optional except a brief escalation reason. Show next-date input only where needed; quick date choices follow approved operational rules.
6. Save records staff/time/response and updates the task. No answer stays open. Contact later returns to the active queue when due. Appointment needed offers prefilled booking and remains actionable until resolved. Provider attention routes to authorized staff.
7. Not needed with a short reason handles visits that should not receive contact. Preserve its history; do not infer global opt-out.

Task states: To contact → Waiting for next action → Done. Followed up is an attempt/result, not a global client state. Staff select the response; the application applies the appropriate state. Client profile places next action, last response and quick controls above chronological contact history.

## Decisions still needed

- Every completed visit versus clinic-selected procedures; latest owner idea favors every visit, with a Not needed exception.
- Clinic-approved contact timing, responsible team, retry interval/limit and custom-procedure fallback.
- Provider handoff and when booking-related tasks resolve.
- Activation boundary: avoid automatically backfilling every historical appointment.
- Preserve completion idempotency, tenant/location permissions, append-only attempts and clinic timezone behavior.

No application code, database data or external communication changed during research. [Implemented slice](37-procedure-followup-list.md); [progress](progress.md).
