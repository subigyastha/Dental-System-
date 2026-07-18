# Database Schema and Data Dictionary

**Status:** normative production target, grounded in the Prisma schema at `prisma/schema.prisma` as inspected on 2026-07-18.
**Authority:** NestJS owns all transactional access. Prisma is an API implementation detail and must never be imported by web/UI code for operational reads or writes.

## 1. Scope, naming, and canonical storage rules

The database is PostgreSQL, accessed through Prisma. Each clinic-owned row carries an `organizationId` and is tenant-isolated by NestJS. UUID-like CUID strings are the current identifiers; opaque immutable string IDs remain the contract regardless of generator.

Product language uses **Client** and **Record**. Existing code/schema uses `Customer`, `patientCode`, `PatientDentalChart`, and `AppointmentSession`; these are legacy technical names, mapped respectively to Client, clientCode, DentalChart, and Record. New migrations and APIs must use the canonical names. Compatibility views/adapters may retain old names during migration, but no new feature may introduce them.

All instants are stored as UTC `timestamptz` / Prisma `DateTime` and exchanged as ISO 8601. Gregorian/AD is canonical. BS is a presentation conversion only; never persist a BS date as the authoritative value. Store local schedule rules as IANA timezone + local time (`HH:mm`), normally `Asia/Kathmandu`.

Financial amounts are `numeric(18,2)` in NPR by default. Do not use floating point. Each invoice/payment stores currency (`NPR` initially) and financial snapshots required for auditability.

## 2. Current schema: model dictionary

The following exists now. `CASCADE` relationships and mutable/delete operations are current implementation details, not approval for production behavior.

