# Delivery skills and QA

Updated: 2026-10-09. Load the skill needed for the task; no blanket skill stack.

| Task | Guidance |
| --- | --- |
| Repeatable browser regression | Playwright |
| Interactive signed-in checks | Available browser control |
| Requested desktop screenshot | Screenshot |
| Explicit security review / secure-default guidance | Security best practices |
| Explicit threat model | Security threat model |
| Observability work | Sentry only when enabled and needed |

Preserve tenant/auth, booking, migration and clinical/billing invariants regardless of skill selection. Security regression tests remain required for affected boundaries; specialized security skills are not mandatory for ordinary edits.

For UI changes check relevant responsive, keyboard, focus and labelled-input behavior. Test loading, rollback and failure paths when touched. Use measured performance evidence for performance claims.

Follow docs/17-testing-strategy.md for applicable checks and release gates. Record concise current validation in docs/progress.md. Link detailed phase evidence in docs/phase-review.html only when needed; do not duplicate logs or reread the whole report.

Domain requirements stay in their specifications. Framework guidance stays in apps/web/AGENTS.md. Historical phase status stays in existing evidence.
