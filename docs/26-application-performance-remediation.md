# Application Performance Remediation

**Date:** 2026-09-06
**Status:** Code remediation and restored-database verification complete; authenticated browser timing awaits a normal test login
**Related baseline:** [25-application-load-performance-audit.md](./25-application-load-performance-audit.md)

## 1. Outcome

The 30-second experience is not primarily a Next.js bundle or static-asset problem. The production frontend shell is small and fast. The dominant path was a remote-database request queue compounded by repeated authentication, serial schedule reads, duplicate initial bootstrap requests, redundant session writes, and eager background prefetch.

This pass applies the highest-impact fixes that are safe within the current architecture:

1. raise the long-running Nest process from one Prisma connection to a bounded default of five;
2. reduce the workspace shell from two authenticated bootstrap requests to one;
3. deduplicate concurrent session validation for five seconds and invalidate it on security mutations;
4. write session activity at most once per configured interval instead of on every protected GET;
5. run independent schedule projections concurrently and remove an unused conflict query from the grid path;
6. cache schedule configuration before the remote query, with TTL, single-flight, LRU bounds, and mutation invalidation;
7. preserve frontend single-flight even when React effects carry an `AbortSignal`;
8. remove automatic adjacent-day data prefetch from initial Schedule load;
9. give browser API calls an eight-second deadline;
10. move password scrypt work off the Node.js event loop;
11. merge the Dashboard active-Client count into the organization projection so its initial reads fit one five-connection wave;
12. add a lightweight Schedule bootstrap for Reservations instead of loading every Provider availability/block relation;
13. remove the separate Provider authorization count and duplicate Provider display query from the Schedule grid while preserving tenant and missing-Provider checks.

Caching is used selectively. Private, rapidly changing clinic data remains `no-store` in the browser. Only server-derived planning data with explicit invalidation and very short session validation are cached.

## 2. Current stack

| Layer | Current implementation | Performance-relevant behavior |
| --- | --- | --- |
| Web | Next.js 15.5.15 App Router, React 19, TypeScript 5.8 | Route code splitting; workspace shell is a Client Component; same-origin `/api` proxy to Nest |
| UI | Tailwind CSS 4, Lucide React, date-fns, Nepali date library | No large image or third-party script payload on the measured login route |
| API | NestJS 11.1, Node.js, TypeScript | Long-running API process; global session guard; route-owned v1 read models |
| Data | PostgreSQL on Supabase, Prisma 6.19 | Remote shared pooler; application-side Prisma pool; high network RTT dominates small queries |
| Authentication | Opaque HttpOnly cookie sessions, database-backed revocation and CSRF | Session validity is checked at the API boundary; activity writes were previously issued per request |
| Caching | Session-local frontend maps and in-process schedule cache | Appropriate for one process; Redis remains a later multi-instance/distributed step |
| Testing | Node test runner, TypeScript typecheck, Next production build, Playwright CLI | Unit/integration-style suites are green; disposable PostgreSQL test is opt-in |

## 3. What commonly slows Next.js applications

The following are the recurring causes described in framework and database documentation and seen across comparable applications.

| Known cause | Typical symptom | Applicability here |
| --- | --- | --- |
| Measuring development mode as production | Slow first request while a route compiles | Present but minor. The earlier dev compile was seconds, not 30 seconds. Production browser timing is fast. |
| Excessive client JavaScript/hydration | Long main-thread work after assets arrive | Not the primary issue. Shared first-load JS is 102 KB and the heaviest route is 153 KB. |
| Serial request waterfalls | Blank/skeleton UI while shell data completes before route data starts | Present. Workspace auth/bootstrap gated route data. |
| Every request bypassing cache | Repeated backend/database work on navigation | Partly present. Sensitive API reads correctly use `no-store`, but safe planning/configuration reuse was incomplete. |
| Indiscriminate prefetch | Initial screen competes with data the user may never open | Present. Schedule fetched two adjacent days 250 ms after the current day. |
| Remote database RTT and too-small pools | Small queries take hundreds of milliseconds and concurrent requests queue | Primary cause. The prior audit measured about 700 ms for `SELECT 1` and multi-second concurrency queues. |
| N+1 or duplicate queries | Similar tables read multiple times for one page | Present in Schedule. Day/grid paths repeated appointment and configuration reads. |
| Synchronous CPU work in Node | Other requests pause during login/password work | Present. `scryptSync` blocked the event loop for roughly 300 ms. |
| Unbounded in-memory cache | Growing memory, stale data, unpredictable eviction | Present in the original schedule cache. |
| Bad environment/connection identity | API startup fails or waits before the UI can receive data | Was present during the first remediation pass; resolved before the restored-database verification below. |

