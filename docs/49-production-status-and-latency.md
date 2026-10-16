# Production status and latency — 2026-10-16

Read-only production assessment; no deployment, configuration or database changes.

## Alignment

- Local HEAD and live remote main: `4d243bc0f21b2c8c67ef8cd8fbb83ec02d1d88cf`.
- Latest GitHub Production deployment: Vercel, same SHA, successful October 9 (deployment 6966162318). Public production login is reachable. Render's exact deployed revision is not exposed by current health responses and remains unverified.
- Working tree has 71 modified/untracked entries, including follow-up workflow, shared client/follow-up tables, calendar/booking and visit payment changes. These are outside the deployed commit.
- Configured Supabase database still ends at successful migration 27. Migration 28 is absent; all nine queried follow-up columns are absent. Migration history contains 30 records; this is not 30 distinct numbered migrations.
- Local eye-test database is separate, with migration 28 applied per prior acceptance evidence. Local and production schemas/features therefore differ intentionally until release.

## Measurements

Three rounds from this workstation, sequential public GETs; all 12 returned HTTP 200. These are small diagnostic samples, not authenticated page benchmarks or p95 results.

| Endpoint | First request | Subsequent requests | Nest processing |
| --- | --- | --- | --- |
| Render API liveness | 42,553 ms | 101–112 ms | 0.5–5.5 ms |
| Render API database readiness | 486 ms | 469–475 ms | 365.6–369.2 ms |
| Vercel-proxied API readiness | 1,017 ms | 494–682 ms | 365.5–366.8 ms |
| Vercel login | 330 ms | 56–65 ms | Not supplied |

Raw evidence: `.codex-temp/production-latency-20261016.json` (local only).

The first liveness delay happens outside Nest request processing and is consistent with cold start/wake-up, but hosting plan/events must confirm it. Warm readiness spends approximately 366 ms on the database path for SELECT 1. This supports investigating API/database network placement or pooler delay; it does not identify a specific slow business query. Supabase's configured pooler hostname indicates Tokyo (`ap-northeast-1`). Render's region is unknown. Vercel response IDs show ingress `bom1`, not proof of the execution region.

## Recommended order

1. Check Render plan, region, deployment SHA and restart events. If Free, use an always-on paid instance: Free services sleep after 15 idle minutes. https://render.com/docs/free
2. Benchmark API and database in the same region, or nearest practical placement. Render offers Singapore; compare migration options and measured latency before moving the current Tokyo database. https://render.com/docs/regions
3. Verify Render's effective database settings. Tracked code already defaults to five Prisma connections, but an explicit `connection_limit=1` in its URL overrides that default. Actual Render environment is unverified.
4. Benchmark direct database access for the persistent Nest process where supported, or session pooling for IPv4; retain current working transaction pooling until alternatives pass checks. Do not blindly increase connection counts. https://supabase.com/docs/guides/database/connecting-to-postgres
5. Measure authenticated bootstrap, reservation grid, slot search, clients and payment requests with existing Server-Timing headers. Optimize sequential round trips, query plans and safe tenant-scoped read caching based on evidence. Prior fixes are in doc 26; they already exist in main.
6. Review/test the pending local release, rehearse migration 28, apply it through the release migration job, then deploy matched API/web commits and verify authenticated workflows. Add a sanitized release identifier to health/build metadata for future parity checks.

## Limits

No authenticated production workflows, hosting dashboard settings or exact Render SHA were inspected. No fresh full test suite was run for this diagnostic/doc-only assessment. Previously recorded suite: 431 combined tests, zero failures; this is historical evidence, not a new result. Clinic acceptance and physical-device checks remain open.
