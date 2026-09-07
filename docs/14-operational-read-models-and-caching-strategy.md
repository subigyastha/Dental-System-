# Operational Read Models and Caching Strategy

| Field | Value |
| --- | --- |
| Status | Normative production target |
| Version | 0.1 (draft) |
| Last updated | 2026-08-15 |
| Authority | NestJS APIs and PostgreSQL remain the source of truth |

## 1. Purpose

This specification replaces the oversized operational-data bootstrap with secure, purpose-specific read models. A read model is a deliberately shaped, authorization-scoped API response optimized for one screen or workflow. It is not a second source of truth.

The browser, Next.js rendering layer, Redis, and any local memory cache are performance layers only. They may never decide authorization, accept an appointment, determine a payment balance, or substitute seed/direct-database data when the API is unavailable.

## 2. Required read models

| Read model | Consumers | Minimum contents | Freshness target |
| --- | --- | --- |
| Session bootstrap | All signed-in screens | authenticated user, effective roles/scopes, active organization/location, enabled features, navigation permissions | request-time; do not shared-cache |
| Dashboard summary | Dashboard | selected-date metrics, attention queue counts, provider load, follow-up summary, safe action links | 30 seconds |
| Schedule snapshot | Day/week schedule | provider availability, blocks, appointments the viewer may see, status summaries, timezone/calendar display metadata | 30 seconds; explicitly invalidated |
| Slot search | Booking/reschedule | candidate provider slots and conflict-safe input metadata | 15–30 seconds; advisory only |
| Client directory | Client list/search | paginated client-safe summaries and duplicate candidates | request-time or short private browser cache |
| Client detail | Client workspace | one authorized client, appointments, Records, follow-ups, chart summary, billing summary subject to permission | request-time; no shared cache for clinical/financial content |
| Billing list/detail | Finance screens | paginated invoices, balances, payment summaries, permitted actions | request-time; private client cache only |
| Inventory dashboard | Inventory screens | location-scoped stock, reorder alerts, movement summaries | 30–60 seconds |
| Platform dashboard | Super Admin | aggregate/de-identified adoption, health, feature-usage metrics and feature-flag state | 1–5 minutes |

Each endpoint is versioned under `/api/v1`, resolves tenant and scope from the authenticated session, returns only permitted fields, and supports explicit pagination/filtering where its result can grow.

## 3. Bootstrap replacement

`GET /operational-data` is not permitted as a production bootstrap endpoint. Its current behavior can expose a broad first-organization payload and creates an unacceptable tenant/privacy boundary.

The replacement starts with an authenticated session bootstrap. Each route then loads its own read model. Initial page rendering must either use the authenticated Nest API or show a bounded loading/error state. It must not fall back to web-side Prisma, an unauthenticated Next route, or seed data.

## 4. Cache policy

### 4.1 Cache layers

1. **Browser memory:** short-lived UI convenience cache, scoped to the current authenticated session and cleared on logout, organization/location switch, role change, or authorization failure.
2. **Nest in-process memory:** permitted only for process-local non-sensitive implementation details. It cannot be the production shared schedule cache or correctness mechanism.
3. **Redis/shared cache:** the production cache for derived, non-sensitive schedule and dashboard summaries. Keys are tenant- and scope-aware; TTL and invalidation are mandatory.
4. **PostgreSQL:** authoritative persistence. Caches do not write authoritative state directly.

### 4.2 Cacheable data

- Provider schedule snapshots, provider slot candidates, availability summaries, and public-to-staff service configuration may use Redis when keyed by organization, location, provider, local AD date/range, role visibility, and schedule version.
- Aggregate dashboard metrics and inventory summary counts may use Redis with a bounded TTL.
- Client Records, dental-chart content, detailed client demographics, invoices, payments, payment-provider metadata, and audit entries must not be placed in a shared cache. A private browser cache is allowed only for the active authorized session and must be cleared as above.

### 4.3 TTLs and invalidation

| Data | Maximum TTL | Mandatory invalidators |
| --- | --- | --- |
| Provider slots | 30 seconds | appointment, provider availability/block/status, provider-service, service duration/buffer, location/timezone change |
| Day/week schedule | 60 seconds | same as provider slots, including cancellation/reschedule/status change |
| Dashboard operational counts | 60 seconds | appointment, follow-up, invoice, inventory movement where relevant |
| Inventory summary | 60 seconds | movement, item/reorder configuration, location change |
| Platform aggregates | 5 minutes | organization lifecycle, feature-usage aggregation, feature-flag change |

Invalidation is event-driven and includes the organization and affected location/provider/date range. TTL is a safety backstop, not the only invalidation mechanism.

## 5. Consistency and booking safety

- Slot results are advisory. The Nest scheduling service revalidates and atomically reserves provider capacity at appointment commit time.
- A cache hit must never avoid database-backed scheduling validation, payment-balance calculation, or authorization.
- Mutations return the authoritative updated resource/version and publish a domain event for cache invalidation and UI refresh.
- Cache outage, serialization failure, or stale data must degrade to an uncached authorized API/database read or a clear retryable error. It must never produce a fake success.

## 6. Keying, security, and observability

- Every shared key begins with an environment and schema/version prefix, then organization and scope identifiers. Never key by client name, phone, email, or raw token.
- No cache entry may cross organization, location scope, or effective-permission boundary.
- Cache logs and metrics include operation, key namespace, result, age, correlation ID, and invalidation cause—but not clinical or financial payloads.
- Monitor hit rate, latency, memory, eviction, invalidation lag/failure, stale-read fallback, and cache error rate. Alert when scheduling invalidation or Redis availability is impaired.

## 7. Performance objectives

- Normal authorized API reads: p95 under 500 ms.
- Day/week schedule read models: p95 under 500 ms at the documented representative clinic volume.
- UI feedback to an interaction: under 100 ms; core route/module usable under 2.5 seconds on normal clinic broadband.
- Appointment commit correctness takes precedence over latency. Under contention, return a clear conflict response and refreshed alternatives.

## 8. Current deviations and release criteria

The dashboard, Client routes, and Schedule startup now use authenticated, purpose-specific `/api/v1` read models; production web code has no Prisma access. Schedule startup is bounded to scoped provider schedule references and services, visible calendar data is range-owned, identical in-flight planning reads remain deduplicated even when a React consumer aborts, and mutation invalidation is revision-safe. The process-local schedule cache now has TTL, LRU bounds, per-key single-flight, stale-load protection, and configuration invalidation. API processing time is exposed through `Server-Timing`/`x-response-time-ms` for evidence capture.

Remaining deviations are shipping gates: some secondary workspace routes still depend on the legacy operational aggregate; the day response retains one compatible rich/grid appointment duplication; browser planning Maps are LRU-bounded but do not yet have elapsed-time TTL; multi-instance cache invalidation/Redis is not implemented; and representative-volume p50/p95, payload, query-count, and query-plan evidence must be re-recorded after the Supabase connection identity is repaired.

Before release, the team must prove that read models are authenticated/scoped; direct Prisma and seed fallbacks are removed from production paths; Redis failure is safe; mutation invalidation works across API instances; and performance/load tests meet the objectives above.
