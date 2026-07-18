# Authorization and Permission Matrix — ClinicFlow

| Field | Value |
| --- | --- |
| Status | Normative ship target |
| Version | 0.1 (draft) |
| Last updated | 2026-07-18 |
| Applies to | All ClinicFlow APIs, web applications, jobs, integrations, reporting, and support operations |
| Product authority | [Product Requirements Document](01-product-requirements-document.md) |

## 1. Purpose and non-negotiable rules

This specification defines the authorization model required for the production release. It supersedes any implicit permission inferred from a screen, route, legacy `User.role` value, or client-side state.

- ClinicFlow uses additive role-based access control (RBAC). A user may have multiple active role assignments; effective permissions are the union of their valid assignments, constrained by scope and policy.
- Every clinic-owned request must be authorized on the server by NestJS. The web application is not an authorization authority and must not access Prisma or PostgreSQL for operational data.
- A role assignment is scoped to exactly one organization and is either organization-wide or restricted to one or more locations in that organization.
- Owner and Admin have all clinic-level role permissions, subject to the finance-correction approval, audit, and scope rules in this document. Ownership-transfer controls remain Owner-only.
- Super Admin is a platform role, not a clinic role. It has no standing right to inspect identifiable clinic, client, clinical, financial, inventory, or scheduling data.
- A completed financial payment is append-only. No permission grants an in-place edit or deletion of a completed payment.
- Product, API, and documentation language uses **client**. Legacy `Customer` identifiers are technical migration artifacts only.

## 2. Model and vocabulary

| Term | Meaning |
| --- | --- |
| Permission | A named server-enforced action, for example `invoice.issue` or `payment.record`. |
| Role | A maintained bundle of permissions. Roles do not bypass tenant or location scope. |
| Assignment | A dated, auditable relationship between a user, role, organization, and optional location set. |
| Organization scope | Access to all authorized locations and organization-level records within one clinic organization. |
| Location scope | Access only to explicitly assigned locations and records whose location is within that set. |
| Assigned work | An appointment, task, or clinical work item explicitly assigned to the acting Provider or Assistant. |
| Sensitive action | An action requiring a reason, stronger re-authentication where configured, or enhanced audit data. |
| Support-access grant | A temporary, auditable Super Admin grant to a named organization for a defined support purpose. |

All role assignments must contain an immutable identifier, `userId`, `organizationId`, `role`, scope type, allowed location IDs when location-scoped, active interval, grantor, reason when required, and revocation metadata. A user may not be active under a role outside the assignment's organization or time interval.

## 3. Roles

| Role | Intended responsibility | Default scope |
| --- | --- | --- |
| Super Admin | Koi Tech platform administration, platform health, aggregate adoption metrics, governed support. | Platform only |
| Owner | Clinic ownership and complete clinic governance. | Organization-wide |
| Admin | Complete clinic administration, excluding ownership transfer. | Organization-wide |
| Manager | Daily operational management, schedules, staff coordination, follow-ups, and operational reporting. | Organization or locations |
| Receptionist | Front desk, client administration, appointments, invoices in draft, and payment recording. | Organization or locations |
| Scheduler | Provider availability, scheduling, appointment communication, and schedule exceptions. | Organization or locations |
| Provider | Clinical delivery and clinical records. Providers can read all client records initially; clinical write is limited to assigned work. | Organization or locations |
| Assistant | Clinical support and permitted documentation drafts. | Organization or locations |
| Finance | Billing administration, payment corrections, reconciliation, finance reports, and payment-provider operations. | Organization or locations |
| Inventory Manager | Inventory catalog, stock operations, suppliers, counts, and inventory reporting. | Organization or locations |

The product must permit a user to hold, for example, both Receptionist and Inventory Manager assignments. It must not require duplicate user accounts to combine legitimate responsibilities.

## 4. Scope evaluation and precedence

For every request, the authorization service must evaluate the following in order:

1. Authenticate the user or verified machine identity and resolve the active organization context.
2. Identify the requested record's organization and, where applicable, location. The client must never supply an organization or location that is trusted without server verification.
3. Collect only active assignments for the user in that organization. Platform assignments are evaluated separately.
4. Union permissions from assignments whose organization and location scope contains the target. An organization-scoped assignment contains every location in its organization.
5. Apply record-level constraints, workflow state, required assignment, separation-of-duties rules, approval thresholds, and feature configuration.
6. Deny if any required check fails; record the denial for sensitive or anomalous attempts without exposing protected data.

