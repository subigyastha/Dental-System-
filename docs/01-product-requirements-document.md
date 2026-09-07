# Product Requirements Document — ClinicFlow

| Field | Value |
| --- | --- |
| Product | ClinicFlow — Koi Workflow System |
| Owner | Koi Tech Company |
| Version | 0.1 (draft) |
| Last updated | 2026-07-18 |
| Release target | Production-ready dental operations release |
| Primary market | Nepal |

## 1. Product summary

ClinicFlow is a multi-tenant dental clinic management system for Nepal. It gives a clinic one operational workspace for client records, appointments, clinical continuity, staff, billing, payments, inventory, and clinic performance.

The product is dental-first, but the underlying organization, location, provider, service, scheduling, client, and billing concepts must remain adaptable to other appointment-based service businesses. That expansion is explicitly out of the first release scope; it must not compromise the dental workflow.

The first release is an internal, staff-facing product. It does not include a client-facing application, online client self-service, or public online booking. The system must, however, keep clear API and data-boundary room for those future channels.

### Terminology rule

Use **client** in product, user-interface, API, and documentation language. Avoid *patient* everywhere except where required by a clinical or regulatory concept (for example, `patient dental chart` in an existing technical model) or when quoting a third-party requirement. The current database model named `Customer` is a legacy implementation name; it represents a client and must not determine product terminology.

## 2. Problem and opportunity

Dental clinics commonly coordinate client details, provider schedules, chairs, clinical notes, recall tasks, invoices, payments, and stock in disconnected tools or manual records. This creates double-booking risk, missed follow-up work, duplicate client records, incomplete billing, and limited visibility for clinic owners.

ClinicFlow is intended to make the daily operating picture reliable: staff can book the right provider and resource, retain the client context that matters for care, record financial activity accurately, and resolve follow-up work. Clinic leadership can operate each clinic independently, while Koi Tech Super Admins can measure platform-wide adoption and health without accessing clinical content unnecessarily.

## 3. Target customers and operating context

### Target clinic types

- Independent dental clinics and small-to-mid-sized dental clinic groups in Nepal.
- Single-location clinics and organizations with multiple branches.
- Clinics offering preventive, restorative, orthodontic, surgical, diagnostic, and related dental services.

### Local defaults

- The default organization timezone is `Asia/Kathmandu`.
- All system timestamps, scheduling calculations, persistence, APIs, audit records, and financial dates use Gregorian/AD dates and ISO-8601 representations.
- The interface may display a Nepali Bikram Sambat (BS) equivalent alongside the AD date through a shared date-conversion API/service. BS is an optional display preference, never the persisted source of truth or the default calendar mode.
- English is the initial interface language. The product must not prevent later Nepali localization.

## 4. Users and access model

ClinicFlow authorizes work through additive roles. A user may hold more than one role; permissions are the union of assigned roles, subject to organization and location scope. Owner and Admin include every clinic-level role by default. A later authorization specification will define the precise action matrix.

| Role | Primary purpose | Core authority |
| --- | --- | --- |
| Super Admin | Koi Tech platform operator | Manages organizations, platform configuration, aggregate product metrics, support and operational controls. Not a default clinic data operator. |
| Owner | Clinic business owner | Full clinic authority, including staff/roles, configuration, finance, inventory, and reporting. |
| Admin | Clinic administrator | Full clinic operational authority equivalent to Owner, except ownership-transfer controls where applicable. |
| Manager | Day-to-day clinic lead | Manages clinic operations, schedules, staff coordination, follow-ups, and reporting. |
| Receptionist | Front-desk operator | Registers and manages clients, books and updates appointments, manages confirmations, and records payments. |
| Scheduler | Scheduling specialist | Manages availability, resources, appointments, reschedules, and schedule communication. |
| Provider | Dentist or other clinical provider | Views assigned work and relevant client history; may register a new caller as a Client and append the caller's number after governed duplicate review; records clinical visit outcomes and chart revisions within authorized scope. General Client profile correction, archive, merge, and identity-review resolution remain administrative workflows. |
| Assistant | Clinical support staff | Supports check-in, chair/workflow activities, and permitted clinical documentation; no independent financial administration by default. |
| Finance | Billing specialist | Manages invoices, payments, refunds/voids as permitted, reconciliations, finance reports, and payment-provider operations. |
| Inventory Manager | Stock custodian | Manages items, suppliers, stock movement, counts, reorder settings, and inventory reporting. |

