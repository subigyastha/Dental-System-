# Application Load Performance Audit

> Implementation follow-up: see [26-application-performance-remediation.md](./26-application-performance-remediation.md) for the fixes applied on 2026-09-06, restored-database measurements, validation evidence, and cache policy. The stale Supabase identity described in the original baseline has been resolved.

| Field | Value |
| --- | --- |
| Product | ClinicFlow / Koi Workflow System |
| Audit date | 2026-08-23 |
| Status | Original baseline retained for traceability; remediation and restored-database verification are complete in document 26 |
| Reported symptom | Signed-in pages can take more than 30 seconds to become usable, including on a locally running web/API stack |
| Primary delivery lane | Complete the open **R1 Performance baseline and request-waterfall reduction** gate in `20-tangible-phase-delivery-plan.md`; this is part of P2R / UP-08, before later UP-14 Redis work |
| Authority | Measurements from the current repository and configured development database; current uncommitted product work was preserved |

## 1. Executive conclusion

**2026-09-06 update:** the database connection was restored and the diagnosis was re-run. A trivial query now averages about **1.05 seconds**, 25 concurrent queries take **6.33 seconds**, and JSON serialization/parsing takes only **0.01-0.04 ms** for the measured read models. The original conclusion therefore still holds: remote database RTT and query-wave queuing dominate; frontend processing is not the cause. Current post-fix details are in document 26.

The 30-second experience is not caused by one large React component, static asset, or Next.js compilation step. It is a queue-amplification problem across the initial request waterfall.

The configured “local” stack is local only for Next.js and NestJS. Every authenticated request still reaches a Supabase PostgreSQL pooler in the Tokyo region. A trivial live database readiness query currently takes about **0.70-0.86 seconds**. The API normalizes the transaction-pooler URL to **one Prisma connection per Nest process**. Several page loads issue multiple authenticated HTTP requests, and each request performs session validation plus domain queries. The Schedule path has the deepest cold query chain. Concurrent work therefore waits behind a one-connection queue.

The strongest direct evidence is:

- A public `SELECT 1` readiness request takes 0.70-0.86 seconds even though Nest is on localhost.
- Twenty-five concurrent readiness requests take 5.45 seconds in total; individual requests wait as long as 5.38 seconds.
- A cold Schedule grid service call takes **5.21 seconds** for only two active Providers and 80 rendered slots.
- The same Schedule grid call on an in-process cache hit still takes **0.72 seconds**, because schedule configuration is queried before the cache key can be checked.
- Current live volume is only 1 organization, 7 users, 8 Clients, 12 appointments, 2 invoices, and 1 Inventory item. Dataset size is not the current explanation.
- Historical API logs contain Prisma `P2024` pool-acquisition timeouts at the full 10-second limit and multiple port-4000 process collisions. Those older failures demonstrate how two or three queue/timeout stages can become a 20-30+ second page load, although the current API now applies safer pooler normalization.
- Cold Next.js route compilation is about 1-3 seconds, and production first-load JavaScript is 113-153 kB for the measured routes. These are optimization opportunities, but they do not explain a persistent 30-second wait.

The immediate fix is not “add Redis.” The release-blocking work is to reduce database distance and round trips, collapse the session/workspace waterfall, remove Schedule's serial query chain, and stop writing `lastSeenAt` on every authenticated read. Redis remains a later UP-14 shared-cache layer after the uncached path meets its target.

## 2. Scope and method

### 2.1 Source coverage

The audit performed a source-wide static scan and then a deeper control-flow review of every startup-critical frontend, API, authentication, scheduling, data-access, cache, configuration, and route entry path.

| Scope | Files | Lines |
| --- | ---: | ---: |
| Runtime web source | 112 | 23,482 |
| Runtime API source | 140 | 19,547 |
| Prisma schema, seed, and runtime scripts | 8 | 2,311 |
| **Runtime total** | **260** | **45,340** |
| Automated test source | 66 | 8,560 |
| **All TypeScript/JavaScript/Prisma source scanned** | **326** | **53,900** |

