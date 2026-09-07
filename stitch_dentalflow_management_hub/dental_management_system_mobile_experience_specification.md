# Dental Management System Mobile Experience Specification

**Status:** Reference baseline  
**Version:** 0.1  
**Companion:** Dental Management System Design System  
**Audience:** Product, design, frontend, backend, QA, and coding agents

## 1. Product Decision

The mobile product is a focused clinical companion, not a smaller version of the desktop application.

Its two primary jobs are:

1. Let an authorized user quickly view the schedule relevant to them.
2. Let an authorized provider or staff member book a client into an available time.

Other product areas remain reachable when necessary, but they are not primary mobile navigation destinations. System configuration, complex finance work, staff management, reports, bulk operations, and advanced setup remain desktop-first.

## 2. Mobile Navigation

Use a three-item bottom navigation.

| Destination | Purpose | Available to |
| --- | --- | --- |
| **Schedule** | Default home. View today and upcoming appointments. | Every authenticated role with schedule access |
| **Book** | Create a reservation for a client. | Providers and roles granted `appointments:create` |
| **More** | Secondary destinations, profile, settings, and desktop-first links. | Every authenticated role, filtered by permission |

Do not show a separate Dashboard, Patients, Billing, Staff, or Settings tab in the mobile bottom navigation. A user should understand the app's purpose at a glance: see work, book care, get to secondary tools when needed.

### Role behavior

| Role | Schedule default | Booking scope |
| --- | --- | --- |
| Provider | Their own appointments, today | Their own schedule by default; another provider only when explicitly permitted |
| Receptionist / scheduler | Clinic schedule or their saved provider/location view | Any provider/location they are permitted to schedule for |
| Assistant | Their assigned or relevant provider schedule | Read-only unless granted booking permission |
| Owner / clinic admin | Clinic schedule with provider/location filters | Any provider/location they are permitted to schedule for |
| Billing-only / restricted role | No Schedule tab if not authorized | Not available |

Permissions must come from the API. The mobile client must not infer access from a display role alone.

## 3. Schedule: The Mobile Home

### Structure

```
Top app bar: [Location] [Search] [Profile]
Schedule controls: [Today] [<] [Tue, 18 Jul] [>] [calendar]
Scope row: [My schedule v] [Provider / Location filter when allowed]
Optional queue: [2 needs attention]
Timeline: all-day items, time rows, appointments, breaks, blocks
Bottom navigation: Schedule | Book | More
```

The visual density should feel Slack-inspired: calm, compact, structured, and easy to scan. The date and active scope are always visible; the appointment list does the real work.

### Default view

- Open on **Today** every time the user starts a new session, unless they intentionally chose another date moments earlier in the same session.
- Use a vertical time timeline, not a horizontally compressed desktop calendar grid.
- Default range is one day. Offer a 3-day agenda as a secondary toggle only after the single-day view is solid.
- Provider users see their own schedule first. They should never have to choose themselves from a filter just to see today's work.
- Users with wider authority can change provider and location through compact filter controls.
- Display all times in the active clinic location's timezone.

### Appointment row anatomy

Each appointment occupies a clear, tappable row/card within the timeline:

| Element | Requirement |
| --- | --- |
| Time | Start and end time or duration; use tabular numerals |
| Patient | Full name; identity is the first text element |
| Visit | Service, visit reason, or appointment type when known |
| Provider | Show when viewing a shared/clinic schedule; omit when redundant on a personal schedule |
| Status | Plain-text label plus icon/color: Scheduled, Checked in, In progress, Completed, Cancelled, No-show, Needs review |
| Signal | Small but explicit indicators for new, changed, overdue, conflict, or required follow-up |

- Appointment height may grow for longer names or additional clinical metadata. Never truncate a patient name so aggressively that it becomes ambiguous.
- Provider color is optional supporting context, not the only identity or state signal.
- Use background grouping and subtle borders; do not render every appointment as a floating, heavily rounded card.
- A current-time marker appears only for the current day.

### Schedule interactions

- Tap an appointment to open a full-screen appointment detail view or bottom sheet.
- Swipe horizontally between previous and next day only when it does not conflict with vertical timeline scrolling; provide visible date controls regardless.
- Tap `Today` to return to the present day.
- Tap the date to open a simple date picker. Do not expose BS/AD configuration controls in the primary mobile view; honor the user's existing calendar preference.
- Pull to refresh may be provided, but the screen must also expose a visible refresh/retry state when data is stale or failed.
- The schedule supports read-only access fully. Edit, cancel, and reschedule actions appear only for authorized users.

### Schedule states

| State | Mobile behavior |
| --- | --- |
| Loading | Show a timeline-shaped skeleton; keep header and selected date visible |
| Empty day | Show the selected date, a concise "No appointments" state, and `Book appointment` only when authorized |
| Offline/stale | Show the last known schedule with timestamp and a non-dismissible stale indicator; block risky booking actions until availability is confirmed |
| Error | Explain that the schedule could not load, retain date/scope controls, offer Retry |
| Conflict | Keep the appointment visible, show an explicit conflict label, and offer details/action according to permission |
| Permission denied | Explain that schedule access is unavailable; do not render a blank timeline |

