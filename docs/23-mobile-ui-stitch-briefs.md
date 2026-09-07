# ClinicFlow mobile UI requirements and Google Stitch briefs

**Status:** implementation brief for visual exploration; application behavior and authorization remain governed by documents 05, 06, 08, 11, and 13.

## Shared mobile requirements

- Design first for 390 × 844 CSS pixels and prove graceful behavior from 320–430px wide, landscape phones, tablets, 200% zoom, safe areas, and an open virtual keyboard.
- Use **Client** everywhere. Do not use Patient or Encounter; the clinical object is a **Record**.
- AD (English/Gregorian) dates are canonical and visually primary. Show the converted BS date as useful secondary context, never as stored scheduling truth.
- Touch targets are at least 44 × 44px. Essential controls cannot depend on hover, tiny icons, horizontal page scrolling, or desktop tables squeezed onto a phone.
- Keep the persistent mobile navigation compact: Today, Schedule, Clients, Finance, and More, with one prominent Book action available from every clinic page.
- All create/edit/detail interactions are bottom sheets on phones and right-side drawers on larger screens. Sheets respect top/bottom safe areas, remain above the virtual keyboard, have a visible drag handle and close action, and keep the primary action reachable.
- Preserve the workspace shell during loading. Use local skeletons with stable geometry; do not replace the whole page with a spinner.
- Show explicit loading, empty, denied, stale/conflict, offline/unavailable, saving-in-background, success, and retry states.

## Screen 1 — Mobile Schedule

### Requirements

1. One chronological timeline for the selected day. When **All providers** is selected, do not create a separate timeline per provider.
2. Use each Provider’s assigned colour as a left edge/dot and display a compact Provider legend/filter. Colour supplements text and never carries meaning alone.
3. Each booked card shows start/end time, Client, service, Provider, status, and urgent/high-priority signal when applicable.
4. Available times remain visibly tappable without overwhelming booked work. Tapping an open time starts slot-first booking with location, Provider, AD date, and exact time already selected.
5. Include a sticky compact header, previous/today/next controls, AD date plus BS equivalent, Day/Week/Month switch, search, Provider filter, and a current-time marker when viewing today.
6. Day is the execution view. Week is a compact seven-day agenda/capacity view. Month is a clean navigation/summary grid that opens a selected day; it does not reproduce a desktop grid at phone width.
7. Appointment tap opens the Appointment Detail bottom sheet. Book action opens the guided Booking bottom sheet.

### Google Stitch prompt

> Create a polished mobile clinic scheduling screen for a dental management product called ClinicFlow, at 390×844. Use a calm professional healthcare visual language: white and very light neutral surfaces, dark slate text, restrained teal accent, 12–16px rounded cards, subtle borders, excellent density, and WCAG-friendly contrast. AD/Gregorian date is primary and the Nepali BS equivalent is secondary. Build one chronological day timeline for all providers, not provider columns and not multiple separate timelines. Add a compact provider-colour legend and filter chips; every appointment card must also show the provider name so colour is not the only cue. Cards show time, Client, service, provider, status, and priority. Open slots are compact tappable rows with “Tap to book”. Include a sticky date header with back, Today, forward, Day/Week/Month controls, search, and a current-time marker. Use a persistent bottom navigation for Today, Schedule, Clients, Finance, More, plus a prominent universal Book action. Show realistic loading skeleton, empty day, and conflict/unavailable examples as component states. Avoid desktop tables, excessive headings, large hero whitespace, glassmorphism, gradients, tiny touch controls, and horizontal page scrolling. Produce component-ready layout and exact mobile spacing.

## Screen 2 — Guided Booking bottom sheet

### Requirements

- Two entry paths share one state machine: Client-first and slot-first.
- A schedule-launched sheet opens on Appointment details and visibly retains the clicked location, Provider, AD date, BS equivalent, and time.
- After service selection, validate whether the selected time fits the server-derived duration/buffer. If valid, enable a clear Continue/Hold action; if invalid, preserve the form and say “This time does not fit this service—choose another time.”
- Client search is number-first, with Recent Clients, New Client, and View slots first choices. New Client requires name and number; address is optional; prior-visit is a checkbox.
- The confirmation step summarizes Client, Provider, service, date/time, priority, and optional notes/location. Booking may finish in the background, but success appears only after authoritative server confirmation.
- Do not expose internal terms such as availabilityVersion, idempotency, retry holding, or transaction.

### Google Stitch prompt

