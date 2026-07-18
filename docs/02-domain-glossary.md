# Domain Glossary

| Field | Value |
| --- | --- |
| Product | ClinicFlow — Koi Workflow System |
| Version | 0.1 (draft) |
| Last updated | 2026-07-18 |
| Status | Canonical terminology for the production release |

## 1. Authority and use

This document is the **source of truth for ClinicFlow domain terminology**. Product requirements, user-interface copy, API contracts, database migrations, analytics definitions, tests, and operational documentation must use these terms. Where an existing implementation uses a different name, this document defines the intended meaning and the migration direction; an implementation name does not change the product term.

The [Product Requirements Document](01-product-requirements-document.md) is the source of product intent. Later specifications may add field-level or state-level precision, but must not redefine a term in this glossary without an explicit glossary change and an ADR where appropriate.

## 2. Canonical terms

| Term | Canonical definition | Key notes |
| --- | --- | --- |
| **Organization** | A clinic business tenant that owns its users, locations, clients, operational records, configuration, and reporting data. | The primary tenant-isolation boundary. |
| **Location** | An operating branch or site within an organization. | A user role may be scoped to one or more locations; organization-wide roles are not location-limited. |
| **User** | An authenticated human identity that can be assigned one or more roles. | A User is not necessarily a Provider or a Client. |
| **Role** | A named set of permissions assigned to a user, at organization or location scope. | Roles are additive: effective permissions are the permitted union of active assignments. Owner and Admin include all clinic roles. |
| **Provider** | A staff member who delivers or is responsible for a scheduled clinical/service appointment. | A Provider can be linked to a User and may work at more than one Location. Provider availability is the release scheduling constraint. |
| **Client** | A person receiving services from an organization. | The canonical product, UI, API, and documentation term. A future client-facing channel may authenticate a Client, but no such application is in this release. |
| **Client ID** | The immutable internal identifier for a Client. | Stable across updates, archive, merge history, integrations, and references. Never encode personal information or business meaning in it. |
| **Client code** | A human-usable, organization-unique identifier automatically assigned to a Client. | Used for lookup and communication where appropriate. Its generated format is a configurable implementation detail; it is not the internal Client ID. |
| **Duplicate candidate** | A possible match surfaced before a Client is created or merged. | A duplicate candidate is not proof of identity and requires an intentional staff decision. |
| **Client merge** | The governed action that resolves duplicate Client records by selecting a surviving Client and retaining an auditable relationship to the merged record. | It must preserve referential history and must not silently discard clinical, operational, financial, or audit data. |
| **Appointment** | A scheduled commitment for a Client to receive one or more services from one Provider at a Location during a defined time interval. | Canonical booking term. It has a workflow lifecycle and is provider-based for this release. |
| **Record** | The clinical/visit record that captures the outcome and authorized documentation of an Appointment. | A Record is distinct from an Appointment: the Appointment is the scheduled workflow; the Record is the resulting service/clinical documentation. |
| **Dental chart** | The versioned, longitudinal dental chart associated with a Client. | A Record may create or reference a chart revision; a chart is not synonymous with a Record. |
| **Service** | A configurable offering that may be scheduled and billed, with duration, buffers, price, and Provider/location eligibility where configured. | An Appointment can include multiple Services. |
| **Provider availability** | A Provider's effective bookable working intervals at a Location. | Availability, recurring blocks, point-in-time blocks, service duration, and buffers determine bookable slots. |
| **Provider block** | A recurring or point-in-time period when a Provider is unavailable for booking. | A blocking change that affects existing Appointments requires an explicit, audited resolution. |
| **Follow-up task** | A tracked action required after or around a Client workflow, such as a recall, reminder, no-show recovery, or treatment continuation. | It is not an Appointment and may be linked to one. |
| **Invoice** | A client-facing financial document with explicit line items and a calculated outstanding balance. | Invoice state and balance are derived from governed financial activity. |
| **Payment** | A recorded tender against an Invoice, from cash, card, transfer, wallet, insurance, or an approved external provider. | Completed Payments are append-only; corrections create linked financial records rather than mutating history. |
| **Payment provider** | An external service used to initiate, receive, or reconcile a Payment. | Examples include Fonepay. Providers integrate through a provider-agnostic adapter boundary and verified, idempotent callbacks. |
| **Inventory item** | A product, consumable, or stock-tracked item managed by an organization. | Stock is location-scoped and changes through governed inventory movements. |
| **Inventory movement** | An immutable event that changes or explains stock at a Location, including receipt, adjustment, transfer, or count variance. | A balance is not authoritative without its movement history. |
| **Audit event** | An immutable accountability record of a consequential action, including actor, timestamp, target, action, and relevant before/after or event context. | Audit events are not interchangeable with product analytics events. |
| **Product analytics event** | A privacy-conscious event used to measure platform or feature usage. | It uses the minimum data necessary and must not include clinical-note content or detailed Client data. |

## 3. Required vocabulary and prohibited terms

| Use this | Do not use as the canonical product term | Rule / exception |
| --- | --- | --- |
| Client | Patient, customer | Use **Client** everywhere in new product, UI, API, and documentation language. `Patient` may appear only when a clinical/regulatory source explicitly requires it; `Customer` is a legacy technical name only. |
| Client ID | Patient ID, customer ID | Refer to the immutable identifier as **Client ID**, even while a legacy schema field remains named differently. |
| Client code | Patient code, customer number | Use **Client code** for the organization-unique generated lookup code. |
| Appointment | Reservation, booking record | “Booking” is acceptable only as a verb or informal description. **Appointment** is the entity name. |
| Record | Encounter, visit session | Use **Record** for the clinical/visit record. “Visit” may describe the real-world event, but is not the canonical entity name. |
| Provider | Doctor, clinician, dentist | Use **Provider** as the cross-role entity. A specialty or UI label may say dentist or doctor when accurate. |
| Provider block | Chair block, resource block | Release scheduling is provider-based. Chair, room, equipment, and generic resource allocation are not release concepts. |
| Gregorian/AD date | English date | Use **Gregorian/AD** for the canonical calendar and persisted date system. “English date” is informal only. |
| Bikram Sambat (BS) display date | Nepali system date | BS is an optional derived display representation, never the stored or default calendar system. |

## 4. Identity, history, and lifecycle rules

### Client identity

- Each Client has one immutable internal Client ID and one organization-unique, automatically generated Client code.
- Phone number is **not** a unique identifier. Families and other legitimate cases may share a phone number.
- Name, phone, email, Client code, and other approved attributes may be used to find or rank duplicate candidates. They do not establish identity on their own.
- A Client is organization-owned. No cross-organization Client record, lookup, merge, or visibility is permitted.
- Client records are archived rather than silently removed when history must be retained. The detailed archive/deletion and merge policy belongs in the Client Identity and Record Governance specification.

### Appointment and Record lifecycle relationship

- An Appointment is created before care/service delivery and progresses through its scheduling workflow (for example: Scheduled, Confirmed, Checked In, In Progress, Completed, Cancelled, No Show, or Rescheduled).
- A Record documents the visit outcome and permitted clinical/service information. It is linked to its Appointment and Client, and is attributable to the responsible Provider where applicable.
- An Appointment may end without a completed Record (for example, cancellation or no-show). A Record must not be treated as proof that an Appointment was scheduled, attended, or billed.
- Rescheduling preserves the original Appointment as historical context and creates a linked replacement Appointment; it does not rewrite prior workflow history.
- Finalized clinical documentation and dental-chart revisions are governed, versioned/auditable records. The detailed signing, amendment, and retention rules are specified later.

### Financial and inventory history

- Invoice and Payment state changes are governed financial events. A completed Payment is not edited or deleted to correct a mistake; a linked refund, void, reversal, or other approved correction records the change.
- An Inventory movement is the immutable explanation for a stock change. A stock balance is a derived operational view, not a substitute for movement history.

## 5. Dates, time, and calendar vocabulary

