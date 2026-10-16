# New booking dates and historical visits

Updated: 2026-10-10. Local change; not deployed.

## Implemented

New-booking date pickers (guided booking and the modal's direct/availability paths) pass today's `Asia/Kathmandu` AD date as the shared picker's inclusive minimum. The existing picker dims/disables earlier grid cells in AD and BS, guards keyboard and date commits, and sets the native AD input minimum. Today stays selectable; existing availability/time validation decides which times can be booked. Reservation browsing and appointment editing/rescheduling were not changed. No API, auth, holds, idempotency, clinical or billing changes.

## Historical entry recommendation — not implemented

Useful for care delivered during downtime, omitted visits discovered later, and importing paper/legacy history. An appointment that the client missed is a no-show, not a completed visit. Existing appointments should use the authorized outcome workflow; absent historical entries need an explicit history workflow rather than relaxing new-booking validation.

This is not necessary for the picker improvement. Prioritize it separately if staff regularly lose visit history or need legacy migration; clinical decisions can otherwise lack relevant context. Product scope and clinical/billing behavior need agreement before implementation.

Proposed workflow: an authorized staff member selects the client, actual event date/time, provider, event type (visit/no-show), source and required reason for late entry. Store actual event time separately from immutable entry time and actor; label it as historical, prevent duplicates, and audit corrections. Enforce tenant and role boundaries. Clinical documentation/signature stays with authorized providers under [Record governance](09-client-identity-and-record-governance.md). Decide separately how appointment-linked Records are represented. Do not automatically create invoices, payments, inventory movements, schedule occupancy, reminders or follow-ups. Any financial reconciliation needs its own authorized workflow.

## Verification

Evidence: `.codex-temp/booking-picker-types.log`, `booking-picker-lint.log`, `booking-picker-calendar.log`, `booking-picker-workspace.log` (same directory). Results are summarized in [progress](progress.md). Interactive browser acceptance remains pending.