## 4. Booking: The Only Primary Creation Flow

Booking must be short, deterministic, and conflict-safe. It is not a generic form builder.

### Entry points

- The `Book` bottom-nav destination.
- An available gap in the schedule timeline.
- The empty-day `Book appointment` action.
- An authorized action from a patient/appointment detail view.

### Booking flow

Use a full-screen, step-based flow on mobile. Keep the current choice visible and allow back navigation without losing entered data.

1. **Choose time**: date, available time, location, provider, service duration.
2. **Choose client**: search by name, phone, or patient ID; show duplicate-safe matches. Offer `Add client` only if the user has that permission.
3. **Confirm visit**: service, provider, time, optional concise note, and the important appointment policy/state.
4. **Server confirmation**: recheck availability and create the appointment. Show the confirmed result or explain the conflict with next available options.

### Booking defaults

- Provider booking for themselves defaults to their own provider identity and active location.
- Staff booking defaults to their most recently used permitted location/provider, with visible controls to change both.
- Booking from a schedule gap pre-fills the selected date, start time, provider, location, and duration context.
- Do not default a service silently when services determine duration, price, or clinical preparation. Ask when it matters.
- Do not ask users to type a time that can be selected from actual server-provided availability.

### Booking guardrails

- The API is the authority for provider availability, resource availability, blocked time, appointment overlap, and permissions.
- Revalidate availability immediately before create. A previously shown slot can become unavailable.
- When a conflict occurs, preserve selected patient and visit details, explain the issue, and return the user to a choice of valid slots.
- Do not use optimistic success for booking. Show success only after a server-confirmed appointment exists.
- Do not allow booking with an unresolved duplicate warning without an explicit user decision and audit record.
- Capture audit metadata for who booked, what was changed, and from which mobile context.

## 5. Appointment Detail

The appointment detail screen is the bridge between viewing and booking; it must remain concise.

### Always visible

- Patient identity and key safety alerts
- Date/time, location, provider, service, status
- Contact cue and arrival/check-in state when relevant
- Booking/change history summary

### Authorized actions

- Check in / undo check in
- Reschedule
- Cancel with required reason where policy requires it
- Mark no-show
- Open patient detail
- Start a new booking for the same patient

Put infrequent actions in an overflow menu. Destructive actions require confirmation with the patient, time, and consequence clearly named.

## 6. More: Reachable, Not Primary

`More` is a grouped, role-aware list. It may contain:

- Attention Center
- Patient search
- Follow-ups
- Billing lookup and payment history
- Notifications
- Profile and appearance preferences
- Help/support
- Open full desktop workspace

Hide or label desktop-first items such as Staff, Services, Locations, System Settings, reports, advanced billing, and configuration. Do not build half-functional configuration forms for small screens.

## 7. Visual and Interaction Rules

- Reuse the Design System's semantic colors, 4 px spacing scale, 36 px controls, and 44 px touch targets.
- The app bar, schedule controls, and bottom navigation must remain stable as the user scrolls the day timeline.
- Use one strong primary action per view. On Schedule, the primary action is `Book`; in Booking, it is the next valid step.
- Avoid floating action buttons that obscure calendar rows. Prefer the `Book` tab plus contextual booking affordances.
- Keep labels short and clinical: `Today`, `Book`, `Check in`, `Reschedule`, `No-show`, `Record payment`.
- Use bottom sheets for simple selection and full-screen pages for multi-step flows or detailed records.
- Preserve text size at 14 px or above in normal content; do not trade readability for calendar density.
- Respect dark mode, reduced motion, keyboard access where a hardware keyboard is present, screen-reader semantics, and device text scaling.

## 8. What Mobile Does Not Need in Its First Release

- Full system configuration
- Services, provider, location, and resource administration
- Complex recurring availability editing
- Advanced invoice creation, refunds, or reconciliation
- Reporting/analytics dashboards
- Bulk patient merge and data-governance workflows
- Full staff management
- Desktop-style multi-provider week board
- A universal mega-dashboard

These capabilities may be reachable through a desktop handoff or a deliberately limited read-only view later. They should not compete with Schedule and Book in the mobile interface.

## 9. Implementation Plan

1. Add a mobile-specific app shell and role-aware three-item navigation.
2. Deliver the one-day schedule timeline with current user/provider scope and robust loading/error/empty states.
3. Add appointment detail with read-only behavior first, then authorized workflow actions.
4. Implement server-backed availability and the four-step booking flow.
5. Add `More` with permission-filtered, secondary destinations.
6. Validate on small Android and iOS viewports, slow networks, text scaling, keyboard navigation, and screen readers.

## 10. Definition of Done

- Any authorized user can sign in and immediately understand where to see their schedule.
- A provider can book an available client appointment from mobile without navigating desktop-oriented screens.
- Booking fails safely when availability or permission changes, and preserves user-entered information.
- Secondary modules are accessible but do not appear as primary mobile destinations.
- The schedule is readable at normal and enlarged text sizes, and all key actions are touch and keyboard accessible.
- No mobile flow depends on direct frontend database reads; all schedule, availability, booking, and permission truth comes from the NestJS API.
