---
title: Codebase Review & Improvement Plan
date: 2026-06-02
updated: 2026-06-03
status: phases-1a-1b-1c-shipped + adr-p1-p2a-shipped + q-new-1-shipped + q-1-partial
version: v3.2.0 (just shipped)
scope: whole-codebase (architecture, concurrency, security, performance, quality, Obsidian conformance, backlog reconciliation)
method: 7 parallel dedicated review passes (architecture, concurrency/lifecycle, security, performance, code quality + testing, Obsidian API conformance, backlog reconciliation) against `main` at 9541ab9
supersedes: docs/reviews/2026-05-31-codebase-review-and-improvement-plan.md (incorporates remaining open items)
related:
  - "[[docs/adr/0001-transport-agnostic-provider-seam.md]]"
  - "[[docs/reviews/2026-05-31-codebase-review-and-improvement-plan.md]]"
---

# Claudian Codebase Review & Improvement Plan — 2026-06-02

Second consolidated review after the 2026-05-31 plan and v3.2.0 ship. Goal: keep the bar for
**robust, stable, high-quality** while closing the live user-reported performance regression and
finishing the architecture/Obsidian-conformance work the prior plan deferred.

## Overall verdict

The 2026-05-31 plan executed well. **Phase 0 (CI + lifecycle), Phase 1a (security), Phase 1b
(stream-time performance), and Phase 2 architecture (ARCH-1/-2/-3/-4/-5a/-5b/-6/-7/-8 + Q-2)
all landed.** Phase 3 guardrails landed. Madge cycles dropped 181 → 52. Zero `console.*`, zero
`@ts-ignore`, zero new `as any`, zero lint warnings.

Remaining issues are **narrow but real**:

1. ~~**CON-3 Codex readline leak**~~ — **shipped 2026-06-03 (commit `5011dde`).** ADR-0001
   Phase 3 is now unblocked.
2. ~~**PERF-4 long-chat-load freeze**~~ — **shipped 2026-06-03 (commit `1e7a02e`).** Event-loop
   yields added every 100 parsed lines / 50 merged entries via `setTimeout(0)`. Trade-off
   surfaced: total wall-clock grows with N (PERF-8 metric); individual frames stay responsive.
   F1 + F4 follow-ups shipped 2026-06-03 (`1bc8483`); F2 + F3 still deferred (need prod vault
   measurement).
3. **Q-1 Notice i18n regressed** — 137 → 214 hardcoded `new Notice()` (56% increase since the
   2026-05-31 baseline). **Partially shipped 2026-06-03:** chunks 1+2+3 routed
   InputController (`aef981c`), ConversationController (`86b93a0`), McpSettingsManager
   (`c4ca6ad`) — ~45 sites done. Remaining: OpencodeAgentSettings (14), AgentSettings claude
   (11), tabControllers (11), SlashCommandSettings (10), CodexSubagentSettings (9), main.ts (9),
   AgentBoardView (9), CodexSkillSettings (6), EnvSnippetManager (6), InputToolbar (6),
   ClaudianView (6), and ~70 others. Lint rule blocking new `new Notice()` still pending.
4. **Q-4 four untested security paths** — `ClaudeApprovalHandler`, `AcpToolStreamAdapter`,
   `HomeFileAdapter`, `ClaudeRewindService` still have **zero** unit tests.
5. ~~**OBS-1/-2/-3/-4/-5 entirely deferred**~~ — **all shipped 2026-06-03** (Phase 1a,
   `3b57e33`).
6. ~~**ADR-0001 Phases 1–3 gated on CON-3**~~ — **gate cleared 2026-06-03.** Phase 1 shipped
   (`4335655`), Phase 2a shipped (`2c6f67e`, rewind optional + RuntimeHost type defined).
   Phase 2b RuntimeHost migration deferred for focused PR (~500 LOC). Phase 3 blocked on
   cursor-hardening PR2.

---

## Implementation status

### Phase 0 — shipped 2026-06-03

