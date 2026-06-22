# Agent Subsystem Improvement Pass — Implementation Plan

> Executed via subagent-driven development: one implementer subagent per increment, gates after each, a quality/spec review on the substantive increments, commit per increment. Derived from a 5-lens review (UX, accessibility, security/resilience, architecture, i18n/content) of PR #117.

**Branch:** `claude/ai-agents-plugin-research-ljdmgg` (PR #117).

**Decisions taken (user):** wire skills into bound chats; KEEP the provider dropdown visible (no change); include the pre-existing chat header + tab badges in the a11y pass; DEFER bulk translation (fix structural i18n bugs only).

**Global constraints:** no `console.*` / `innerHTML`; Obsidian DOM (`createEl`/`setIcon`); all user-facing strings via `t()`; `.claudian-` CSS prefix; quality ratchet (deadCodeIssues=0, boundaryViolations=0, clones/complexity ratcheted, MI floor) + LOC guard (cap 500) + per-dir coverage + perf must stay green; commit trailers (`Co-Authored-By` + `Claude-Session`); author `Claude <noreply@anthropic.com>`.

---

## Increment 1 — i18n structural fixes + copy

**Goal:** fix the real i18n bugs and copy issues (no bulk translation).

**Changes:**
- **BUG-1 (Critical):** in all 10 `src/i18n/locales/*.json`, change `provider.codex.skill.{deleted,updated,created}` from `${name}` to `{name}` (the engine only interpolates `{param}`).
- **BUG-2:** remove dead keys (no `t()` callers): `agentRoster.sectionIdentity`, `agentRoster.sectionAppearance`, `agentRoster.sectionRoles`, `agentRoster.fieldInstructions`, `skillLibrary.readOnlySuffix` — from the type unions (`src/i18n/types/agents.ts`, `toolLibrary.ts`) and all 10 locales. (Verify with grep first; `sectionModel`/`sectionInstructions` ARE used — keep them.)
- **BUG-3:** add `agentRoster.colorNone` = "None"; use it for the color `<option value="">` in `AgentDetailEditor.renderAppearanceRow` instead of `agentRoster.providerDefault`.
- **BUG-4:** `AgentRosterView.createAndEdit` — initial name `t('agentRoster.newAgent')` instead of literal `'New Agent'`; keep the dedup id-fragment suffix.
- **BUG-5:** `SkillLibraryView` freshly-created skill `providerDisplayName` — add `skillLibrary.providerVault` = "Vault" and use it.
- **COPY-3:** `agentRoster.capsSummary` → `"{skills} skills · {tools} tools"` (count precedes noun).
- **COPY-4:** `agentRoster.back` → `"Back"` (drop the inline "←"); the topbar back button keeps a leading chevron via `setIcon` if desired (optional, S).
- **COPY-5:** `agentRoster.fieldDescription` → `"Description"`.
- **COPY-1:** soften the `(s)` notices — reword to avoid count-coupled plurals where the count is already visible: `installStarterDone` → `"Installed {installed} starter agents · skipped {skipped} existing."` is still `(s)`-free-ish; simplest: keep numbers but drop the `(s)` by pluralizing to the common case, OR leave as-is if rewrite is awkward. (Low priority; apply the clean rewrite, don't add a plural engine.)

**Acceptance:** i18n parity tests pass; `agentBoardNoUntranslatedLiterals` passes; typecheck/lint/build green; grep shows no remaining `${` in locale strings and no refs to removed keys.

**Review:** I verify (run i18n parity + grep) — contained, mechanical.

---

## Increment 2 — Architecture extractions + tests

**Goal:** pull load-bearing logic out of `main.ts`/views into pure, tested units (Arch #1, #2, #6).

**Changes:**
- **`src/features/agents/roster/resolveAgentProvider.ts` (new):** `resolveAgentPreferredProvider(agent, settings, registry-statics): ProviderId` encoding "preferred = `providerOverride ?? modelSelection?.providerId`; use if enabled else settings default". Replace the 3 duplicated sites: `main.ts:resolveAgentRunTarget`, `AgentRosterView.resolveAgentProvider`, and the defaulting in `AgentDetailEditor.renderModelCard`. Unit-test the enabled/disabled/fallback matrix.
- **`src/features/tools/scopedTools.ts` (new):** pure `getScopedTools(loaded: LoadedTool[], grantedToolIds?: string[]): LoadedTool[]` and `scopedToolKey(loaded, grantedToolIds?): string` (sorted-name fingerprint). `main.ts` `getScopedClaudianTools`/`getClaudianToolKey`/`getClaudianToolServer` delegate to them. Unit-test: grant-empty=all, partial grant, errored/no-module excluded, fingerprint order-independence/stability.
- **`BoundAgentProjection` type:** name the `{ prompt?; model?; tools?; skills? }` shape returned by `resolveBoundAgent` (export from a roster module; consume in `InputController`).

**Acceptance:** new unit tests pass; the 3 provider-pref sites + the 3 tool methods now delegate; behavior identical; `main.ts` LOC drops; gates green.

**Review:** spec + quality subagent (load-bearing for live MCP correctness).

---

## Increment 3 — Tool registry concurrency + resilience logging

**Goal:** Sec #1 (High), #4, #5(log part), Arch #8.

**Changes:**
- **`ClaudianToolRegistry.load()`:** build into a local `Map` and atomically swap into `this.tools` at the end; serialize overlapping loads (chain on a `private loading: Promise<void>`), so a burst of vault `modify` events can't clear/interleave the map. Add a unit test simulating two concurrent `load()`s → final map complete, no false duplicate errors.
- **`AgentRosterStore.list()/get()`:** log malformed-JSON drops via `plugin.logger.scope('agents')` (pass a logger in, or accept an `onError` callback — keep the store framework-light; wire the logger from the caller). Don't change the silent-skip behavior, just make it diagnosable.
- **`rosterAgentProjection.projectAgentToProvider`:** the `catch {}` should surface the error to an injected logger/sink before swallowing (thread an optional `onError` through `projectRosterAgentsToProviders`).

**Acceptance:** concurrency test passes; logging present; gates green.

**Review:** spec + quality subagent (concurrency correctness).

---

## Increment 4 — Agent icons render

**Goal:** UX H2 — restore per-agent icons (presets + user choice).

**Changes:**
- `AgentPersona` (`src/features/agents/agentTypes.ts`): add `icon?: string`.
- `rosterAgentToPersona` (`personaRegistry.ts`): pass `icon: agent.icon` through.
- `renderAgentAvatar` (`agentAvatar.ts`): when `persona.icon` is set, render it via `setIcon` (icon takes precedence over initials; builtin `cpu` path unchanged). Keep `data-icon` test hook.
- `AgentDetailEditor.renderAppearanceRow`: add an icon picker (a small set of Lucide names, or a text field with a curated dropdown) writing `draft.icon`; include in dirty tracking (add `icon` to `rosterDirty` SCALAR_KEYS). New i18n key `agentRoster.icon` = "Icon" (+ option labels if a dropdown).
- Avatar test: assert icon rendering path.

**Acceptance:** preset agents show their icons in cards/header/tabs; user can pick an icon; dirty tracks it; gates green.

**Review:** quality subagent.

---

## Increment 5 — Skills wired into bound chats

**Goal:** UX C1 — granted skills actually apply to a bound chat (decision: wire them).

**Approach (provider-agnostic, reuses the existing `boundAgentPrompt` seam consumed by all 4 providers):** fold the granted skills into the bound prompt.
- Extend `BoundAgentPersonaInput` with `skills?: Array<{ name: string; description?: string }>`; `formatBoundAgentPersona` appends a block: e.g. `"You have these skills available — use them when relevant:\n- {name}: {description}"`. Empty/absent → no block. Unit-test the formatter with/without skills.
- `main.ts:resolveBoundAgent` (already async): resolve the agent's `skills` names against the vault skill aggregator (`vaultSkillAggregator.listAll()` → name + description), pass the matched entries into `formatBoundAgentPersona`. Names with no catalog match are still listed by name (no description). Keep `tools` scoping unchanged.
- Reflect in the `BoundAgentProjection` type from Increment 2.

**Acceptance:** a bound chat whose agent has granted skills gets a skills section in its system prompt (verifiable via the formatter unit test + a `resolveBoundAgent`/projection unit test with a mocked aggregator); no behavior change when no skills granted; gates green.

**Review:** spec + quality subagent (runtime behavior change).

---

## Increment 6 — Agent delete reconciles projected provider files

**Goal:** UX H3 / Sec #3 — deleting (or re-syncing) a roster agent must not orphan `.claude/.codex/.cursor/.opencode/agents/*` files.

**Changes:**
- **`src/app/rosterAgentProjection.ts`:** add `projectedAgentPaths(agent, providerIds): string[]` (reuse each provider's `ProviderRegistry.projectRosterAgent(...).path`) and `removeProjectedAgent(slug, providerIds, adapter)` (best-effort delete each path, isolate failures, report). Unit-test path computation + isolation.
- **`AgentRosterView.deleteAgent`:** after `store.delete`, also remove the projected files for that agent across the enabled/registered providers (via the plugin seam, mirroring `syncRosterAgentsToProviders`). Add a `plugin.removeRosterAgentProjection(agent)` method analogous to `syncRosterAgentsToProviders`.
- Add a short explanatory tooltip/help to the "Sync to providers" button (i18n) clarifying it writes provider subagent files (addresses the H3 "unexplained" half).

**Acceptance:** deleting an agent removes its projected provider files; unit tests for path computation + isolation; gates green.

**Review:** spec + quality subagent (filesystem lifecycle).

---

## Increment 7 — New-agent draft + UX feedback

**Goal:** UX H5 (no empty persist), H4 (binding reversibility hint), M9 (loading), M10 (start-chat-uses-draft).

**Changes:**
- **No empty persist:** `AgentRosterView.createAndEdit` opens the detail editor on an **in-memory** new agent (not yet saved); the editor persists on first Save (the dirty/back-guard already exists). On Back without save, nothing is written. (Confirm the editor's save path handles a never-saved agent — it calls `store.save`, fine.)
- **Binding hint:** the header bound-agent chip gets a `title`/tooltip already; add an explicit hint that to change the agent you start a new chat (i18n `agentRoster.bindingHint`), surfaced on the chip tooltip.
- **Loading states:** `AgentRosterView.renderList`, the Skills card in `AgentDetailEditor`, and `SkillLibraryView` render a brief loading placeholder before the `await` resolves, replaced by list/empty after. (Shared helper in `libraryView.ts`, i18n `common.loading` or reuse.)
- **Start-chat-when-dirty:** in `AgentDetailEditor`, when dirty, the footer "Start chat" gets a tooltip noting it launches the saved version (i18n), OR disable it when dirty. (Pick the tooltip — less disruptive.)

**Acceptance:** abandoning a new agent leaves no file; loading states visible on slow vaults; tooltips present; gates green.

**Review:** quality subagent.

---

## Increment 8 — Accessibility: agent / library components

**Goal:** the a11y findings in the new components.

**Changes (attributes + small DOM, no behavior change):**
- **CapabilityPicker:** header `aria-expanded` (synced on toggle) + `aria-controls`; chip = real remove button with `aria-label` = `t('agentRoster.removeCapability',{name})` and the click target the whole chip is fine if labeled; list `role="group"` + `aria-label`=label; search `aria-label`; move focus to search on expand.
- **AgentDetailEditor:** `aria-label` on name/description/initials inputs, color `<select>`, and the instructions `<textarea>`; role chips `aria-pressed` (synced); dirty indicator `aria-live="polite"` and kept in the a11y tree (toggle via class, not `display:none` removal, OR add `role="status"`).
- **AgentRosterView card:** `aria-label` = agent name on the `role="button"` card; resolve the nested-interactive-in-`role=button` issue (make the card a `role="group"` with the open action on a labeled element, OR keep card clickable but move Start/Delete out of the button's accessible name via structure). Keep keyboard open (Enter/Space) working.
- **libraryNav:** `role="navigation"` + `aria-label`; active item `aria-current="page"`.
- **libraryView modal fields (`renderModalLabel`/`renderModalTextField`/`createModalCodeArea`):** associate label↔input via `for`/`id` or `aria-labelledby`.
- **Status chips (tool ready/error):** add a non-color cue (icon or text prefix already present — ensure not color-only).
- **`accessibility.css`:** focus-visible rings for `.claudian-cap-picker-chip`, `.claudian-roster-role-chip`.
- New i18n keys as needed (`agentRoster.removeCapability`, `agentRoster.openAgent`, `agentRoster.colorLabel`, etc.).

**Acceptance:** keyboard + SR operability of the new components; gates green. (Views are manual-UI; where logic helpers are added, test them.)

**Review:** quality subagent (+ a focused a11y re-check).

---

## Increment 9 — Accessibility: chat header + tab badges

**Goal:** the pre-existing header/tab keyboard gaps (decision: include).

**Changes:**
- **Header action buttons** (`ClaudianView.buildNavRowContent` / `buildHeader`): the `.claudian-header-btn` `div`s (quick actions, new tab, new conversation, history) become keyboard-operable — `role="button"` + `tabindex="0"` + Enter/Space handlers (or switch to `createEl('button')` with `.claudian-header-btn` styling). History button: `aria-haspopup` + `aria-expanded` synced with the dropdown; dropdown `role="menu"`/`listbox` as appropriate.
- **Bound-agent chip:** `aria-label` on the chip (the "chatting with {name}" message); avatar inside `aria-hidden`.
- **Tab badges** (`TabBar.renderBadge`): `role="button"` (or `tab`) + `tabindex="0"` + Enter/Space → `onTabClick`; `aria-current`/`aria-selected` on the active badge; a keyboard-accessible close affordance (small close button on closeable badges, or `aria-keyshortcuts` + a documented shortcut); inner icon spans `aria-hidden`. Active tab gets a non-color differentiator (e.g. underline/inset) in `tabs.css`. Keep `renderBadge` under the complexity ceiling (extract helpers if needed — it was just refactored).
- Extend the existing `TabBar` unit tests for the new aria attributes + keyboard activation.

**Acceptance:** header + tabs fully keyboard-operable; active states announced; TabBar tests cover the new behavior; gates green (watch `renderBadge` complexity + ClaudianView/TabManager LOC).

**Review:** spec + quality subagent.

---

## Deferred (documented in `docs/tech-debt/2026-06-19-agent-roster-tools-skills-followups.md`)

- Bulk translation: ~837 locale entries + 8 preset prompts (English-only).
- Atomic file writes (temp+rename) for the roster/conversation JSON stores (Sec #5).
- HTTP tool-server in-flight-request drain before `rebuild()` (Sec #2 — needs an Opencode runtime to validate).
- Projecting tool-grant restrictions into provider subagent `tools`/`disallowedTools` (Sec #6 — least-privilege parity between bound-chat and @-mention paths).
- Turn-cancel → running-tool abort when the MCP host omits a signal (Sec #7).
- `getDisplayText`/ribbon/command i18n (needs re-registration on locale change) (BUG-6).
- Library-shell unification of `AgentRosterView` onto `renderLibraryShell`/`createLibraryCard` (Arch #3 / UX M8) — medium refactor, lower urgency.

---

## Execution order & cadence

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. After each increment: full fast gates (typecheck, lint, check:loc, check:quality) + the relevant tests; a heavier sweep (full test, coverage, perf) batched at natural points; commit per increment; push periodically. Substantive increments (2, 3, 5, 6, 9) get a spec+quality review subagent; contained ones (1, 4, 7, 8) get a quality review or controller verification. A final whole-pass review at the end.