The following precedence rules are mandatory:

- Cross-organization access is always denied, even if the user has a role in another organization.
- An explicit policy denial, an inactive/suspended user, revoked assignment, disabled feature, invalid workflow state, or missing required approval overrides the otherwise additive role union.
- Location scope limits location-owned records. Organization-scoped records are available only where the role has the relevant organization-level permission.
- A record without a location is evaluated at organization scope; it must not become visible merely because the user has a role at one location.
- Relationship-derived access such as **assigned work** can further narrow a role; it cannot broaden tenant or location scope.
- If a record changes location, future access follows the current location while the audit history preserves the access context at the time of each action.

## 5. Action matrix

Legend: **M** manage/create/update where workflow permits; **R** read; **D** draft only; **A** approve; **—** no permission. Owner and Admin inherit every clinic-role permission in this table unless a row states an exception.

| Capability / action | Owner / Admin | Manager | Receptionist | Scheduler | Provider | Assistant | Finance | Inventory Manager | Super Admin |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Organization configuration, locations, services | M | limited operational config | — | — | R as needed | R as needed | payment config only | inventory config only | platform configuration only |
| Invite/suspend staff; role assignments | M | staff coordination only | — | — | — | — | — | — | platform staff only |
| Client demographic/contact records | M | M | M | R | R all clients initially | R for support workflow | R as billing requires | — | no standing access |
| Client clinical records | M, audited exceptional access | R operationally; no clinical authoring | R only where needed for front desk; no clinical-note content by default | R appointment context only | R all clients initially | R only necessary assigned-work context | R billing context only | — | no standing access |
| Clinical record / visit outcome | M only through authorized clinical workflow | — | — | — | M for assigned work | D for permitted assigned work | — | — | no standing access |
| Finalize/sign clinical record | M only when clinically authorized | — | — | — | M for own assigned work | — | — | — | no standing access |
| Appointments, check-in, status updates | M | M | M | M | M for assigned work | limited workflow support | R finance context | — | no standing access |
| Provider availability and schedule blocks | M | M | R | M | manage own availability where permitted | R | — | — | no standing access |
| Operational and utilization reporting | M | R | limited front-desk views | R schedule views | R own/work views | R assigned-work views | finance only | inventory only | aggregate platform only |
| Draft invoice and line items | M | — | D | — | draft only if clinic enables provider billing workflow | — | M | — | no standing access |
| Issue/cancel/void invoice | M | — | — | — | — | — | M | — | no standing access |
| Record payment against issued invoice | M | — | M | — | — | — | M | — | no standing access |
| Edit/delete completed payment | — | — | — | — | — | — | — | — | — |
| Refund, reverse, void payment | A/M subject to threshold | — | — | — | — | — | initiate M; approval where required | — | no standing access |
| Reconcile payments and settlements | M | — | — | — | — | — | M | — | no standing access |
| Configure payment providers and credentials | M | — | — | — | — | — | M | — | platform connector controls only |
| Inventory catalog, suppliers, reorder settings | M | R | — | — | R consumption context | R consumption context | — | M | no standing access |
| Receive/count/adjust/transfer stock | M | — | — | — | — | — | — | M | no standing access |
| Inventory reports | M | R | — | — | — | — | — | M | aggregate platform only |
| Aggregate platform metrics and organization lifecycle | — | — | — | — | — | — | — | — | M |
| Temporary governed support access | — | — | — | — | — | — | — | — | request/use only |

`M` does not authorize bypassing lifecycle rules. For example, an invoice cannot be issued without validated lines and required client/location context; an appointment cannot be saved across an unresolved provider conflict; and stock cannot be made negative unless a separately approved inventory policy explicitly permits it.

### 5.1 Clinical access policy for the first release

Until a later client-access policy is approved and implemented, each Provider assignment may read client records for all clients within its valid organization/location scope. This is an intentional first-release operating policy, not an implication that all users may read all clinical content.

- Provider clinical writes, amendments, outcomes, and signatures are limited to the Provider's assigned appointment or work item, except an audited Owner/Admin exceptional-access workflow.
- Assistants may create or edit a permitted clinical draft only for assigned work. They cannot sign, finalize, or alter a finalized Provider record.
- Receptionist, Scheduler, Manager, and Finance views must expose only the minimum client/appointment/billing data required by their rows in the matrix. They do not receive clinical-note authoring permissions.
- A future per-client care-team or consent-based access policy must replace this broad Provider read rule only through a versioned policy change, migration, and negative authorization tests.

