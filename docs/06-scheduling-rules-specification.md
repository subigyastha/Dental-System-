# Scheduling Rules Specification

| Field | Value |
| --- | --- |
| Product | ClinicFlow — Koi Workflow System |
| Version | 0.1 (draft) |
| Last updated | 2026-08-15 |
| Status | Normative release specification |
| Canonical time system | Gregorian/AD ISO-8601 timestamps |

## 1. Purpose and scope

This specification defines how ClinicFlow determines availability and commits provider-based appointments. It is the source of truth for scheduling behavior. The NestJS scheduling service is responsible for applying these rules; client applications may preview slots, but may not decide that a booking is valid.

The production release schedules **providers**, not chairs, rooms, equipment, or other resources. A provider may have at most one capacity-reserving appointment at a time. Existing `Resource`, `resourceId`, and chair-related UI/schema behavior are not part of the release scheduling contract and must not be required to create, validate, display, or block an appointment. They may be retained internally only as dormant future-expansion data until their governing specification is approved.

## 2. Time, calendar, and timezone rules

1. Every persisted instant—including appointment start/end, blocks, audit events, due dates, and notifications—is an AD/ISO-8601 UTC timestamp.
2. Each organization and location has an IANA timezone. `Asia/Kathmandu` is the default for new Nepal organizations and locations, but scheduling calculations must use the appointment location's timezone, falling back to the organization timezone.
3. A local scheduling date and time is converted to one unambiguous UTC instant before it is saved. Date/time input without a resolved location timezone is invalid.
4. AD is the default calendar mode throughout the application. BS is an optional, derived, read-only display value supplied through the central calendar conversion service/API. It is never stored as the appointment date, used as a database query key, or used for conflict calculation.
5. The UI must show enough context to prevent date ambiguity: date, local time, timezone where relevant, and an AD/BS label when both calendar representations are shown.

## 3. Core scheduling objects

| Object | Rule |
| --- | --- |
| Provider | The sole capacity owner in this release. The provider must be active and bookable. |
| Service | An active organization service. A provider may perform it only when provider-service configuration permits it. |
| Appointment | A discrete booking for exactly one client, one provider, one location (where the organization has locations), and one or more services. |
| Clinical duration | Sum of selected service durations, using a provider/location-specific duration override where configured. |
| Buffer | Post-service provider time reserved after the clinical duration. The booking buffer is the maximum of selected service buffers, provider-availability buffer, and any explicitly authorized appointment buffer. |
| Availability window | A recurring weekly provider work interval, optionally location-scoped and bounded by effective dates. |
| Recurring block | A weekly interval in which a provider is unavailable. |
| One-time block | A specific timestamp range in which a provider is unavailable. |
| Slot | A candidate start time. It is advisory until the API commits an appointment successfully. |

## 4. Availability evaluation

For a requested appointment, the system evaluates in this order:

1. Resolve the authenticated actor's organization and permitted locations; never accept tenant identity from the request as authority.
2. Resolve the appointment location timezone and convert the AD local request to an instant.
3. Confirm the provider belongs to the organization, is `Available` (not `Away` or `Inactive`), and is permitted at the selected location.
4. Confirm every selected service belongs to the organization, is active, and is supported by the provider when explicit provider-service configuration exists.
5. Compute clinical duration and buffer.
6. Find active provider availability for the applicable local day of week and location scope. Availability must include the requested date within `effectiveFrom` and `effectiveTo` (inclusive when an end date is supplied).
7. Confirm the full reserved interval fits inside an availability window: `[startsAt, startsAt + clinicalDuration + buffer)`.
8. Reject the request if it intersects an effective recurring block, one-time provider block, capacity-reserving appointment, or a provider eligibility restriction.
9. Revalidate all checks atomically when writing the appointment. A prior slot-preview result never guarantees a booking.

### Rule precedence

1. A provider that is inactive, away, absent from the organization, or unauthorized for the location is not bookable.
2. One-time blocks override recurring availability.
3. Recurring blocks override availability.
4. A confirmed capacity reservation overrides an otherwise open availability window.
5. A location-specific availability or provider-service setting overrides an organization-wide/default provider setting.

## 5. Slot generation

