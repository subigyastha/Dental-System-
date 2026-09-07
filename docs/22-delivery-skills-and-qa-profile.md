# ClinicFlow Delivery Skills and QA Profile

**Adopted:** 2026-08-16
**Purpose:** Make the tools and quality practices used by upcoming phases explicit and repeatable.

## Verified skills for upcoming work

The following curated skills were installed from the official `openai/skills` catalog and become available to new Codex turns:

| Skill | ClinicFlow use |
| --- | --- |
| `playwright` | Repeatable browser flows, responsive viewport checks, keyboard interaction, hydration/console failures, request counts, and signed-in regression coverage. |
| `screenshot` | Consistent visual evidence for the persistent HTML phase review, including desktop/mobile states and defect comparisons. |
| `security-best-practices` | Auth/session/logout, RBAC, CSRF, secret handling, sensitive cache cleanup, and secure implementation review. |
| `security-threat-model` | Focused threat modeling for Staff access changes, session exit, Super Admin support access, messaging, payments, and other trust-boundary changes. |
| `sentry` | Error/performance instrumentation planning and verification once the observability slice is active; no sensitive Client, Record, or financial payloads may be captured. |

The existing in-app browser-control skill remains the preferred tool for interactive signed-in manual QA when a local session is available. Automated Playwright evidence complements it; neither replaces API, database, or authorization tests.

## Gutsphere reference adopted selectively

The local reference `D:\Gutsphere\Gutsphere Landing\skills\landing-page-builder\SKILL.md` was reviewed. ClinicFlow adopts only the practices that transfer safely to an authenticated operational application:

- mobile-first responsive implementation and explicit 360px, 768px, and desktop review;
- semantic interactive elements with visible focus, keyboard support, labelled inputs, and no nested interactive controls;
- WCAG 2.2 AA target, at least 44px touch targets, reduced-motion support, and no hover-only essential action;
- measured Core Web Vitals targets of LCP under 2.5s, INP under 200ms, and CLS under 0.1 where browser rendering is in scope;
- content-shaped loading states, stable geometry, explicit media dimensions, minimal blocking JavaScript, and pre-ship QA rather than visual inspection alone;
- clear action labels and one visually dominant primary action per task surface.

Landing-page conversion funnels, public SEO templates, repeated marketing CTAs, testimonials, and marketing proof sections are intentionally **not** applied to clinic workspaces.

## Phase application

1. **R0A — Sign out:** use security best practices and a focused threat model before implementation; verify keyboard, short viewport, zoom, double-click, API failure, expiry, cross-tab cleanup, and no-data-flash behavior with Playwright/browser evidence.
2. **R1/R1S — Performance and Staff Management:** use Playwright for request-waterfall and responsive regression evidence, screenshots for review, and the adopted accessibility/performance rules for the Staff table/cards/drawers.
3. **R2/R3 — Booking and calendar:** verify pending/rollback states, rapid navigation, touch/keyboard operation, hydration errors, and representative viewport behavior. Package selection still requires measured bundle, accessibility, timezone, and performance evidence.
4. **R4 and integration phases:** threat-model Super Admin support grants, global kill switches, provider callbacks, and message/payment secrets before implementation.
5. **Operations:** use Sentry guidance only when the observability contract, data-scrubbing rules, environment separation, and sampling policy are approved.

For every invoked skill, read its current `SKILL.md` before acting. Record the skill-driven QA evidence in `docs/phase-review.html`; do not mark a phase complete from a checklist without running the relevant checks.