### 5.2 Financial authority

Receptionist payment authority is deliberately narrow:

- May create and edit a **draft** invoice within valid location scope and record a payment against an **issued** invoice.
- Must enter payment method, amount, received date/time, location, invoice, and an appropriate reference/receipt identifier where applicable.
- May not issue, cancel, void, or delete invoices; edit/delete a completed payment; create a refund, reversal, or adjustment; reconcile settlements; configure a payment provider; or alter finance reports.
- A payment record becomes immutable when completed. Corrections are new linked ledger events: void, refund, reversal, or other governed adjustment.

Finance may create and administer invoices, record payments, reconcile settlements, operate payment providers, and initiate permitted corrections. Owner/Admin approval is required for a refund, void, reversal, or adjustment at or above the organization-configured amount threshold; an Owner/Admin cannot approve their own initiated correction. Every correction requires a reason and links to the original payment and invoice.

Payment-provider callbacks, including future Fonepay or other Nepal provider integrations, run under a dedicated machine identity. A callback may update a payment only after provider authentication/signature validation, idempotency validation, invoice/payment correlation, and state-transition authorization. No browser user role can simulate a verified provider callback.

## 6. Role delegation and assignment administration

- Only Owner or Admin may grant, change, or revoke clinic roles. They may grant only assignments within their own organization; location-scoped grants must name approved locations in that organization.
- Owner/Admin must not grant platform roles. Super Admin assignments are managed through a separately protected platform administration workflow.
- An Admin may not transfer ownership, remove the final active Owner, or grant an Owner role unless an explicit ownership-governance policy permits it. The default release behavior is Owner-only ownership transfer with stronger re-authentication and audit.
- No actor may approve a financial correction they initiated. The system must enforce this even when the actor holds both Finance and Owner/Admin roles.
- Role changes take effect immediately for subsequent authorization checks; active sessions must have assignment version/permission changes revalidated or invalidated promptly.
- Assignment creation, scope changes, activation, expiry, and revocation require a reason when they increase access, and always create an audit event containing grantor, grantee, old/new roles and scope, and correlation ID.

## 7. Authentication, sessions, and service identities

- Production browser authentication uses short-lived, secure, `HttpOnly`, `Secure`, `SameSite` session cookies. Tokens must not be stored in `localStorage`, `sessionStorage`, or JavaScript-readable persistent browser storage.
- Session issuance, refresh, logout, password reset, account suspension, role change, and organization-context switching are server-side events. Sensitive actions, including role administration, payment correction approval, ownership transfer, provider credential changes, and support-access use, require recent re-authentication or equivalent step-up control.
- CSRF protections apply to cookie-authenticated state-changing requests. Transport encryption is mandatory; secrets and payment-provider credentials are never returned to browser clients or ordinary logs.
- API clients, background jobs, webhooks, and payment adapters use distinct scoped service identities, credential rotation, and least-privilege permissions. They are not represented as human user roles.
- Authorization decisions must use server-side assignment data, organization context, record state, and policy version. Client-supplied role claims are advisory only and must not authorize an action.

## 8. Super Admin boundary and support access

Super Admin may manage platform configuration, organization provisioning/lifecycle, platform service health, security/operational controls, and aggregate/de-identified metrics such as organizations onboarded, active organizations/users, feature adoption, request health, and error trends.

Super Admin must not receive standing access to clinic records. Identifiable clinic data, client data, clinical notes, appointment details, invoices, payments, inventory movements, and exports are denied by default.

When support access is necessary, the platform must require a support-access grant with all of the following:

- named Super Admin, target organization, support case/reason, requested data domain, minimum required permission set, start time, and expiry time;
- read-only access by default, with a separate explicit justification and authorization for any write action;
- an automatic expiry and immediate revocation control;
- immutable audit events for request, approval where required, access attempts, records viewed, actions performed, and expiry/revocation;
- organization notification where practical and a clinic-visible support-access history; and
- no use as a substitute for tenant-scoped product APIs or general troubleshooting shortcuts.

Platform analytics must use the minimum data necessary. Clinical note content and detailed client data are not analytics inputs.

## 9. Audit, monitoring, and data-minimization requirements

The authorization/audit subsystem must record successful and denied sensitive actions with actor or service identity, organization, location where applicable, role assignment IDs used, target type/ID, action, decision, reason, timestamp, correlation/request ID, source/IP/device metadata consistent with privacy policy, and before/after or event payload appropriate to the action.

