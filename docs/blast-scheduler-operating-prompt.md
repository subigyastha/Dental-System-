# BLAST Scheduler Operating Prompt

Design and build the Schedule view from the perspective of a front-desk scheduler or clinic coordinator under real operating pressure.

The scheduler must be able to:

- See a Nepali-style month calendar where BS is primary and AD is shown diagonally below each day.
- Click a day and immediately see that day’s appointment list.
- Understand how many appointments exist per day and whether any day has operational risk.
- Filter the day by provider without losing calendar context.
- Inspect safe available slots before booking.
- Book directly into an available slot using provider, service duration, and buffer time.
- Add a missing customer without leaving the workflow.
- Delete an incorrect schedule entry quickly.
- Preserve backend correctness: ISO/AD datetime is source of truth, BS is a localization layer.

Scheduling strategy:

- Working window: 8:00 AM to 6:00 PM Nepal time.
- Candidate slots step every 15 minutes.
- A slot is available only if service duration plus buffer does not overlap an active appointment for the provider.
- Cancelled appointments release capacity.
- Slot booking should prefill the appointment form with date, time, provider, and service.

UX standard:

- Calendar first, list second, slot booking beside it.
- Avoid modal chains for day inspection.
- High-frequency actions stay visible: add appointment, add customer, delete schedule, book slot.
- Every scheduling action should update local UI immediately and write through to Supabase.
