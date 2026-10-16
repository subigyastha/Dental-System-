# Reservation date navigation

Updated: 2026-10-10. Implemented locally; not deployed.

## Layout and references

Removed the sidebar Date card and the mobile Day-only date card. Both schedule headers use the shared AD/BS picker in every view. Desktop groups the date trigger and Previous/Today/Next beside Day/Week/Month. Mobile stacks the date, navigation, provider selector and full-width view controls.

Closest reference: [Jane schedule](https://jane.app/guide/working-with-the-schedule), with a Go to Date popup and view-sized navigation. Also reviewed [Outlook](https://support.microsoft.com/en-us/accessibility/outlook/use-a-screen-reader-to-explore-and-navigate-outlook-calendar), [Google Calendar](https://support.google.com/calendar/answer/6110849) and [FullCalendar toolbar](https://fullcalendar.io/docs/headerToolbar).

The popup is rendered into the document body, positioned within viewport edges, and scrolls internally on short screens. It retains dual dates, month browsing, keyboard date navigation, Escape/focus return and outside pointer dismissal. Toolbar popup Tab navigation stays inside until dismissed. Date selection preserves the current view and synchronizes month/day details. Week arrows advance seven days on mobile; desktop month navigation follows the active AD/BS calendar. Booking and API behavior are unchanged.

The schedule popup omits the duplicate native Gregorian input. Its footer shows today’s AD/BS dates immediately before Today; this uses Nepal local today rather than the selected date. Native input remains available in booking/form pickers. Verified the simplified popup with web types, component lint and 117 browser assertions (exit 0).

## Evidence

- Web typecheck, changed-component ESLint, production web build and formatting: exit 0. Build required an unsandboxed retry because Windows path canonicalization was denied in the sandbox.
- Calendar tests: 12 passed; phase-two workspace tests: 62 passed, 0 failures/skips, exit 0.
- Signed-in local Edge at localhost:3102/reservations: 117 assertions passed at 1440, 768, 390 and 320px across all three views. Verified native input removal, today’s footer date, viewport/page fit, portal placement, AD/BS, month browsing, Escape/focus return, retained view, Week increments and Month heading synchronization. No browser runtime errors.
- Logs: [browser](../.codex-temp/calendar-toolbar-browser.log), [tests](../.codex-temp/calendar-toolbar-tests.log), [types](../.codex-temp/calendar-toolbar-typecheck.log), [build](../.codex-temp/calendar-toolbar-build.log).
- Screenshots: [desktop](../output/playwright/calendar-toolbar-1440.png), [mobile](../output/playwright/calendar-toolbar-390.png).

Physical iOS/Android checks remain part of existing device acceptance. Existing local follow-up work was preserved.
