# Frontend UX and Screen Specification — ClinicFlow

| Field | Value |
| --- | --- |
| Status | Normative production target |
| Last updated | 2026-07-18 |
| Primary interface | Authenticated staff web application |
| Related specifications | [PRD](01-product-requirements-document.md), [Authorization](05-authorization-and-permission-matrix.md), [Workflow Catalog](12-workflow-and-state-machine-catalog.md) |

## 1. Scope and interface principles

ClinicFlow is an internal staff-facing web application. There is no client portal, public booking, or client self-service in this release. All user-facing language uses **client**; legacy current route/model names containing `patients` or `customers` must be migrated or redirected without exposing those terms in the product UI.

- The frontend renders and orchestrates. NestJS `/api/v1` is the sole authority for data, permissions, validation, transitions, and audit. A screen, hidden button, route guard, cache, or client-side role value never grants access.
- A role-permitted route may show only data allowed by organization/location scope and workflow state. Server `403` is authoritative even if the navigation was visible.
- AD/Gregorian date and time are the primary display and input system. The UI may show a clearly labelled BS equivalent using the shared conversion API; it never submits a BS value as scheduling authority.
- Financial and inventory workflows are separate. Inventory screens must not imply stock changes affect invoices/payments automatically.
- Destructive critical-data action always presents archive first. An archived record may be eligible for Owner-only confirmed deletion after a clear consequence/retention check; the interface must explain when deletion is unavailable.
- Interfaces must meet WCAG 2.2 AA and work at desktop and mobile widths without loss of essential staff workflows.

## 2. Navigation and route map

The current application contains `/patients`, `/reservations`, `/billing`, `/staff`, `/settings`, `/dashboard`, and `/my-schedule`. The target route map uses client-first, task-oriented paths. Legacy paths must redirect safely with no route-level data leakage.

| Target route | Screen and purpose | Primary roles |
| --- | --- | --- |
| `/login` | Secure staff sign-in, session-expiry recovery and support contact | Unauthenticated staff |
| `/workspace` | Organization/location selection and operational home redirect | Authenticated staff |
| `/dashboard` | Role-aware daily overview: schedule, follow-ups, permitted metrics and action queue | All clinic roles, scoped content |
| `/schedule` | Day/week provider schedule, availability, blocks, create/change appointment | Owner/Admin, Manager, Receptionist, Scheduler; Provider/Assistant scoped views |
| `/my-schedule` | Personal assigned appointments and tasks | Provider, Assistant; other roles if useful |
| `/appointments/:id` | Appointment detail, status actions, communications, Record/billing links | Per authorization/workflow policy |
| `/clients` | Find/create/manage client directory; archive/merge entry points | Authorized clinic roles |
| `/clients/:id` | Client profile, appointment history, Records, communication, finance summary, archive status | Per authorization matrix |
| `/records/:id` | Draft, sign, view immutable record/amendment history | Provider/Assistant within clinical policy; audited exceptional access |
| `/follow-ups` | Owned/team queue, due dates, state actions and escalation | Operations/clinical roles within scope |
| `/billing/invoices` and `/billing/invoices/:id` | Invoice list/detail, draft/issue/void controls and linked payment ledger | Receptionist draft/payment actions; Finance/Owner/Admin broader controls |
| `/billing/payments/:id` | Immutable payment detail, provider/reconciliation/correction history | Finance/Owner/Admin; limited Receptionist view |
| `/inventory` | Stock dashboard, catalog, count/receive/transfer/adjustment history | Inventory Manager, Owner/Admin; permitted reports |
| `/reports` | Role-filtered operational, finance, inventory reports | According to role matrix |
| `/settings/organization`, `/settings/locations`, `/settings/services` | Clinic configuration | Owner/Admin; limited Manager/role-specific configuration |
| `/settings/staff` and `/settings/roles` | Staff status, additive role/location assignments, audit history | Owner/Admin |
| `/settings/messaging` | Clinic-level WhatsApp/SMS configuration and templates where globally enabled | Owner/Admin, Finance only where relevant |
| `/platform` | Super Admin aggregate platform dashboard | Super Admin only |
| `/platform/organizations` | Organization lifecycle/provisioning | Super Admin only |
| `/platform/features` | Global feature flags, including WhatsApp/SMS enablement and safety disable | Super Admin only |
| `/platform/metrics` | Aggregate/de-identified onboarding, usage, feature adoption and health metrics | Super Admin only |
| `/platform/support-access` | Time-bound support-access request/history; no standing clinic data access | Super Admin only |

The sidebar must be derived from server-delivered capabilities and active organization/location, not a hard-coded role enum. A disabled feature is absent or visibly unavailable with an explanatory non-sensitive reason; deep links return the same server-enforced denial.

## 3. Shared interaction model

### 3.1 Context, identity, and session

The app header shows active organization, active location where relevant, signed-in staff identity, and current date/calendar preference. Switching organization or location requires an explicit choice and clears scoped cached data before the new context renders. Cookie-based session expiry returns to `/login` with a safe return path; it must not expose prior client data in the URL, page cache, or error message.