- Candidate starts occur on an Owner-controlled organization interval; the default is **15 minutes**. Release choices are **5, 10, 15, 20, 30, or 60 minutes** rather than an arbitrary integer.
- The slot-start interval controls which start times are offered and how the calendar grid is divided. It does **not** change service duration, appointment duration, provider capacity, or buffer rules.
- The Owner changes the interval from clinic scheduling settings. The API validates the allowlist, records an audit event, increments the schedule configuration version, invalidates affected schedule/slot caches, and causes active slot selection/holds to refresh before confirmation. Existing appointments retain their persisted starts and durations.
- A future provider/location override requires a separate approved rule. Until then, one organization interval applies consistently to every provider and location.
- Clinical duration and buffer do not need to be multiples of the slot interval.
- The system generates only candidates that pass the same availability rules used at booking time.
- The earliest permitted start is the current local time; starts in the past are rejected.
- Staff may book up to **12 calendar months** ahead. There is no additional same-day cutoff because public/client self-service is out of scope.
- A schedule grid is a read model, not an authority. It must derive its visible range from configured business hours and actual availability—not a hard-coded 08:00–19:00 range.
- Changing an appointment, provider availability, block, service duration/buffer, or provider-service eligibility invalidates affected slot and schedule read models.

## 6. Conflict and concurrency rules

### 6.1 Capacity reservation

Capacity-reserving appointments have statuses `Scheduled`, `Confirmed`, `CheckedIn`, and `InProgress`. Their reservation interval is:

```text
[appointment.startsAt, appointment.endsAt + appointment.bufferMinutes)
```

Two reservation intervals for the same provider must never overlap. The interval comparison uses half-open intervals: an appointment ending at 10:30 (including its buffer) permits the next booking to start exactly at 10:30.

`Completed`, `Cancelled`, `NoShow`, and `Rescheduled` do not reserve future provider capacity. Follow-up need is an outcome/task property, not a capacity-reserving appointment status.

### 6.2 Commit-time guarantee

The API must prevent race-condition double bookings. The required implementation is a database-backed transactional guard, not an in-memory cache or preflight check alone. The implementation may use an appropriate PostgreSQL range exclusion constraint, an equivalent provider-range lock plus recheck, or another documented mechanism with the same correctness guarantee.

The commit path must:

1. start a transaction;
2. obtain the required provider/date-range protection;
3. reload blocking appointments and blocks;
4. run the availability test; and
5. create/update the appointment and audit/workflow event together or fail with a conflict response.

No overbooking is permitted in the production release. The existing `allowOverlaps` setting must remain disabled and must not bypass these rules.

## 7. Appointment lifecycle and scheduling effects

| State | Meaning | Capacity | Allowed next states |
| --- | --- | --- | --- |
| Scheduled | Created and awaiting confirmation/check-in. | Reserved | Confirmed, CheckedIn, Cancelled, NoShow, Rescheduled |
| Confirmed | Client has confirmed attendance. | Reserved | CheckedIn, Cancelled, NoShow, Rescheduled |
| CheckedIn | Client has arrived. | Reserved | InProgress |
| InProgress | Clinical work has begun. | Reserved | Completed |
| Completed | Appointment concluded; a Record and follow-up task may be created. | Released | None |
| Cancelled | Appointment was cancelled before check-in. | Released | None |
| NoShow | Client did not attend. | Released | None |
| Rescheduled | Original appointment replaced by a linked successor. | Released | None |

### Follow-up requirement

`FollowUpRequired` in the current implementation is a legacy appointment status. The target model records follow-up requirement on the completed/no-show/cancelled outcome and creates a linked follow-up task. It must not be used as an open appointment state or to reserve provider capacity.

### Transition requirements

- Every transition is server-validated against the table above; accepting an arbitrary status enum is prohibited.
- Every transition creates a workflow event and audit record with actor, prior state, next state, timestamp, and reason/note where required.
- A completed appointment cannot be cancelled, rescheduled, or deleted. Any financial or clinical correction follows its own governed lifecycle.
- Only a valid cancellation/reschedule can release a pre-check-in booking. Direct deletion is not a production scheduling operation.

## 8. Cancellation, no-show, and reschedule policy

### Cancellation

- Owner, Admin, Manager, Scheduler, and Receptionist may cancel an appointment before check-in within their organization/location scope.
- A Provider may cancel only their own pre-check-in appointment. An Assistant cannot cancel independently.
- Cancellation reason is mandatory and consists of a standardized reason plus optional explanatory text.
- Cancellation records the actor, time, prior status, reason, and linked recovery work where applicable. It releases the provider reservation immediately.

### No-show