Static pattern review included 98 API-client references, 67 React effects, 503 Prisma operation references, 32 runtime `Promise.all` sites, all route entrypoints, all Prisma indexes/migrations, and the largest runtime files. Large files were treated as navigation and maintainability risks, but findings were ranked by measured effect rather than line count.

### 2.2 Runtime checks

The following read-only checks were performed:

1. Started the current Nest and Next development servers independently.
2. Timed cold `/login` and `/dashboard` compilation through a real Chromium session.
3. Built the production web application and recorded per-route first-load JavaScript.
4. Timed live API readiness and invalid-session requests through localhost.
5. Sent 25 concurrent readiness and invalid-session requests to expose queue behavior.
6. Ran read-only service-level timing against the configured database using a database-derived Owner context; no user, credential, session, or domain row was changed.
7. Measured cold and warm Schedule-grid execution against the actual Scheduling service and cache.
8. Read the existing delivery plan, performance/caching specification, database review, environment guide, source logs, and migration/index history.

### 2.3 Limits

- No reusable test password exists in the repository environment. The audit did not reset a credential or manufacture an authenticated session, because that would be an out-of-scope data mutation. Full signed-in browser-waterfall capture remains the first implementation task.
- The service timings exclude the global HTTP session guard unless stated otherwise. A normal protected endpoint must add the measured session-validation cost and may also enqueue an asynchronous session-touch write.
- The live dataset is intentionally tiny. These measurements diagnose network/round-trip and queue cost; they are not representative-volume p50/p95 release evidence.
- Historical `nest-api` log findings are supporting evidence from 2026-05-11, not proof that the exact older process/pool state is active today.

## 3. Measured baseline

### 3.1 Local process and web build

| Check | Result | Interpretation |
| --- | ---: | --- |
| Nest startup with reachable database | ~1.1 s | API framework startup is healthy. |
| Next development server ready | ~2.6 s | Framework startup is not the 30-second cause. |
| Cold `/login` | 3.21 s response; 1.84 s compile; 581 modules | Noticeable only on first dev access. |
| Cold `/dashboard` without a session | 1.91 s response; 1.15 s compile; 802 modules | Cold compilation is well below the reported delay. |
| Production web compile | 4.0 s | Build succeeds and compilation is not pathological. |
| Production shared first-load JS | 102 kB | Normal for this application shape. |
| Production route first-load JS | 113-153 kB | Not large enough to explain 30 seconds on localhost. |
| Largest served image asset | 38.1 kB SVG | Asset transfer is not material. |

The largest production route first-load totals are `/my-schedule` at 153 kB, `/reservations` at 151 kB, `/billing` at 137 kB, `/staff` at 134 kB, and `/clients` at 133 kB. Code splitting is working. Large source files such as the 2,254-line Reservations component and 1,608-line booking modal increase development and maintenance cost, but the built route sizes rule them out as the primary delay.

### 3.2 Database and API latency

| Check | Result |
| --- | ---: |
| Five sequential `/api/health/ready` requests | 0.862, 0.703, 0.702, 0.697, 0.711 s |
| Three invalid-session `/api/auth/me` requests | 0.755, 0.714, 0.719 s |
| 25 concurrent readiness requests | 5.445 s total; 0.913 s min; 5.383 s max; 3.566 s average |
| 25 concurrent invalid-session requests | 3.642 s total; 0.725 s min; 3.640 s max; 2.162 s average |
| One current readiness `Server-Timing` sample | 846.0 ms inside Nest |
| One current invalid-session `Server-Timing` sample | 713.4 ms inside Nest |

The readiness endpoint performs only `SELECT 1`. Therefore most of the 0.7+ second cost is connection/pool/network path, not application business logic or table size. The concurrent maximums show queue time accumulating before even trivial queries.

### 3.3 Read-model service timing