## 5. Product goals

1. Provide a safe, fast daily operational workspace for every clinic location.
2. Prevent invalid provider and resource scheduling conflicts before an appointment is committed.
3. Maintain one trusted client record with auditable clinical and operational history.
4. Produce reliable invoices, payment balances, and financial audit history, including partial payment and future Nepal payment-provider integration.
5. Give clinic leadership useful views of utilization, workload, follow-ups, payments, inventory, and operational risk.
6. Give Super Admins privacy-conscious platform metrics: organizations onboarded, active organizations, active users, feature adoption, operational health, and error/usage trends.
7. Ship only when the release meets the readiness requirements in section 10.

## 6. Release scope

### 6.1 Required capabilities

#### Organization, location, and staff administration

- Create and manage organizations and clinic locations with separate data and configuration scopes.
- Create, invite, activate, suspend, and manage staff users.
- Assign multiple roles to a user, revoke roles, and audit role changes.
- Maintain provider profiles, specialties, services, availability, recurring blocks, exceptions, and locations.
- Enforce tenant isolation for every clinic-owned read and write.

#### Client management and clinical continuity

- Create, search, view, update, archive, and safely merge client records.
- Capture contact details, identity/supporting identifiers, demographics, emergency contacts, allergies, medical notes, risk labels, visit history, and communication history.
- Detect likely duplicates before client creation and require an intentional, audited merge decision.
- Record appointment/visit outcomes, clinical and provider notes, follow-up requirements, and versioned dental chart changes.
- Preserve a clear extension boundary for future client portals, self-service booking, documents, imaging, consent capture, diagnosis, prescriptions, and treatment plans.

#### Scheduling and daily operations

- Show day and week schedules by location, provider, resource, and appointment status.
- Create, confirm, check in, start, complete, cancel, reschedule, mark no-show, and flag follow-up-required appointments.
- Generate and validate available slots using provider availability, service duration, buffers, recurring blocks, point-in-time blocks, provider status, location, and resource availability.
- Prevent conflicts for a provider or required resource unless an explicitly authorized, auditable overbooking policy permits it.
- Support multiple services per appointment, location-specific provider service configuration, appointment notes, priorities, recurrence, communication state, and cancellation reasons.
- Create and manage recovery, recall, reminder, incomplete-workflow, and treatment-continuation follow-up tasks.
- Keep notifications and communication history ready for reliable delivery channels; automated reminders are a ship requirement only when their channel integration and delivery monitoring are enabled for a clinic.

#### Billing, payments, and Nepal payment-provider readiness

- Create, issue, update, cancel, and void invoices with line items, discounts, tax, due dates, notes, outstanding balance, and audit history.
- Record cash, card, bank-transfer, mobile-wallet, insurance, and other payments, including partial payments and supported adjustments/refunds/voids.
- Permit a Receptionist to record a payment without granting unrestricted finance administration. Finance, Owner, and Admin retain broader financial controls; the detailed permission matrix is authoritative.
- Design a payment-provider adapter boundary with provider-agnostic payment intent, external transaction/reference ID, callback/webhook verification, idempotency, reconciliation state, failure reason, and audit metadata.
- Be ready to integrate Nepal payment providers such as Fonepay and additional providers without changing invoice or ledger semantics. Provider integrations are enabled only after their contracts, credentials, security review, sandbox tests, webhook validation, reconciliation, and operational support are complete.

#### Inventory

- Manage inventory items, categories, units, suppliers, locations, reorder levels, stock on hand, stock movements, adjustments, transfers, purchase/receiving records, expiry/batch information where relevant, and audit history.
- Associate consumable inventory with services or clinical workflows where configured, without silently decrementing stock until the inventory rule explicitly authorizes it.
- Surface low-stock, expiring-stock, stock-variance, and reorder work to authorized users.
- Maintain inventory per organization and location, with no cross-tenant stock visibility.

