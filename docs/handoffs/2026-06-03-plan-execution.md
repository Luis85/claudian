---
title: Session handoff — 2026-06-03 (Claudian plan execution)
date: 2026-06-03
status: superseded
superseded-by: "[[2026-06-04-q1-complete]]"
scope: whole-codebase plan execution (Phase 1a/1b/1c, ADR-0001 P1/P2a, Q-NEW-1, Q-1 partial)
branch: main (direct commits, no feature branch)
head-at-handoff: c4ca6ad
related:
  - docs/reviews/2026-06-02-codebase-review-and-improvement-plan.md (source plan)
  - docs/adr/0001-transport-agnostic-provider-seam.md (architecture seam ADR)
  - docs/superpowers/plans/2026-05-30-cursor-integration-hardening.md (blocks ADR-0001 P3)
---

# Session handoff — 2026-06-03 (Claudian plan execution)

Picks up the 2026-06-02 codebase review & improvement plan from `phase-0-shipped`
into the linear progression of remaining phases. Working tree on `main`; user
opted to commit phases directly (no feature branch).

## What shipped this session (9 commits, all on main)

| Commit | Phase / item | Verified |
|--------|--------------|----------|
| `3b57e33` | Phase 1a — Obsidian conformance (OBS-1..5) | tc/lint/test/build |
| `1bc8483` | Phase 1c F1+F4 — long-chat yield-above-continue + docs reconcile | tc/lint/test/build |
| `e2f389a` | Phase 1b — UX-1..4 polishing | tc/lint/test/build |
| `4335655` | ADR-0001 Phase 1 — canonical tool-name set per provider | tc/lint/test/build |
| `2c6f67e` | ADR-0001 Phase 2a — rewind optional + RuntimeHost type defined | tc/lint/test/build |
| `4e420c9` | Q-NEW-1 — `src/core/constants.ts` extraction | tc/lint/test/build |
| `aef981c` | Q-1 chunk 1 — InputController Notice i18n (16 sites) | tc/lint/test/build |
| `86b93a0` | Q-1 chunk 2 — ConversationController Notice i18n (8 keys) | tc/lint/test/build |
| `c4ca6ad` | Q-1 chunk 3 — McpSettingsManager Notice i18n (14 sites) | tc/lint/test/build |

Every commit verified with `npm run typecheck && npm run lint && npm run test && npm run build`
before pushing. Current state: 6623 tests pass / 35 skipped / 356 suites, lint clean, build pass.

## Deploy state

TestVault build copy is current per `c4ca6ad`. To redeploy:

```bash
OBSIDIAN_VAULT="D:/TestVault" npm run build
```

## Smoke test prompt (validated mid-session)

```
Run this 4-step smoke test. Pause between steps.

Step 1: Use the AskUserQuestion tool to ask me which color I prefer — red, blue, or green. Wait for my answer.

Step 2: Run `git status --short` via Bash. Approval prompt should fire. While it's pending, I'll switch tabs and come back.

Step 3: Create a new note at `smoke-test.md` with frontmatter `{tags: [smoke-test], created: today}` and three bullet points summarizing this session.

Step 4: Read `smoke-test.md` back and confirm contents match what you wrote.

After step 4, give me a one-line PASS/FAIL summary.
```

User confirmed "looks good to me" after running this against the Phase 1a+1b+1c deploy.

## What's NOT done — pick-up queue (linear-order)

### Q-1 Notice i18n sweep (in progress, ~75% remaining)

Plan priority order:

| File | Sites | Status |
|------|-------|--------|
| `src/features/chat/controllers/InputController.ts` | 17 | done (chunk 1) |
| `src/features/chat/controllers/ConversationController.ts` | 15 | done (chunk 2) |
| `src/features/settings/ui/McpSettingsManager.ts` | 14 | done (chunk 3) |
| `src/providers/opencode/ui/OpencodeAgentSettings.ts` | 14 | **next chunk 4** |
| `src/providers/claude/ui/AgentSettings.ts` | 11 | pending |
| `src/features/chat/tabs/tabControllers.ts` | 11 | pending |
| `src/providers/claude/ui/SlashCommandSettings.ts` | 10 | pending |
| `src/providers/codex/ui/CodexSubagentSettings.ts` | 9 | pending |
| `src/main.ts` | 9 | pending |
| `src/features/tasks/ui/AgentBoardView.ts` | 9 | pending |
| `src/providers/codex/ui/CodexSkillSettings.ts` | 6 | pending |
| `src/features/settings/ui/EnvSnippetManager.ts` | 6 | pending |
| `src/features/chat/ui/InputToolbar.ts` | 6 | pending |
| `src/features/chat/ClaudianView.ts` | 6 | pending |
| `src/providers/claude/ui/PluginSettingsManager.ts` | 5 | pending |
| _various_ | ~65 more | pending |

After all sites: **add ESLint rule blocking new `new Notice()` outside an allowlist**
(plan item still open).

**Chunk pattern (established this session — follow it exactly):**