These timings use the same current Prisma URL normalization as the API and a read-only Owner context. They exclude the separate global guard query and HTTP serialization.

| Service operation | Time | JSON size | Notes |
| --- | ---: | ---: | --- |
| Workspace bootstrap | 1.716 s | 593 B | Organization and locations are parallel in source but share the constrained database path. |
| Dashboard bootstrap | 2.246 s | 2,189 B | Six data operations run in one `Promise.all`. |
| Schedule bootstrap | 1.842 s | 4,531 B | Provider/service references only; payload size is not the issue. |
| Schedule grid, cold | **5.209 s** | 80 slots | Dominant cold read path. |
| Schedule grid, in-process cache hit | **0.723 s** | 80 slots | Cache hit still pays for schedule configuration. |
| Client directory | 0.994 s | 3,351 B | Bounded at 25 rows in this call. |
| Client detail | 3.242 s | 1,467 B | Client read followed by four timeline reads. |
| Finance workspace | 1.559 s | 1,443 B | Current data is tiny; nested history can grow. |
| Inventory workspace + movement history, as UI launches them | 3.108 s | 4,374 B | Two protected HTTP calls in production add two guard validations. |
| Staff directory | 1.277 s | 2,530 B | Four summary/list operations. |
| Settings | 0.972 s | 467 B | One small organization/settings read. |
| Archive | 0.699 s | 2 B | Empty result; baseline is almost entirely database path. |

A protected HTTP request generally adds about 0.7 seconds for session lookup before these service figures. The guard then calls `touchSession`, which starts a database update without awaiting it. That write can occupy the only Prisma connection while subsequent page reads are starting.

## 4. Initial-load control flow

### 4.1 All ordinary workspace routes

The client layout gates every workspace screen behind `WorkspaceRoot`:

1. Browser downloads and hydrates the workspace client bundle.
2. `loadWorkspaceSession()` launches `/api/auth/me` and `/api/v1/workspace/bootstrap` in parallel.
3. Each protected request independently validates the same cookie in PostgreSQL.
4. Each successful validation schedules a `UserSession.lastSeenAt` update.
5. The route component is not mounted until the shell bootstrap resolves.
6. Only then does the route component's effect launch Dashboard, Clients, Finance, Staff, Settings, Inventory, or Archive data.

This creates a mandatory shell-then-route waterfall. The in-memory workspace loader prevents repeated shell bootstrap on client navigation within the same tab, which is good, but first load and hard refresh still pay the entire sequence.

Relevant source:

- `apps/web/lib/workspace-session-loader.ts:45-51`
- `apps/web/components/workspace/workspace-root.tsx:50-94`
- `apps/api/src/modules/auth/session-auth.guard.ts:38-54`
- `apps/api/src/modules/auth/auth.service.ts:158-160` and `356-360`

### 4.2 Dashboard

After the shell resolves, Dashboard requests `/v1/dashboard/bootstrap`. The service launches organization, three counts, upcoming appointments, and follow-ups in parallel. The query shapes are bounded and indexed. The issue is that another authenticated request and another database round-trip phase are placed after the shell phase.

Relevant source: `apps/web/components/workspace/dashboard-page.tsx:136-154` and `apps/api/src/modules/api-v1/dashboard-bootstrap.service.ts:46-78`.

### 4.3 Schedule / Reservations

Schedule has the largest waterfall:

1. Before shell session resolution, `WorkspaceRoot` also starts `/v1/schedule/bootstrap`.
2. The browser waits for session/workspace and schedule bootstrap before mounting the real page.
3. Day view immediately requests `/v1/schedule/day`.
4. The day controller runs appointment listing and provider-grid generation in parallel.
5. Provider-grid authorization counts Providers.
6. Grid generation reads schedule configuration.
7. On a cold cache, schedule context executes five reads in a Prisma batch transaction.
8. Provider display rows and appointments are then read in separate sequential phases.
9. After the visible day succeeds, the UI waits 250 ms and prefetches both adjacent days.

