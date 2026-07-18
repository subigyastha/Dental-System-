# Client Identity and Record Governance

| Field | Value |
| --- | --- |
| Product | ClinicFlow — Koi Workflow System |
| Version | 0.1 (draft) |
| Last updated | 2026-07-18 |
| Status | Normative release specification |
| Canonical vocabulary | Client; Record; amendment |

## 1. Purpose and authority

This specification governs client identity, client data, clinical Records, dental-chart revisions, duplicate handling, correction, archive, and deletion. It is the source of truth for those behaviours. NestJS is the only authority that may create, alter, merge, archive, restore, or delete governed data. The web application must use the API and must not read or write Prisma/PostgreSQL directly.

`Client` is the product, API, and documentation term. The current `Customer` model, `patientCode` field, and `/customers` implementation are legacy technical names that must be renamed or isolated behind a compatibility layer before release; they must not dictate new product vocabulary. `Record` means a clinical Record, not the generic database `RecordStatus` enum.

## 2. Identity model

Every client has two identifiers:

| Identifier | Rule |
| --- | --- |
| Client ID | Opaque, immutable, globally unique internal identifier. It is never reissued or changed, including after a merge or archive. |
| Client code | Human-friendly organization-scoped identifier, generated atomically from an organization sequence. It is unique within the organization and never reused. |

The client code generator must use a transaction-safe sequence/counter, not `COUNT(*)`, a last-row lookup, or browser logic. It must remain safe under concurrent client creation. Existing `PT-00001`-style values remain historical aliases during migration; new presentation and API labels use `clientCode`.

Organization ID is derived from the authenticated server-side session. No client lookup, write, code, relationship, or export may cross an organization boundary. A client may have a user account in a future patient-facing product, but no client-facing login, portal, self-booking, or self-service API is in this release.

## 3. Registration, identity data, and duplicates

Required registration data is the minimum necessary for an organization to identify and contact a client: full name and at least one approved contact method or a documented reason it is unavailable. Date of birth, gender, address, emergency contact, medical alerts, allergies, and clinical information are collected only when relevant to care or clinic policy.

Phone number and email are **not** unique identifiers. Families, guardians, and businesses may share a phone or email. The current database uniqueness constraint on `[organizationId, phone]` is a release blocker and must be removed/replaced with a non-unique indexed normalized contact value.

Before creating a client, the API must perform an organization-scoped duplicate search using normalized phone, normalized email, name, and, where supplied, date of birth. It returns ranked candidates (`strong`, `moderate`, or `weak`) and requires the actor to select an existing client, merge later, or explicitly attest that a new client is appropriate. A match is advisory: no automatic merge is permitted.

Normalization rules are versioned and auditable. Source values are preserved; canonical search values are stored separately. The UI must explain that shared household contacts are allowed and must not imply a match is a duplicate.

## 4. Merge and alias governance

Only Owner, Admin, or an explicitly authorized Client-Records permission may initiate and approve a merge. The actor selects a primary client and secondary client, reviews field conflicts and all related appointments, Records, invoices, payments, chart revisions, communications, and tasks before commit.

A merge is transactional and reversible only through a controlled, audited unmerge procedure. It must:

1. preserve the primary Client ID;
2. move relationships without changing their historical authorship or timestamps;
3. retain the secondary Client ID and code as a non-reusable alias pointing to the primary client;
4. record the reason, actor, time, fields selected, and before/after relationship counts; and
5. return the primary record for future lookups while warning authorized users of the merge history.

The current direct relationship reassignment implementation and duplicate phone constraint must be reviewed against these requirements before release. A merge may not silently overwrite a value with a conflicting value or erase a clinical Record.

## 5. Client profile and clinical Record governance

Profile corrections change administrative demographic/contact data and create an audit event with changed-field metadata. They must not rewrite historical invoice snapshots, payment records, appointment history, signed Records, or chart revisions.

A clinical Record is the clinical outcome/documentation associated with a completed or in-progress care interaction. Its minimum lifecycle is:

```text
Draft → Signed
```