At minimum, audit: authentication/session events; organization-context changes; role and scope changes; client merge/archive; clinical drafting/finalization/amendment; appointment state changes/conflict overrides; invoice lifecycle; payment recording, corrections, reconciliation, and provider callbacks; inventory movements; exports; configuration changes; Super Admin support access; and authorization denials for sensitive resources.

Audit records are append-only, tenant-isolated where clinic-owned, searchable only by authorized roles, retained according to the approved retention policy, and protected from ordinary administrative alteration. Monitoring must alert on suspicious privilege changes, repeated cross-tenant denials, elevated payment failures, unauthorized webhook attempts, and support access beyond its expiry.

## 10. Implementation migration from scalar `User.role`

The current implementation has a scalar Prisma `User.role` enum. It is insufficient for additive roles and location scope and must be replaced without silently broadening access.

1. Introduce normalized `RoleAssignment` (and assignment-location relation where needed), policy/permission definitions, assignment status, effective dates, grant/revoke audit fields, and indexes for user/organization/location authorization checks.
2. Backfill each active scalar role into one organization-scoped assignment only after verifying the user's tenant. Quarantine or manually resolve users whose organization relationship is ambiguous; never infer cross-tenant rights.
3. Deploy dual-read authorization that compares the legacy role decision with the new assignment decision, logs mismatches safely, and defaults to the more restrictive decision during the transition.
4. Update NestJS guards/services and every API, worker, webhook, report, and export to authorize from assignments and server-side scopes. Remove direct frontend Prisma/database paths from production flows.
5. Migrate role-management UI and APIs to additive assignment administration, including location scope, expiry, revocation, reasons, and audit views. Replace client-visible terminology with client-first language.
6. Migrate existing sessions/claims, invalidate affected sessions, remove production reliance on the scalar role, and only then retire it after verified rollback and data-retention planning.

## 11. Current gaps and required release acceptance tests

The present repository baseline includes a single `User.role` value and token-based authentication. It does not demonstrate this production authorization model. The following gaps are release blockers until implemented and evidenced:

- additive role assignments, organization/location scoping, role lifecycle/audit, and server-side permission evaluation;
- dedicated Finance and Inventory Manager roles, bounded Receptionist payment recording, correction approval separation, and immutable payment controls;
- Super Admin platform controls, aggregate metric isolation, governed support access, and clinic-visible audit history;
- secure browser sessions replacing browser-readable token storage, CSRF defenses, step-up controls, and scoped machine identities;
- tenant isolation and authorization coverage across all Nest endpoints, workers, reporting, exports, and payment webhooks; and
- an implemented, explicit first-release Provider read-all-within-scope policy with assigned-work-only clinical write enforcement.

Release acceptance evidence must include automated and manual tests proving that:

1. A user with two roles receives the valid union of permissions, while a role at Location A cannot access Location B or another organization.
2. Owner/Admin receive all clinic-role permissions but cannot bypass payment immutability, correction approval separation, or organization isolation.
3. Receptionist can save a draft invoice and record a valid payment on an issued invoice, but cannot issue/void an invoice, edit/delete its completed payment, refund, reverse, reconcile, or configure a provider.
4. Finance can initiate a correction; the configured threshold requires a different Owner/Admin approver, and linked immutable ledger/audit events result.
5. Provider can read all in-scope client records initially but can write/sign only assigned clinical work; Assistant can draft permitted assigned-work content but cannot finalize it.
6. Every clinic-owned endpoint and export rejects a valid user from another organization and rejects an out-of-scope location request without leaking record existence.
7. Super Admin can view only aggregate/de-identified platform metrics by default. Identifiable clinic data requires an unexpired, scoped support grant and yields a complete audit trail.
8. Session revocation, role revocation, account suspension, CSRF protection, and step-up authentication block or invalidate protected actions as designed.
9. Verified, duplicate, failed, and forged payment-provider callbacks each follow the appropriate idempotent authorization and audit path.
10. Audit logs show the precise authorization context for consequential actions and cannot be changed through ordinary clinic administrative APIs.

## 12. Decision ownership

Changes to this matrix require product, security, and clinic-operations review. Any expansion of clinical visibility, finance authority, Super Admin standing access, payment correction rights, or cross-location access requires a versioned decision, threat/privacy review, implementation migration, and negative authorization tests before release.
