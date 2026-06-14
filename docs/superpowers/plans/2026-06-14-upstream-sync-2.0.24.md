---
title: Upstream Sync to YishenTu/claudian 2.0.24
date: 2026-06-14
status: proposed
scope: shared/mention, chat-rendering, inline-edit, settings, providers/opencode
parent: Infrastructure
---
# Upstream Sync to YishenTu/claudian 2.0.24 — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks 2–4 are **awaiting maintainer approval** — do not start them until the owner picks them up (the `Quick win now + plan the rest` decision on 2026-06-14 only authorised Task 1).

**Goal:** Continue the selective upstream sync from `YishenTu/claudian`. The previous pass took us to a selective **2.0.21** baseline (`docs/superpowers/plans/2026-06-01-upstream-sync-2.0.21.md`). Upstream is now at **2.0.24**; this plan triages the 2.0.22 → 2.0.24 delta (8 PRs) and ports the parts that apply to our diverged `Luis85/claudian` (claudian-cursor) fork without disturbing fork-only surfaces (Cursor provider, Agent Board, Context Trust Envelope, split Tab modules, perf suite).

**Architecture:** Our fork is a multi-provider product (Claude, Codex, Opencode, Cursor) at v3.5.0; it is *not* an upstream mirror. We cherry-pick high-value fixes / small features and park the rest. Of the 8 upstream PRs:

- **Adopt:** #748 (mention spaces — **done in this PR**), #767 (expand Write/Edit diffs setting — fork-adapted), #776 (OpenCode hydration robustness — conditional on Windows support).
- **Verify-then-decide:** #761 (inline-edit Accept/Reject visibility — confirm the Intel-Mac bug reproduces on our widget architecture first).
- **Skip:** #760 (Pi-only), #777 (mostly Pi), #778 (CSS divergence), #779 (infra we already own). Rationale in the Appendix.

**Tech Stack:** Git, TypeScript, esbuild, Jest, Obsidian plugin API, npm.

**Fidelity caveat:** The upstream change details below were derived from PR descriptions and release notes (web), **not** line-level diffs — our GitHub tooling is scoped to `Luis85/claudian`. Task 0 therefore adds an `upstream` remote and resolves the real squash-merge commits before any port. Treat the per-task code shapes as direction, and reconcile against the actual upstream diff during implementation.

**Out of scope:** #760 (unify Pi model picker style), #777 (provider TypeScript warnings — Pi-heavy), #778 (remove `!important` style overrides), #779 (pin Node version), README sponsor section. See Appendix.

---

## Delta triage (2.0.22 → 2.0.24)