The code comment says the grid is kept serial to protect a one-connection Supabase transaction pool. That prevents `P2024`, but it does so by making latency proportional to remote round trips.

Relevant source:

- `apps/web/components/workspace/workspace-root.tsx:50-83`
- `apps/web/components/workspace/reservations-page.tsx:388-437`
- `apps/web/components/workspace/app-state.tsx:1188-1227`
- `apps/api/src/modules/api-v1/schedule-v1.controller.ts:64-93`
- `apps/api/src/modules/providers/providers.service.ts:280-300`
- `apps/api/src/modules/scheduling/scheduling.service.ts:767-845`
- `apps/api/src/modules/scheduling/scheduling.service.ts:1204-1320`

The browser planning cache is bounded to 32 entries. However, visible reads that carry an `AbortSignal` are deliberately excluded from the in-flight request maps (`app-state.tsx:1199` and `1226`). In development Strict Mode, an effect cleanup can abort the first browser request and launch the same second request. Browser abort does not guarantee that the already-started PostgreSQL work is cancelled. This needs confirmation in the signed-in network trace, but it is a credible development-only load multiplier.

### 4.4 Client detail

Client detail performs one Client query and then a second phase containing four parallel history queries. With a nearby database this is reasonable. Across the current high-latency one-connection path it measured 3.24 seconds before guard overhead.

Relevant source: `apps/api/src/modules/api-v1/clients-v1.service.ts:115-160`.

### 4.5 Inventory

The page launches workspace and movement-history HTTP requests concurrently. The workspace endpoint launches locations, up to 250 Items with balances/lots, up to 250 suppliers, and a movement count. The second endpoint loads 150 movements. It is bounded, but it duplicates session validation and competes for the same connection.

Relevant source: `apps/web/components/workspace/inventory/inventory-workspace.tsx:78-116` and `apps/api/src/modules/api-v1/inventory.service.ts:110-193`, `282-301`.

## 5. Ranked findings

### PERF-01 — Remote database latency dominates every local request

**Severity:** Critical / confirmed  
**Confidence:** High

`DATABASE_URL` targets the Supabase transaction pooler in the Tokyo region. Next and Nest are local, but data is not. The measured `SELECT 1` cost of roughly 700-850 ms is already above the project's p95 target of 500 ms before any business query chain begins.

This explains why caching seems attractive but cannot be the first correction: authentication, cache-version lookup, misses, and uncached sensitive data all still cross the same path.

### PERF-02 — One Prisma connection converts parallel page work into queued work

**Severity:** Critical / confirmed  
**Confidence:** High

`apps/api/src/env-bootstrap.ts:96-105` adds `pgbouncer=true&connection_limit=1` for the Supabase 6543 transaction pool. This avoids prepared-statement and pool-exhaustion failures, but it serializes the application's database work. The 25-request benchmarks directly show queue growth.

The setting is defensible as a safety fallback for this pool mode. It is not a topology that can meet the current `<500 ms` API target while each database operation costs ~700 ms.

### PERF-03 — Schedule cold path contains too many serial database phases

**Severity:** Critical / confirmed  
**Confidence:** High

Cold Schedule grid time is 5.21 seconds before HTTP guard/access-controller overhead. The path reads configuration, context, Providers, and appointments in sequential phases. Context itself contains five reads. The `/v1/schedule/day` controller separately loads appointments while grid generation loads appointments again for slot state, so overlapping appointment data is queried twice.

This is the largest code-level contributor and the first endpoint to redesign.

### PERF-04 — Cache hits still require a remote configuration query

**Severity:** High / confirmed  
**Confidence:** High

`listScheduleGridForDay()` calls `getScheduleConfiguration()` before it can construct the versioned cache key. The measured warm call is therefore 723 ms instead of an in-memory response. Similar key construction should be reviewed for slot reads.

The current `ScheduleCacheService` is also an unbounded process-local `Map` with no TTL, age metadata, hit/miss metrics, or cross-instance invalidation. That is a correctness/operations risk but not the current cold-load root cause.

