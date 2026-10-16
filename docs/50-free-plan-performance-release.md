# Free-plan performance and workflow release — 2026-10-16

Scope: release the pending staff-directed follow-up, client table, calendar/booking and visit-payment work, with app changes for the existing free hosting plans. No paid plan or region migration is requested.

## Performance changes

- Opening sign-in issues one anonymous, uncached API liveness request, overlapping backend wake-up with credential entry. Concurrent mounts share the in-flight request. Failures remain silent until the actual operation; there is no interval or keep-alive service.
- Sign-in and initial workspace bootstrap allow 60 seconds for a sleeping backend. Ordinary requests retain their eight-second default; booking/payment retry and idempotency rules are unchanged. Sign-in disables its submit button while pending.
- Follow-up status totals use one tenant/location/filter-scoped grouped query instead of five separate counts. This removes four database statements per queue load, reducing pressure on the five-connection pool. Six distinct view counts remain separately scoped.
- API liveness includes a validated hosting commit SHA when Render supplies it, enabling exact release verification without credentials or clinical data.
- Render now uses `SUPABASE_POOL_MODE=session`. The existing normalization switches the Supabase endpoint to port 5432 and removes transaction-mode prepared-statement restrictions while retaining TLS and the bounded connection pool. No database credentials changed. A workstation comparison measured warm SELECT 1 at 714–717ms in transaction mode versus 139–141ms in session mode; subsequent production measurements confirm the benefit from Render.
- Generated eye-test build artifacts are excluded from lint and local temporary artifacts from Git.

These changes reduce avoidable work and premature timeouts. They do not eliminate Render Free spin-down or cross-region database network latency. Baseline: [production assessment](49-production-status-and-latency.md). Prior broader optimizations already in main: [performance remediation](26-application-performance-remediation.md).

## Validation and rollout

- Node 24 local full suite: 432 passed, zero failures, one database HTTP test skipped in the standard invocation. The separate local HTTP attempt could not connect to stopped PostgreSQL. [Release CI](https://github.com/subigyastha/Dental-System-/actions/runs/38935475067) passed all 436 tests with zero failures/skips, including HTTP and database transaction checks, fresh migrations and the standard Linux build.
- API/web typechecks, lint, formatting, operational data boundary, route classification, secret scan, Prisma validation and production dependency audit passed (zero vulnerabilities).
- Windows Turbopack exited while creating its CSS child process, including outside the sandbox. Webpack provides the local production build check; Linux CI retains the standard Turbopack build.
- Migration 28 is additive and preserves existing reminders/contact history; reviewed release order is CI fresh-database rehearsal, production migration, then matched API/web rollout.
- Existing migration/schema index naming differences and provider-slot default drift are outside this migration; no schema push or unrelated schema synchronization.

Local evidence: `.codex-temp/release-20261016-*.log`. Production rollout must verify migration history, API revision, public readiness/login and authenticated access controls. Physical-phone acceptance remains separate. No external messages or synthetic production bookings/payments are part of rollout verification.

## Production result

[PR #7](https://github.com/subigyastha/Dental-System-/pull/7) merged as `1ed62e8b728321df707d164491ccb077e28261d7`. Both Render and Vercel successfully deployed the application merge, and the API liveness revision matched. Render is Free in Singapore; the configured Supabase pooler is Tokyo. Session mode is verified operational from Render.

Migration 28 applied successfully before rollout. All nine new columns exist; all four existing reminders preserved their ids/statuses/dates, and existing communications were preserved. No unrelated schema synchronization ran.

Three post-release measurement rounds returned 200 for API liveness/readiness, proxied readiness and login (12/12). Warm SELECT 1 processing was 73.1–73.3ms versus approximately 366ms before (80% lower). Warm direct readiness was 163–184ms versus 469–475ms before. Proxied readiness samples were 203–359ms versus 494–1,017ms before. This is a small health-check sample, not proof of equivalent gains on every page. Raw `.codex-temp/production-latency-after-20261016.json`.

Four public requests to protected follow-up/workspace/client/finance endpoints returned 401. CI verifies authenticated tenant/location containment; signed-in production clinic acceptance remains pending because no clinic session is available in the browser. Render Free still sleeps after inactivity; wake overlap and longer initial deadlines reduce its impact but do not remove the underlying cold start.