#### Reporting and platform administration

- Clinic reports: appointment volume/statuses, provider utilization, no-shows, follow-up backlog, client activity, invoicing, collections, outstanding balances, payment method mix, and inventory state.
- Super Admin reporting: number of onboarded organizations, active organizations, active users, onboarding progression, organization/location usage, feature adoption, request/error health, and aggregate operational trends.
- Super Admin analytics must use the minimum data necessary. Aggregate/de-identified metrics are preferred; clinical note content and detailed client data are not product-analytics inputs.

### 6.2 Explicitly out of scope for this release

- Client-facing web or mobile apps, public booking, client login, and self-service payment.
- Full electronic health record functionality, e-prescribing, diagnosis coding, imaging management, and treatment-plan authoring.
- Insurance-claim submission or adjudication.
- Accounting-general-ledger replacement and payroll.
- Multi-vertical templates or a generic workflow/plugin marketplace.

## 7. Core workflows

### 7.1 Register or find a client, then book

1. A front-desk user searches by name, phone, email, or client code.
2. The system shows probable duplicate matches before a new client is created.
3. The user selects a client or creates one, selects location, provider, services, date/time, and required resource.
4. The scheduling service validates availability and conflicts using AD/ISO source dates.
5. The appointment is created with an audit event; communication and follow-up work are created when applicable.

### 7.2 Deliver a visit and maintain continuity

1. Staff check in the client and the provider starts the appointment.
2. The provider records the visit outcome, relevant notes, follow-up need, and a versioned dental-chart update where applicable.
3. The appointment completes or enters an exception state; follow-up work is assigned and visible in the operational queue.

### 7.3 Invoice and take payment

1. Authorized staff create or review an invoice for the client and appointment.
2. Invoice totals are derived from explicit line items, discount, and tax rules.
3. A Receptionist may record a permitted payment; the system recomputes the balance, records the actor and method/reference, and updates invoice state.
4. If an external provider is used, the provider callback is verified and idempotently reconciled before a payment is marked completed.

### 7.4 Maintain inventory

1. An Inventory Manager receives stock, records a count or adjustment, or transfers stock between authorized locations.
2. Each movement creates an immutable inventory record and updates the location balance transactionally.
3. Low-stock and expiry thresholds create actionable operational alerts.

### 7.5 Super Admin platform operations

1. A Super Admin provisions or manages an organization without bypassing tenant isolation in clinic workflows.
2. The platform records privacy-conscious adoption and health telemetry.
3. Super Admin views aggregate metrics and investigates operational issues through audited support controls.

## 8. Product principles and constraints

- **API and business-logic authority:** NestJS is the sole authority for data access and business rules. The frontend must not read Prisma or the database directly.
- **Tenant isolation by default:** organization-scoped data is never exposed across tenants; location scope further limits access where configured.
- **Auditability:** consequential clinical, scheduling, finance, role, inventory, configuration, and support actions have an actor, timestamp, before/after context or event payload, and correlation to the affected record.
- **Financial correctness over convenience:** completed payments are not silently edited or deleted; corrections use a governed adjustment, refund, void, or reversal process.
- **Calendar correctness:** AD/ISO is canonical; BS is derived display data only. Conversion must be centralized, deterministic, tested, and visible to users when shown.
- **Accessibility and responsiveness:** core front-desk and provider workflows work on desktop and mobile-width screens, support keyboard operation, readable contrast, meaningful labels, loading states, empty states, and recoverable errors.
- **Security and privacy:** authentication, authorization, secret management, encrypted transport, secure password/session handling, audit trails, backups, and least-privilege access are release requirements.

## 9. Success metrics

### Clinic-level metrics