| Model | Purpose and principal fields | Relationships / current constraints and indexes |
|---|---|---|
| `Organization` | Tenant: `id`, name, business type, contact details, `status`, timezone, `primaryCalendar`, timestamps. | Has locations, users, providers, clients, services, appointments, finance, workflow/audit data. Indexed by status and business type. Current `primaryCalendar` defaults **BS**; target default is AD with optional BS display. |
| `Location` | Organization site: name, address/phone, timezone, `isActive`. | Belongs to Organization; currently referenced by resources, availability, blocks, provider services, appointments. Indexed `(organizationId)`, `(organizationId,isActive)`. |
| `OrganizationSetting` | One organization settings record: buffers, reminder lead, overlap flag, business-day strings. | One-to-one with Organization (`organizationId` unique). Expand rather than store operational flags in unstructured JSON. |
| `User` | Current staff/account record: profile, credential hash, employment metadata, schedulability, lifecycle `status`, **single** `role`. | Optional Organization (permits SuperAdmin); optional 1:1 Provider. Unique `(organizationId,email)`, indexes `(organizationId,role)`, email, status. Single-role design is a production blocker. |
| `Provider` | Schedulable clinical provider: display label, specialty, status, color. | Organization-scoped; optional unique User; has appointments, service mappings, availability/blocks and chart revision attribution. Index `(organizationId,status)`. |
| `Customer` (legacy Client) | Client demographic/clinical-alert data: name, phone/email, DOB, address, emergency contact, medical notes, allergies, risk label, `patientCode`, last visit. | Organization-scoped and referenced by appointments, records, chart/revisions, invoices/payments and communications. Current unique `(organizationId,phone)` **violates shared-family-phone policy**. `patientCode` is organization-unique when supplied. Index name/email/user. |
| `Service` | Catalog item: name/category, description, duration/buffer, optional price, `isActive`. | Organization; joins to appointments, providers, records and invoice lines. Index `(organizationId,isActive)`. |
| `ProviderService` | Provider-specific service availability and optional duration/price override, optionally location-associated. | Unique `(providerId,serviceId,locationId)`; indexes each FK. Keep location association, but provider—not chair/resource—is the booking constraint. |
| `Resource` | Generic physical resource (legacy scheduling model): name/type/location. | Current relation to appointments/blocks. Not part of public booking contract for phase one; no chair/resource conflict must be enforced. |
| `Appointment` | Provider booking: organization/client/provider/location, UTC `startsAt`/`endsAt`, duration/buffer, status, priority, notes, cancellation, recurrence link. | Current optional resource and `sourceAppointmentId` recurrence self-link; joins services, workflow, record, follow-up, notifications, invoice/payment. Indexes organization/start, location/start, `(organization,provider,start)`, `(organization,status,priority)`. Current indexes cannot prevent overlapping writes. |
| `AppointmentService` | Appointment-to-service join. | Composite PK `(appointmentId,serviceId)`; cascading deletion. |
| `ProviderAvailability` | Recurring local availability window: weekday, local times, slot/buffer, effective range, recurrence. | Provider and optional location; indexes organization/provider/day and location. Validate day 0–6, time ordering, date range and no overlapping windows in service layer. |
| `ProviderRecurringBlock` | Repeating unavailable local-time block with reason. | Provider/optional location. Indexed `(organization,provider,day,isActive)`. |
| `BlockedTime` | One-off UTC unavailability; current schema can reference provider, resource, and location. | Indexes organization/range and provider/range. Phase-one public model is provider-only. |
| `AppointmentSession` (legacy Record) | Current mutable clinical visit data: appointment/client/provider/service, summaries/notes, follow-up and chart fields. | One per Appointment; one service; chart revision optional. Indexed appointment/client/provider. It does not yet enforce signed immutable Records. |
| `PatientDentalChart` (legacy DentalChart) | Current client current-state JSON chart, version, updater and source record. | One per Client (`customerId` unique); indexes updater/source. Current update-in-place design must be complemented by immutable revision history. |
| `DentalChartRevision` | JSON point-in-time chart revision, optional source record and provider. | Client; optional unique record; indexes `(client,createdAt)` and author. Must become append-only with reason/version linkage. |
| `FollowUpTask` | Client/appointment task: type, status, priority, due date, summary/action, provider owner. | Tenant/client scoped; optional appointment/provider. Indexes `(organization,status,priority,dueAt)` and `(organization,client)`. |
| `Notification` | Outbound notification/outbox candidate: channel/status/template/recipient/schedule/payload/error. | Tenant and optional appointment; index `(organization,status,scheduledFor)`. Add provider delivery IDs, attempts/idempotency and feature/provider references. |
| `CommunicationLog` | Client communications history: channel/direction/summary/time/metadata. | Client, optional appointment; index `(organization,client,occurredAt)`. |
| `Invoice` | Finance document: organization/client/appointment, number, status, timestamps, totals/balance/notes. | Unique `(organization,invoiceNumber)`; lines and payments; indexes tenant/status/issued, client, appointment. Current model permits mutation/deletion after financial activity—production blocker. |
| `InvoiceLineItem` | Snapshot line: optional service, description, quantity, price/discount/tax/total, ordering/metadata. | Invoice cascade, optional service; index `(invoice,sortOrder)`, service. Must store a frozen service/tax snapshot on issue. |
| `Payment` | Current collection: invoice/client/appointment, amount/method/status/reference/date/metadata. | Restricts invoice/client deletion; indexes tenant/date, invoice, client, appointment. Current mutable/delete endpoints violate append-only accounting. |
| `WorkflowEvent` | Appointment status event: from/to status, actor, note/time. | Tenant/appointment; index `(organization,appointment,createdAt)`. Must be emitted transactionally for every valid transition. |
| `AuditLog` | Generic audit event: tenant/actor/entity/action, old/new JSON and description. | Indexed organization, actor, entity pair, time, and `(organization,time)`. Must become mandatory for privileged, clinical, financial, support, archive/delete and configuration changes. |

### Current enum values