### PERF-05 — Session validation and session-touch writes are multiplied per page

**Severity:** High / confirmed by source and guard timing  
**Confidence:** High

Every protected HTTP call reads `UserSession` and its User relation. `requireSessionToken()` then fires an unawaited `lastSeenAt` update. An initial Dashboard uses auth/me, workspace, and Dashboard requests; Schedule adds bootstrap/day/prefetch requests. Thus a read-only page creates multiple session reads and multiple database writes.

The write is off the direct await chain, but not off the pool. With one Prisma connection it competes with the very reads needed to render the screen.

### PERF-06 — Shell gating creates an avoidable network waterfall

**Severity:** High / confirmed by source  
**Confidence:** High

Most route-owned data cannot begin until `WorkspaceRoot` has completed auth and workspace bootstrap and mounted the child. The correct move away from the legacy `/operational-data` aggregate has reduced payload/privacy risk, but the new reads still need orchestration so route data and shell data do not become serial phases.

### PERF-07 — Adjacent Schedule prefetch is too aggressive for a constrained connection

**Severity:** High / confirmed by source; signed-in waterfall pending  
**Confidence:** Medium-high

Two heavy day snapshots start 250 ms after the visible day succeeds. On a healthy multi-connection/local database this is useful. On the current single connection, the prefetch can delay the next user action, route-owned request, or quick-book request. It also warms only the current API process's cache.

### PERF-08 — Browser requests have no shared latency budget

**Severity:** Medium-high / confirmed by source  
**Confidence:** High

`apiFetch` passes the caller signal but defines no default timeout. A database/pool stall can leave the skeleton visible until the database, proxy, or browser eventually fails. The UI needs a bounded “still working” state and a typed timeout, but timeouts must accompany root-cause reduction rather than hiding it.

### PERF-09 — Current data shapes are mostly bounded, with four growth risks

**Severity:** Medium / not the current tiny-data cause  
**Confidence:** High

Positive findings:

- Client directory is cursor-bounded.
- Dashboard lists are bounded.
- Schedule ranges are date-scoped.
- Staff is paginated.
- Inventory has explicit top-level limits.

Growth risks:

1. Finance workspace takes 100 invoices but includes all Payments and Corrections for each invoice; child histories are not bounded or aggregated.
2. Archive returns all archived Clients with no pagination.
3. Inventory workspace allows 250 Items and expands balances and every positive lot, then separately returns 150 movements.
4. Staff allows page 10,000 with offset pagination and repeated relational filters/counts; deep pages will degrade.

### PERF-10 — Synchronous password hashing blocks the Nest event loop during login

**Severity:** Medium / confirmed  
**Confidence:** High

The current `scryptSync` parameters block the event loop for about 310 ms on this machine, in addition to login database reads/writes. This is not a 30-second page-navigation cause, but concurrent logins can pause unrelated API work. Move verification/hashing off the main event loop or use an asynchronous implementation while retaining the approved cost parameters.

### PERF-11 — Development process hygiene can recreate old 10-second stalls

**Severity:** Medium-high / historical evidence  
**Confidence:** Medium

The checked-in logs show:

- Prisma `P2024` after waiting 10 seconds for a connection from a 13-connection client pool.
- Multiple Nest watch processes restarting and colliding on port 4000 (`EADDRINUSE`).

Current startup deliberately fails instead of moving to another port, which is good. The local runbook still needs one supported command that starts exactly one API and one web process, checks readiness, and reports stale listeners before developers diagnose a UI that is proxying to the wrong/stale process.

### PERF-12 — Direct Prisma tools can bypass runtime URL normalization

**Severity:** Medium / confirmed in diagnostic  
**Confidence:** High

The Nest entrypoint calls `loadMonorepoEnv()`, which adds pooler-compatible parameters. A raw PrismaClient script that only loads `.env` does not. The audit reproduced PostgreSQL `26000: prepared statement ... does not exist` in that bypass path. Runtime scripts must import the shared environment bootstrap or receive an already-normalized URL. Migration commands should continue to use `DIRECT_URL` and the documented session/direct endpoint.