| Item | Commit | Notes |
|------|--------|-------|
| **CON-3** | `5011dde fix(codex): close readline interface on transport dispose` | `rl` now a private field on `CodexRpcTransport`; closed + nulled in `dispose()`. Behaviour test in `tests/unit/providers/codex/runtime/CodexRpcTransport.test.ts` asserts handler count stays at 1 after `dispose()` even when stream pushes more data. **Unblocks ADR-0001 Phase 3.** |
| **PERF-4** | `1e7a02e fix(claude): yield event loop during long-session hydration` | `YIELD_EVERY_PARSED_LINES = 100` in `src/providers/claude/history/sdkSessionPaths.ts`; `YIELD_EVERY_MERGED_ENTRIES = 50` in `src/providers/claude/history/ClaudeHistoryStore.ts`. Yields via `await new Promise(r => window.setTimeout(r, 0))`. Final-iteration guard avoids extra delay. Output unchanged (same messages, same order, same `skippedLines`). |
| **PERF-8** | `c9c5f03 test(perf): add conversation-load hydration gate` | `tests/perf/conversationLoad.perf.test.ts`. Scales `[50, 200, 800, 2000]`. Asserts message-count invariants; reports `loadMs` for trend tracking (not asserted). Catches O(N²) duplication and silent message drops. |

**Verification at ship time:** typecheck pass, lint pass (0 warnings), unit suite 6382 pass / 35 skipped / 347 suites, perf suite 12 pass / 7 suites, build pass.

