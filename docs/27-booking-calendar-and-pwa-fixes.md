# Schedule booking, calendar alignment, and PWA installation

Reviewed: 2026-10-01. Release verification in progress; signed-in and physical-device acceptance remain.

## Causes and changes

- **Booking:** Schedule emits Nepal-offset timestamps while persisted holds use UTC. Text equality rejected valid holds and cleared the preselected time. Slot comparison now uses the instant; availability responses, slot IDs, and version hashes normalize timestamps to UTC. The UI shares one matching helper, preserves the requested time, and distinguishes service validation from availability conflicts.
- **Simple flow:** tap Schedule time → choose service → Continue → choose/create Client → confirm. All available times are visible, including later slots. Selecting a replacement time does not immediately move to another step. Continue creates the protected hold, with a synchronous double-tap lock. Server overlap checks and idempotency remain authoritative.
- **AD day mismatch:** Nepal midnight was read with UTC date getters, producing yesterday's day number. Civil date fields now come from the date key. AD month navigation also uses civil-date arithmetic rather than Nepal-midnight instants.
- **BS weekday mismatch:** the library grid depends on the device timezone. AD and BS now share a single six-week grid built from converted civil dates and UTC weekday arithmetic. Conversion remains in the existing library; BS is derived from canonical AD.
- **PWA:** Next's native manifest, 192/512px PNG icons, maskable icon, Apple touch icon, standalone launch, and a shared Install app action are added. Installation is available from sign-in, desktop Profile, and mobile More. The old worker cleanup endpoint was removed because it would unregister the new worker.
- **Mobile:** accidental double-tap zoom is prevented with `touch-action: manipulation`; pinch zoom remains available. Controls use 16px text to avoid input-focus zoom, principal actions have at least 44px touch targets, drawers contain scrolling, and bottom surfaces account for safe areas. Login uses the dynamic viewport height. Mobile More scrolls on short screens.

## Installation and offline behavior

Serve production over HTTPS. Localhost is suitable for development; plain HTTP on a LAN IP does not meet secure-context installation requirements. Deploy both the web and API changes together.

- Chromium: Install app uses the browser prompt when available; otherwise the browser menu supplies installation.
- iPhone/iPad: Safari → Share → Add to Home Screen.
- The installed app opens in standalone mode and uses the current server session.
- The service worker caches only `/offline.html`. It never caches clinic pages, API responses, or mutations, and never queues bookings or financial writes. An existing open page shows a network-status banner when offline; a new offline navigation shows the public reconnect screen.
- `/sw.js` is served as JavaScript with no-cache/no-store headers. Only old `clinicflow-offline-*` caches are removed during upgrades.

The implementation uses native Next/browser facilities and the existing logo; no PWA framework or additional runtime dependency is introduced.

## Verification

- Full configured test suite passed; the disposable PostgreSQL HTTP test remains skipped without `TEST_DATABASE_URL`.
- Regression tests cover offset-to-UTC selection/hold creation, later-slot matching, AD/BS conversion consistency, weekday columns, sequential cells, and month/year navigation.
- Calendar tests passed in `Asia/Kathmandu` and `America/Los_Angeles`.
- PWA tests verify icon dimensions, standalone manifest, public-only offline caching, API/write bypass, and preservation of server denials.
- Web and API production builds, typechecks, formatting, route inventory, and web/Prisma boundary checks passed. Lint has one pre-existing navigation warning in Client Hub.
- Browser checks cover mobile install guidance, 16px inputs, touch behavior metadata, and no horizontal overflow on the sign-in screen. Native installation and physical iOS/Android gesture behavior still require device acceptance.

## Release verification and acceptance

Supabase connectivity was restored on 2026-10-01. A read-only connection check passed and Prisma reports all 26 migrations applied. This release has no schema changes. CI now also runs the existing booking, Client creation, and Finance concurrency/rollback integration tests against its disposable PostgreSQL service; it does not run those fixtures on production.

The release audit detected the newly published Next.js advisory [GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j). Next.js and its matching ESLint configuration are patched to 16.3.8; the production dependency audit reports zero vulnerabilities.

Signed-in acceptance: verify an early and a later Schedule time with two service durations, unavailable-slot recovery, returning to held details, double-tap Continue, and confirmation. Check AD/BS dates across midnight and month/year changes, then install on Android and iOS and check the virtual keyboard, safe areas, scrolling, and reconnect flow.