| Enum | Current values | Production note |
|---|---|---|
| `UserRole` | SuperAdmin, Owner, Admin, Manager, Receptionist, Scheduler, Provider, Assistant, Client | Replace single enum assignment with role assignments; add `Finance` and capability roles as required. `Client` is not an MVP login role. |
| `RecordStatus` | Active, Inactive, Invited, Suspended | Account/entity lifecycle only; do not use it as a substitute for archive/delete state. |
| `ProviderStatus` | Available, Busy, Away, Inactive | Availability is derived from schedule; status is operational visibility. |
| `AppointmentStatus` | Scheduled, Confirmed, CheckedIn, InProgress, Completed, Cancelled, NoShow, Rescheduled, FollowUpRequired | `FollowUpRequired` should be represented by follow-up creation, not a terminal booking status; transition catalogue governs target values. |
| `Priority` | Low, Normal, High, Urgent | Reusable task/appointment priority. |
| `FollowUpType` / `FollowUpStatus` | Reminder, NoShowRecovery, Recall, IncompleteWorkflow, TreatmentContinuation / Open, InProgress, Waiting, Done, Blocked | Target state transitions are defined in the workflow catalogue. |
| `NotificationChannel` / `NotificationStatus` | SMS, WhatsApp, Email, Push / Queued, Sending, Delivered, Failed, Cancelled | Phase-one live channels are SMS and WhatsApp, subject to platform feature flag and clinic provider configuration. |
| `InvoiceStatus` | Draft, Issued, PartiallyPaid, Paid, Cancelled, Void | Production: issued snapshot immutable; cancellation/void rules are in Billing Lifecycle. |
| `PaymentMethod` / `PaymentStatus` | Cash, Card, BankTransfer, MobileWallet, Insurance, Other / Pending, Completed, Failed, Refunded, Voided | Expand with provider metadata and linked correction events; a completed payment is never edited/deleted. |

## 3. Production-target additions and migrations

### Identity, tenancy, authorization, and lifecycle

| Target model / change | Required fields and constraints | Purpose |
|---|---|---|
| `PlatformUser` or platform-scoped `User` | Platform identity with no clinic data implied; SuperAdmin assignment is platform-scoped, MFA/audit fields. | Separates platform administration from tenant membership. |
| `OrganizationMembership` | `userId`, `organizationId`, lifecycle, timestamps; unique `(userId,organizationId)`. | A user can work in multiple organizations without duplicating identity. |
| `UserRoleAssignment` | `membershipId`, `role`, nullable `locationId`, active range, assignedBy; unique active assignment per role/scope. | Multi-role authorization. Owner/Admin receive all clinic capabilities organization-wide; all other roles can be limited to locations. Add `Finance`. |
| `Role` / `Permission` (seeded) | Stable role keys and permission keys; assignments may be derived from role policy. | Prevents hard-coded role arrays from becoming an authorization source. |
| `EntityLifecycle` / fields on critical entities | At minimum `archivedAt`, `archivedById`, `archiveReason`, `deleteRequestedAt`, `deleteRequestedById`, `deleteConfirmedAt`, `deleteConfirmedById`. | Two-step deletion. Archive first; only an Owner may explicitly confirm deletion from archive. Use soft-deletion/audit retention first and physical purge only under approved policy. Applies to Client, Record, appointment, finance, inventory, staff and configuration as applicable. |
| `ClientCodeSequence` | Organization PK/unique, monotonically incremented counter, transaction/row-lock generated. | Atomic organization-scoped Client code. Migrate `patientCode` to `clientCode`; preserve legacy codes as aliases. |
| `ClientIdentifierAlias` | Client FK, type/value, source, active/merged timestamps; unique tenant/type/value when appropriate. | Supports merge history and old codes without claiming shared phone uniqueness. |
| Client change | Remove unique `(organizationId,phone)`; retain non-unique index on normalized phone. Add normalized name/email/phone search and possible-match records. | Family members may share phone/email; duplicate detection is workflow, not a hard uniqueness rule. |
| `DeletionRequest` | Entity type/id, organization, requester, owner confirmer, reason, confirmation challenge, status, retention/purge eligibility. | Auditable approval rather than a destructive `DELETE` route. |

### Clinical, scheduling, notifications

`Record` becomes a first-class model with status `Draft|Signed|Amended`; signer/time, amendment-of relation and mandatory correction reason. Signed content and chart revisions are append-only. The current mutable `AppointmentSession` is migrated/aliased to Record. Client records are visible to providers in phase one, as approved; access tightening can be added later without reshaping identifiers.