### PERF-13 — In-process maps need lifecycle bounds

**Severity:** Low-medium / source risk  
**Confidence:** High

`ScheduleCacheService` has no TTL or maximum size, and the in-memory HTTP rate-limit map does not prune expired keys. Neither explains current latency, but both can grow for the lifetime of a production process. This belongs in hardening after the critical path is fixed.

## 6. What is not causing the 30-second load

| Suspect | Finding |
| --- | --- |
| Next.js framework startup | 2.6 seconds locally; not persistent. |
| Cold route compilation | 1.15-1.84 seconds in observed routes; development-only. |
| JavaScript bundle | 113-153 kB first load on application routes; code splitting is effective. |
| Images/fonts | Only small local SVG marks are loaded; no remote font waterfall exists. |
| Current row count | Far too small to explain seconds of database execution. |
| Missing basic indexes | Hot tenant/date/status paths are generally indexed, including the refinements in migrations 000021-000023. Representative-volume plans are still required. |
| Legacy `/operational-data` bootstrap | No current frontend caller was found; route-owned v1 reads are in place. The legacy API should still be retired after compatibility confirmation. |

## 7. Remediation plan aligned to the delivery schedule

### Scheduling decision

Treat this as the completion package for the already-open **R1 Performance baseline and request-waterfall reduction** item. It is not a new feature lane and should block R1 closure, authenticated responsive certification, and staging certification. It belongs under P2R / UP-08 because it corrects read-model delivery. Do not wait for UP-14 Redis, and do not pull all Redis/worker work forward.

The work can be delivered as six small, reviewable slices. Estimated effort is **7-11 engineering days plus representative-volume/staging observation**, assuming no database-region migration is required. If the API/database must be re-homed, infrastructure lead time is additional.

### R1-P0 — Capture the signed-in baseline and expose queue time

**Estimate:** 0.5-1 day  
**Dependency:** none  
**Release role:** must land first

1. Create a non-production performance account through the normal provisioning process.
2. Capture browser traces for login, Dashboard, Clients, Client detail, Finance, Inventory, Staff, Settings, Day/Week/Month Schedule, and booking confirmation.
3. Record navigation start, first shell, first useful route content, request count, request start/end, payload bytes, `Server-Timing`, and error/timeout state.
4. Add per-request database query count and cumulative query duration without logging SQL values or sensitive payloads.
5. Add pool wait/acquisition metrics if supported by the selected Prisma/driver path; otherwise correlate Prisma duration with PostgreSQL/Supavisor metrics.
6. Store a baseline table in `docs/artifacts/` and make regression comparison repeatable.

**Exit gate:** every target route has cold/warm p50/p95, request count, query count, payload size, and time-to-useful-content.

### R1-P1 — Correct environment topology before application caching

**Estimate:** 0.5-2 days for configuration; longer if region migration is required  
**Dependency:** R1-P0 baseline

1. For local development, support true local PostgreSQL as the default fast loop. Keep remote Supabase as an explicit integration profile.
2. For deployed environments, co-locate Nest/API compute and PostgreSQL in the same region.
3. Evaluate Supavisor Session Mode on port 5432 with a small bounded Prisma pool versus Transaction Mode on 6543 with one connection. Use measured concurrency, not an arbitrary `connection_limit` increase.
4. Retain `DIRECT_URL` only for migrations and use the documented supported endpoint.
5. Make the effective pool mode, sanitized database region/host class, Prisma connection limit, and connect timeout visible in startup diagnostics.
6. Fail the performance profile if `SELECT 1` p95 exceeds 100 ms in a production-like environment.

**Exit gate:** trivial database/API reads are p95 <100 ms in local/staging-equivalent topology, and 25 concurrent readiness requests do not queue beyond 250 ms.