**Trade-off surfaced (informational, not a regression):** PERF-8 metrics table shows wall-clock
grows with yield count — ~1.7s at N=4000 entries in mocked-fs Jest vs ~24ms without yields.
Individual frames stay ≤16ms responsive (PERF-4's contract); total load extends. Production fs
I/O overlap likely reduces the stark gap. Tuning + measurement tracked as **Phase 1c**.

### Phases 1a + 1b + 1c (F1+F4) + ADR P1 + ADR P2a + Q-NEW-1 + Q-1 partial — shipped 2026-06-03

| Phase / item | Commit | Notes |
|---|---|---|
| **Phase 1a OBS-1..5** | `3b57e33 refactor(obsidian): land Phase 1a conformance sweep (OBS-1..5)` | OBS-1: defer `ProviderWorkspaceRegistry.initializeAll` to `app.workspace.onLayoutReady`; git watcher stays sync because restored views read `gitStatusWatcher` synchronously; restored views reprobed via `refreshProviderAvailability` after deferred init. OBS-2: extract `app.setting` / `app.hotkeyManager` access into `src/utils/obsidianPrivateApi.ts` with feature-detecting wrappers. OBS-3: replace `EnvSnippetManager.ts:379` cast with `leaf.loadIfDeferred()` + new `isClaudianView` predicate at `src/features/chat/isClaudianView.ts`. OBS-4: `AgentBoardView.applyNoteChange` to atomic `vault.process`. OBS-5: wrap `ClaudianView` vault.on handlers in `registerEvent`; retire manual `eventRefs[]` + `offref` cleanup. |
| **Phase 1c F1 + F4** | `1bc8483 refactor(claude/history): land Phase 1c F1+F4 (PERF-4 follow-ups)` | F1: move yield check above the three early-continue paths in `loadSDKSessionMessages` merge loop so cadence ties to raw iteration count regardless of skip clustering. New unit test in `tests/unit/utils/sdkSession.test.ts` feeds 500 consecutive synthetic-assistant skip entries and asserts scheduler progress still occurs. F4: rewrite the long-chat issue acceptance section — per-frame responsiveness (shipped contract) split from total-load wall-clock (tracked via PERF-8 `loadMs`, not gated). |
| **Phase 1b UX-1..4** | `e2f389a feat(chat): land Phase 1b UX polishing (UX-1..4)` | UX-1: active tab badge fills with `--interactive-accent` background + bold weight. UX-2: `needsAttention` flag wired in all four blocking-input flows in `InputController` (approval, ask-user, exit-plan-mode, post-plan approval); CSS adds a pulsing red dot bottom-left of the badge. UX-3: codepath audit confirmed tab switching is already unblocked at the TS level; regression test added in `TabManager.test.ts` asserting `switchToTab` succeeds + `needsAttention` survives the switch. UX-4: header `titleTextEl` now reads active tab's `getTabTitle()` and re-syncs on tab switch / open / close / title-change; new `conversation:renamed` event on `ChatEventMap` emitted by `ConversationStore` on rename / title update; `ConversationStoreDeps` gains the events bus reference (plumbed through `main.ts` + test harnesses). |
| **ADR-0001 Phase 1** | `4335655 feat(core/providers): land ADR-0001 Phase 1 (canonical tool-name set)` | `ProviderRegistration.canonicalToolNames: ReadonlySet<string>` (required); `ProviderRegistry.getCanonicalToolNames(id)` accessor mirrors the existing `getCapabilities` / `getChatUIConfig` shape. Codex / Opencode derive their sets from existing normalization tables (`CODEX_CANONICAL_TOOL_NAMES`, `OPENCODE_CANONICAL_TOOL_NAMES`). Cursor derives from `CURSOR_SDK_NAME_TO_KIND` keys plus `TOOL_WRITE` (resolved by argument-shape logic, not the direct map). Claude declares an explicit set in `src/providers/claude/canonicalTools.ts`. Tests assert every registered provider exposes a non-empty set with the expected core names. |
| **ADR-0001 Phase 2a** | `2c6f67e refactor(core/runtime): land ADR-0001 Phase 2a (rewind optional, RuntimeHost typed)` | `ChatRuntime.rewind()` is now optional; trivial Codex / Cursor / Opencode rewind stubs deleted (Claude retains the real implementation). `ConversationController.rewind` gains a TS narrowing guard against the optional signature on top of the existing `supportsRewind` capability gate. `src/core/runtime/RuntimeHost.ts` defines the typed replacement for the seven `set*Callback` setters (contract documented inline). The provider-runtime migration to consume the host is deferred as **Phase 2b**. |
| **Q-NEW-1** | `4e420c9 refactor(core): land Q-NEW-1 (extract shared constants module)` | `src/core/constants.ts` consolidates 5 cross-cutting magic numbers with rationale comments: `SELECTION_POLL_INTERVAL_MS` (250, three controllers), `INPUT_HANDOFF_GRACE_MS` (1500), `SETTINGS_FIELD_HIGHLIGHT_MS` (1500), `PRIVATE_SETTINGS_RENDER_DELAY_MS` (100), `HOTKEY_BINDING_POLL_INTERVAL_MS` (2000). Provider-specific limits stay in their provider modules. |
| **Q-1 chunk 1** | `aef981c refactor(chat): land Q-1 chunk 1 (InputController Notice i18n)` | 16/17 InputController `new Notice()` sites routed through `t()` under a new `chat.input.*` subspace. The 17th (`new Notice(result.error)`) is already-translated dynamic content — pass-through. en.json carries canonical strings; 9 other locales receive the same English placeholders via the existing fallback mechanism. |
| **Q-1 chunk 2** | `86b93a0 refactor(chat): land Q-1 chunk 2 (ConversationController Notice i18n)` | Routes the 4 history-action helpers (`chat.history.loadFailed` / `regenerateFailed` / `deleteFailed` / `renameFailed`) plus 4 rewind error-param keys (`chat.rewind.errMessageNotFound` / `errServiceUnavailable` / `errUnknown` / `errUnsupported`). Two helper sites stay as dynamic pass-throughs (callers supply translated strings). |
| **Q-1 chunk 3** | `c4ca6ad refactor(settings): land Q-1 chunk 3 (McpSettingsManager Notice i18n)` | All 14 McpSettingsManager `new Notice()` sites routed through `t()` under a new `settings.mcp.*` subspace. `imported` / `importedWithSkipped` replace the prior inline string concatenation; `toggleEnabled` / `toggleDisabled` replace a ternary-string-inside-Notice. |

**Verification at ship time:** typecheck pass, lint clean, 6623 tests pass / 35 skipped / 356 suites, build pass (every commit independently verified before push).

---

## Findings by severity

### P0 — Blockers for next architecture round

| ID | Finding | Evidence | Status |
|----|---------|----------|--------|
| **CON-3** | **Codex transport `readline` interface never closed on `dispose()`.** `rl` is a local in the constructor, never stored. On process restart, stale linefeed events from the prior subprocess can route through the new transport's handler set. Blocks ADR-0001 Phase 3 (transport extraction). | `src/providers/codex/runtime/CodexRpcTransport.ts:26-33` (constructor), `:75-78` (dispose) | ✅ shipped 2026-06-03 (`5011dde`) |
| **PERF-4** | **Long-chat hydration blocks the event loop.** `ConversationStore.getConversationById` → `hydrateConversationHistory` → `ClaudeHistoryStore.loadSDKSessionMessages` reads JSONL + parses messages **synchronously in a loop**. For a 500–1000 message conversation, this is 100–500ms of frozen UI. This is the live user-reported "loading a long chat makes the UI unresponsive" symptom — **distinct from PERF-1** (stream-time reflow), which already landed. (Original review also flagged sidecar load as sequential — **wrong**: it is already `Promise.all` at `ClaudeHistoryStore.ts:157`.) | `src/app/conversations/ConversationStore.ts:189-196`; `src/providers/claude/history/ClaudeHistoryStore.ts:60-170` | ✅ shipped 2026-06-03 (`1e7a02e`); tuning in Phase 1c |

### P1 — High value, modest effort

| ID | Finding | Evidence |
|----|---------|----------|
| OBS-1 | `onload()` runs heavy work synchronously: provider workspace init, git watcher, conversation list load, env apply. No `app.workspace.onLayoutReady` wrapper. | `src/main.ts:77-134`, esp. `:86-93` |
| OBS-2 | Private/undocumented Obsidian APIs (`app.setting`, `app.hotkeyManager`). No feature-detect; breaks silently if Obsidian renames. | `src/features/settings/ClaudianSettings.ts:68-92`; `src/features/settings/hotkeys/HotkeysSection.ts:46,72-78` |
| OBS-3 | Deferred-view cast in `EnvSnippetManager.ts:379` (`.view as ClaudianView`). No `loadIfDeferred()` call; safe `isClaudianView()` predicate exists at `main.ts:57-61` but unused here. | `src/features/settings/ui/EnvSnippetManager.ts:379` |
| OBS-4 | Non-atomic note writes (`vault.modify` + `vault.read` pairs); zero `vault.process` usage in `src/`. Concurrent agent-board edits can clobber. | grep: 0 matches for `vault.process` in `src/` |
| OBS-5 | `ClaudianView.ts:983-987` registers 4 `vault.on(...)` handlers in a manual `eventRefs[]` array instead of `registerEvent(...)`. Cleanup works but is non-idiomatic. | `src/features/chat/ClaudianView.ts:983-987` |
| Q-1 | **Notice i18n regressed** — `new Notice()` count 137 → 214 since 2026-05-31. New code skips `t()`. Hot offenders: `InputController` (17), `ConversationController` (14), `McpSettingsManager` (14), `OpencodeAgentSettings` (14). | grep counts (see Quality review) |
| Q-4 | Four security/robustness classes still untested: `ClaudeApprovalHandler`, `AcpToolStreamAdapter` (132 LOC), `HomeFileAdapter` (75), `ClaudeRewindService` (220). All are core seam handlers. | `tests/unit/` grep |
| PERF-8 | **No perf gate for history hydration.** Existing perf suite covers `messageRenderer`, `toolCallIndex`, history *filter*/*parse* — but **not** the full disk-→hydrate-→render path that PERF-4 sits on. The gap masked the live symptom. ✅ **shipped 2026-06-03** (`c9c5f03`). | `tests/perf/conversationLoad.perf.test.ts` |
| UX-1 | Active tab unclear when multiple tabs are streaming. | `docs/issues/UX polishing and improvements.md` (item 1) |
| UX-2 | No "needs attention" badge when a tab is blocked on user input. | same, item 2 |
| UX-3 | Cannot switch to another tab while active tab has an open user question. | same, item 3 |
| UX-4 | Plugin header shows "Claudian", not the active session title; title only visible on tab hover. | same, item 4; `src/features/chat/ClaudianView.ts` |

### P2 — Real but lower

| ID | Finding | Evidence |
|----|---------|----------|
| ARCH-5 (residual) | `InputController.ts` still **1,464 LOC** after the `QueuedMessageController` extraction. Still owns input wiring, mention dispatch, approval flow state, and the steering state machine. | `src/features/chat/controllers/InputController.ts` (1464 LOC) |
| ARCH-NEW-1 | **15 files >800 LOC.** Top: `ClaudeChatRuntime` 1863, `StreamController` 1694, `CodexHistoryStore` 1630, `InputController` 1464, `InputToolbar` 1419, `ToolCallRenderer` 1207, `SubagentManager` 1137, `TabManager` 1097. Not all need splitting; apply the deletion test per file before acting. | (see Architecture review) |
| PERF-5 | `loadSDKSessionMessages` sidecar load loop is sequential `await`s inside the same call. Bundling via `Promise.all` (or streaming) would knock ~20–50ms per async subagent off PERF-4. | `src/providers/claude/history/ClaudeHistoryStore.ts:144-163` |
| PERF-6 | `dedupeMessages()` + sort happens on the **full merged array** after hydration completes. Could be interleaved with hydration. | `src/providers/claude/history/ClaudeConversationHistoryService.ts:416-419` |
| Q-7 | Settings registry port incomplete. 3 of 8 tabs registry-driven (`agentBoard`, `orchestrator`, `diagnostics`); 5 still imperative (`general`, `claude`, `codex`, `opencode`, `cursor`) — ~53 fields outstanding. Tracked at `docs/issues/settings-registry-port-followup.md`. | `src/features/settings/registry/fields/` |
| Q-NEW-1 | Magic numbers/strings pervasive (coalesce limits, queue overflow, poll intervals, timeouts) with no `src/core/constants.ts`. | (see Quality review) |
| Q-NEW-2 | Provider test parity asymmetric: Claude 21 suites, Codex 17, Opencode 8, Cursor 6, ACP 5. Cursor and Opencode lack approval-handler/MCP-dispatch coverage. | `tests/unit/providers/` |

### P3 — Nice-to-have

| ID | Finding | Evidence |
|----|---------|----------|
| OBS-NEW-1 | Audit `addEventListener` sites for cleanup tracking in `InputToolbar`, `NavigationSidebar`, `StatusPanel`. 266 raw `addEventListener` calls across 64 files; not all wrong, but not all audited. | grep |
| OBS-NEW-2 | `BrowserSelectionController.ts:80` and `CanvasSelectionController.ts:94` cast `.view as` without `loadIfDeferred()`. Low risk (these are polling contexts, not core views). | cited |
| PERF-7 | History dropdown windowed at 50 (`HISTORY_RENDER_WINDOW_SIZE`); fine today, watch as conversation counts grow. | `src/features/chat/controllers/ConversationController.ts:31` |

### What's already good — do not re-litigate

- **Security**: SEC-1 through SEC-6 all closed. SEC-2 vault-trust gate fully wired at all four SDK setting-source call sites (reads risk fresh from disk every decision). SEC-4 curated env applied to live MCP spawns AND the new Cursor/Opencode allowlist. Cursor sessionId validation hardened across all path-construction sites. Zero `eval`, zero `shell: true`, zero unparameterized SQL.
- **Concurrency**: CON-1 (Cursor SIGKILL escalation), CON-2 (`shutdown()` hang protection), CON-4 (Claude abort listener removal + SIGKILL), CON-5 (silent catches routed through logger), S0-2 (awaitable cleanup on tab destroy + provider switch), S0-3 (`onunload` SIGTERM sweep) all landed.
- **Performance (stream-time)**: PERF-1 fully landed (`O(N·T)` → `O(1)` per chunk via bottom-anchor sentinel + `IntersectionObserver`); PERF-3 size-aware throttle + byte-exact final render; PERF-2 message list windowed at 80 trailing messages.
- **Architecture**: ARCH-1 (`PluginContext` extraction), ARCH-2 (provider default-config registration), ARCH-3 (`ConversationStore`), ARCH-4 (Cursor "ACP" docs corrected), ARCH-5a (`Tab.ts` 1915 → 45-line barrel), ARCH-5b (`QueuedMessageController` extraction), ARCH-6 (`StreamProjection`), ARCH-7 (Claude/Cursor on `QueryBacked*`, −450 LOC), ARCH-8 (provider settings load-normalization hook).
- **ADR-0001 Phase 0**: Hardcoded provider arrays replaced with `ProviderRegistry.getRegisteredProviderIds()`; cross-boundary imports closed; `setEnabled?` and `getAvailableModes?` added to existing interfaces.
- **Apparent vs actual regressions**: the prior plan listed `ApprovalPromptController` as a deferred Phase 2 holdout entangled with `inputContainerHideDepth`. The entanglement no longer exists — approval rendering is now inline. **Finding closed.**
- **Discipline**: zero `console.*` in production, zero `@ts-ignore`, zero new `as any` (3 pre-existing legacy; `asSettingsBag()` covers settings), lint clean, i18n keys synced.

---

## Phased improvement plan

### Phase 0 — Close the live blockers ✅ SHIPPED 2026-06-03

1. ✅ **CON-3 — Codex `readline` close on dispose.** (`5011dde`)
2. ✅ **PERF-4 — Long-chat hydration off the hot path.** (`1e7a02e`) Yielding-parse approach
   chosen. Render-then-hydrate explicitly deferred (see Phase 1c F3 and the deferred-options
   list).
3. ✅ **PERF-8 — Perf gate for hydration cost.** (`c9c5f03`)

**Exit criteria met:** CON-3 closed (unblocks ADR-0001 Phase 3); event loop no longer blocked
>50ms during long-chat load (per PERF-4 yield contract); perf gate passing. **Wall-clock
trade-off surfaced; tuning is Phase 1c.**

### Phase 1a — Obsidian-conformance sweep ✅ SHIPPED 2026-06-03 (`3b57e33`)

The 2026-05-31 plan listed OBS-1 through OBS-5; none landed. Run them as one focused PR — they share files and review surface:

4. **OBS-1** — move heavy `onload()` work into `app.workspace.onLayoutReady`.
5. **OBS-2** — wrap `app.setting`/`app.hotkeyManager` access in feature-detecting helpers under `src/utils/obsidianPrivateApi.ts`.
6. **OBS-3** — replace the `EnvSnippetManager.ts:379` cast with the safe `isClaudianView()` predicate + `loadIfDeferred()`. Sweep for similar `.view as` casts.
7. **OBS-4** — port `vault.modify`/`vault.read` pairs to `vault.process()`. Priority: `features/tasks/` work-order writes (concurrent-clobber risk under multi-agent runs).
8. **OBS-5** — wrap `ClaudianView.ts:983-987` vault events in `registerEvent(...)`; sweep remaining services.

### Phase 1b — UX polishing ✅ SHIPPED 2026-06-03 (`e2f389a`)

The four sub-items in `docs/issues/UX polishing and improvements.md` are independent and shippable separately:

9. **UX-1** — active-tab visual indicator (color/underline differentiating active vs background tabs).
10. **UX-2** — "needs attention" badge when tab is blocked on user input.
11. **UX-3** — allow tab switch while a user question is pending (preserve question state per tab).
12. **UX-4** — render session title in the plugin header, not "Claudian".

Recommend splitting the current single issue into four tracked issues so each can land independently.

### Phase 1c — PERF-4 follow-ups & measurement (F1+F4 ✅ SHIPPED 2026-06-03 `1bc8483`; F2+F3 deferred)

Surfaced by the Phase 0 final integration review. Phase 1c closes the loop on the PERF-4 yield
trade-off and tightens the merge-loop yield discipline. **None of these block other phases**;
they can run alongside 1a/1b.

13. **F1 — Yield check above the `continue` paths in the merge loop.** Today the yield check
    sits at the bottom of `loadSDKSessionMessages`'s merge loop, so the three `continue`
    statements (`isSystemInjectedMessage`, `<synthetic>` assistant, null `parseSDKMessageToChat`
    result) skip it. Real transcripts rarely run pathological streaks, but the contract should
    not depend on transcript shape. Move the modulo check to the top of the loop (using
    `i > 0`) or add a `processed++` counter inside the body. Add a unit test that feeds N
    consecutive skip-path entries and asserts yields still fire.
    - Evidence: `src/providers/claude/history/ClaudeHistoryStore.ts:87-125`.
    - Surfaced by: PERF-4 code-quality reviewer; Phase 0 final integration review (item 3).
    - Effort: S.
14. **F2 — Tune `YIELD_EVERY_PARSED_LINES` (100) and `YIELD_EVERY_MERGED_ENTRIES` (50) against
    a real long-transcript vault.** Current constants were chosen without empirical input. The
    PERF-8 metrics table shows wall-clock growing roughly linearly with yield count; doubling
    `N` halves the yield overhead while keeping per-batch wall-time well under the 16 ms frame
    budget. Pick values from measured production data, not test mocks. Update the comments next
    to each constant to record the measured per-batch cost + chosen N rationale.
    - Evidence: `sdkSessionPaths.ts:14`, `ClaudeHistoryStore.ts:64`; PERF-8 metrics table at
      `tests/perf/conversationLoad.perf.test.ts`.
    - Effort: S (after F3 measurement lands).
15. **F3 — Production measurement of the PERF-4 trade-off.** PERF-8 numbers come from
    mocked-fs Jest; they over-state the yield overhead by ~75× because the I/O wait that
    dominates in production is mocked out. Record a one-off measurement on a real vault with a
    representative long transcript (≥1000 messages), with and without yields, with cold and
    warm OS file cache. Capture results in `.context/` (per `CLAUDE.md` throwaway-notes
    convention) and feed the numbers into F2's tuning + F4's docs reconciliation.
    - Surfaced by: Phase 0 final integration review (item 5).
    - Effort: S (one measurement session).
16. **F4 — Reconcile exit-criteria wording in the long-chat issue + this plan.** The plan's
    verify line ("does not freeze the event loop >50ms") is what shipped; the same issue's
    acceptance line ("interactive within 1 animation frame") is stricter and currently
    ambiguous (per-frame responsiveness vs. total load). Pick the responsive-frames framing
    (the contract we actually meet); document the total-load trade-off explicitly.
    - File: `docs/issues/Loading a long chat from history makes the ui unresponsive.md`.
    - Surfaced by: Phase 0 final integration review (item 1).
    - Effort: S (docs only).

**Deferred (not in Phase 1c — track separately if they become user-visible):**

- **`linearTranscript` shared fixture.** Duplicated in `tests/perf/claudeHistory.perf.test.ts`
  and `tests/perf/conversationLoad.perf.test.ts`. Extract to `tests/perf/_fixtures.ts` only
  when a third tenant appears (rule of three). Surfaced by PERF-8 code-quality reviewer +
  Phase 0 final integration review (item 4).
- **Render-then-hydrate (PERF-4 long-term shape).** Mount the windowed view with skeleton
  placeholders immediately; complete hydration in the background; finalize via the existing
  `StreamProjection` applier. Better long-term shape than yielding parse (also subsumes PERF-5
  / PERF-6 entirely). **File as a separate spec/issue if F3 measurement shows the wall-clock
  cost is user-visible** (e.g. long visible "Loading…" state on giant transcripts). Until
  then, the yielding parse is sufficient. Surfaced by Phase 0 final integration review
  (item 6).

### Phase 2 — ADR-0001 Phases 1–3 (P1 ✅ `4335655`; P2a ✅ `2c6f67e`; P2b deferred; P3 blocked on cursor-PR2)

After CON-3 lands:

13. **ADR-0001 Phase 1** — extend `ProviderRegistration` + lift the canonical tool-name set per provider. Mechanical. Codex/Opencode lift as flat data; Cursor stays as argument-shape logic.
14. **ADR-0001 Phase 2** — introduce `RuntimeHost`; mark optional `ChatRuntime` members optional (`rewind?`, `steer?`, `fork?`); delete the three trivial stubs. Add the typed `createMockRuntime()` drift guard and the cancel-dismiss invariant test for Claude + Codex.
15. **ADR-0001 Phase 3** — extract `core/transport/`: `spawnAgentProcess()` (Codex/Cursor/Opencode) + `JsonRpcStdioClient` (Codex/Opencode; Cursor stays NDJSON). Add the perf gate for `JsonRpcStdioClient` pending-request lookup. **Land after `docs/superpowers/plans/2026-05-30-cursor-integration-hardening.md` PR2 to avoid the documented file collision.**

### Phase 2b — Architecture residuals (2–4 days, opportunistic)

16. **ARCH-5 residual** — split `InputController.ts` (1464 LOC) along its three remaining seams: input wiring, mention dispatch, steering state machine. Pair with the `RuntimeHost` work in Phase 2 to amortize the test churn.
17. **ARCH-NEW-1** — apply the deletion test to the 15 files >800 LOC. Only act when complexity would consolidate. `ClaudeChatRuntime` and `CodexHistoryStore` are likely candidates (they fuse multiple concerns); `StreamController` is mostly DOM rendering after ARCH-6.

### Phase 3 — Quality follow-through (Q-NEW-1 ✅ `4e420c9`; Q-1 partial ✅ `aef981c` + `86b93a0` + `c4ca6ad`; Q-4/Q-7/Q-NEW-2 pending)

18. **Q-1 (regressed)** — sweep 214 hardcoded `new Notice()` through `t()`. Priority order: `InputController` (17), `ConversationController` (14), `McpSettingsManager` (14), `OpencodeAgentSettings` (14), then `features/tasks`. Add a lint rule blocking new `new Notice()` outside an allowlist.

**Subspace policy** (codified 2026-06-03 after chunk-4/5/6 review):

- Chat-side keys: `chat.input.*`, `chat.history.*`, `chat.rewind.err*`, `chat.fork.*`.
- Generic settings keys with no provider scope: `settings.<feature>.*` (e.g. `settings.mcp.*`).
- Provider-specific keys: `provider.<id>.<feature>.*`. Established by chunk 4
  (`provider.opencode.subagent.*`).
- **Pre-existing `settings.subagents.*` is grandfathered as Claude's de-facto
  provider subspace.** Future Claude subagent strings extend it. Future
  non-Claude subagent strings go under `provider.<id>.subagent.*`. The naming
  asymmetry is accepted; a later refactor could rename for symmetry but is out
  of scope for Q-1.
- **String duplication across `settings.subagents.*` and `provider.<id>.subagent.*`
  is accepted.** Convention consistency wins over translator-burden minimization.
  Documented for translator awareness.

**ESLint rule design** (when chunk sweep finishes):

- Block `new Notice('...')` and ``new Notice(`...${x}...`)`` outside an
  explicit allowlist file.
- Allow `new Notice(t(...))`.
- Allow pure-identifier pass-throughs (`new Notice(err.error)`,
  `new Notice(nameError)`) — these depend on the validator-helper translation
  chunk tracked at `docs/issues/translate-validator-helper-strings.md`.

**Validator helper translation** — tracked separately at
`docs/issues/translate-validator-helper-strings.md`. Land after the main sweep
finishes; will return contracts from `validateOpencodeAgentName`,
`validateAgentName`, `validateCommandName`, and the `parseOptional*` family
through a `{ key, params }` shape so call sites translate at the Notice
boundary.
19. **Q-4** — unit tests for `ClaudeApprovalHandler`, `AcpToolStreamAdapter`, `HomeFileAdapter`, `ClaudeRewindService`. At minimum: smoke + error paths + cancellation.
20. **Q-7** — finish the settings registry port. Phase K: register the remaining 5 tabs (~53 fields). Delete the legacy fallback renderers.
21. **Q-NEW-1** — `src/core/constants.ts` for coalesce limits, queue overflow, poll intervals, timeout durations.
22. **Q-NEW-2** — add provider test-parity suites for Cursor and Opencode (approval handlers, MCP dispatch).

---

## Sequencing rationale

- ~~**Phase 0**~~ — shipped 2026-06-03.
- **Phase 1a (Obsidian)** is overdue and the entire sweep is one focused PR — better as one round than as five drips.
- **Phase 1b (UX)** is independently scoped and high user value; can run in parallel with 1a.
- **Phase 1c (PERF-4 follow-ups)** is independent of 1a/1b (different files, different reviewers) and can run alongside either. F3 (production measurement) gates F2 (tuning). F1 and F4 are independent of both.
- **Phase 2 (ADR-0001)** is **no longer gated on CON-3** (shipped) — the three phases are mergeable in order. Phase 3 of ADR-0001 still must sequence after `docs/superpowers/plans/2026-05-30-cursor-integration-hardening.md` PR2 to avoid the documented file collision.
- **Phase 2b (architecture residuals)** is opportunistic — only act on files whose deletion test passes.
- **Phase 3 (quality)** comes last so the lint rule blocking new `new Notice()` is set against an already-improved baseline.

---

## Issue backlog reconciliation

Verified each issue under `docs/issues/` against the live tree:

| Issue | Frontmatter | Verified status | Action |
|-------|-------------|-----------------|--------|
| `Loading a long chat from history makes the ui unresponsive.md` | open | **PERF-4 shipped 2026-06-03 (`1e7a02e`); tuning + acceptance-wording reconciliation in Phase 1c F2/F4** | Update body with shipped status + Phase 1c follow-ups; close when F4 reconciles wording |
| `Missing Eventbus makes expanding...md` | done | deferred by design | **Update** to `status: deferred` with rationale |
| `Pasted images or files to the chat dont get picked up.md` | open | **likely done** — paste handler in `ImageContext.ts:48-50` integrates with agent context | **Close** pending user confirmation |
| `UX polishing and improvements.md` | open | open (4 sub-items, none shipped) | **Split** into 4 issues (UX-1..UX-4 above) |
| `agent-board-evidence-review.md` | open | open (Phase-2 PRD, no implementation yet) | Leave open; schedule post-MVP-stabilization |
| `agent-board-mvp.md` | done | done | Leave done |
| `architecture-deepening-proposal.md` | open | **done** (consolidated, Phase 2 architecture closed; transport residuals in ADR-0001) | **Close** with status note pointing to ADR-0001 + this plan |
| `insufficient logging.md` | done | deferred by design (issue body says deferred; frontmatter mismarked) | **Update** to `status: deferred` |
| `settings-registry-port-followup.md` | open | open (~53 fields outstanding) | Leave open; tracked under Phase 3 Q-7 |
| `user-manual-settings-links-followup.md` | open | open (partially done) | Leave open; treat as release-notes debt; ship with next minor |

---

## Out of scope

- Changing visible chat behavior outside the listed UX items.
- New providers, new MCP capabilities, new commands.
- Re-opening the four ADRs / closed-by-design items.
- Cursor → ACP convergence (documented in ADR-0001 as a separate later decision).
