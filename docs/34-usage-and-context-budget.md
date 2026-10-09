# Usage and context budget

Audit: 2026-10-09. Aim: less repeated model work, without weakening correctness.

## Findings
- Global model: gpt-6.1-sol, low reasoning. Already economical relative to higher effort; unchanged.
- Local apps/web/AGENTS.md is small (~650 bytes) and framework-generated; retained.
- Delivery plan mandated root + three workers every phase. Replaced with direct work by default.
- Largest references: delivery plan ~73 KB, phase review ~152 KB, upgrade/performance references ~26–35 KB. Files on disk do not consume model tokens merely by existing; reading/injecting them does.
- Skill names/descriptions are discoverable; bodies/references load when used. Avoid stacking unrelated skills.
- Configured standalone MCPs: node_repl (browser support), Stitch (design). Plugin tools add discovery/schema overhead when exposed; calls and large outputs add context. No per-server metering available, so no measured attribution or savings percentage.

## Applied
- Root AGENTS.md: concise routing, bounded delegation/output, current progress.
- docs/progress.md: short current state; historical docs retained as references.
- Delivery skill profile: topic routing, no automatic security-skill stack.
- Global instructions: short replies, bounded reads and delegation.
- Canva/template-creator plugins and Stitch MCP disabled by default, not uninstalled. Re-enable for design/template jobs. Existing accounts/credentials retained.
- Coding, GitHub, deployment, browser, PDF and app tools retained because other projects may need them. Disabled Sentry and document/sheet/slide plugins remain disabled.
- Reusable lean-project-maintenance skill installed globally; audits setup when asked, not every coding turn.
- scripts/audit-agent-context.mjs: read-only size report and lean-entry budget check.

## Operating defaults
- One agent; only delegate independent substantial work when requested. Pass paths, exact goal, invariants and required checks in a short brief. Do not clone full chat history or spawn more workers.
- Batch independent tool reads. Search before reading; limit to relevant sections. Save logs to ignored local files; return summary and failure excerpts.
- Keep current progress below 500 words. Change one status source; link it from old plans. Add detailed evidence only when it changes acceptance or diagnosis.
- Choose one skill for the task; load a second only for a distinct need. Preserve necessary skill and framework requirements.
- Complete focused checks once; broad release gates still apply before release.
- At a completed task boundary, start a new chat with docs/progress.md and the next goal.
- Keep the current low effort setting for routine work. Increase only for difficult analysis; brevity alone does not limit hidden reasoning.

## Other projects
Global instructions now apply across projects. For each repo, add a short AGENTS.md with its real commands/invariants and one progress entry; do not copy this project's clinical rules. Invoke $lean-project-maintenance to adapt the setup. Keep existing specialized skills; select by task instead of combining all skill sets. Other repos were not edited.

## Verification and rollback
Run: node scripts/audit-agent-context.mjs --check
It checks root instructions and current progress size; reference sizes are advisory, not token measurements.
Fresh chats/restart are needed to confirm effective plugin/MCP changes; this active chat retains its current tools.
Global config backup: ~/.codex/config.toml.before-lean-20261009 (may contain secrets; do not commit/share).
Restore only the changed enabled flags from backup, or enable the plugins in Settings. Remove global AGENTS.md/lean skill only if no longer desired.
Measure account usage before/after comparable tasks, same model/effort/scope; note reset boundaries and other active chats. No promised percentage reduction.

Sources checked:
- https://learn.chatgpt.com/docs/config-file/config-reference
- https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra
