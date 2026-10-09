# Clinic workflow eye test

Prepared locally on October 9, 2026, using the current branch. Open [the local app](http://localhost:3000/reservations). The separate WSL PostgreSQL database is `workflow_eye_test_20261009`; Supabase is unchanged.

Sign in as `reception@eyetest.local` with `ClinicEyeTest-2026!`. These credentials belong only to the synthetic local clinic. The owner account is `owner@eyetest.local`; doctor accounts are `pratik@eyetest.local` and `mira@eyetest.local`, using the same eye-test password.

Select **October 10, 2026 (Saturday)** in Schedule. Both doctors have availability from 08:00 to 18:00, with lunch blocked from 12:00 to 13:00. The original fixture contains **33 appointment records**: 17 for Dr. Pratik Shrestha and 16 for Dr. Mira KC. Subsequent eye-test edits change the live counts and statuses. All clients are labelled TEST and use synthetic numbers. Open gaps are intentional so booking and rescheduling can be exercised.

| Time | Dr. Pratik Shrestha | Dr. Mira KC |
| --- | --- | --- |
| 08:00 | Completed custom check, 30 min | Completed scaling, 45 min |
| 08:30 / 08:45 | Completed consultation at 08:30, 30 min | Completed check-up at 08:45, 15 min |
| 09:00 | Checked in, scaling, 45 min | Confirmed consultation, 30 min |
| 09:30 / 09:45 | Confirmed check-up at 09:45, 15 min | Checked in, custom retainer adjustment at 09:30, 45 min |
| 10:00 / 10:15 | Confirmed filling at 10:00, 30 min | Unconfirmed check-up at 10:15, 15 min |
| 10:30 | Cancelled consultation; available | Cancelled consultation; available |
| 11:00 | Unconfirmed root canal, 60 min | Confirmed filling, 45 min |
| 11:45 | Continuation of 11:00 visit | Unconfirmed check-up, 15 min |
| 12:00–13:00 | Lunch block | Lunch block |
| 13:00 | Confirmed scaling, 45 min | Confirmed root canal, 60 min |
| 13:45 | Unconfirmed check-up, 15 min | Continuation of 13:00 visit |
| 14:00 | Cancelled consultation; available | Unconfirmed consultation, 30 min |
| 14:30 | Confirmed custom bite adjustment, 45 min | Confirmed custom retainer review, 30 min |
| 15:00 / 15:15 | Unconfirmed check-up at 15:15, 15 min | Cancelled consultation at 15:00; available |
| 15:30 | Cancelled history plus confirmed replacement, 30 min | Unconfirmed scaling, 45 min |
| 16:00 / 16:15 | Unconfirmed filling at 16:00, 45 min | Confirmed check-up at 16:15, 15 min |
| 16:30 / 16:45 | Confirmed check-up at 16:45, 15 min | No-show consultation at 16:30, 30 min |
| 17:00 | Confirmed root canal, 60 min | Confirmed custom complex restoration, 60 min |

## Suggested walkthrough

1. Check yellow unconfirmed visits, provider-colored confirmed/checked-in visits and red cancellation notes. Occupied continuation cells must not offer booking. Completed and no-show records remain on the Day timeline, including past dates; they do not reserve new capacity under the existing lifecycle rules. Desktop **+** controls allow booking available time beside history.
2. Open Mira's 09:30 visit. It should show **Retainer adjustment**, a client-profile link and **Complete**, without a required Start step. Completing it should plan the routine recall.
3. Reschedule Pratik's 10:00, 30-minute visit to **10:15**, or Mira's 14:30, 30-minute visit to **14:45**. The appointment may overlap its own old time; another active visit must still cause a conflict. Changing a queued case is expected during this eye test.
4. Book Pratik's cancelled **14:00** interval. Choose a custom procedure and 30 minutes. The cancelled record and reason should remain visible after replacement. The new visit should show **Rebooked time**, with the cancellation reason. At Pratik's 15:30, a replacement is already present to compare this behavior.
5. Choose a custom procedure and inspect the duration choices: 15, 30, 45, 60… minutes. Verify the selected time survives the booking steps.
6. Switch Day, Week and Month, then AD/BS. Day's main date label includes the weekday. A longer appointment should occupy one continuous card on desktop and one entry on mobile; separate visits keep a gap. Week uses 280px desktop columns and one panel-width column per day on phones, with horizontal scrolling and sticky date headings. Month has a seven-day heading row, prominent primary dates, small companion dates, provider dots, a today marker and a selected-day outline. Select a date and use **Open selected day**. Check 320px and 390px mobile widths as well as desktop.
7. Open **Clients → due follow-ups**. Three extra TEST clients cover an overdue six-month recall, a staff-adjusted recall and a historical completed visit requiring explicit recall review. Change the next date or record a call outcome; check the next routine recall and retained history. No calls or messages are sent.

8. Select **October 17, Dr. Pratik, 10:00**. Three synthetic **Defensive workflow check** records cover Completed, Cancelled and a Confirmed replacement at the same time. Each should appear once on desktop/mobile, with the cancellation reason visible. Open the Completed record to verify its details. A failed Day load should show unavailable records and no stale slot controls; **Retry schedule** should restore the selected day. See [DD-2026-10-09](36-defensive-schedule-review.md) for checks and limits.

## Reproduction and checks

The guarded day fixture is [seed-clinic-eye-test.mjs](../scripts/seed-clinic-eye-test.mjs). It requires a fresh localhost `workflow_eye_test_*` database, all migrations, a running local API and `EYE_TEST_PASSWORD`. It refuses an existing day instead of overwriting eye-test edits. Booking and lifecycle transitions use the actual API; supporting accounts, availability and synthetic clients are fixture data. Three historical recall cases are prepared separately in the local fixture.

The current local API and web processes remain running on ports 4000 and 3000. Local restart helpers/configuration are in `.codex-temp/eye-test-command.cjs` and `eye-test-env.json`; use Node 24. Keep the private configuration out of Git. Start each server in a separate terminal with `node .codex-temp/eye-test-command.cjs api` and `node .codex-temp/eye-test-command.cjs web`.

All 27 migrations applied successfully to the isolated database. PostgreSQL booking, client creation, finance concurrency and HTTP containment tests: 4 passed, 0 skipped. Evidence: `.codex-temp/eye-test-migrations.log`, `eye-test-postgres-tests.log`, `eye-test-seed.log`. This preparation does not push a branch or deploy production.

The October 9 layout refinement uses [Hamro Patro's calendar](https://www.hamropatro.com/) as a reference for weekday headings, dual dates and the today marker. Continuous appointment blocks and scrollable day columns follow established [time-grid](https://fullcalendar.io/docs/timegrid-view) and [minimum day width](https://fullcalendar.io/docs/dayMinWidth) patterns, using the existing components without adding a calendar dependency. Desktop and mobile share the Month renderer and appointment-grouping helper. Grouping requires the same appointment ID and consecutive occupied rows; missing rows, separate IDs and free/cancelled slots remain distinct.

Live Edge checks: zero page overflow at 320px, 390px and 1440px; Week column widths 360px on a 390px phone and 280px on desktop; sticky heading drift 0px. Month exposes 42 distinct civil dates and all seven weekdays in AD and BS. Grouped visits still open details, and a cancelled slot still opens booking with its original doctor/time. Screenshots are in `output/playwright/calendar-*.png`; measurements and check logs are in `.codex-temp/calendar-*.log`.
