# Database Complexity and Performance Review

**Reviewed:** 2026-08-15
**Scope:** Prisma schema, all 23 migrations, NestJS Prisma call sites, hot read models, configured PostgreSQL catalog/statistics, seed behavior, and live integrity checks.

## Outcome

The domain model is not broadly over-engineered. Booking holds/confirmations, Client identity reviews and merge lineage, financial corrections, audit events, and idempotency receipts each protect a real concurrency, safety, or audit requirement. Removing those tables would make the system simpler on paper but less correct.

The remaining excess complexity is transitional duplication: old and new authorization sources, scalar and multi-value Client phones, legacy clinical storage, two finance API generations, and the workspace-wide operational payload alongside route-owned read models. Those paths should be retired by measured cutover, not collapsed in one destructive migration.

## Changes completed in this review

| Area | Change | Result |
|---|---|---|
| Referential integrity | Added missing FKs for Client merge actors, Record providers, communication tenants, and workflow actors. | Scripts or future write paths can no longer create those orphans. |
| Index complexity | Removed four provably redundant indexes and two unused priority-first indexes. | Lower write amplification while retaining an equivalent or better lookup path. |
| Dashboard and timelines | Added date-oriented appointment, follow-up, Client timeline, finance, and communication indexes. | Index column order now matches actual filters and ordering. |
| Client directory | Added small active-row browse/recent partial indexes and a `pg_trgm` name-search index. | Active directory reads avoid archived/merged rows; case-insensitive fragments avoid a full name scan at scale. |
| Finance reconciliation | Replaced hydration of every invoice with database aggregates plus day-bounded Payment and FinancialCorrection queries. Draft invoices are excluded from issued/outstanding totals. | Network/memory cost no longer grows with complete invoice history for a daily report. |
| Client contacts | Repaired missing normalized phone/email projections, backfilled authoritative `ClientPhone` rows, and fixed the demo seed to create both representations. | Existing and newly seeded Clients use the same indexed matching path. |
| Domain invariants | Added checks for appointment/block/availability intervals, schedule formats, positive durations/sequences/versions, nonnegative finance values, and valid business hours. | Invalid states fail at commit time even when a new writer bypasses a DTO. |
| Race safety | Added active-role partial unique indexes and the missing null-location ProviderService uniqueness rule. | Concurrent duplicate grants/mappings cannot pass the service-layer precheck race. |

Migrations `20260815_000021` through `000023` were applied successfully to the configured database. Prechecks found no orphan, cross-tenant, invalid-range, negative-value, or duplicate-active-role rows.

## Current evidence and limits

The configured database currently contains one organization, six Clients, eight appointments, four follow-ups, one invoice, and two payments. This is enough to validate migration safety and integrity, but not enough to claim production-scale latency. Index statistics from this dataset are directional only.

The next performance gate must use representative synthetic volume and record `EXPLAIN (ANALYZE, BUFFERS)` plus p50/p95 latency for Client directory/search, provider-day schedule, dashboard, finance workspace, and reconciliation. Do not add speculative JSON indexes or caches before that evidence exists.

## Complexity to retain

- `BookingSlotHold` and `BookingConfirmation`: required for slot ownership, expiry, atomic confirmation, and replay safety.
- PostgreSQL provider-time exclusion constraint: required because an application availability check alone races.
- `ClientIdentityReview`, `ClientAlias`, and `ClientMerge`: required for shared-household contacts and auditable duplicate resolution.
- `FinancialCorrection` and idempotency metadata: required for immutable payments, distinct approval, retries, and reconciliation.
- `WorkflowEvent` and `AuditLog`: they serve different purposes—domain transition history versus privileged/general audit evidence.

## Complexity to remove through planned cutover

| Priority | Transitional duplication | Implementation gate before removal |
|---|---|---|
| P2R | `/operational-data` returns a wide organization graph while v1 route-owned read models now exist. | Move every remaining web caller to a bounded v1 contract, add route-isolation tests, measure payload/latency, then delete the wide endpoint and mapper. This is the largest remaining read-performance risk. |
| P2/P8 | `User.role` coexists with OrganizationMembership/RoleAssignment. | Backfill memberships/assignments for every clinic user, make authorization read assignments only, prove two-tenant/location denial tests, then remove scalar-role fallback in a contract migration. |
| P3 | `Customer.phone`/`normalizedPhone` coexist with `ClientPhone`. | Keep dual-write/repair monitoring until all writers and exports read `ClientPhone`; then make the scalar value a derived compatibility projection or remove it. |
| P4B | Legacy `BillingService` coexists with `FinanceLedgerService`. | Route all UI/API callers through governed v1 commands, compare ledger results, disable generic mutation/delete routes, then remove the legacy service. |
| P5 | Mutable `AppointmentSession` and current-state chart tables coexist with the planned signed Record/amendment model. | Perform the Record expand/backfill/dual-read/cutover plan; do not add more fields to the legacy Record table. |
| P4A | Appointment resource/chair relations remain although provider is the booking authority. | Confirm no public caller depends on chair conflicts, retain display-only compatibility if needed, then remove resource conflict logic before considering schema contraction. |

## Important deferred database refinements

These are relevant, but should not be implemented against the small current dataset without the stated gate:

1. **Tenant-consistent composite foreign keys.** Ordinary FKs prove that referenced rows exist, but not that duplicated `organizationId` values match across Appointment/Client/Provider, Invoice/Client/Location, Payment/Invoice/Client, and similar relations. Current live checks found zero mismatches and services validate tenant scope. Add composite candidate keys and FKs only in an expand/validate/contract migration rehearsed against production-shaped data.
2. **Clinical tenant columns.** Legacy `AppointmentSession`, `PatientDentalChart`, and `DentalChartRevision` derive tenancy through parents instead of carrying a direct organization FK. Add tenant columns as part of P5 Record migration rather than expanding soon-to-be-replaced tables twice.
3. **`issuedAt` semantics.** Draft invoices currently have a required timestamp. Reconciliation now excludes Draft/Cancelled states, but the target model should make `issuedAt` nullable until issue and preserve a separate `createdAt`.
4. **Timestamp type migration.** Prisma currently created `timestamp(3) without time zone` columns. The API treats them as UTC. A switch to `timestamptz` requires an explicit `AT TIME ZONE 'UTC'` conversion rehearsal and schedule regression evidence; do not allow an implicit cast.
5. **Row-level security.** Nest authorization is the current authority. If direct database access, analytics, or tenant-scoped service credentials are introduced, add and test PostgreSQL RLS; do not treat it as a substitute for API authorization.
6. **Index pruning after scale evidence.** Reassess overlapping finance/contact indexes using at least one full clinic cycle of `pg_stat_user_indexes`. Zero scans in today’s tiny dataset are not sufficient evidence to remove non-redundant indexes.

## Release checks

- All migrations must apply from baseline to an empty disposable PostgreSQL database and against a production-shaped snapshot.
- Run `ANALYZE` before query-plan capture and include row counts, buffers, planning time, and execution time.
- Assert zero orphan and tenant-mismatch rows before validating composite FKs.
- Run booking, Client creation, finance concurrency, authorization, and seed smoke tests after every schema train.
- Use forward repair; do not use `db push` or destructive rollback in shared environments.