| Upstream PR | Summary | Fork applicability | Verdict | Task |
|---|---|---|---|---|
| #748 | allow spaces in @mentioned filenames | We carried the identical `/\s/` gate in `MentionDropdownController` | **Adopt** | Task 1 (done) |
| #767 | expand Write/Edit diffs by default (setting); shared display-text extraction | No expand-diff setting today; the display-text-from-wrappers half overlaps our Context Trust Envelope | **Adopt the setting only** | Task 2 |
| #776 | stabilize OpenCode history hydration (dedicated SQLite reader, `module.require` + spawned-Node fallback, 100MB maxBuffer) | We use `await import('node:sqlite')` (the renderer dynamic import #776 replaces) + a `sqlite3` CLI probe | **Adopt if Windows / large-session support matters** | Task 3 |
| #761 | render inline-edit diffs as markdown; fix Accept/Reject buttons missing (Intel Mac, #734) | Our `InlineEditModal` uses a different CodeMirror-widget architecture; already has `hideSelectionHighlight` + accept/reject buttons | **Verify #734 reproduces, then adopt or skip** | Task 4 |
| #760 | unify Pi model picker style | No Pi provider | **Skip** | Appendix |
| #777 | resolve provider TypeScript warnings | Mostly Pi; rest is minor Claude assertion cleanup | **Skip** | Appendix |
| #778 | remove `!important` style overrides | Our CSS is heavily diverged (Cursor, Agent Board) | **Skip / own pass** | Appendix |
| #779 | pin Node version for reproducible releases | We own `release.mjs` / `sync-version.js` | **Skip** | Appendix |

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify (done) | `src/shared/mention/MentionDropdownController.ts` | Remove `/\s/` gate; close on zero default-path matches (Task 1) |
| Modify (done) | `tests/unit/shared/mention/MentionDropdownController.test.ts` | Spaces-allowed + zero-match regression tests (Task 1) |
| Modify | `src/core/types/settings.ts` | Add `expandWriteEditDiffsByDefault: boolean` (Task 2) |
| Modify | `src/app/settings/defaultSettings.ts` | Default the new setting to `false` (Task 2) |
| Modify | `src/features/settings/registry/fields/general.ts` | Toggle field for the new setting (Task 2) |
| Modify | `src/features/settings/ClaudianSettings.ts` | Legacy renderer fallback toggle (Task 2, until v4.0.0 deletion) |
| Modify | `src/i18n/**` | `settings.expandWriteEditDiffsByDefault.{name,desc}` across 10 locales (Task 2) |
| Modify | `src/features/chat/rendering/WriteEditRenderer.ts` | Honor setting for stored (`:110`) + streaming (`:220`) `isExpanded` defaults (Task 2) |
| Modify | `src/features/chat/rendering/applyPatchExpandedHelpers.ts` (+ Codex apply_patch render path) | Apply same default to Codex apply_patch diffs (Task 2) |
| Modify | `tests/unit/features/chat/rendering/WriteEditRenderer.test.ts` (+ apply_patch test) | Expanded-by-default coverage, both paths (Task 2) |
| Modify | `src/providers/opencode/history/OpencodeHistoryStore.ts` | Replace `await import('node:sqlite')` with `module.require` + spawned-Node fallback; 100MB maxBuffer (Task 3) |
| Create | `src/providers/opencode/history/opencodeSqliteReader.ts` (name TBD) | Dedicated reader extracted per upstream #776 (Task 3) |
| Modify | `tests/unit/providers/opencode/history/OpencodeHistoryStore.test.ts` | Node child-process hydration + buffered sqlite3 fallback (Task 3) |
| Modify | `src/features/inline-edit/ui/InlineEditModal.ts` | Explicit preview action buttons; markdown diff block (Task 4, conditional) |
| Modify | `src/style/features/inline-edit.css` | Preview-action button styling (Task 4, conditional) |
| Modify | `tests/unit/features/inline-edit/ui/InlineEditModal.openAndWait.test.ts` | Preview-button + fenced-code diff coverage (Task 4, conditional) |

---

## Task 0: Branch, baseline, resolve upstream SHAs

**Files:** none (setup only).

- [ ] **Step 1: Clean tree + green baseline**
  ```bash
  git status
  npm run typecheck && npm run lint && npm run test && npm run build
  ```
  If anything is red, fix on `main` first.

- [ ] **Step 2: Add the upstream remote and fetch tags**
  ```bash
  git remote add upstream https://github.com/YishenTu/claudian.git 2>/dev/null || true
  git fetch upstream --tags
  ```

- [ ] **Step 3: Resolve the real squash-merge commit for each PR**
  ```bash
  for pr in 748 760 761 767 776 777 778 779; do
    echo "PR #$pr:"; git log upstream/main --oneline --grep "#$pr" | head -3
  done
  ```
  Record the SHAs; capture each diff into `.context/` (throwaway) before porting, e.g.
  ```bash
  git show <sha-767> > .context/upstream-767.patch
  ```

---

## Task 1: #748 — spaces in @mentioned filenames (DONE in this PR)

Completed on branch `claude/gallant-gauss-e6ervq`. Recorded here for traceability.

- Removed the `/\s/` whitespace gate in `MentionDropdownController.handleInputChange` so multi-word filenames (e.g. `@test file 2.md`) stay searchable (`buildVaultItems` matches via `.includes(searchLower)`).
- Added a zero-results auto-close in `populateDefaultItems` (first-level path) so prose that merely contains an `@` no longer keeps an empty dropdown open. Submenu paths (`@agents/`, `@folder/`) keep their existing "No matches" affordance.
- Tests: `@mention filenames with spaces (#748)` — multi-word match stays open; multi-word no-match auto-closes. Existing `space follows @mention` test retargeted to assert the no-match close.

No further action.

---

## Task 2: #767 — expand Write/Edit diffs by default (setting only)

