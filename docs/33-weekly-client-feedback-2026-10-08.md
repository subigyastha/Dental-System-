# Weekly client feedback — recorded October 8, 2026

Source: the client's weekly meeting notes, relayed by the project owner in this chat. This is a refined record of the feedback, with repeated points consolidated. The recording date is not a claim about when the meeting took place.

## Product direction

Reception handles the appointment journey in the same system. Everyday actions must be short and predictable. Reuse Clients, client profiles, Schedule and Dashboard rather than adding separate recall or calling screens. Keep one authoritative booking/availability path, preserve history and use a small, consistent set of colors.

## Changes requested now

| ID | Client feedback | Intended behavior and acceptance |
| --- | --- | --- |
| WF-01 | Contact every client for follow-up by default every six months, with case-specific adjustments | Completion plans the next routine recall using six calendar months, not 180 days. Staff can adjust its date and next action in the client profile. Due/overdue clients remain visible until staff record an outcome or set the next attempt. The existing Clients directory provides the call list; Dashboard links to it. No automatic calls or texts in this stage. |
| WF-02 | Reduce appointment steps for reception | Main flow: Unconfirmed booking → Confirmed → Checked in → Completed. No separate Start action is required. Existing InProgress appointments can still complete. Operational completion must not grant permission to sign or alter clinical Records. Completion handles routine recall planning without a separate mandatory step. Cancellation, no-show and rescheduling remain exception actions. |
| SC-01 | Daily view should show confirmation and cancellation at a glance | Unconfirmed appointments use yellow. Confirmed/arrived appointments use the provider's primary color. Cancelled history uses red and includes the cancellation reason. Text labels accompany colors. No new black status is introduced. |
| SC-02 | Keep cancellation visible until its time is reused | A cancelled appointment does not reserve capacity. Its history appears at its original time while that interval has not been replaced by an active booking. Replacement bookings take precedence in Schedule; cancellation remains in appointment/client history. Clicking a cancelled interval can still start booking. |
| SC-03 | Cancellation reasons should be visible wherever cancellation is shown | Persist and return the reason with cancelled appointments. Show it in Schedule detail/history and the client's appointment timeline. Historical records without a reason show a clear fallback rather than inventing one. |
| SC-04 | All views should identify the weekday | Day and Month show weekday as well as date; Week retains weekday/date headings. AD/BS dates continue to share one civil date. |
| SC-05 | Keep Week headings visible while scrolling | The weekday/date header stays at the top of the actual Schedule scrolling area. It must work without hiding controls or causing page overflow on mobile. |
| CX-01 | Reach the client profile easily from an appointment | Appointment details and Dashboard appointment rows link to the existing client profile. Existing access checks govern profile data. |
| BK-01 | Allow a custom procedure and duration | Choose a catalogue service or enter a visit-specific custom procedure name. Custom procedures are appointment snapshots and do not create catalogue services. Booking, holds, confirmation, edits and rescheduling reserve the same selected duration. |
| BK-02 | Duration choices must use fixed blocks | Only 15, 30, 45, 60 … minutes are valid. Remove arbitrary-minute entry. Validate positive multiples of 15 on the server as well as the form. Existing historical appointments keep their stored duration until explicitly changed. |
| BK-03 | Preserve the earlier urgent Schedule fixes | A 30-minute appointment covers both 15-minute cells. Its exact end becomes available only after any buffer. Rescheduling by 15 minutes may overlap the appointment's own previous interval, while other bookings/holds still conflict. |

## Planned after the core workflow is stable

1. **Messaging foundation:** capture channel preference/permission, use templates, link communication history to the client/appointment, track queued/sent/delivered/failed state, handle retries without duplicate delivery, and provide a clinic-wide stop control. Start with appointment reminders and recalls. Keep sensitive procedure details out of reminder text by default.
2. **WhatsApp and SMS integration:** choose supported provider(s), connect the clinic sender, verify delivery callbacks, support reschedule/cancellation suppression, and test with synthetic recipients before enabling live messages. A user's reply/opt-out must be reflected in the same client record. Existing due-client lists support manual calling without automated dialing.
3. **Broadcast messaging:** reuse the same sender, preferences and delivery log. Add explicit audience selection, recipient count, preview, scheduling and campaign approval. Re-check eligibility and deduplicate recipients at send time. Keep broadcast/marketing permission separate from operational reminder eligibility.
4. **Google reviews:** after messaging works, add the clinic's review link to an eligible post-visit message. Then consider listing reviews and drafting/replying through an authorized Business Profile connection. Sending a review request does not prove that the client reviewed the clinic; do not automatically link public reviewers to private client records.

The external integration work is planned, not enabled by this meeting record. No real messages, calls or review replies are sent during implementation/testing.

Official references checked October 8, 2026: [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/) requires recipient permission and honoring opt-outs; platform-initiated conversations use approved templates, with replies governed by its 24-hour service window. [Google's review guidance](https://support.google.com/business/answer/3474122) supports a review link and prohibits incentives for reviews. [Google Business Profile review APIs](https://developers.google.com/my-business/content/review-data) document listing and replying to reviews through an authorized profile. Re-check provider policy, account eligibility and pricing when implementing these later stages.

## Clarification still needed

**Procedure review:** the phrase may mean a post-treatment recovery review or a view of completed procedure records. The project owner has been asked to clarify. Do not invent a new clinical workflow or page until the meaning is established. Existing visit/procedure records remain available.

**Existing clients:** routine recall rollout must cover clients whose earlier completed visits predate this feature. Reconcile from the latest completed visit and preserve existing case-specific tasks; record backfill execution separately from code delivery. Clients with no completed visit need an explicit clinic rule rather than an invented last-visit date.

## Delivery tracking

This record describes accepted feedback and the planned sequence. Implementation, validation and deployment status are maintained in [current progress](progress.md). Do not read a requirement in this document as proof that it is already live.

Related records: [prior urgent Schedule fixes](32-schedule-occupancy-and-duration.md), [workflow/state-machine baseline](12-workflow-and-state-machine-catalog.md), [deployment runbook](16-deployment-security-and-observability-runbook.md).
