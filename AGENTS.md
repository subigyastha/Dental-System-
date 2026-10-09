# Workflow System

- Work directly by default. Delegate only when requested and useful; one worker unless more are requested. Use a minimal brief, no full-history fork, no nested delegation or duplicate investigation.
- Read relevant code and doc sections only. Use docs/progress.md for continuation; large plans and phase-review.html are on-demand references.
- Preserve tenant/auth, booking/idempotency, clinical and billing invariants. Keep existing uncommitted work.
- Run checks appropriate to changed behavior and required release gates. Save verbose logs locally; report counts, failures and exit codes. Repeat only after changes or unresolved failures.
- Update docs/progress.md after meaningful work: current slice, verified checks, remaining work and blockers. Replace stale status; keep below 500 words. Link evidence rather than copying it.
- Read applicable skills only; avoid loading every QA skill. Keep answers short, plain and understandable.
- Web-specific framework rules: apps/web/AGENTS.md. Domain specs: search docs by topic; no bulk reads.