1. Identify Notice sites: `grep -n "new Notice(" <file>`
2. Map each site to a key (skip pure dynamic pass-throughs like `new Notice(result.error)`).
3. Add keys to `src/i18n/types.ts` under the existing TranslationKey union.
4. Add canonical strings to `src/i18n/locales/en.json` under appropriate subspace.
5. Inject same English placeholders into the 9 other locales using a helper script under
   `.context/add-*-keys.sh` (Python json-load → setdefault → json-dump). Existing examples:
   `.context/add-chat-input-locale.sh`, `.context/add-conv-controller-keys.sh`,
   `.context/add-mcp-keys.sh`. These are throwaway helpers and stay gitignored under
   `.context/` per project convention.
6. Import `t` from `'../../../i18n/i18n'` (adjust relative path) in the source file.
7. Replace each `new Notice('foo')` with `new Notice(t('key.path'))`. Use
   `t('key', { param: value })` for interpolation.
8. Verify: `npm run typecheck && npm run lint && npm run test`. Build is optional per chunk.
9. Commit with conventional-commit subject `refactor(<scope>): land Q-1 chunk N (<file> Notice i18n)`.

**Subspace naming conventions used so far:**
- Chat-side: `chat.input.*`, `chat.history.*`, `chat.rewind.err*`
- Settings: `settings.mcp.*`
- Provider-specific: prefer `provider.<id>.<feature>.*` (none added yet)

### Deferred — needs explicit user direction before resuming

| Item | Status | Block / reason |
|------|--------|----------------|
| ADR-0001 Phase 2b — RuntimeHost migration | deferred | ~500 LOC mechanical refactor across 4 provider runtimes + `tabControllers` + 5 test files. Needs focused PR with own review attention. Type definition + cancel-dismiss invariant contract already documented in `src/core/runtime/RuntimeHost.ts`. |
| ADR-0001 Phase 3 — `core/transport/` extraction | blocked | `docs/superpowers/plans/2026-05-30-cursor-integration-hardening.md` PR2 still open (T5/T6/T8/T13/T14/T22/T25/T26/T27). Phase 3 must land after PR2 to avoid documented file-collision risk on `CursorChatRuntime.query`, ACP subprocess kill, and ACP transport pending-request cleanup. |
| Phase 1c F2 + F3 | deferred | F3 requires production vault measurement (one-off measurement session on a real ≥1000-message transcript with cold/warm OS cache). F2 (tune `YIELD_EVERY_PARSED_LINES` / `YIELD_EVERY_MERGED_ENTRIES`) depends on F3 data. |
| Q-4 | pending | Unit tests for `ClaudeApprovalHandler`, `AcpToolStreamAdapter`, `HomeFileAdapter`, `ClaudeRewindService`. Smoke + error paths + cancellation. ~4 new test files. |
| Q-7 | pending | Finish settings registry port: register 5 remaining tabs (~53 fields). Delete legacy fallback renderers. Tracked at `docs/issues/settings-registry-port-followup.md`. |
| Q-NEW-2 | pending | Cursor + Opencode test parity — approval handlers + MCP dispatch. |
| Phase 2b architecture residuals | opportunistic | ARC-5 residual: split `InputController.ts` (1464 LOC) along 3 seams. Plan recommends pairing with RuntimeHost work (Phase 2b) to amortize test churn. |

## How to resume

1. Open repo at `D:\Projects\claudian`. On `main` branch.
2. Check `git log --oneline -10` — top commit should be `c4ca6ad`.
3. Read this file + the plan doc (`docs/reviews/2026-06-02-codebase-review-and-improvement-plan.md`)
   to confirm state.
4. For Q-1 continuation: follow the chunk pattern above on the next file in the priority table.
   `OpencodeAgentSettings.ts` is the next chunk.
5. For any other item: refer to the plan doc's "Phased improvement plan" section + the
   "Test debt and perf" section in `docs/adr/0001-transport-agnostic-provider-seam.md`.

## Plan-doc edits (also part of this handoff)

Updated `docs/reviews/2026-06-02-codebase-review-and-improvement-plan.md`:
- Frontmatter `status` field reflects multi-phase shipped state.
- "Remaining issues" list marks OBS-* as shipped, Q-1 as partial, ADR-0001 P1+P2a as
  shipped + P2b/P3 status documented.
- New `### Phases 1a + 1b + 1c (F1+F4) + ADR P1 + ADR P2a + Q-NEW-1 + Q-1 partial — shipped`
  block under "Implementation status" with one row per commit.
- Phased improvement plan section headings annotated with shipped commits.

## CLAUDE.md / memory state

Nothing changed in `~/.claude/projects/D--Projects-claudian/memory/MEMORY.md` this session.
Existing entries (window-timer convention, lint-clean policy, release process, dev-build setup)
are still accurate.

## Throwaway helpers (stay in `.context/`)

The locale-injection helpers used for the Q-1 chunks are throwaway scripts and stay under
`.context/` per project convention:

- `.context/add-chat-input-locale.sh`
- `.context/add-conv-controller-keys.sh`
- `.context/add-mcp-keys.sh`
- `.context/add-claude-agent-load-key.sh`
- `.context/add-opencode-agent-keys.sh`
- `.context/add-slash-command-keys.sh`
- `.context/add-tab-controllers-keys.sh`

Each script is the locale-injection helper for the matching Q-1 chunk. They are idempotent
(setdefault-based), so re-running them is safe.

## One last context note

The user runs the project in caveman mode. All commit messages and code stay in normal
prose — caveman applies to chat replies only. Plan docs and handoff notes likewise stay
normal-prose so they are readable in any mode.
