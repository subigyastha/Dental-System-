# Decision Log and Architecture Decision Records

| Field | Value |
| --- | --- |
| Status | Living decision log |
| Version | 0.1 |
| Last updated | 2026-07-18 |

## How to use this log

This file records consequential, durable product and technical decisions. New entries use the next sequential ADR number and contain context, decision, consequences, owner, and status (`Proposed`, `Accepted`, `Superseded`, or `Deprecated`). An ADR is required before changing tenancy, authorization, canonical terminology, retention/deletion, schedule correctness, payment/integration architecture, cache architecture, or deployment/security controls.

## ADR-001 — Modular monolith with NestJS authority

**Status:** Accepted

**Decision:** ClinicFlow is an npm-workspaces modular monolith with Next.js web and NestJS API applications. NestJS is the sole authority for operational business rules and PostgreSQL access. Next.js provides UI/SSR only.

**Consequences:** Browser/Next operational Prisma access and fallback routes must be removed. Future workers/integration adapters use Nest-owned contracts rather than browser code.

## ADR-002 — Multi-tenant organization isolation

**Status:** Accepted

**Decision:** Organization is the primary tenant boundary; location is a secondary scope. Tenant and permission scope are derived server-side from authenticated identity, not trusted request fields.

**Consequences:** Every endpoint, query, cache key, job, audit event, and test must enforce organization/location scope. Cross-tenant tests are release gates.

## ADR-003 — Client and Record terminology

**Status:** Accepted

**Decision:** `Client` is the canonical product/UI/API term and `Record` is the clinical/visit documentation term. Existing `Customer`, `patientCode`, `AppointmentSession`, and `Patient*` identifiers are legacy implementation mappings pending a controlled migration.

**Consequences:** Documentation and new APIs use canonical terms. Compatibility adapters/migration versions preserve existing data/contracts until retired deliberately.

## ADR-004 — Canonical calendar and time

**Status:** Accepted

**Decision:** Gregorian/AD ISO-8601 UTC timestamps are canonical for persistence, APIs, audit, and calculations. AD is the default UI calendar. BS is optional, derived display/conversion data through one centralized service.

**Consequences:** No feature stores or schedules by BS values. Scheduling uses location IANA timezone, defaulting to `Asia/Kathmandu` for Nepal organizations.

## ADR-005 — Provider-only scheduling capacity

**Status:** Accepted

**Decision:** The release schedules provider capacity only. Chairs, rooms, equipment, and generic resources are not scheduling constraints.

**Consequences:** Public scheduling contracts do not require resource IDs. Provider range conflicts are prevented through a database-backed atomic commit guard; resource modeling is a future extension.

## ADR-006 — Additive multi-role authorization

**Status:** Accepted

**Decision:** Replace scalar user roles with active, auditable organization/location-scoped role assignments. Owner/Admin receive all clinic-level capabilities. Super Admin is platform-only by default.

**Consequences:** Finance and Inventory Manager are distinct additive roles. Effective permissions are resolved server-side and changes invalidate sessions/authorization state.

## ADR-007 — Critical-data archive then Owner-confirmed deletion

**Status:** Accepted

**Decision:** Critical Client, Record, finance, inventory, audit, and comparable operational information must first be archived. An Owner may permanently delete only from the archive after explicit confirmation and only when retention, legal hold, financial, and audit policy permits it.

**Consequences:** No normal hard delete for critical data. Archive, delete request/confirmation, actor, reason, and outcome are audited. Signed Records and completed payments normally require governed amendments/reversals rather than deletion.

## ADR-008 — Finance and inventory are separate domains

**Status:** Accepted

**Decision:** Inventory movement is an immutable operational ledger separate from invoices, payments, and accounting. The release does not automatically create COGS/general-ledger entries from inventory movement or Record completion.

**Consequences:** Finance and Inventory Manager permissions, data models, reports, and workflows remain separate; future linkage requires an ADR.

## ADR-009 — Payment and notification integration boundaries

**Status:** Accepted

**Decision:** Payment providers, including Fonepay, integrate through server-owned, provider-neutral adapters with verified idempotent webhooks and reconciliation. First-phase messaging supports WhatsApp and SMS through provider adapters. Super Admin controls global feature flags that can enable/disable messaging and payment integration capabilities.

**Consequences:** Browser code never holds provider secrets. Live provider enablement requires sandbox/production verification, credentials, support monitoring, and explicit feature configuration.

## ADR-010 — Shared cache and read models

**Status:** Accepted

**Decision:** Replace oversized operational bootstrap with narrow authenticated read models. Redis caches derived schedule/dashboard data with TTL and event invalidation; PostgreSQL/Nest remains authoritative.

**Consequences:** Cache cannot determine authorization, booking validity, payment correctness, or serve client clinical/financial payloads as shared data.

## ADR-011 — Production platform baseline

**Status:** Accepted

**Decision:** Production runs separately deployable web, API, and worker services with managed PostgreSQL/Redis, secret manager, structured observability, CI release gates, backups/restore rehearsal, and controlled migration deployment.

**Consequences:** Current direct-Prisma fallbacks, single-instance cache, missing CI/health/observability, and incomplete authorization are launch blockers until remediated and evidenced.
