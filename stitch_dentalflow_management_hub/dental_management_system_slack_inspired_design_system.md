# Dental Management System Design System

**Status:** Reference baseline  
**Version:** 0.1  
**Design direction:** Slack-inspired operational workspace, adapted for clinical work  
**Audience:** Product, design, frontend, backend, QA, and coding agents

## 1. Purpose

Create a clinic operating interface that feels calm, fast, organized, and dependable during a busy workday. This system takes inspiration from Slack's information architecture and interaction philosophy, not its brand, assets, copy, or exact visual styling.

The reference product is a multi-tenant dental management system for receptionists, providers, clinic owners, assistants, and billing staff. The primary work is scheduling, patient care, follow-up, billing, and coordination.

## 2. Reference Principles Taken From Slack

Slack's product UI is strong because it treats work as an ongoing stream that must remain navigable, searchable, and actionable. These are the principles to adopt.

1. **Persistent orientation.** Users should always know where they are, what clinic they are in, and what needs their attention.
2. **Work is organized before it is displayed.** Clear sections, stable navigation, and meaningful names reduce cognitive load.
3. **High information density, controlled hierarchy.** Dense data is readable because only one or two things carry strong visual emphasis at once.
4. **Attention is a first-class system.** Unread, overdue, pending, and conflict states are visible without turning the entire screen into an alarm.
5. **Progressive disclosure.** Common work stays in the primary view; detail, history, metadata, and rare actions live in drawers, menus, or detail pages.
6. **Personal efficiency is legitimate.** Filtering, saved views, sidebar organization, keyboard shortcuts, compact layouts, and display preferences help frequent users move quickly.
7. **The same interaction language works across features.** A list item, notification, patient result, and schedule card should share familiar selection, status, and overflow behavior.

Slack supports customizable navigation and sidebar organization, user-selected compact/detailed display density, filterable notification views, keyboard navigation, and screen-reader navigation. These capabilities validate the principles above; they are not features to copy blindly. See the sources section.

## 3. Clinical Translation

| Slack pattern | Dental system translation |
| --- | --- |
| Workspace switcher | Organization and location switcher |
| Navigation tabs | Workspace destinations: Dashboard, Reservations, My Schedule, Patients, Billing, Staff, Settings |
| Sidebar sections | Role-aware groups such as Today, Scheduling, Patients, Finance, Administration |
| Channel list | Saved clinical views, provider filters, quick patient lists, or work queues |
| Activity feed | Attention Center for overdue follow-ups, appointment changes, payment issues, and assigned work |
| Thread / details pane | Patient timeline, appointment activity, invoice history, audit trail, or contextual detail drawer |
| Unread badge | Count of assigned/pending items; never use this for passive informational history |
| Composer / quick actions | Global search and contextual create actions: Book, Check in, Add patient, Record payment, Create follow-up |

## 4. Non-Negotiable Design Rules

1. Use the system as **inspiration, never imitation**. Do not use Slack logos, Slack purple, proprietary illustrations, product copy, or pixel-for-pixel replicas.
2. Every screen must make its current clinic/location and page context obvious.
3. Operational data is the primary content. Decorative cards, gradients, and large hero areas are not appropriate for the core application.
4. Color never carries meaning by itself. Pair every status color with text, iconography, or a label.
5. The default desktop experience prioritizes speed and scanability; the mobile experience prioritizes one task at a time.
6. Destructive or clinically consequential actions require confirmation and must create auditable events.
7. Avoid a giant generic bootstrap UI. Each domain screen owns its own loading, empty, error, and permission-denied states.

## 5. App Shell

### Desktop structure

Use a three-region shell. The main content area is the product; surrounding navigation stays stable across routes.

| Region | Default width | Responsibility |
| --- | ---: | --- |
| Utility rail | 56 px | Organization switcher, global destinations, attention badge, profile/menu |
| Context sidebar | 272 px | Role-aware navigation, saved views, provider/location filters, quick links |
| Main workspace | Flexible | Page header, filters, primary list/board/calendar, detail panels |

Rules:

- The utility rail is icon-first; every icon-only control has a tooltip and accessible name.
- The context sidebar may collapse to 72 px on medium desktop widths, but the main workspace must remain usable.
- A page header stays inside the main workspace and contains: title, scoped context, low-frequency actions, and page-level controls.
- Keep the global search/command entry reachable from every authenticated screen.
- Detail drawers open from the right on large screens. They should not destroy the user’s current list, calendar, or filter context.

### Mobile structure

- Use a bottom navigation with four primary destinations at most: Home, Schedule, Patients, More.
- Put search and the primary create action in the top app bar or page header, based on the task.
- Use full-screen detail routes or sheets; do not compress desktop sidebars into a thin mobile rail.
- Preserve a visible return path and the active location context.

## 6. Navigation and Information Architecture

### Default navigation groups

1. **Today**: Dashboard, Attention Center, My Schedule.
2. **Care**: Reservations, Patients, Follow-ups.
3. **Finance**: Billing, Payments, Outstanding balances.
4. **Practice**: Staff, Services, Locations, Settings.

Show groups based on permissions. Do not render inaccessible destinations merely to display an error after selection.

### Attention Center

Create one cross-domain queue rather than scattering alerts through every screen. It should include only actionable items:

- Appointment conflicts or unassigned appointments
- Check-in and treatment items due today
- Overdue follow-ups
- Failed reminders or communications needing intervention
- Draft/overdue invoices and failed/partial payments
- Record merge or governance review requests

Each item must show: type, patient (where appropriate), concise reason, timestamp/due time, owner, and a direct action. Support filters, bulk safe actions, and a dense/detailed view choice.

## 7. Visual Tokens

These are our tokens, not Slack tokens. Store them as CSS variables or design tokens; do not scatter literal values through components.

### Color

| Token | Light value | Use |
| --- | --- | --- |
| `--color-canvas` | `#FFFFFF` | Main surfaces |
| `--color-surface` | `#F8FAFC` | Secondary page background |
| `--color-sidebar` | `#F1F5F9` | Navigation background |
| `--color-hover` | `#E8F0F7` | Hover/selected candidate background |
| `--color-selected` | `#DCEEF9` | Current row/view background |
| `--color-border` | `#D7E0E8` | Dividers and controls |
| `--color-text` | `#17212B` | Primary text |
| `--color-text-muted` | `#5C6B78` | Supporting text |
| `--color-primary` | `#0B6E99` | Main actions, active navigation, links |
| `--color-primary-hover` | `#085A7D` | Hover/pressed primary actions |
| `--color-success` | `#16803C` | Completed / paid / confirmed |
| `--color-warning` | `#9A6700` | Needs attention / pending |
| `--color-danger` | `#C2352B` | Conflict / overdue / destructive action |
| `--color-info` | `#1769AA` | Informational status |

Dark mode must use separately tested semantic values. It is not an inverted light palette. Respect the user’s system setting by default and allow a per-device choice.

### Typography

- Font stack: `Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`.
- Base size: 14 px with a 20 px line-height.
- Dense operational rows: 13 px / 18 px only when the information remains legible.
- Page title: 20 px / 28 px, semibold.
- Section title: 14 px / 20 px, semibold.
- Labels and metadata: 12 px / 16 px; never rely on tiny text as a substitute for hierarchy.
- Use sentence case. Avoid all-caps labels except very short, non-essential metadata.
- Use tabular numerals for money, time, queue counts, and schedule grids.

### Spacing, shape, and depth

- Base spacing unit: 4 px. Common steps: 4, 8, 12, 16, 20, 24, 32.
- Standard control height: 36 px. Compact control height: 28 px. Primary touch target: 44 px minimum.
- Default radius: 6 px. Use 8 px for dialogs and drawers. Avoid pill-shaped UI except for small status chips or avatars.
- Prefer one-pixel borders and background changes over frequent shadows.
- Elevation: none for normal surfaces; light shadow only for popovers, dialogs, and floating menus.

## 8. Component Contract

Every shared component must have documented variants, states, keyboard behavior, accessibility semantics, and examples before broad use.

| Component | Required variants / behavior |
| --- | --- |
| Button | Primary, secondary, tertiary, destructive; loading state; icon plus label preferred for consequential actions |
| Icon button | Tooltip and `aria-label`; never the only representation of a destructive action |
| Navigation item | Default, hover, selected, unread/attention indicator, disabled only when justified |
| Data row | Click target, selected state, trailing actions on hover/focus, status and metadata slots, responsive wrapping rules |
| Status badge | Semantic type plus plain-language label; compact but never the only status signal |
| Filter chip | Applied, removable, keyboard reachable; long filter values truncate with a title/tooltip |
| Tabs | Use only for peer views of one context, not as a substitute for top-level navigation |
| Table | Sticky headers where helpful, sortable fields, empty state, row keyboard access, clear responsive fallback |
| Calendar item | Provider color is secondary; appointment state and time remain readable without color |
| Drawer | Contextual detail with explicit close, escape support, unsaved-change protection, and a URL/deep-link strategy where needed |
| Modal | Only for focused decisions or destructive confirmations; trap focus and return focus on close |
| Toast | Short outcome feedback only; do not use it for errors that require a decision or that must remain visible |
| Empty state | Explain the state, name the next valid action, and do not fabricate data |
| Error state | Explain what failed, retain safe context, offer retry, and give a support/debug reference when relevant |

## 9. Data-Dense Screen Patterns

### Lists and tables

- Put the most decision-relevant information at the left: patient, appointment time, status, provider, then supporting metadata.
- Align dates, times, counts, and currency consistently for vertical scanning.
- Use row dividers or very subtle alternating grouping; avoid individual card containers for every row.
- On hover or keyboard focus, reveal secondary actions. Keep the primary row action consistently placed.
- Use stable status vocabulary across all features: `Scheduled`, `Checked in`, `In progress`, `Completed`, `Cancelled`, `No-show`, `Needs review`.

### Scheduling

- Time is the primary axis; providers/resources are the secondary axis.
- Appointment cards show time, patient name, service or visit reason, provider, and concise state. Do not make card color the sole identifier.
- Conflicts must be visible before submission and revalidated by the server at submission time.
- Show availability, blocks, breaks, and schedule exceptions as distinct states.
- Keep provider colors muted and stable per provider; ensure text contrast is safe in every provider color.
- Booking opens from a known time/provider context and preserves it through the form.

### Patient workspace

- The patient identity bar is persistent within the patient workspace: name, ID, key alerts, age/date of birth, contact cue, and record status.
- Use tabs for peer patient record views such as Overview, Visits, Dental chart, Follow-ups, Billing, and History.
- Clinically sensitive alerts use explicit severity and a reason. Do not use a vague red dot.
- Timeline entries identify who changed what and when; revisions and merges remain traceable.

### Billing

- Treat monetary values as audit-sensitive data. Use right-aligned, tabular figures and explicit currency.
- Surface invoice status, payment state, amount due, and due date before secondary notes.
- Destructive financial actions show the affected amount, patient, and irreversible consequence in the confirmation dialog.

## 10. Interaction and Feedback

1. A visible action should complete in place whenever possible.
2. Save states are explicit: `Saving`, `Saved`, `Failed to save`, or `Offline changes pending`.
3. Optimistic updates are allowed only for reversible, low-risk actions. Appointment and payment changes require server-confirmed truth.
4. Preserve filter, scroll, selection, and panel state when users move between a list and a detail view.
5. Use menus for infrequent actions; do not hide the primary task in an overflow menu.
6. Keyboard users must be able to navigate, select, open details, invoke row actions, dismiss overlays, and return to their previous focus.
7. Every mutation emits a domain event and displays the server-confirmed outcome or conflict.

## 11. Accessibility Standard

Target WCAG 2.2 AA for all product surfaces.

- Text and UI contrast must meet AA; check every semantic status in both light and dark mode.
- All functionality is available by keyboard. Use native controls where possible.
- Visible focus is mandatory and distinct from selected state.
- Use semantic landmarks, headings, lists, tables, dialog semantics, descriptive labels, and meaningful empty-state text.
- Announce asynchronous save/failure outcomes with appropriate live regions.
- Respect reduced-motion preferences.
- Do not rely on hover alone; expose hover actions on focus and touch.
- Test critical flows with screen-reader navigation and keyboard-only operation.

## 12. Motion

- Motion exists to preserve orientation, not decorate.
- Use 120-180 ms transitions for hover, selection, drawers, and menus.
- Avoid bouncing, large parallax, and attention-seeking animation in clinical workflows.
- Respect `prefers-reduced-motion`; functional state changes must remain clear with no animation.

## 13. Implementation Rules for Coding Agents

1. Inspect and reuse existing shared primitives before creating a component.
2. Add or update tokens before introducing a new literal color, spacing, radius, or shadow.
3. Use semantic token names such as `status-danger` or `surface-sidebar`, never product-specific names such as `slack-purple`.
4. Use the existing icon system (prefer Lucide where available); icon-only controls require labels/tooltips.
5. Keep page-specific components local until at least two domains need the exact same behavior.
6. Build loading, empty, error, permission, and responsive states with the normal screen, not as afterthoughts.
7. Avoid nested cards, excessive borders, broad gradients, large display text, and generic dashboard decoration.
8. Validate desktop and mobile layouts. Main operational routes must not clip controls, hide data, or cause horizontal page scrolling.
9. Ensure business state comes from the NestJS API. UI status must not invent a separate source of truth for scheduling, payments, or permissions.
10. For a consequential new workflow, add or update a Storybook story, component test, or end-to-end test according to the project’s established tooling.

## 14. Definition of Done for a New Screen

- It is reachable through the correct role-aware navigation.
- It has a clear title, scoped context, and one obvious primary task.
- It uses shared tokens and components.
- It supports loading, empty, error, permission-denied, and mobile states.
- It has keyboard navigation and visible focus.
- It represents statuses with text plus color/iconography.
- It preserves user context when opening and closing detail views.
- It uses server-confirmed state for scheduling, billing, and permissions.
- It has appropriate test coverage for the user-facing risk.

## 15. Initial Build Order

1. Foundations: tokens, typography, iconography, theme infrastructure, focus, density preference.
2. App shell: utility rail, context sidebar, global search, page header, mobile navigation.
3. Primitives: buttons, menus, inputs, selects, statuses, table, drawer, modal, toast, empty/error states.
4. Attention Center and shared notification patterns.
5. Scheduling patterns and booking flow.
6. Patient workspace and clinical timeline.
7. Billing and finance patterns.

## 16. Sources and Research Notes

The following Slack materials informed the interaction principles in this document:

- [Slack sidebar preferences](https://slack.com/help/articles/212596808-Adjust-your-sidebar-preferences): separable navigation bar, sidebar, customizable/reorderable destinations, adjustable sidebar width.
- [Slack custom sidebar sections](https://slack.com/help/articles/360043207674-Organize-your-sidebar-with-custom-sections): groups, filters, and personalized organization of active work.
- [Slack Activity view](https://slack.com/help/articles/46751260742035-Introducing-the-new-Activity-view-in-Slack): filterable notification feed, detailed/dense layouts, actions without losing workflow context.
- [Slack display density](https://slack.com/help/articles/213893898-Change-how-messages-are-displayed): clean and compact display choices.
- [Slack accessibility](https://slack.com/intl/en-gb/help/articles/4455747966739-Accessibility-in-Slack) and [screen-reader navigation](https://slack.com/help/articles/360000411963-Use-Slack-with-a-screen-reader): contrast, font/zoom preferences, landmark-style navigation, focusable sections, and keyboard operation.
- [Slack keyboard shortcuts](https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts): efficiency and predictable navigation for frequent users.
- [Slack theme controls](https://slack.com/help/articles/205166337-Change-your-Slack-theme): user-controlled visual preferences and sidebar contrast.

These sources describe current Slack behaviors as of July 2026. The Dental Management System remains responsible for its own visual language, accessibility testing, and clinical safety decisions.