### 3.2 Lists, search, and record detail

- Server-backed lists support keyboard-accessible search, filter, sort, pagination/cursor navigation, selected filters in the URL, and a clearly labelled result count.
- Client search supports client code, name, phone, email and approved identity fields. Before new-client creation, a duplicate candidate panel is mandatory; phone is never treated as globally unique because families may share it.
- Detail pages use a stable summary header (client name/code, appropriate contact/risk alerts, organization/location) and task-oriented tabs. Clinical content is not preloaded for roles without clinical content access.
- Each mutating form identifies required fields, server-validated constraints, timezone/date representation where relevant, and side effects such as a provider-capacity reservation, issued-invoice snapshot, or notification send.

### 3.3 Status actions, confirmations, and audit

Only valid workflow commands are offered. Status controls are labelled verbs (`Check in`, `Start appointment`, `Sign Record`) rather than editable status dropdowns. The UI passes an expected version/idempotency key for commands where applicable, handles `409` by explaining that data changed and offering refresh, and never retries a payment or send automatically after an uncertain response.

Archive is an explicit reversible-looking first step only where policy permits. Archive confirmation states what becomes unavailable and links to archive history. Owner-only deletion from archive requires a separate confirmation/re-authentication dialog, reason, retention result, and clear warning that it may be irreversible. A failed policy check must not offer a workaround.

## 4. Screen specifications

| Screen | Required behavior | Important empty / error state |
| --- | --- | --- |
| Dashboard | Show only permitted daily schedule, follow-up queue, quick client search, operational alerts, and role-relevant KPI cards. Link to underlying filtered work lists. | Empty: explain no work is scheduled. Error: card-level retry and timestamp; do not display seeded totals. |
| Schedule | Day/week provider grid; AD primary date picker with optional BS secondary label; provider/location filters; availability/blocks; create, confirm, check-in, cancel, reschedule and no-show actions only when valid. | No provider/availability: explain how authorized staff can configure it. Conflict: refresh valid slots and name a safe category, never another client. API failure: explicit unavailable schedule state. |
| Appointment detail | Show client/appointment context, provider, service timing/buffer, communication history, valid lifecycle actions, Record and billing links. Reschedule creates a linked successor, not in-place time replacement. | If already changed/terminal: render current state and history; disable invalid actions with reason. |
| Client directory/profile | Search/create, duplicate candidates, demographics/contact, archive/merge history, permitted Records, appointment history, communications and billing summary. Client profile excludes a client-facing account. | No results: offer authorized create flow; no direct database/seed fallback. Unauthorized clinical section: omit content, not a misleading blank panel. |
| Record | Draft editor with save state/version, assigned-work context, sign action, immutable signed display and amendment timeline. Assistants see draft-only controls where permitted. | Sign failure/stale draft: preserve local unsaved content safely and require refresh/review; never overwrite signed content. |
| Follow-ups | Default to due/overdue owned work; filters for status/type/priority/location; state commands require required reasons/next review dates. | Empty: distinguish no assigned work from filtered-out work. Failed task change: retain prior visible state and show retry after refresh. |
| Billing | Invoice list/detail exposes financial state and balance; draft form recalculates server totals; issue action freezes snapshot. Receptionist sees only allowed draft/payment controls. Payment detail is ledger-like and immutable when completed. | Payment/network uncertainty: show `verification pending` rather than assuming success/failed; prevent duplicate submission with idempotency. |
| Inventory | Item/search/reorder list, location stock balances, immutable movement history, receive/count/transfer/adjust actions and variance alerts. No invoice/payment side effect text unless a future approved integration exists. | Zero stock and no data must be distinct. Out-of-scope user receives access-denied state, not an empty catalog. |
| Staff and roles | Staff lifecycle, additive role assignment, organization/location scope, effective dates, role audit and suspension. | Prevent removal of final Owner; role change shows immediate-access effect and may require re-authentication. |
| Messaging settings | Clearly show global channel status, clinic enablement, provider credentials health (never secrets), consent/template readiness, send status and failed delivery queue. | If Super Admin globally disables WhatsApp/SMS, explain it cannot be enabled at clinic level and preserve configuration/history. |
| Platform screens | Aggregate/de-identified organizations, active usage, feature adoption, error/health metrics, feature flags and support-access workflow. No routine client/clinical/financial detail. | A Super Admin needing clinic data begins a scoped, audited support-access request; direct record search is unavailable. |

## 5. Scheduling UX requirements

- Provider is required; chair/resource selection is excluded from release scheduling UI. The system does not render a resource conflict as a booking blocker.
- Slot search submits AD date/time, location, provider and services. Nest calculates authoritative duration, buffers, end time and availability. The grid is informative, not a reservation until command success.
- Default provider start cadence is 15 minutes; the interface respects a clinic configuration only when the API returns it. Staff may book up to 12 months ahead.
- Date/time labels state the active location timezone. BS is optional secondary information supplied by shared conversion; user-entered BS values are converted/validated by the central service before any API request.
- Cancellation requires a standardized reason. No-show is disabled until scheduled end plus buffer except for an Owner/Admin override that asks for a reason. Reschedule confirms it preserves the original history and creates a successor.
- When a concurrent booking wins, the UI says the slot is no longer available, retains safe form inputs, refreshes availability, and requires the user to select/confirm a new slot. It never offers overbooking.

