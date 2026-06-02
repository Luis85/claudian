---
title: Codebase Review & Improvement Plan
date: 2026-06-02
status: draft
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

1. **CON-3 Codex readline leak** — the last open concurrency item, and ADR-0001 Phase 3 cannot
   ship until it lands.
2. **PERF-4 long-chat-load freeze** — the live user-reported symptom is **not** the same as the
   landed PERF-1 stream-time fix. Root cause is synchronous history hydration on conversation
   load, not streaming.
3. **Q-1 Notice i18n regressed** — 137 → 214 hardcoded `new Notice()` (56% increase since the
   2026-05-31 baseline). New code is not routing through `t()`.
4. **Q-4 four untested security paths** — `ClaudeApprovalHandler`, `AcpToolStreamAdapter`,
   `HomeFileAdapter`, `ClaudeRewindService` still have **zero** unit tests.
5. **OBS-1/-2/-3/-4 entirely deferred** — none of the Obsidian-conformance items landed.
6. **ADR-0001 Phases 1–3** — gated on CON-3; mechanical work still ahead.

---

## Findings by severity

### P0 — Blockers for next architecture round

| ID | Finding | Evidence |
|----|---------|----------|
| **CON-3** | **Codex transport `readline` interface never closed on `dispose()`.** `rl` is a local in the constructor, never stored. On process restart, stale linefeed events from the prior subprocess can route through the new transport's handler set. Blocks ADR-0001 Phase 3 (transport extraction). | `src/providers/codex/runtime/CodexRpcTransport.ts:26-33` (constructor), `:75-78` (dispose) |
| **PERF-4** | **Long-chat hydration blocks the event loop.** `ConversationStore.getConversationById` → `hydrateConversationHistory` → `ClaudeHistoryStore.loadSDKSessionMessages` reads JSONL + parses + loads subagent sidecars **synchronously in a loop**. For a 500–1000 message conversation, this is 100–500ms of frozen UI. This is the live user-reported "loading a long chat makes the UI unresponsive" symptom — **distinct from PERF-1** (stream-time reflow), which already landed. | `src/app/conversations/ConversationStore.ts:189-196`; `src/providers/claude/history/ClaudeHistoryStore.ts:60-170` (esp. `:144-163` subagent sidecar loop) |

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
| PERF-8 | **No perf gate for history hydration.** Existing perf suite covers `messageRenderer`, `toolCallIndex`, history *filter*/*parse* — but **not** the full disk-→hydrate-→render path that PERF-4 sits on. The gap masked the live symptom. | `tests/perf/*.perf.test.ts` (no `claudeHistory` hydration timing) |
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

### Phase 0 — Close the live blockers (1–2 days)

1. **CON-3 — Codex `readline` close on dispose.** Store `rl` as a field; `rl.close()` in `dispose()`; add unit test asserting no stale-event after restart. Unblocks ADR-0001 Phase 3. **[verifies: restart-during-stream test green]**
2. **PERF-4 — Long-chat hydration off the hot path.** Two compatible approaches:
   - **Yielding parse**: read JSONL in chunks, yield to event loop between chunks (e.g. `await new Promise(r => setTimeout(r, 0))` after every N messages).
   - **Render-then-hydrate**: mount the windowed view immediately with placeholder/skeleton messages; complete hydration in the background; finalize via the existing `StreamProjection` applier. This is the better long-term shape — it also covers PERF-5/6.
   Pick one, ship behind a perf test (PERF-8). **[verifies: opening a 1000-msg conversation does not freeze the event loop >50ms]**
3. **PERF-8 — Perf gate for hydration cost.** New `tests/perf/conversationLoad.perf.test.ts` asserting cold-load latency scales linearly with message count and a worst-case bound. Without this, PERF-4 will regress silently again.

**Exit criteria:** CON-3 closed; opening the longest conversation in the user's vault is interactive within 1 animation frame; perf gate passing.

### Phase 1a — Obsidian-conformance sweep (1–2 days)

The 2026-05-31 plan listed OBS-1 through OBS-5; none landed. Run them as one focused PR — they share files and review surface:

4. **OBS-1** — move heavy `onload()` work into `app.workspace.onLayoutReady`.
5. **OBS-2** — wrap `app.setting`/`app.hotkeyManager` access in feature-detecting helpers under `src/utils/obsidianPrivateApi.ts`.
6. **OBS-3** — replace the `EnvSnippetManager.ts:379` cast with the safe `isClaudianView()` predicate + `loadIfDeferred()`. Sweep for similar `.view as` casts.
7. **OBS-4** — port `vault.modify`/`vault.read` pairs to `vault.process()`. Priority: `features/tasks/` work-order writes (concurrent-clobber risk under multi-agent runs).
8. **OBS-5** — wrap `ClaudianView.ts:983-987` vault events in `registerEvent(...)`; sweep remaining services.

### Phase 1b — UX polishing (2–3 days)

The four sub-items in `docs/issues/UX polishing and improvements.md` are independent and shippable separately:

9. **UX-1** — active-tab visual indicator (color/underline differentiating active vs background tabs).
10. **UX-2** — "needs attention" badge when tab is blocked on user input.
11. **UX-3** — allow tab switch while a user question is pending (preserve question state per tab).
12. **UX-4** — render session title in the plugin header, not "Claudian".

Recommend splitting the current single issue into four tracked issues so each can land independently.

### Phase 2 — ADR-0001 Phases 1–3 (3–6 days, sequenced)

After CON-3 lands:

13. **ADR-0001 Phase 1** — extend `ProviderRegistration` + lift the canonical tool-name set per provider. Mechanical. Codex/Opencode lift as flat data; Cursor stays as argument-shape logic.
14. **ADR-0001 Phase 2** — introduce `RuntimeHost`; mark optional `ChatRuntime` members optional (`rewind?`, `steer?`, `fork?`); delete the three trivial stubs. Add the typed `createMockRuntime()` drift guard and the cancel-dismiss invariant test for Claude + Codex.
15. **ADR-0001 Phase 3** — extract `core/transport/`: `spawnAgentProcess()` (Codex/Cursor/Opencode) + `JsonRpcStdioClient` (Codex/Opencode; Cursor stays NDJSON). Add the perf gate for `JsonRpcStdioClient` pending-request lookup. **Land after `docs/superpowers/plans/2026-05-30-cursor-integration-hardening.md` PR2 to avoid the documented file collision.**

### Phase 2b — Architecture residuals (2–4 days, opportunistic)

16. **ARCH-5 residual** — split `InputController.ts` (1464 LOC) along its three remaining seams: input wiring, mention dispatch, steering state machine. Pair with the `RuntimeHost` work in Phase 2 to amortize the test churn.
17. **ARCH-NEW-1** — apply the deletion test to the 15 files >800 LOC. Only act when complexity would consolidate. `ClaudeChatRuntime` and `CodexHistoryStore` are likely candidates (they fuse multiple concerns); `StreamController` is mostly DOM rendering after ARCH-6.

### Phase 3 — Quality follow-through (2–3 days, parallelizable)

18. **Q-1 (regressed)** — sweep 214 hardcoded `new Notice()` through `t()`. Priority order: `InputController` (17), `ConversationController` (14), `McpSettingsManager` (14), `OpencodeAgentSettings` (14), then `features/tasks`. Add a lint rule blocking new `new Notice()` outside an allowlist.
19. **Q-4** — unit tests for `ClaudeApprovalHandler`, `AcpToolStreamAdapter`, `HomeFileAdapter`, `ClaudeRewindService`. At minimum: smoke + error paths + cancellation.
20. **Q-7** — finish the settings registry port. Phase K: register the remaining 5 tabs (~53 fields). Delete the legacy fallback renderers.
21. **Q-NEW-1** — `src/core/constants.ts` for coalesce limits, queue overflow, poll intervals, timeout durations.
22. **Q-NEW-2** — add provider test-parity suites for Cursor and Opencode (approval handlers, MCP dispatch).

---

## Sequencing rationale

- **Phase 0 is non-negotiable**: CON-3 blocks ADR-0001 Phase 3, and PERF-4 is the live user pain. Ship them together — they share neither files nor reviewers.
- **Phase 1a (Obsidian)** is overdue and the entire sweep is one focused PR — better as one round than as five drips.
- **Phase 1b (UX)** is independently scoped and high user value; can run in parallel with 1a.
- **Phase 2 (ADR-0001)** is deliberately gated on CON-3 per the ADR's own migration plan. The three phases are mergeable in order.
- **Phase 2b (architecture residuals)** is opportunistic — only act on files whose deletion test passes.
- **Phase 3 (quality)** comes last so the lint rule blocking new `new Notice()` is set against an already-improved baseline.

---

## Issue backlog reconciliation

Verified each issue under `docs/issues/` against the live tree:

| Issue | Frontmatter | Verified status | Action |
|-------|-------------|-----------------|--------|
| `Loading a long chat from history makes the ui unresponsive.md` | open | **open** (root cause = PERF-4 above) | **Update** with root cause + perf gate; track under Phase 0 |
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