- **Canonical system date/time:** Persist timestamps and financial/scheduling dates in Gregorian/AD using ISO-8601 representations. Scheduling calculations use the organization/location timezone, with `Asia/Kathmandu` as the default.
- **BS display date:** A Bikram Sambat equivalent may be shown alongside the canonical AD date through the shared conversion API/service. BS is optional display data, is not the default calendar mode, and must never become a second persisted source of truth.
- **Local time:** A time interpreted in the selected Location's timezone before conversion to a canonical timestamp.
- **Business day:** A Location's operational day. It must not be inferred from a browser's timezone.

## 6. Release boundary terms

The following words may exist in legacy implementation code or future planning, but they are not ClinicFlow release concepts unless a later approved specification introduces them:

| Term | Release treatment |
| --- | --- |
| Chair / room / equipment / resource | Not used for appointment availability or conflict validation in this release. Scheduling has one required Provider per Appointment and prevents Provider conflicts. |
| Client portal / client app / self-service booking | Future expansion boundary only. No client-facing application, client login, public booking, or self-service payment ships in this release. |
| Insurance claim | A Payment method/context may record insurance-related activity, but claims submission and adjudication are out of scope. |
| General ledger | Not an Invoice/Payment responsibility; ClinicFlow is not an accounting-general-ledger replacement. |

## 7. Legacy technical mapping and migration direction

The current Prisma schema contains implementation names that predate this glossary. They are compatibility details, not approved product language. New APIs, UI copy, documentation, analytics event names, and migrations should use the canonical terms below. Existing names must be changed through a backward-compatible technical migration with data migration, contract versioning where needed, and regression tests; do not perform a cosmetic rename that breaks existing references.

| Current implementation name | Canonical term | Migration direction |
| --- | --- | --- |
| `Customer` model; `customerId`; `customers` relations | Client; `clientId`; `clients` relations | Introduce canonical application/API names first, then plan schema/table/foreign-key migration with compatibility views or versioned contracts as required. Remove customer-facing terminology only after all consumers migrate. |
| `patientCode` | Client code | Replace public/API/UI naming with `clientCode`; migrate storage/index naming while preserving organization uniqueness. |
| `UserRole.Client` and `clientProfiles` | Future Client authentication/profile boundary | No client-facing authentication in this release. Do not expose this role as a released user role; decide its future model separately from staff authorization. |
| `AppointmentSession` | Record | Evolve the appointment-linked visit/documentation model and public contracts to `Record`; preserve historical data and one-to-one constraints until a future record model explicitly changes them. |
| `PatientDentalChart` and `DentalChartRevision` | Client dental chart and dental-chart revision | Replace patient-facing labels in code/contracts progressively while retaining regulated terminology only where truly required. |
| `Resource`, `resourceId`, and resource blocks | Future scheduling allocation concept | Do not use these to determine release availability or booking validity. Defer retention/removal and a possible reintroduction to a future scheduling-capacity ADR. |
| `primaryCalendar = "BS"` | Gregorian/AD default with optional BS display | Migrate defaults and configuration semantics so AD/ISO is canonical and default; retain BS only as an explicit display preference backed by centralized conversion. |
| Single `User.role` value | Additive role assignments | Replace with a role-assignment model that supports multiple roles and organization/location scope; retain a controlled compatibility path during migration. |

## 8. Open technical migration decisions

These are intentional future implementation decisions, not permission to diverge from the glossary:

1. Define the Client-code generation format, collision handling, and whether a code may ever be reissued after archive. It must remain organization-unique and automatically assigned.
2. Define the backward-compatible sequence for physical database renames from `Customer`/`patient*`/`AppointmentSession` to canonical client/record names, including reporting and integration contract versions.
3. Define Record signing, amendment, retention, and multi-record rules after clinical workflow requirements are finalized.
4. Define a future provider-plus-capacity model only when chairs, rooms, equipment, or other resources become an approved product requirement. It must not alter the provider-only release behavior implicitly.
5. Define client-authentication and client-portal concepts as a separate future product surface, including consent, authentication, privacy, and API boundaries.