## 6. State feedback, loading, empty, and failure behavior

Every data-bearing screen implements all states below. Skeletons mirror final layout enough to prevent disorientation, but do not masquerade as data.

| State | Required presentation |
| --- | --- |
| Initial loading | Accessible `aria-busy` region and skeleton/progress label; action controls disabled until authoritative capability/data load. |
| Incremental loading | Preserve already confirmed content; show local progress and prevent duplicate action submission. |
| Empty | State what is absent, why it may be absent, and the next permitted action. Do not use an empty table alone. |
| Filtered empty | Preserve filters and explain that no records match; offer clear filters. |
| Forbidden | Clear `You do not have access` response with no record-existence confirmation or protected content. |
| Validation failure | Field-level message linked with `aria-describedby`, summary at top, server rule prioritised over client hint. |
| Conflict/stale data | Explain that another change occurred, preserve non-sensitive draft input, reload authoritative state, require reconsideration. |
| API outage / timeout | Explicit unavailable/error state, last successful refresh time if known, safe retry. **Never** use Prisma, direct database access, seed data, or a fabricated fallback response. |
| Background operation | Show queued/pending/failed/delivered status from API; communication/payment outcome remains pending until verified. |

## 7. Responsive and accessibility requirements

The supported minimum viewport is 320 CSS pixels. Desktop scheduling may use a dense grid; at mobile widths it becomes a chronological provider list with date/provider filters and the same booking actions. Tables must offer horizontally reachable data or an accessible card/detail alternative; no essential action is hover-only.

WCAG 2.2 AA release requirements include:

- semantic landmarks, page titles, logical heading hierarchy, visible focus, keyboard navigation and skip link;
- contrast-compliant text/status indicators, with text/icon labels in addition to color; do not convey appointment/payment state by color alone;
- accessible form labels, error associations, input purpose/autocomplete where appropriate, touch targets, zoom/reflow, and reduced-motion support;
- dialogs that trap focus correctly, announce title/consequence, support Escape when safe, restore focus, and require no drag-only interaction;
- accessible schedule cells with date/time/provider/status labels, keyboard traversal and a list alternative; and
- tested screen-reader announcements for data refreshes, saves, validation, notifications and destructive confirmations.

Do not place clinical notes, payment references, session credentials, or provider secrets in browser console output, analytics, URLs, client-side persistent storage, or error banners.

## 8. Super Admin feature control and analytics UX

Super Admin is a separate platform workspace. It may enable/disable feature families globally, including WhatsApp and SMS messaging, after configuration/operational review. Turning a feature off stops new use and safely prevents queued delivery according to policy, records an immutable configuration audit event, exposes health/impact counts without clinic message content, and does not bypass clinic data isolation.

Clinic configuration is a second gate: a global-on channel remains unavailable until the clinic is enabled, its provider contract/credentials are validated, approved templates and consent policy are configured, and monitoring is healthy. Global-off always wins. UI feature flags are presentation hints; each Nest API and worker command repeats the authoritative server-side flag check.

Platform dashboards show minimum-necessary aggregates: organizations onboarded/active, active staff, onboarding progression, feature adoption, service latency/error rate, and notification/payment operational health. They do not expose client names, clinical notes, raw payment details, or message bodies. Support access is a separate, reasoned, time-limited and audited flow.

## 9. Current deltas and release acceptance

The current Next.js route structure uses `/patients` and `/reservations`, includes direct Prisma-backed Next API paths, and has a web client bearer token stored in `localStorage`. It also lacks the required inventory, Super Admin, additive-role, messaging adapter/flag, governed Record, and production payment flows. Those screens and behaviors must not be treated as shipped from adjacent UI alone.

Release acceptance requires:

1. All production screens use authenticated Nest `/api/v1` endpoints only; no direct frontend Prisma/database or seeded fallback path remains.
2. Route map, navigation, API responses and labels use client-first language, while legacy URLs redirect without leaking data.
3. Screen/API tests prove role/location/tenant differences, invalid workflow actions, client clinical visibility policy, Receptionist payment limits, and Super Admin aggregate-only default access.
4. Schedule tests cover AD primary/BS optional display, provider-only conflict handling, concurrent conflict feedback, cancellation/no-show/reschedule states, and mobile/keyboard paths.
5. Records, archive/delete confirmation, invoices/payments, inventory and messaging screens visibly enforce their governing lifecycle and never imply unsupported automatic integrations.
6. WhatsApp/SMS screens prove global Super Admin off overrides clinic settings, while disabled/enabled/failing channel states remain clear and no secrets/content leak.
7. Automated accessibility testing plus manual keyboard, screen-reader, zoom/reflow and representative mobile-device checks pass for all core workflows.
8. API outage, auth/session expiry, stale-data, duplicate-submit and background-delivery tests prove users receive explicit, recoverable states with no fabricated data.
