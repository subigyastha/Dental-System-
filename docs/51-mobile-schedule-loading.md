# Mobile PWA schedule loading — 2026-10-16

Reported error: “Provider availability could not be loaded. Try again.” with “Retry schedule” in Reservations/Schedule; desktop works.

The message comes from the day-schedule read effect, before booking confirmation. It catches every failure from `/v1/schedule/day`, including transport, timeout, session/permission and response-scope failures. The shared transport previously applied its ordinary eight-second deadline. The PWA service worker caches only the public offline screen; it does not cache schedule API data or writes. Public production health was 200 at revision 962648b; Render ERROR search showed no matching application errors in the last hour. These observations do not establish the original phone's exact HTTP failure.

## Change

- Day-schedule GET gets a 60-second total budget, allowing a resumed PWA to wait for the sleeping free API.
- Retry one transient network/timeout/server failure within the remaining budget, preserving the exact date/provider/location query. Never retry session/permission/validation/rate-limit denials.
- Preserve underlying error feedback instead of replacing every failure with generic provider availability text. Network failures advise checking the connection; timeout, expired session and permissions remain distinguishable.
- Existing request sharing, local navigation cancellation, cache revision guards and date/provider response-scope checks remain in place. No booking/payment mutation, authorization, capacity rule, database migration or offline data cache changes.

## Verification

- Local Node 24: 60 workspace/schedule tests and 69 UI tests passed, zero failures/skips. Added five regressions for transient recovery, bounded timeout budget, rejected requests, retry limit and error messages.
- Web types, lint and formatting passed. Production webpack build and release CI recorded in the current handoff.
- Initial direct test invocation from repository root failed to resolve the web TypeScript alias; the configured web workspace invocation passed.
- Phone OS and original HTTP status remain unavailable. Physical-phone production retest is required before claiming the original incident fully reproduced/resolved.

Evidence: `.codex-temp/mobile-schedule-*.log` (local only).