### R1-P2 — Collapse session/workspace bootstrap and throttle session touches

**Estimate:** 1-2 days  
**Dependency:** can proceed with R1-P1 after the baseline

1. Replace the parallel `/auth/me` + `/v1/workspace/bootstrap` pair with one authenticated session/workspace bootstrap contract containing the complete actor and shell context.
2. Validate the cookie once per bootstrap request and pass the guard-attached `AuthSession` throughout; retain default-deny authorization.
3. Update `lastSeenAt` only when it is older than a defined activity granularity, such as 60 seconds, using a conditional update or coalesced per-session writer.
4. Ensure touch failure does not create an unbounded retry loop and does not consume the pool on every GET.
5. Preserve logout, revocation, idle-timeout, role-change, location-scope, 401, and cross-tab cache-clearing semantics.

**Exit gate:** hard refresh uses one shell HTTP request, one session validation, and at most one throttled touch; navigation reuses the shell context until an explicit invalidator.

### R1-P3 — Replace the Schedule query chain with one day read model

**Estimate:** 2-3 days  
**Dependency:** R1-P0; benefits strongly from R1-P1

1. Move `/v1/schedule/day` into one dedicated service instead of composing `appointments.list()` and `providers.listScheduleGrids()` in the controller.
2. Query appointment rows once and derive both visible appointment cards and slot occupancy from that result.
3. Combine schedule configuration, Provider metadata, availability, recurring blocks, blocked times, and appointments into the minimum number of database round trips. Prefer a small number of explicit set-based queries; do not create a per-Provider loop.
4. Make authorization scope part of the service input so Provider-count authorization and read-model Provider lookup can share one result.
5. Cache schedule configuration/version separately so an in-memory grid hit does not query PostgreSQL first.
6. Add API-side single-flight coalescing by tenant/location/date/provider set, bounded TTL, maximum entries, hit/miss/age metrics, and mutation invalidation.
7. Keep slot/booking commit validation database-authoritative. No cache may approve a booking.

**Target:** cold day snapshot <=3 database round trips and p95 <500 ms; process-local cache hit p95 <50 ms before UP-14 Redis.

### R1-P4 — Fix browser orchestration and prefetch policy

**Estimate:** 1-2 days  
**Dependency:** R1-P2/P3 contracts

1. Start shell and authorized route data without an avoidable serial mount waterfall. A persistent shell skeleton may render immediately while both requests progress.
2. Use subscriber-aware in-flight deduplication: multiple consumers share one request, and the underlying fetch aborts only when every consumer has cancelled.
3. Add a default read timeout budget and typed retryable timeout state; allow longer explicit budgets only for governed commands such as booking confirmation.
4. Prefetch adjacent Schedule days only after current content is useful and the browser/API is idle. Disable or reduce prefetch on constrained connections and development Strict Mode.
5. Preserve the 32-entry private session cache, but add age/TTL so stale entries do not live for an entire shift.
6. Do not send `cache: no-store` reflexively for data covered by a safe, session-private client policy; authorization-sensitive server/shared caching remains prohibited.

**Exit gate:** no duplicate visible read survives a Strict Mode remount, route content begins without waiting for unrelated shell data, and prefetch never delays an explicit user request.

### R1-P5 — Bound growth paths and add representative-volume gates

**Estimate:** 1-2 days implementation plus test execution  
**Dependency:** R1-P0 instrumentation

1. Replace Finance's nested all-Payments/all-Corrections hydration with aggregates for list rows and demand-load invoice detail/history.
2. Paginate Archive.
3. Split Inventory summary/catalog from movement history and demand-load lots/detail where practical.
4. Replace deep Staff offset pagination with cursor pagination or cap supported pages after measured product needs.
5. Load representative data and capture `EXPLAIN (ANALYZE, BUFFERS)` for every hot read model.
6. Retain existing useful indexes and add an index only when a measured plan demonstrates the need.

**Exit gate:** query/payload cost remains bounded at representative clinic volume and all p95 targets pass without Redis.