Providers may create and edit drafts. Assistants may create or edit only the draft fields their permissions permit. A Provider signs a Record; signing binds the signer, signed timestamp, Record version, client, and related appointment/session where applicable. Once signed, the Record is immutable.

Corrections to signed Records are append-only amendments. An amendment references the signed Record, states a required correction reason, contains the replacement or supplemental content, identifies its author/time, and never changes the source content or signature. Readers see the original and ordered amendments together. A later amendment may correct an earlier amendment but cannot erase it.

Dental chart data follows the same append-only rule. Each chart revision stores a complete versioned snapshot, author, time, optional source Record/session, and reason/note. The mutable “current chart” projection is derived from the newest valid revision; it is not the historical authority. Current `PatientDentalChart` updates and cascade deletes are release blockers until revision history and immutability are enforced.

## 6. Two-step archive and deletion policy

Critical information is never directly deleted. This includes clients, clinical Records and chart revisions, appointments, invoices, payments, inventory movements, organization configuration, audit events, and user/role history.

The mandatory lifecycle is:

```text
Active → Archived → Permanently deleted
```

Archive is a reversible logical state. It removes an item from ordinary operational lists and blocks ordinary changes, but retains it, its identifiers, relationships, reason, actor, and archived timestamp. It must not be implemented as a cascading database delete. Only a permitted operational role may archive, with a required reason for critical data.

Permanent deletion is available **only from the archive**, only to an Owner, and only after an explicit confirmation that identifies the exact target and states the irreversible impact. The API requires a fresh confirmation token/typed confirmation, rechecks Owner authority and archive state inside the transaction, records a deletion audit event, and rejects bulk or ambiguous deletion. Admin, Finance, Receptionist, Provider, Assistant, and Super Admin may not bypass this rule.

Permanent deletion must also be rejected when a legal hold, active retention obligation, financial audit obligation, clinical retention obligation, unresolved dispute, or linked record that must be retained applies. Where deletion is allowed, it must preserve the minimum non-identifying audit tombstone required to demonstrate the action. No automatic purge is authorized until a jurisdiction- and clinic-approved retention schedule is adopted.

## 7. Consent, privacy, access, and exports

Consent and communication preferences are versioned records with purpose, channel, source, language where relevant, capture time, actor/system, and withdrawal time. Consent is not inferred from a contact value. Messaging sends only through clinic-enabled channels and according to the separate notification specification.

All client and Record access is organization-scoped and role-authorized. For the initial release, Providers may access client Records across their organization as approved in the permission matrix; per-client care-team restrictions are future scope. Exceptional Owner/Admin access to clinical content is audited. Sensitive fields must be minimized in list/search responses and excluded from analytics unless de-identified and authorized.

Exports require a permission, scope, purpose, audit entry, and a time-limited download. API logs, analytics, error tracking, and support tools must redact clinical notes, medical alerts, addresses, contact values, tokens, and payment references unless explicitly necessary and protected.

## 8. Required audit event data

For create, update, match decision, merge, unmerge, sign, amendment, chart revision, archive, restore, deletion request, and permanent deletion, capture: organization, target type/ID, actor identity and roles, request/correlation ID, timestamp, action, reason where required, before/after version or safe field diff, and source (UI/API/system). Audit events are append-only and cannot be deleted through ordinary product functions.

## 9. Required implementation changes and release criteria

The current schema and services are not sufficient to claim compliance: `Customer.phone` is unique, client-code generation is count-based, multiple related records use cascade delete, and session/chart content is mutable. Before production release, the system must:

- adopt Client terminology or documented API/database compatibility mappings;
- add immutable client IDs, atomic organization-scoped client-code sequencing, archived state, archival metadata, aliases, merge history, and retention/legal-hold controls;
- remove phone uniqueness while retaining performant normalized-contact indexes and organization boundaries;
- implement signed Record and chart-revision immutability plus amendment history;
- make archive-first deletion and Owner-only explicit-confirmation deletion enforceable server-side for every critical entity; and
- test concurrent client-code allocation, shared phone registration, merge integrity, archive/restore, deletion rejection, Record amendment, tenant isolation, and audit completeness.

No endpoint may expose a direct hard-delete path for critical information in the shipped release.