> Design a native-feeling mobile bottom-sheet booking flow for ClinicFlow at 390×844. The sheet rises above a dimmed but recognizable schedule, has a drag handle, close button, step label, scrollable body, and sticky safe-area-aware action footer. Show the slot-first Appointment step: a compact selected-time summary at the top with clinic, provider, AD date, secondary BS date, and exact time; large provider choices; service selector; priority; and available times. Once a service is selected, show either a positive “Selected time fits this service” state with a primary Continue button or an inline “This time does not fit this service—choose another time” state with nearby alternatives. Also design Client search, minimal New Client, possible-match review, confirmation, background-saving, success, and uncertain-response recovery states. Use plain staff-facing language and never show “retry holding”, technical IDs, or implementation terminology. Controls must work with one hand and an open mobile keyboard.

## Screen 3 — Appointment Detail bottom sheet

### Requirements

- Lead with Client, service, status, priority, date/time, Provider, duration/buffer, communication state, and notes.
- Show exactly one contextual primary workflow action: Confirm, Check in, Start, or Complete.
- Keep Edit and Reschedule as secondary actions. Cancellation and no-show require an inline reason; never use a browser prompt.
- Archive uses a visible second confirmation step and explains that governed history remains. Permanent deletion is not presented as an ordinary appointment action.
- API failures remain in the sheet with retry-safe feedback and no false success.
- Edit and Reschedule replace the detail sheet instead of stacking behind or over it. Cancel restores the unchanged detail view; successful save returns to the refreshed Schedule.

### Google Stitch prompt

> Design an appointment-detail mobile bottom sheet for ClinicFlow at 390×844. Use a concise summary card for Client, service, status and priority, followed by a two-column information grid that collapses cleanly at 320px for date/time, provider, reserved time, duration/buffer, communication state, and notes. Present one full-width primary workflow button based on status (Confirm, Check in, Start, Complete). Put Edit details and Reschedule below as secondary actions. Design inline cancellation and no-show reason entry with confirmation, plus a separate two-step Archive area explaining retained history. The sheet must feel native, use safe areas and 44px targets, remain usable with the keyboard open, and avoid a center modal, browser prompt, crowded action toolbar, or destructive red primary button.

## Screen 4 — Edit and Reschedule appointment

### Requirements

- Opening from Appointment Detail replaces that sheet; two appointment surfaces are never visible or focusable together.
- Edit shows immutable Client context and focused Provider, service, AD-first date/time, duration, priority, notes and location controls.
- Reschedule starts with the current appointment summary, then Provider, service, AD-first date and live available times. The current time is labelled but cannot be confirmed as a reschedule.
- A required reason and final successor summary explain that the original appointment remains in governed history.
- Conflict retains the draft and refreshes nearby times. Dirty close asks whether to keep editing or discard. Cancel restores details; successful save returns to refreshed Schedule.

### Google Stitch prompt

> Design two related 390×844 mobile bottom sheets for ClinicFlow: Edit Appointment and Reschedule Appointment. They replace the Appointment Detail sheet rather than stacking with it. Both start with a compact read-only Client/current-appointment summary. Edit uses large Provider choices, service, AD-primary/BS-secondary date, native time and duration, priority chips, and collapsible notes/location. Reschedule uses a guided three-part flow: choose Provider/service/date and live time cards; enter a required reason; review the new successor summary. Label the current time, require a different selected time, and clearly state that the original remains in history. Include loading skeleton, no-times, concurrent-conflict with preserved values, dirty-close confirmation, saving, and success states. Use a sticky safe-area footer, 44px controls, one-hand reach, and no technical transaction language.

## Screen 5 — Mobile Inventory operations

### Requirements

- Show current location, low/out-of-stock counts, expiring lots, and recent movement evidence without Finance totals.
- Item cards expose SKU, item name, on-hand quantity and unit, reorder state, next expiry/lot, and permitted actions.
- Receive, use, adjust, count, and transfer are focused bottom sheets with quantity/unit, lot/expiry when required, source/reference, reason, and a confirmation summary.
- Clearly distinguish available, quarantined, expired, exhausted, archived, and out-of-stock states with text and colour.
- Preserve immutable movement history and idempotent retry behavior in user language: “Already recorded” rather than duplicate success.

### Google Stitch prompt

> Design a professional mobile Inventory workspace for ClinicFlow at 390×844. This is an operational stock system, separate from Finance. Include a location selector, low-stock and expiring-lot summary, search/filter chips, dense item cards with SKU, name, on-hand quantity plus unit, reorder point, lot/expiry and clear status, and recent immutable movements. Add a primary inventory action that opens bottom sheets for Receive, Use, Adjust, Stock count, and Transfer. The Receive sheet includes supplier, source reference, quantity/unit, lot number and AD expiry date where required, reason, review, pending, success, already-recorded, and failure states. Use clear international inventory conventions and do not show invoice, payment, COGS, or accounting controls.

## Handoff expected from Stitch

Return each screen independently with desktop/tablet implications called out, reusable component names, all interaction states, and screenshots at 390px and 320px. The implementation review will validate Stitch output against the server contract; generated visuals do not redefine permissions, lifecycle rules, dates, holds, or data ownership.