### R1-P6 — Login and process hardening

**Estimate:** 1 day; may run parallel after R1-P1  
**Dependency:** baseline

1. Replace synchronous password verification/hashing with an asynchronous or worker-thread path while retaining password-policy and cost requirements.
2. Provide one root development command that starts one web and one API watcher, waits for readiness, and reports port ownership clearly.
3. Make every runtime Prisma script import `loadMonorepoEnv()` before constructing PrismaClient; add a test/check for the pooler normalization boundary.
4. Bound/prune Schedule and rate-limit maps.

**Exit gate:** login does not block the API event loop, stale local processes are obvious, and raw runtime scripts cannot bypass pooler compatibility.

### UP-14 — Add Redis only after R1 is green

UP-14 remains the correct place for multi-instance Schedule/Dashboard caching and event-driven invalidation. After the uncached route meets its budget:

- move non-sensitive Schedule snapshots and Dashboard aggregates to tenant/scope/version-keyed Redis;
- apply the TTLs and invalidators already specified in `14-operational-read-models-and-caching-strategy.md`;
- retain PostgreSQL authorization and booking/finance correctness;
- prove Redis outage degrades to the now-fast uncached path.

## 8. Acceptance and regression budgets

These gates refine the existing performance objectives rather than replace them.

| Layer | Target |
| --- | --- |
| Local/staging-equivalent `SELECT 1` | p95 <100 ms |
| Normal authorized API reads | p95 <500 ms |
| Schedule day/week read model | p95 <500 ms at representative volume |
| In-process Schedule cache hit | p95 <50 ms and zero database query |
| Core route useful content | p95 <2.5 s on normal clinic broadband |
| Warm client-side route transition | p95 <1.0 s |
| Login | p95 <2.5 s and no main-event-loop block >100 ms |
| Pool wait | p95 <100 ms; max <250 ms at agreed concurrency |
| Read timeout/error state | clear retryable state by 8 s; no indefinite skeleton |
| Initial shell requests | one session/workspace bootstrap; no duplicate auth read |
| Schedule day database work | <=3 round trips; appointment data read once |
| Concurrent navigation | 10 simultaneous page loads meet targets with no P2024/5xx |

Test at minimum:

- cold process / cold cache;
- warm process / cold route;
- warm route/client cache;
- 1, 5, 10, and 25 concurrent users;
- 100 ms and 300 ms injected database latency;
- database/pool unavailable;
- Redis unavailable after UP-14;
- development Strict Mode;
- session near idle-touch threshold;
- Schedule mutation during cached reads;
- 320 px mobile and representative desktop while CPU is throttled.

## 9. Verification order

1. Re-run the exact baseline after R1-P1 topology changes.
2. Prove auth revocation/CSRF/tenancy tests after bootstrap consolidation.
3. Prove Schedule visibility, timezone, provider capacity, invalidation, and booking concurrency after query consolidation.
4. Capture browser traces and `Server-Timing` for every route.
5. Run production build, typechecks, repository tests, representative-volume plans, and concurrent load.
6. Update `14-operational-read-models-and-caching-strategy.md`, `15-environment-and-local-development-guide.md`, `16-deployment-security-and-observability-runbook.md`, `20-tangible-phase-delivery-plan.md`, and the ADR log with the accepted pool/topology/cache decisions.

## 10. Final diagnosis

The reported latency is real and architecturally explainable. The current application pays remote-database latency many times per screen and serializes those operations through one Prisma connection. Schedule compounds that with a five-second cold grid path, a database-dependent “cache hit,” repeated session work, and eager adjacent-day prefetch. Under pool contention or the historical 10-second acquisition timeout, those phases can readily cross 30 seconds.

The correct release sequence is:

**measure signed-in waterfall -> fix database topology -> collapse bootstrap/session writes -> consolidate Schedule reads -> fix browser orchestration -> prove representative volume -> add Redis later.**

No application behavior or database data was changed during this audit.