- Appointment creation, confirmation, cancellation, no-show, and completion volumes.
- Double-booking/conflict-prevention rate and attempted-conflict rate.
- Provider utilization and schedule capacity.
- Follow-up completion and overdue backlog.
- Client duplicate rate and merge activity.
- Invoice issuance, collection rate, outstanding balance, refund/void activity, and payment-method mix.
- Low-stock, expiry, and stock-adjustment variance.

### Platform-level metrics (Super Admin)

- Organizations onboarded, activated, retained, and active in the reporting period.
- Active users by organization, role, and feature.
- Feature adoption for scheduling, client records, follow-ups, billing, payment methods, inventory, and reporting.
- Onboarding funnel completion and time to first successful appointment/invoice.
- API availability, latency, error rate, background-job/notification failure rate, and payment-provider reconciliation exceptions.

Metrics must have documented event definitions, tenant-aware aggregation, retention limits, and access controls before they are used for operational decisions.

## 10. Production-release readiness

This is a production release only when all in-scope capabilities are complete and verified. A visually present screen, seed-only behavior, or untested endpoint is not sufficient.

### Required release gates

- Every required workflow is backed by persistent PostgreSQL data, authenticated NestJS APIs, validation, authorization, and auditable error handling.
- Multi-role authorization, the Finance role, Super Admin boundaries, and Receptionist payment-recording permission are implemented and covered by tests.
- Scheduling conflict rules, timezone handling, AD persistence, BS display conversion, appointments, resources, recurring blocks, and exception paths have automated tests for boundary cases.
- Billing/payment state changes are transactional, idempotent where externally triggered, fully auditable, and reconciled against invoice balances.
- Payment-provider integration is either disabled by configuration or complete through provider sandbox verification, webhook signature validation, duplicate-delivery handling, failure recovery, reconciliation, and operational monitoring.
- Inventory stock movements are transactional, location-scoped, authorized, auditable, and protected against negative/unexplained balances according to the approved inventory policy.
- No direct frontend Prisma/database access exists in production flows.
- Every tenant-owned query is organization-scoped and has negative authorization/isolation tests.
- Security review, secrets configuration, backup/restore rehearsal, health checks, observability, error tracking, incident ownership, and rollback procedure are complete.
- Accessibility checks and responsive acceptance testing pass for core workflows.
- Production data handling, retention, archive/deletion, and support-access policy are approved.
- A pilot/UAT sign-off confirms the principal clinic workflows are usable with representative staff and data.

## 11. Current implementation baseline and release deltas

The repository already contains a Next.js frontend, NestJS API, PostgreSQL/Prisma schema, token-based authentication, organization/location/provider/client/service/appointment models, availability and blocks, client merge flows, dental chart revisions, follow-up tasks, invoice/payment endpoints, and an initial BS/AD display layer.

The following are product requirements that are **not to be represented as complete solely because adjacent code exists**. They require explicit implementation and verification before release:

- Multi-role user assignments (the current Prisma `User` model has one `role` enum value).
- A dedicated Finance role and the finalized permission matrix.
- Super Admin platform-management and aggregate analytics capabilities.
- Inventory data model, APIs, screens, stock controls, and reporting.
- Provider-agnostic payment integration adapter, Fonepay integration readiness, secure webhooks, reconciliation, and payment correction controls.
- Production-grade notification integrations and monitoring where enabled.
- Complete end-to-end release gates, security hardening, operational runbooks, and production acceptance evidence.
- Terminology migration from legacy `Customer`/patient-facing labels to client-facing language where it does not break compatibility.

## 12. Document relationships

This PRD is the product-level source of intent. The following documents will make its requirements precise and implementable:

1. Domain Glossary
2. Architecture Overview and System Context/Data Flow
3. Authorization and Permission Matrix
4. Scheduling Rules Specification
5. Database Schema and Data Dictionary
6. API Contract Reference
7. Client Identity and Record Governance
8. Billing and Payment Lifecycle
9. Workflow and State Machine Catalog
10. Inventory Lifecycle and Governance
11. Frontend UX and Screen Specification
12. Operational Read Models and Caching Strategy
13. Environment and Local Development Guide
14. Deployment, Security, and Observability Runbook
15. Testing Strategy and Decision Log/ADRs