For appointment conflict safety, add PostgreSQL exclusion constraints or equivalent transactionally locked range checks over active appointment statuses and `(organizationId, providerId, tstzrange(startsAt, endsAt + buffer))`. The reservation/availability check and insert/update must happen in one transaction. Resource/chair fields remain legacy/internal only and are excluded from the phase-one public booking contract.

Add `NotificationProvider`, `OrganizationNotificationChannel`, `NotificationAttempt`, and `OutboxEvent`. Store encrypted provider credentials/references (never raw secrets), external message ID, idempotency key, attempt number, delivery timestamp/error classification. Platform feature flags control whether SMS/WhatsApp are available to any clinic; clinic configuration then enables an approved adapter. No delivery is sent if either gate is off.

### Finance and payments — separate from inventory

Finance is independent from stock. Add `currency`, payment allocation, immutable ledger/correction links, `PaymentProvider`, `OrganizationPaymentProviderAccount`, `PaymentIntent`, `PaymentWebhookEvent`, and `PaymentReconciliation`. Adapter keys include `fonepay` and other Nepal provider identifiers; Fonepay begins in sandbox. Webhook events must be stored before processing, signature-verified, replay-safe, and idempotently mapped to an intent/payment. A provider callback never directly mutates a payment without tenant/account/reference validation.

### Inventory — no accounting coupling in phase one

Create a separate Inventory module: `InventoryItem`, `InventoryLocationStock`, `StockMovement`, `StockAdjustment`, `Supplier`, `PurchaseOrder` (when needed), and optional `RecordConsumption`. Stock movements are immutable, tenant/location scoped, and reference source/reason/actor. A completed Record may create configured consumption movements. It must **not** automatically post finance/COGS entries or mutate invoice values in phase one.

### Platform feature/usage controls

Add `PlatformFeatureFlag` (global default, rollout/kill switch, audit), `OrganizationFeatureOverride` (clinic enablement), and aggregated `UsageEvent` / `UsageMetricDaily` tables. They enable SuperAdmin to control WhatsApp/SMS/payment/inventory rollouts and measure onboarding, active clinics/users, and feature usage without exposing tenant clinical details by default.

## 4. Integrity, indexing, privacy, and retention requirements

- Every tenant-owned table must have `organizationId`, an FK, and an index beginning with `organizationId`; every query must predicate its resolved tenant scope.
- Validate cross-tenant FKs in the service transaction (e.g., client/provider/service/invoice all belong to the same organization). PostgreSQL FK alone does not prove this.
- Add unique/idempotency indexes for external callbacks and mutation keys; add date/range indexes that match schedule, client-search, dashboard and finance queries. Measure with `EXPLAIN ANALYZE` before creating broad JSON indexes.
- Encrypt credentials and designated sensitive PII/clinical fields at rest where infrastructure supports it; use TLS in transit; restrict database access to API/migrations. Password hashes only, no payment-card data, no provider secrets in logs/audit JSON.
- Audit logs and signed Records/financial events are immutable application records. Redact sensitive fields in audit payloads and retain only allowed before/after summaries.
- Archive hides data from ordinary workflows but preserves referential integrity and auditability. Owner-confirmed deletion is a controlled request, not immediate physical deletion. Legal hold, active dispute, unpaid invoice, required retention, or linked immutable record blocks purge.
- Define jurisdiction/clinic retention periods before automated purge. Until then, do not automatically purge critical data. Backups follow the operations runbook and restore testing.

## 5. Production acceptance criteria

Production migration is incomplete until it: (1) removes web direct-Prisma operational access; (2) backfills/migrates legacy Customer/Patient terms; (3) converts Users to memberships plus multi-role/location assignments; (4) replaces destructive mutations with archive/delete request workflow; (5) makes signed Records, chart revisions and completed payments immutable; (6) prevents provider double-booking at database transaction level; (7) makes tenant checks and audit events mandatory; and (8) introduces provider/feature-flag/outbox controls before live SMS, WhatsApp, or Fonepay activation.