> **Status: DONE** (PR #100). `expandFileEditsByDefault` setting (type + default `false` + registry field + legacy toggle + 10 i18n locales, copied verbatim from upstream `65ca3ec5`). `initiallyExpanded` threaded through `WriteEditRenderer` (streaming + stored) and the generic `ToolCallRenderer` (gated to Codex `apply_patch` at the StreamController/MessageRenderer call sites). Upstream's display-text-from-context-wrappers half intentionally skipped — the Context Trust Envelope owns it here.

**Adopt scope:** the user-facing setting that defaults Write/Edit (and Codex `apply_patch`) diffs to expanded, across stored + streaming render paths. **Do not** port upstream's "derive display text from hidden context wrappers / shared display-content extraction" — our **Context Trust Envelope** (`docs/superpowers/specs/2026-06-07-context-trust-envelope.md`) already owns that concern differently; porting it would conflict.

- [ ] **Step 1: Read the real upstream diff** (`.context/upstream-767.patch`) and confirm which hunks are the setting vs. the wrapper-extraction (skip the latter).

- [ ] **Step 2: Add the setting**
  - `src/core/types/settings.ts`: add `expandWriteEditDiffsByDefault: boolean;` (near `requireCommandOrControlEnterToSend`, `:175`).
  - `src/app/settings/defaultSettings.ts`: add `expandWriteEditDiffsByDefault: false,` (near `:38`).

- [ ] **Step 3: Surface it in settings UI**
  - `src/features/settings/registry/fields/general.ts`: add a toggle field mirroring the `requireCommandOrControlEnterToSend` entry (`:368`).
  - `src/features/settings/ClaudianSettings.ts`: add the legacy fallback toggle (`:432` pattern) until the v4.0.0 imperative-renderer deletion.
  - i18n: add `settings.expandWriteEditDiffsByDefault.{name,desc}` to all 10 locale catalogs under `src/i18n/`.

- [ ] **Step 4: Honor the setting in `WriteEditRenderer.ts`**
  - Two render paths default `isExpanded: false` (`:110` stored, `:220` streaming). Thread the setting through the existing renderer context (read the call sites in `MessageRenderer.ts` to see whether settings already reach the renderer; if not, pass a `expandWriteEditDiffsByDefault` flag through the render-context object rather than importing the plugin).
  - `setupCollapsible` already accepts an initial expanded state — pass the resolved default into it.

- [ ] **Step 5: Apply the same default to Codex `apply_patch` diffs**
  - `applyPatchExpandedHelpers.ts` + its Codex render call site. Confirm the same flag governs the initial expand.

- [ ] **Step 6: Tests** (`tests/unit/features/chat/rendering/WriteEditRenderer.test.ts` + apply_patch test)
  - Setting `false` → collapsed (current behavior unchanged).
  - Setting `true` → expanded on both stored and streaming paths, and for Codex `apply_patch`.

- [ ] **Step 7: Verify** `npm run typecheck && npm run lint && npm run test && npm run build`, then perf (`npm run test:perf`) — `messageRenderer.perf` must stay within its window (expanding by default mounts more DOM per Write/Edit card; confirm the guard still passes).

- [ ] **Step 8: Commit** `feat(chat): add setting to expand Write/Edit diffs by default (upstream #767, setting only)`

**Effort:** S–M. **Risk:** low (additive, defaulted off). Recommended next pickup.

---

## Task 3: #776 — OpenCode history hydration robustness (conditional)

> **Status: core fixes DONE** (PR #100). Ported the two high-value robustness wins **in place** (the fork's store diverged ~248 lines from upstream pre-#776 and carries a second sqlite-reading path — `loadOpencodeLastAssistantData` — so a full reader extraction was higher-risk than warranted; both reading paths share the hardened helpers):
> 1. `requireSqliteModule()` via `module.require('node:sqlite')` (renderer-safe) replacing `await import('node:sqlite')`.
> 2. `OPENCODE_SQLITE_QUERY_MAX_BUFFER` (100MB) + `windowsHide` on the `sqlite3` CLI spawn — the direct ENOBUFS fix for #775.
>
> **Deferred follow-up:** the spawned-Node middle tier (`loadSessionRowsWithNodeProcess` via `findNodeExecutable` + child script). It is purely additive (a third fallback between in-process node:sqlite and the sqlite3 CLI) and the module.require + maxBuffer fixes already address #775's reported symptom; deferred to keep the diverged-store change low-risk and because the tier is hard to unit-test in place without DI. Track separately if a real-world session still fails to hydrate.

**Adopt if** Windows and/or large OpenCode session support matters to fork users. Upstream replaces a renderer-side dynamic SQLite import with a `module.require` + spawned-Node reader and adds a 100MB `maxBuffer` to dodge ENOBUFS on large sessions (issue #775). Our store already has the relevant seam: `loadSqliteModule` does `await import('node:sqlite')` (`OpencodeHistoryStore.ts:406`), with a `sqlite3` CLI probe (`:419`) and `spawnSync` already imported (`:1`). This builds on our prior #713 large-metadata guard.

- [ ] **Step 1: Read `.context/upstream-776.patch`** and our `OpencodeHistoryStore.ts` side by side. Map upstream's reader to our `loadOpencodeSessionRows` / `loadSqliteModule` functions.

- [ ] **Step 2: Replace renderer dynamic import** Swap `await import('node:sqlite')` for `module.require('node:sqlite')` (renderer-safe), keeping the `sqlite3` CLI path as buffered fallback. Extract the reader into `opencodeSqliteReader.ts` if it clarifies the store.

- [ ] **Step 3: Add the spawned-Node fallback** When neither in-process path is available, spawn `process.execPath` to run a tiny query script; set `maxBuffer: 100 * 1024 * 1024`.

- [ ] **Step 4: Tests** Cover (a) Node child-process hydration path and (b) buffered `sqlite3` fallback, mirroring upstream's additions, adapted to our store's signatures. Keep the existing #713 large-metadata regression cases passing.

- [ ] **Step 5: Verify** full gate + `conversationHistory`/opencode perf specs unaffected.

- [ ] **Step 6: Commit** `fix(opencode): harden history hydration with module.require + spawned-node fallback (upstream #776)`

**Effort:** M. **Risk:** medium (Electron renderer require semantics differ across Obsidian versions; verify on Windows). Defer if no Windows users.

---

## Task 4: #761 — inline-edit Accept/Reject visibility (verify first)

Upstream #761 fixes issue #734 (*Accept/Reject buttons do not appear, Intel Mac x86_64*) by replacing inline glyph button widgets with explicit preview-action buttons, hiding the original selected range during preview, and rendering the diff as a markdown block. **Our `InlineEditModal` diverges**: it uses `PreviewWidget`/`DiffWidget`/`InputWidget` CodeMirror decorations, already calls `renderInlineEditMarkdownPreview` (from the 2.0.21 sync), and already toggles `hideSelectionHighlight`/`showSelectionHighlight`. The fix may not be needed, or may need a different shape.

- [ ] **Step 1: Reproduce / root-cause** Determine the upstream root cause from `.context/upstream-761.patch` (why the glyph-button widget failed to mount on x86_64). Check whether our `InputWidget`/`DiffWidget` mount path has the same flaw (e.g., a widget that renders buttons conditionally on a layout measurement). If our architecture cannot exhibit the bug, **stop and record SKIP** with the reasoning in `docs/reviews/`.

- [ ] **Step 2 (only if reproduced): Port adapted** Move accept/reject controls into the preview block as explicit buttons rather than relying on the inline glyph widget; ensure the diff renders as a fenced markdown block; keep Cursor/other-provider inline-edit paths intact.

- [ ] **Step 3 (only if reproduced): Tests** Preview action buttons present + wired; fenced-code markdown diff renders. Extend `InlineEditModal.openAndWait.test.ts`.

- [ ] **Step 4: Verify** full gate.

- [ ] **Step 5: Commit** `fix(inline-edit): keep Accept/Reject controls visible in markdown diff preview (upstream #761)` — or record the SKIP review note.

**Effort:** M–L (or zero if not reproduced). **Risk:** medium — touches the diverged inline-edit widget core. **Do not port blind.**

---

## Appendix: Explicitly skipped

| PR | Why skipped |
|---|---|
| #760 unify Pi model picker style | No Pi provider in the fork. |
| #777 resolve provider TypeScript warnings | Predominantly Pi (JSONL listeners, Pi chat UI); the residual Claude assertion cleanups are cosmetic and our TS/lint baseline is already green. Optionally cherry-pick only the Claude-only hunks if they apply cleanly. |
| #778 remove `!important` style overrides | Our CSS diverged substantially (Cursor styling, Agent Board redesign). Porting upstream's selector-specific replacements risks regressions; do a fork-owned `!important` audit instead if desired. |
| #779 pin Node version for reproducible releases | We own our release tooling (`scripts/release.mjs`, `scripts/sync-version.js`); adopt the Node pin independently only if our CI needs it. |
| README sponsor section | Different project identity. |

---

## Self-Review Notes

Coverage check, per upstream PR in the 2.0.22 → 2.0.24 delta:

| Upstream PR | Disposition |
|---|---|
| #748 mention spaces | Task 1 — **done in this PR** |
| #767 expand diffs setting | Task 2 — adopt setting only (skip wrapper-extraction; Context Trust Envelope owns it) |
| #776 OpenCode hydration | Task 3 — conditional on Windows/large-session support |
| #761 inline-edit Accept/Reject | Task 4 — verify #734 reproduction first |
| #760 / #777 / #778 / #779 | Appendix — skip with rationale |

Recommended order once approved: **Task 2** (clean, low-risk, high-value) → **Task 3** (if Windows matters) → **Task 4** (only if reproduced). Each task is independently shippable behind its own PR; none depends on another.