Reference guidance:

- Next.js recommends production-mode measurement, layouts/partial rendering, route splitting, deliberate lazy loading, and careful caching in its [production checklist](https://nextjs.org/docs/app/guides/production-checklist).
- Next.js explains that prefetch is useful when it reflects likely navigation and documents disabling or moving it to user intent in its [prefetching guide](https://nextjs.org/docs/app/guides/prefetching).
- Next.js documents that `no-store` always goes back to the data source in the [extended fetch reference](https://nextjs.org/docs/app/api-reference/functions/fetch).
- Prisma recommends a calculated multi-connection pool for long-running processes, one global client, and pool tuning after measurement in its [database connection guide](https://www.prisma.io/docs/orm/v6/prisma-client/setup-and-configuration/databases-connections).
- Supabase recommends session mode for persistent IPv4 backends and transaction mode for transient/serverless clients in its [Postgres connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).

## 4. Repository evaluation

### 4.1 Ruled out as primary causes

#### Frontend bundle size

The production build remains compact:

- shared first-load JavaScript: **102 KB**;
- Login: **113 KB**;
- Dashboard: **127 KB**;
- Schedule: **151–153 KB**;
- no large runtime images, analytics bundles, tag managers, or blocking third-party scripts were found.

The measured production Login navigation completed in **189 ms**, with:

- response start/TTFB: **53 ms**;
- DOM interactive: **89 ms**;
- load complete: **189 ms**;
- resource requests: **13**;
- transferred resource bytes: approximately **139 KB**.

This proves that the Next server, HTML, JavaScript delivery, and hydration baseline do not explain a 30-second authenticated screen.

#### Database volume

The August audit found only one organization, seven users, eight clients, twelve appointments, two invoices, and one inventory item. Large-table scans cannot explain the observed latency at that volume.

#### Next.js compile time

Development compilation affects the first local visit, but prior route compilation was roughly one to two seconds. The current optimized build succeeds, and production navigation is sub-second.

### 4.2 Confirmed causes and changes

#### PERF-FIX-01 — Prisma concurrency

**Before:** the code default for Supabase transaction mode forced `connection_limit=1`. Independent requests and `Promise.all` work queued behind one connection unless a local/deployment URL explicitly overrode it. The current `.env.local` already contains an explicit value of five; this change makes the safe long-running-process default consistent across environments.

**After:** both supported Supabase pool modes default to a bounded pool of five connections for one persistent Nest process. `PRISMA_CONNECTION_LIMIT` can override this from 1–20. Explicit connection-string values remain authoritative.

This is deliberately not an unlimited pool. When API replicas are added, the value must be divided across instances so their combined maximum stays below the Supabase project pool.

Files:

- `apps/api/src/env-bootstrap.ts`
- `apps/api/src/env-bootstrap.spec.ts`
- `.env.example`

#### PERF-FIX-02 — One workspace bootstrap request

**Before:** initial workspace navigation sent `/auth/me` and `/v1/workspace/bootstrap`. Each passed through the database-backed session guard.

**After:** the bounded workspace response contains the already guard-authenticated user projection. The frontend sends one `/v1/workspace/bootstrap` request and derives both the user and shell data from it.

The change is additive to the v1 response and exposes no password hash, session token, CSRF hash, or other credential material.

Files:

- `apps/api/src/modules/api-v1/workspace-bootstrap.service.ts`
- `apps/web/lib/workspace-bootstrap.ts`
- `apps/web/lib/workspace-session-loader.ts`

#### PERF-FIX-03 — Session validation reuse

**Before:** every protected API request queried `UserSession`, even when several page requests arrived together with the same cookie.

**After:** concurrent checks share one pending lookup, and a validated result is reused for at most five seconds. The cache is LRU-bounded to 500 entries. Expiry, idle timeout, revocation, and user status are still re-evaluated on every cache read.

Fresh database validation is still mandatory for:

- CSRF token checks and rotation;
- logout and session rotation;
- explicit security revocation.

Logout/rotation evict the token immediately; user-wide revocation evicts all cached sessions for that user. In a future multi-instance deployment, this five-second cache should move to Redis/pub-sub invalidation or be disabled when immediate cross-instance revocation is required.

File: `apps/api/src/modules/auth/auth.service.ts`

#### PERF-FIX-04 — Session activity write throttling

**Before:** every successful protected request scheduled a `lastSeenAt` update. The fire-and-forget write still occupied the only Prisma connection.

**After:** recent sessions issue no activity write. A stale session writes at most once per five-minute default interval, never longer than one-third of the configured idle timeout. Concurrent stale requests share one pending write, and the update has a database staleness condition.

Configuration: `SESSION_TOUCH_INTERVAL_SECONDS`, default `300`.

#### PERF-FIX-05 — Schedule query concurrency and query removal

**Before:** schedule configuration, provider context, provider projection, and appointment projection ran in serial phases. Provider context also queried appointment conflicts even though the grid renderer did not consume them.

**After:** the grid overlaps independent provider-context, provider-projection, and appointment reads. Non-transactional provider-context projections execute concurrently through the bounded pool. Grid construction opts out of the unused conflict query. Authoritative booking commands retain their transactional conflict validation.

File: `apps/api/src/modules/scheduling/scheduling.service.ts`

The day endpoint still returns both the rich appointment list and grid contract for compatibility. A future read-model consolidation can remove the remaining rich/grid appointment duplication, but it is no longer serialized behind a one-connection pool.

#### PERF-FIX-06 — Bounded schedule cache

**Before:** cache entries had no TTL, size bound, or single-flight loader. A warm grid still queried remote schedule configuration before finding its cache key.

**After:** the schedule cache provides:

- 30-second default TTL;
- 500-entry LRU bound;
- per-key single-flight loading;
- stale-load protection when invalidation races an active load;
- a 60-second schedule-configuration entry;
- explicit configuration eviction when clinic schedule settings change.

Warm grid hits now avoid the configuration database query entirely. Appointment, provider, and settings mutations retain targeted invalidation.

Files:

- `apps/api/src/modules/scheduling/schedule-cache.service.ts`
- `apps/api/src/modules/scheduling/schedule-cache.service.spec.ts`
- `apps/api/src/modules/scheduling/scheduling.service.ts`

#### PERF-FIX-07 — Frontend request single-flight with cancellation

**Before:** several planning loaders disabled request deduplication whenever a React effect supplied an `AbortSignal`. React Strict Mode cleanup/re-run could therefore send the same request twice.

**After:** the underlying request is shared and allowed to populate the bounded cache. Each consumer can independently stop waiting without cancelling the request for other consumers.

Applied to:

- appointment ranges;
- day summaries;
- week summaries;
- schedule-day snapshots.

File: `apps/web/components/workspace/app-state.tsx`

#### PERF-FIX-08 — Remove initial adjacent-day prefetch

**Before:** loading the current day automatically fetched the previous and next day after 250 ms. On a constrained pool, this competed with the visible page.

**After:** only the selected day is requested. Existing cache reuse still makes revisited days fast. If adjacent prefetch is restored, it should be triggered by explicit hover/touch intent or a verified idle period and connection-quality policy.

File: `apps/web/components/workspace/reservations-page.tsx`

#### PERF-FIX-09 — API latency budget

All browser API requests, including the CSRF bootstrap, now have an eight-second deadline. A timeout becomes a typed `ApiRequestError` with reason `REQUEST_TIMEOUT`. This prevents indefinite skeletons; it does not classify a failed response as a successful performance improvement.

Files:

- `apps/web/lib/api-client.ts`
- `apps/web/lib/api-client.test.ts`

#### PERF-FIX-10 — Non-blocking password hashing

`scryptSync` was replaced with the asynchronous Node.js `scrypt` API. Password derivation retains the same N/r/p parameters and encoded format, but no longer blocks unrelated health, page, or API requests on the event loop during login, account creation, or password reset.

Files:

- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/staff/staff.service.ts`
- affected authentication/integration tests

#### PERF-FIX-11 — Dashboard stays within one pool wave

**Before:** Dashboard launched six independent Prisma operations through a pool configured for five connections. Even though the code used `Promise.all`, one operation necessarily waited for a second connection wave. The restored-database probe measured **2.549 seconds** for this service projection.

**After:** the active-Client count is selected through the organization relation count. The same response contract now uses five top-level operations and measured **1.782-1.843 seconds** in follow-up samples. The database remains remote, so the result still exceeds the final API target, but the avoidable second wave was removed.

Files:

- `apps/api/src/modules/api-v1/dashboard-bootstrap.service.ts`
- `apps/api/src/modules/api-v1/dashboard-bootstrap.service.spec.ts`

#### PERF-FIX-12 — Reservations uses a summary Schedule bootstrap

**Before:** both Reservations and My Schedule called the same full bootstrap. Prisma eagerly loaded Provider availability, recurring blocks, blocked times, and Provider services before Reservations could render, although Reservations uses live server-computed grid data and only needs Provider display/filter metadata initially. The full read measured **2.589-2.887 seconds** and returned 4,531 bytes on the restored data.

**After:** `/v1/schedule/bootstrap?detail=summary` selects active Provider display metadata, location-scoped Provider service IDs needed by edit/reschedule, and the service reference list. Availability and block collections remain empty. The three independent reads share one pool wave. Reservations requests this projection; `/my-schedule` deliberately keeps `detail=full` because its editor needs the full schedule relations. In the final same-process comparison, summary measured **1.463 seconds / 1,459 bytes** versus **3.755 seconds / 4,531 bytes** for full, a 61% service-time reduction and 68% payload reduction in that sample.

Files:

- `apps/api/src/modules/api-v1/schedule-bootstrap.service.ts`
- `apps/api/src/modules/api-v1/schedule-bootstrap.service.spec.ts`
- `apps/api/src/modules/api-v1/schedule-v1.controller.ts`
- `apps/web/components/workspace/workspace-root.tsx`

#### PERF-FIX-13 — Schedule grid reuses the authoritative Provider projection

**Before:** a requested grid first counted Provider IDs for authorization, then the scheduling service queried those Providers again for status and again for display fields. The authorization count was a serial remote round trip before grid work started.

**After:** authorization still validates the actor, organization, and optional location synchronously, but existence is checked from the tenant-scoped Provider rows already required by the scheduling calculation. Those same rows now carry display name, color, and specialty, removing another duplicate Provider query. A missing requested Provider still raises `404`; booking commands retain their authoritative transaction checks.

The final cold direct grid sample was **2.657 seconds** and the immediate cache hit was below the timer's 1 ms reporting precision. The remaining cold duration is primarily one configuration RTT followed by a wave of schedule-table reads; the warm result confirms that cache lookup and in-process grid rendering are not slow.

## 5. Cache policy

### Safe to cache now

| Data | Location | Lifetime | Invalidation |
| --- | --- | --- | --- |
| Validated session projection | Nest process | 5 seconds | logout, rotate, revoke-user, TTL |
| Schedule configuration | Nest process | 60 seconds | clinic schedule settings mutation, TTL |
| Schedule grids/slots/summaries | Nest process | 30 seconds | appointment/provider/settings mutations, TTL |
| Workspace bootstrap | Browser memory | active signed-in browser session | logout, session expiry, settings change |
| Planning requests/results | Browser memory, max 32 per map | active workspace mount | planning mutation, logout, mount lifecycle |

### Intentionally not cached persistently

- Client, finance, staff, settings, archive, and inventory HTTP responses remain private and `no-store`.
- Next.js shared Data Cache is not used for user-specific clinic API responses.
- Browser disk cache/service-worker storage is not used for clinical payloads.
- Failed or timed-out responses are not cached.
- Mutation commands and idempotency receipts are never treated as reusable GET data.

### When Redis will help

Redis becomes useful when more than one Nest instance serves the same organization. It can provide shared schedule entries, distributed invalidation, session revocation messages, rate limits, and cache observability. Adding Redis before fixing connection topology and query waterfalls would merely hide the first request and leave cache misses slow.

## 6. Verification evidence

### Automated gates

| Gate | Result |
| --- | --- |
| `npm run typecheck` | Passed for web and API |
| `npm test` plus the final targeted cache regression | Passed: 282 tests; 1 disposable-PostgreSQL integration test skipped by design |
| `npm run build` | Passed with Next.js 15.5.15 |
| Authentication additions | Session lookup single-flight, activity-write throttle, async hashing tests passed |
| Schedule cache additions | TTL, single-flight, and invalidation-race tests passed |
| Production browser | Login navigation complete in 189 ms; TTFB 53 ms; 13 resources; ~139 KB transferred |

### Restored-database verification

The connection is restored. The API is using the Supabase transaction pooler on port 6543 with `connection_limit=5`. The final read-only probe produced:

| Operation | Restored result | Interpretation |
| --- | ---: | --- |
| Prisma connect | 1.762 s | Remote connection setup is material. |
| Five sequential `SELECT 1` | 0.927-1.171 s; 1.049 s average | One database round trip already exceeds the desired protected-API budget. |
| 25 concurrent `SELECT 1` | 6.332 s total; 6.331 s maximum; 4.174 s average | A five-connection pool creates approximately five waves under this burst. |
| Workspace bootstrap | 1.012 s; 806 B | Two independent reads overlap successfully; the remaining time is roughly one remote wave. |
| Dashboard bootstrap | 1.843 s; 1,812 B | Improved query shape, still limited by remote/pool variability. |
| Full Schedule bootstrap | 2.589-3.755 s; 4,531 B | Retained for the schedule editor only. |
| Reservations Schedule summary | 1.463 s steady-process; 1,459 B | Lightweight startup projection with ten Provider-service IDs. A new process measured 3.510 s while opening pool connections. |
| Client directory | 1.855 s; 3,351 B | One bounded query; sample variation tracks database RTT, not payload size. |
| Schedule grid, cold | 2.657 s; 2 Providers / 80 slots | Configuration plus one remote read wave. |
| Schedule grid, immediate warm hit | <1 ms | Cache removes the remote path as designed. |

For all four serialized read-model payloads, `JSON.stringify` and simulated browser `JSON.parse` each measured only **0.01-0.04 ms**. This directly rules out API JSON generation and frontend JSON parsing as the multi-second delay. React rendering was not profiled under an authenticated session because no normal test credential was available; privileged session fabrication was explicitly rejected and not bypassed.

The residual root cause is infrastructure distance/quality: the current API machine pays about one second per database round trip. Query reduction and short-lived safe caching make the application substantially less sensitive to that cost, but an uncached read cannot meet a 500 ms p95 while its simplest database operation takes about twice that long.

## 7. Residual production performance gate

With a normal non-production test login and the API deployed in its intended region:

1. start one Nest instance and the optimized Next build;
2. confirm readiness and one signed-in workspace bootstrap;
3. record `Server-Timing`, TTFB, and total duration for Dashboard and Schedule;
4. load Schedule day view cold, then revisit it warm;
5. run 10 and 25 concurrent readiness/session checks;
6. verify the browser sends one workspace bootstrap and one selected-day request, with no automatic adjacent days;
7. confirm a recent session produces no `lastSeenAt` write;
8. confirm no P2024 pool timeout under the representative concurrency test;
9. compare API-to-database RTT from the deployed API region with the current 1.05-second local-machine result.

Acceptance targets remain:

| Metric | Target |
| --- | --- |
| Database `SELECT 1` p95 from the deployed API region | under 100 ms |
| Normal protected API read p95 | under 500 ms |
| Cold Schedule day response p95 | under 1 second initially; drive toward 500 ms |
| Warm in-process Schedule grid | under 50 ms and no configuration query |
| Warm route transition | under 1 second |
| Useful signed-in route content | under 2.5 seconds |
| Pool wait p95 | under 100 ms, maximum under 250 ms |
| Browser failure budget | typed failure by 8 seconds |

The current machine does not meet the first three cold targets because `SELECT 1` itself averages about 1.05 seconds. Co-locate the persistent API with the database, or choose a database region near the deployed API and clinic users. Application caching cannot remove the first uncached cross-region round trip.

## 8. Delivery-plan alignment

This remediation completes the code portion of the existing R1 performance lane:

- **R1-P0:** instrumentation and current baseline — restored-database service timing complete; signed-in browser trace awaits a normal test credential;
- **R1-P1:** pool configuration — implemented; infrastructure co-location remains deployment work;
- **R1-P2:** shell/session waterfall — implemented for initial workspace bootstrap and session writes;
- **R1-P3:** Schedule read reduction — parallelized, deduplicated, summary-projected, and cached; final single-query day projection remains an optional follow-up;
- **R1-P4:** frontend orchestration — dedupe, timeout, and prefetch changes implemented;
- **R1-P6:** login event-loop hardening — implemented;
- **UP-14:** Redis — intentionally deferred until multi-instance deployment or measured shared-cache need.

## 9. Files changed by this performance pass

- `.env.example`
- `apps/api/package.json`
- `apps/api/src/env-bootstrap.ts`
- `apps/api/src/env-bootstrap.spec.ts`
- `apps/api/src/integration/phase-one-http.integration.spec.ts`
- `apps/api/src/modules/api-v1/workspace-bootstrap.service.ts`
- `apps/api/src/modules/api-v1/workspace-bootstrap.service.spec.ts`
- `apps/api/src/modules/api-v1/dashboard-bootstrap.service.ts`
- `apps/api/src/modules/api-v1/dashboard-bootstrap.service.spec.ts`
- `apps/api/src/modules/api-v1/schedule-bootstrap.service.ts`
- `apps/api/src/modules/api-v1/schedule-bootstrap.service.spec.ts`
- `apps/api/src/modules/api-v1/schedule-v1.controller.ts`
- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/auth/server-sessions.spec.ts`
- `apps/api/src/modules/scheduling/schedule-cache.service.ts`
- `apps/api/src/modules/scheduling/schedule-cache.service.spec.ts`
- `apps/api/src/modules/scheduling/scheduling.service.ts`
- `apps/api/src/modules/staff/staff.service.ts`
- `apps/web/components/workspace/app-state.tsx`
- `apps/web/components/workspace/reservations-page.tsx`
- `apps/web/components/workspace/workspace-root.tsx`
- `apps/web/lib/api-client.ts`
- `apps/web/lib/api-client.test.ts`
- `apps/web/lib/quick-book.test.ts`
- `apps/web/lib/schedule-bootstrap.test.ts`
- `apps/web/lib/workspace-bootstrap.ts`
- `apps/web/lib/workspace-bootstrap.test.ts`
- `apps/web/lib/workspace-session-loader.ts`

No database schema or migration was changed by this pass.
