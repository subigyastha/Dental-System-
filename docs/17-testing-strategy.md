# Testing Strategy

| Field | Value |
| --- | --- |
| Status | Normative release-quality strategy |
| Version | 0.1 (draft) |
| Last updated | 2026-07-18 |

## 1. Quality principles

Testing proves product invariants, not only screen behavior. NestJS services and PostgreSQL constraints are the authority for business correctness. Tests use synthetic/de-identified fixtures only; no production client, clinical, financial, or credential data is permitted.

Every defect in scheduling, authorization, clinical governance, billing, payment integrations, or data isolation receives a regression test at the lowest level that can prevent recurrence.

## 2. Test layers

| Layer | Scope | Required examples |
| --- | --- | --- |
| Unit | Pure domain functions and isolated service rules | AD/BS conversion, duration/buffer calculation, invoice math, transition rules, duplicate scoring, permission resolution |
| Service/integration | Nest service + real disposable PostgreSQL/Redis dependencies | tenant scoping, role unions, appointment reservation, invoice/payment transaction, archive/delete policy |
| API/contract | Versioned HTTP API + auth/error schemas | DTO validation, pagination, idempotency, forbidden tenant access, webhook signature/replay responses |
| End-to-end | Browser through Nest API | sign-in, client creation, booking, check-in/Record signing, invoice/payment, archive flow, Super Admin flags |
| Accessibility | Automated and manual keyboard/screen-reader checks | modal focus, error announcements, semantic labels, responsive layouts, contrast |
| Performance/resilience | Representative load and failure conditions | schedule grid, concurrent booking, cache outage, provider callback spike, queue backlog |
| Security | Dependency, secret, authorization, and abuse checks | IDOR/cross-tenant denial, CSRF/cookie policy, rate limits, log redaction, penetration assessment |

## 3. Non-negotiable invariants

### Authorization and tenancy

- A request cannot read or change another organization's data, even if it supplies a guessed ID.
- Location-scoped role assignments cannot exceed their allowed locations.
- Owner/Admin inherit clinic permissions; Super Admin has no standing clinic-data access.
- A multi-role user receives the permitted union, while explicit state/scope/approval denial still wins.
- Receptionist can record a permitted payment but cannot correct, delete, refund, void, reconcile, or configure payment providers.
- Provider can read all in-scope Clients initially but can sign/write only assigned clinical work; Assistant can draft permitted assigned work but cannot finalize it.

### Scheduling

- AD/ISO timestamps are canonical; BS conversions never alter the saved instant.
- Provider-only conflict detection rejects overlapping reserved intervals, including buffer time; chair/resource data does not affect release scheduling.
- Availability effective dates, timezone, location, recurring/one-time blocks, service eligibility, booking horizon, and slot interval are enforced.
- Two concurrent create/update requests cannot reserve the same provider interval.
- Terminal appointment states cannot be reopened by arbitrary status input; a reschedule creates a successor and preserves the original history.

### Client and Record governance

- Shared phone numbers are permitted; Client ID and organization-unique Client code remain immutable/non-reusable.
- Duplicate matching never silently merges records.
- Critical information is archived before deletion; only an Owner can permanently delete from the archive after explicit confirmation and when retention/legal rules permit it.
- Signed Records and chart revisions cannot be overwritten or deleted; amendments retain author, reason, timestamp, and linkage.

### Financial and inventory correctness

- Invoice totals use NPR decimal/rounding rules and match persisted line items, discounts, and tax.
- Completed payment totals cannot exceed payable balance under concurrent requests.
- Completed payments are append-only; corrections are linked reversal/refund/void actions with required approval/audit.
- Provider webhook deliveries are signature-verified, idempotent, and reconciled without duplicate collection.
- Inventory movements are immutable, organization/location-scoped, and do not create financial/COGS entries automatically.

## 4. Fixtures and test data

- Factories generate independent organization/location/user/role/client/provider/service/appointment/invoice fixtures with unique identifiers.
- Each integration test uses an isolated transaction/schema/database and cleans up through approved test tooling.
- Test roles include every combination that changes authorization, including multi-role, revoked, suspended, location-scoped, and Super Admin support-access paths.
- Provider sandbox traffic is isolated by environment and must never reach a live merchant/client account during automated tests.

## 5. CI quality gates

Every change requires, as applicable:

1. dependency/secret/license scanning;
2. formatting/lint and TypeScript typecheck for both web and API;
3. web and API builds;
4. unit, service/integration, and API-contract suites;
5. migration/schema validation and seed compatibility checks;
6. end-to-end tests for critical release flows;
7. accessibility checks and manual review for changed interactive screens;
8. scheduling concurrency, billing invariant, payment webhook, and tenant-isolation regression suites;
9. staging smoke and performance checks before production promotion.

No production deployment proceeds with an unresolved critical/security defect, failed migration check, failed invariant suite, or unreviewed database/security/financial change.

## 6. Current gaps and release criteria

The repository currently has a small calendar utility test only. It has no broad Nest unit/service suite, disposable database integration suite, API contract suite, end-to-end suite, concurrency test, financial/provider webhook test, accessibility test, performance test, security scan gate, or CI workflow. These gaps block production release.

Release evidence includes test reports, coverage/risk review, successful migration rehearsal, staging smoke results, load/concurrency results, accessibility assessment, and documented acceptance by the product/operational owners.