- An authorized staff member may mark an appointment `NoShow` only after the scheduled end plus buffer has elapsed.
- Owner or Admin may override that timing rule; the override reason is mandatory and audited.
- A no-show creates or updates a `NoShowRecovery` follow-up task according to the Follow-up State Machine specification.

### Rescheduling

- Rescheduling preserves history. The original appointment transitions to `Rescheduled`; a new appointment is created as its successor and links to the original appointment.
- The original appointment's reschedule reason, actor, time, and successor ID are audited. The successor receives fresh availability/conflict validation.
- If billing has begun, the reschedule flow must preserve invoice/payment traceability and require an authorized billing decision before changing financial linkage. It must not silently move completed payments between appointments.
- A Provider may reschedule only their own pre-check-in appointment; Owner/Admin/Manager/Scheduler/Receptionist may reschedule within scope. Assistants require an explicit delegated capability and do not receive it by default.

## 9. Recurring appointments

- A recurrence rule creates individually persisted child appointments; each child has its own status, audit history, and client communication.
- A recurrence may not create appointments beyond the 12-month booking horizon.
- Each child is validated at creation and must be revalidated if its date, provider, service timing, availability, or block changes.
- A conflict affects only the conflicting child appointment. The user must explicitly choose whether to skip, alter, or resolve it; the system may not silently overbook.

## 10. Availability and block administration

- Owner, Admin, Manager, and Scheduler may manage any provider's availability, recurring blocks, and one-time blocks within scope.
- A Provider may manage only their own availability or block request, subject to clinic approval policy. Receptionists do not administer provider availability. Assistants have no default schedule-administration capability.
- Availability or block edits must not silently invalidate existing appointments. The system identifies affected bookings, requires an explicit resolution plan (retain, reschedule, cancel, or override by authorized policy), and audits both the change and every resolved booking.
- Effective dates are mandatory for availability. End dates are optional for an ongoing pattern. Invalid intervals, overlapping malformed windows, and `endsAt <= startsAt` are rejected.
- Only the Owner changes the organization slot-start interval in phase one. Provider availability editors may change working windows and buffers but cannot silently create their own grid cadence.

## 11. Required API and UI behavior

- The UI submits location, provider, services, AD date/time, and optional scheduling notes; the API calculates canonical duration, buffer, and end time.
- The API must return stable conflict categories without leaking another client's sensitive details: provider unavailable, outside availability, blocked time, service unsupported, booking horizon, or provider conflict.
- If a conflict occurs after a displayed slot was selected, the UI explains that availability changed and offers refreshed valid slots.
- BS display and conversion use the shared calendar API/service. A UI component must not implement an independent conversion or send BS dates as booking authority.
- Schedule views should display only the client information the current user's permissions permit. Provider access to the client directory is allowed initially by product decision; clinical write authority remains separately controlled.

## 12. Release acceptance criteria and current deltas

The release is not ready until these criteria are true:

- Default calendar configuration is AD, and every scheduling calculation respects the organization/location IANA timezone.
- Provider-only scheduling works without a required resource/chair and resource-related fields do not create conflicts in release flows.
- Availability effective dates, location scope, buffers, blocks, and provider-service rules are enforced in both slot previews and commit-time validation.
- A database-backed concurrency test proves simultaneous bookings cannot create overlapping provider intervals.
- A regression test proves different providers do not create false conflicts and that one provider cannot be double-booked.
- Status transitions, cancellation reasons, no-show timing, reschedule successor creation, and follow-up creation are server-enforced and audited.
- Every affected cache/read model is invalidated after schedule-changing actions; cache absence or staleness cannot compromise booking correctness.
- Owner slot-interval changes are validated, audited, reflected in slot search and Day/Week grids, and never rewrite existing appointments or service durations.
- Unit, integration, API, and end-to-end tests cover date conversion, timezone boundaries, booking horizon, availability exceptions, effective dates, buffer boundaries, roles, transitions, and concurrent requests.

### Known implementation deltas

The current repository retains a dormant resource model and inconsistent slot constants: booking search uses a fixed 15-minute cadence while provider mapping and schedule grids still expose/hard-code 60 minutes. Owner-controlled organization cadence, availability effective dates, complete location-timezone removal of hard-coded Nepal assumptions, and shared multi-instance cache invalidation remain open. Database overlap protection, governed lifecycle commands, bounded schedule startup, and PostgreSQL booking-concurrency coverage are implemented; authenticated responsive and representative-volume performance evidence remains open.
