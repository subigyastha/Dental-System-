# Mobile schedule scrolling — 2026-10-18

The previous mobile layout pinned the whole Reservations/date/navigation/provider/view-control block. Weekly appointments also used an independent vertical scroller, so scrolling the board could leave most of the screen occupied by controls.

## Behavior

- Reservations heading, date picker, navigation, filters and Day/Week/Month switch scroll with the page. Scrolling back toward the top reveals them normally; no gesture-only control or automatic hide/show animation.
- Day keeps a compact date/provider strip visible under the workspace header. Provider chips remain selectable while viewing appointments. The duplicate day-provider dropdown is removed; scoped provider schedules retain their provider label.
- Week uses document vertical scrolling on mobile. A compact day/date/count strip stays visible; swiping/focusing either the strip or weekly columns keeps their horizontal positions synchronized. The desktop board keeps its bounded 70vh scroller and sticky column headings.
- Month keeps month navigation and weekday labels visible only while the calendar is in view. They release when reaching the selected-day details below.
- Sticky offsets use the measured workspace-header height and safe-area inset instead of the former hard-coded 57px. Header changes after sign-in and resizing are observed.
- Touch targets and current provider selection remain accessible. No auth, tenant, scheduling capacity, booking, payment, cache or database behavior changes.

## Evidence

Interactive synthetic fixture renders the actual React schedule components, with no database or clinic records. Edge checks cover day/week/month at 320/390/767px: all nine combinations scroll the controls away, pin context below the 69px fixture header and avoid page overflow. Week horizontal synchronization verified in both directions (341px and 671px). Provider B selection remains visible/sticky. Month context releases past the calendar. Desktop at 1440px hides the mobile week strip and retains its 630px/70vh scroll limit.

Screenshots and readings: `.codex-temp/mobile-{day,week,month}-scroll.png`, `mobile-scroll-browser{,-extra}.json`. Fixture `.codex-temp/mobile-scroll-fixture.tsx`; loopback preview port 3198.

Local: 69 UI tests passed after updating the existing week-scroll contract; types, lint, format, whitespace and webpack production build passed. Initial UI run failed only the former assertion requiring the bounded mobile scroller; it was updated for the requested behavior. CI/release results are recorded in [current progress](progress.md).

Physical iOS/Android PWA acceptance remains recommended, especially safe-area/orientation and touch swiping. Fixture measurements do not replace clinic workflow acceptance.
