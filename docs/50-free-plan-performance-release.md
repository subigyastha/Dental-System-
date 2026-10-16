# Free-plan performance and workflow release — 2026-10-16

Scope: release the pending staff-directed follow-up, client table, calendar/booking and visit-payment work, with app changes for the existing free hosting plans. No paid plan or region migration is requested.

## Performance changes

- Opening sign-in issues one anonymous, uncached API liveness request, overlapping backend wake-up with credential entry. Concurrent mounts share the in-flight request. Failures remain silent until the actual operation; there is no interval or keep-alive service.
- Sign-in and initial workspace bootstrap allow 60 seconds for a sleeping backend. Ordinary requests retain their eight-second default; booking/payment retry and idempotency rules are unchanged. Sign-in disables its submit button while pending.
- Follow-up status totals use one tenant/location/filter-scoped grouped query instead of five separate counts. This removes four database statements per queue load, reducing pressure on the five-connection pool. Six distinct view counts remain separately scoped.
- API liveness includes a validated hosting commit SHA when Render supplies it, enabling exact release verification without credentials or clinical data.
- Generated eye-test build artifacts are excluded from lint and local temporary artifacts from Git.

These changes reduce avoidable work and premature timeouts. They do not eliminate Render Free spin-down or cross-region database network latency. Baseline: [production assessment](49-production-status-and-latency.md). Prior broader optimizations already in main: [performance remediation](26-application-performance-remediation.md).

## Validation and rollout

- Node 24 local full suite: 432 passed, zero failures, one database HTTP test skipped in the standard invocation. Isolated HTTP, builds and CI recorded in the project handoff as completed.
- API/web typechecks, lint, formatting, operational data boundary, route classification, secret scan, Prisma validation and production dependency audit passed (zero vulnerabilities).
- Windows Turbopack exited while creating its CSS child process, including outside the sandbox. Webpack provides the local production build check; Linux CI retains the standard Turbopack build.
- Migration 28 is additive and preserves existing reminders/contact history; reviewed release order is CI fresh-database rehearsal, production migration, then matched API/web rollout.
- Existing migration/schema index naming differences and provider-slot default drift are outside this migration; no schema push or unrelated schema synchronization.

Local evidence: `.codex-temp/release-20261016-*.log`. Production rollout must verify migration history, API revision, public readiness/login and authenticated access controls. Physical-phone acceptance remains separate. No external messages or synthetic production bookings/payments are part of rollout verification.
