---
title: Codebase Review & Improvement Plan
date: 2026-05-31
status: draft
scope: whole-codebase (architecture, robustness, security, performance, quality, Obsidian conformance)
method: 7 parallel dedicated review passes over src/ (~81k LOC, 435 files)
---

# Claudian Codebase Review & Improvement Plan

Goal: make the current implementation **robust, stable, and high-quality before adding more
functionality**. This document consolidates seven focused review passes (architecture,
concurrency/lifecycle, code quality, testing, security, performance, Obsidian API conformance)
into one prioritized, phased plan.

## Overall verdict

Claudian is, for ~81k LOC, an **unusually disciplined** codebase: `0` `console.*`, `0`
`@ts-ignore`, `0` `as any`, shallow nesting, small methods, perfectly synced i18n (288 keys ×
10 locales), a genuinely clean provider abstraction (no `providerId === 'x'` branching in
`features/`), and a healthy test corpus (6,299 tests). Typecheck, lint, and the production
build all pass.

The problems are **concentrated, not systemic**, and cluster in five areas that must be closed
before new features land:

1. **CI is red** — 4 platform-coupled tests fail on Linux (the OS CI runs on).
2. **Subprocess lifecycle leaks** — tabs/plugin teardown can orphan provider CLI processes.
3. **Security defaults are unsafe** — `yolo` permission mode + auto-trusting vault-committed
   `.claude/settings.json`/`mcp.json` means opening an untrusted vault can execute code.
4. **Long chats degrade** — the message list is never virtualized and every stream chunk
   forces a full-DOM reflow → `O(N·T)` per turn (the user-reported symptom).
5. **Architectural inversion** — `core/` depends on the concrete `main.ts` plugin, producing
   184 import cycles and a service-locator god object.

---

## Cross-cutting themes

- **Defaults favor power over safety.** `permissionMode: 'yolo'`, MCP servers default-enabled,
  full `process.env` forwarded to children. Great for a power user, dangerous on first contact
  with an untrusted vault.
- **Teardown is best-effort / fire-and-forget.** Cleanup paths exist but aren't awaited;
  `onunload` skips runtime disposal entirely.
- **Unbounded growth in the hot path.** DOM nodes, listeners, and per-frame markdown re-parsing
  all scale with conversation size with no windowing or backoff.
- **The concrete plugin leaks into core.** `ClaudianPlugin` is imported by 57 files and appears
  in 140 signatures; it is the root of the dependency cycles and the test-mocking burden.
- **Discipline is unenforced.** The excellent type hygiene and i18n coverage are maintained by
  convention; nothing in lint/CI/coverage prevents regression.

---

## Findings by severity

### P0 — Stability blockers (must fix first)

| ID | Finding | Evidence |
|----|---------|----------|
| S0-1 | **CI is red on Linux.** 4 tests in 2 suites assert win32 path behavior while running on POSIX; CI runs `npm run test` on `ubuntu-latest` only. Source is correct — the *tests* are platform-coupled and ignore the repo's own win32-guard convention. | `tests/unit/providers/cursor/runtime/cursorLaunch.test.ts:35-81`, `tests/unit/utils/toolFilePath.test.ts:74-79`; convention to copy: `tests/unit/utils/path.test.ts:609-642`; `.github/workflows/ci.yml:45-59` |
| S0-2 | **Orphaned subprocesses on teardown.** `destroyTab` is async but calls `cleanup()` without awaiting; runtime cleanups spawn the kill as a floating promise (`void this.shutdownProcess()`). DOM is torn down before SIGTERM→SIGKILL completes. | `Tab.ts:1703`; `OpencodeChatRuntime.ts:512`; `CodexChatRuntime.ts:743`; `ClaudeChatRuntime.ts:1780` |
| S0-3 | **`onunload()` never disposes runtimes.** On plugin disable/hot-reload, live Claude/Codex/Opencode/Cursor subprocesses survive — zombie CLI processes. | `main.ts:485-489` |

### P1 — Security hardening (high risk, mostly low effort)

| ID | Finding | Evidence |
|----|---------|----------|
| SEC-1 | **Default `permissionMode: 'yolo'` → SDK `bypassPermissions`.** Out of the box, Bash/Write/Edit run with zero approval UI; prompt-injection from a vault note can execute commands on turn 1. | `app/settings/defaultSettings.ts:8`; `ClaudeQueryOptionsBuilder.ts:247`; `claudeColdStartQuery.ts:91-92` |
| SEC-2 | **Vault-committed `.claude/settings.json` is auto-trusted** (hooks + `permissions.allow`). `settingSources` always includes `project`/`local`; cwd is the vault. A malicious vault's `SessionStart` hook runs the moment a turn starts. No "trust this vault" gate exists. | `providers/claude/settings.ts:166-172`; `CCSettingsStorage.ts:43-51`; `ClaudeQueryOptionsBuilder.ts:298` |
| SEC-3 | **Vault-committed `.claude/mcp.json` auto-launches MCP servers** on first query (`enabled` defaults to `true`; `contextSaving:false` makes a server active every turn). Validation only checks `command` is a string. | `McpStorage.ts:45`; `core/types/mcp.ts:94`; `McpServerManager.ts:38-53` |
| SEC-4 | **Full `process.env` forwarded to every child** (incl. vault-defined MCP servers). | `claudeColdStartQuery.ts:86-90`; `McpTester.ts:245` |
| SEC-5 | **ACP `read/writeTextFile` honor absolute paths with no vault containment** (defense-in-depth; the CLI's own permission flow is the primary gate). | `OpencodeChatRuntime.ts:1280-1319` |
| SEC-6 | Secrets stored cleartext in the (syncable/committable) in-vault `.claudian/claudian-settings.json`; redaction regex is key-name-only and misses `bearer|passwd|pwd|signature|private_key`. | `providerEnvironment.ts:180-210`; `core/logging/redact.ts:1` |

### P1 — Performance (the "long chat gets slow" symptom)

| ID | Finding | Evidence |
|----|---------|----------|
| PERF-1 | **No DOM virtualization + per-chunk full reflow.** `scrollToBottom()` reads `scrollHeight` after every chunk over an unbounded, never-pruned message DOM → synchronous layout of the entire conversation, `O(N·T)` per turn where N grows. **This is the root cause of the reported symptom.** | `StreamController.ts:275,787,832,942,1556`; `MessageRenderer.ts:237-254` (no prune) |
| PERF-2 | **Unbounded node/listener/memory accumulation** — every message stays mounted with its code/copy/rewind listeners; nothing recycles. | `MessageRenderer.ts:256,662,708,752` |
| PERF-3 | **Per-frame full markdown re-parse of the active block** → `O(C²)` for a block of C chars. `renderContent` does `el.empty()` + full `MarkdownRenderer.render` every rAF; tool output re-renders the whole growing result. | `MessageRenderer.ts:667,674,688`; `ToolCallRenderer.ts:1176`; `StreamController.ts:462,783` |

### P1 — Concurrency / robustness

| ID | Finding | Evidence |
|----|---------|----------|
| CON-1 | **Cursor cancel is SIGTERM-only, no SIGKILL escalation, no process-group kill.** `query()` can hang on `child.on('close')` forever; `isStreaming` stuck. | `CursorChatRuntime.ts:200-202,232-240` |
| CON-2 | `shutdown()` can hang forever if `kill()` throws or the proc already exited (promise bound to `exit` event, no try/catch, no `exitCode` guard). | `AcpSubprocess.ts:98-114`; `CodexAppServerProcess.ts:126-140` |
| CON-3 | Codex query generator can park forever if the subprocess dies without emitting `done` and without `cancel()` (no transport-close watchdog). | `CodexChatRuntime.ts:489-497` |
| CON-4 | Claude `customSpawn` abort listener never removed on normal exit (leak); SIGTERM-only. | `claude/runtime/customSpawn.ts:41-43` |
| CON-5 | Silent `.catch(() => {})` on `sendMessage()` paths can leave the UI with no error surfaced and `isStreaming` inconsistent; untracked retry `setTimeout` fires post-disposal. | `InputController.ts:569,579,997,1247`; `StreamController.ts:1279` |

### P1 — Obsidian API conformance

| ID | Finding | Evidence |
|----|---------|----------|
| OBS-1 | **No `onLayoutReady`** — all of `onload` (session enumeration, provider init, git watcher, vault subscriptions) runs synchronously on the startup critical path. | `main.ts:86-483`, `648-705` |
| OBS-2 | **Private/undocumented APIs** (`app.setting`, `app.hotkeyManager`, `openTabById`) — breakage risk across Obsidian updates. | `ClaudianView.ts:403-405`; `HotkeysSection.ts:46,72-78`; `ClaudianSettings.ts:68-92` |
| OBS-3 | **Deferred-views not fully correct.** `getView()` silently treats a *deferred* chat view as "no view" (mis-evaluates command `checkCallback`s / file-context injection); `EnvSnippetManager.ts:379` casts `.view as ClaudianView` directly. Plugin does **not crash** (duck-typed `isClaudianView` filter), but isn't deferred-*correct*. | `main.ts:69-73,1143-1151`; `EnvSnippetManager.ts:379` |
| OBS-4 | **Non-atomic note writes** (`vault.read` + `vault.modify`) on work-order notes; concurrent runs can clobber. Use `vault.process()`. | `AgentBoardView.ts:316-321`; `TemplateNoteStore.ts:112` |
| OBS-5 | Raw `addEventListener`/`setInterval`/`vault.on` instead of `registerDomEvent`/`registerInterval`/`registerEvent` (cleaned up today, but non-idiomatic). | `ClaudianView.ts:398-513,962-967`; several controllers |

### P2 — Architecture

| ID | Finding | Evidence |
|----|---------|----------|
| ARCH-1 | **`core/` depends on concrete `main.ts`.** `ClaudianPlugin` imported by 57 files, in 140 signatures — root of the cycles and untestability. Extract a narrow `PluginContext` interface. | `core/providers/types.ts:1`; `ProviderRegistry.ts:1`; `ProviderWorkspaceRegistry.ts:1` |
| ARCH-2 | **184 circular dependencies** (`madge --circular`), almost all routed through `main.ts` + `core/providers/types.ts` + the static `defaultProviderConfigs` barrel. | `core → app → all-providers → core` cycle class |
| ARCH-3 | **`ClaudianPlugin` service-locator god object** (`settings` ×222, `app` ×99) mixing command registration, conversation CRUD, settings migration, env resolution, view lifecycle. | `main.ts` (1177 lines) |
| ARCH-4 | **Docs mislabel Cursor as "ACP-backed."** Only Opencode uses `providers/acp`; Cursor reimplements stream/tool mapping (`cursorStreamMapper` 508 + `cursorToolNormalization` 689 lines). Fix docs or converge. | `CursorChatRuntime.ts:1-2,171-176`; root `CLAUDE.md`, `core/CLAUDE.md` |
| ARCH-5 | **God files** `Tab.ts` (1915, 18 free functions over a shared mutable struct), `InputController.ts` (1776, 4 subsystems incl. a ~400-line steering state machine). Split along existing seams. | `features/chat/tabs/Tab.ts`; `features/chat/controllers/InputController.ts` |
| ARCH-6 | **`StreamController` fuses provider-neutral stream projection with DOM rendering.** Extract a `StreamChunk → message-state operations` projection layer with DOM rendering as a thin adapter, so streaming correctness (block ordering, tool/thinking finalization, compact boundaries, usage) is unit-testable without a DOM. Pair with Phase 1b (which already moves rendering toward an adapter). | `features/chat/controllers/StreamController.ts` (1601); from PR #10 PRD |
| ARCH-7 | **Claude/Cursor auxiliary services not yet on the shared query-backed modules.** Codex & Opencode use `QueryBacked*` + `AuxQueryRunner`; Claude & Cursor still ship standalone title/refine/inline-edit services duplicating continuation/cancellation/callback-safety. Add Claude (cold-start) and Cursor query-runner adapters. | `providers/claude/auxiliary/*`, `providers/cursor/auxiliary/*` vs `core/auxiliary/QueryBacked*`; from PR #10 PRD |
| ARCH-8 | **App shell imports provider-specific settings logic.** `ClaudianSettingsStorage` imports `updateClaudeProviderSettings` from `providers/claude`. Generalize via a provider settings load-normalization hook so the app shell stays provider-neutral. (Opencode's former plan-mode leak is already resolved.) | `app/settings/ClaudianSettingsStorage.ts:10`; from PR #10 PRD |

> Cross-reference: ARCH-6/-7/-8 and the Conversation-store split (ARCH-3) consolidate the still-valid findings from the **PR #10 architecture-deepening PRD** (`docs/issues/architecture-deepening-proposal.md`), now closed in favor of this plan. The PRD's "deletion test" discipline (two adapters make a seam real; don't build speculative seams) governs Phase 2.

### P3 — Code quality & test hardening

| ID | Finding | Evidence |
|----|---------|----------|
| Q-1 | **~137 hardcoded `new Notice()` strings bypass i18n** (212 total Notices, only 39 via `t()`) — toasts are English-only across 10 locales. Worst: `InputController.ts` (15), `main.ts` (13), `features/tasks` (23). | grep counts |
| Q-2 | Identical `settings as unknown as Record<string, unknown>` cast repeated **34×** across 25 files — invisible seam; add one `asSettingsBag()` helper. | `main.ts:788` + 33 sites |
| Q-3 | **No guardrails:** `no-explicit-any` is `off`; no `coverageThreshold`; no unused-export check. Discipline is convention-only. | `eslint.config.mjs:88,146`; `jest.config.js:38-43` |
| Q-4 | **Untested security/robustness paths:** `ClaudeApprovalHandler` (0 refs), `AcpToolStreamAdapter` (0), `HomeFileAdapter` (0), `ClaudeRewindService` (0); whole untested UI subtrees (`features/tasks/ui/*`, `features/settings/ui/*`). | grep |
| Q-5 | Over-mocking in big UI suites (`Tab.test.ts`: 151 `toHaveBeenCalled`) asserts collaborators were called, not outcomes — lets refactors/bugs through. Two stale `TODO Phase F` comments. | `tests/unit/features/chat/tabs/Tab.test.ts`; `diagnostics.ts:63,77` |

---

## Phased improvement plan

### Phase 0 — Go green & stop the bleeding (½–1 day)
Unblock CI and close the worst leaks. No behavior change for users.

1. **Fix the 4 platform-coupled tests** (S0-1) using the repo's existing win32-guard pattern
   (`path.test.ts:609-642`): branch on `process.platform` / assert by basename, or inject
   `path.win32` into `cursorLaunch.ts`. **[verifies: `npm run test` green on Linux]**
2. **Add a win32 + ubuntu CI matrix** so the inverse never regresses (`ci.yml`).
3. **Make `cleanup()` awaitable and await it** in `destroyTab`/`TabManager.destroy()` (S0-2).
4. **Dispose runtimes in `onunload()`** — best-effort synchronous SIGTERM over all views (S0-3).
5. **Harden `shutdown()`** with try/catch + `exitCode` guard (CON-2); add SIGKILL escalation
   to Cursor cancel (CON-1).

**Exit criteria:** CI green on both OSes; open→close→reopen and disable-plugin leave no
orphaned provider processes (verify with `ps`).

### Phase 1a — Security defaults (½–1 day, high risk reduction)
6. **Default `permissionMode` to a prompting mode**; make `yolo` explicit opt-in with a
   one-time warning (SEC-1).
7. **Add a per-vault trust gate** before honoring project `.claude/settings.json` hooks/
   allow-rules and vault MCP servers (SEC-2, SEC-3); **default vault-sourced MCP servers to
   disabled** (SEC-3).
8. **Curate child env** instead of forwarding all of `process.env`, especially to vault-defined
   MCP servers (SEC-4); add vault-containment checks to ACP `read/writeTextFile` (SEC-5);
   broaden the redaction regex + document the in-vault secrets file (SEC-6).

### Phase 1b — Long-chat performance (1–3 days; directly fixes the reported symptom)
9. **Stop the per-chunk full reflow** (PERF-1): only scroll when the user is pinned to bottom;
   use a bottom-anchor sentinel + `IntersectionObserver`/`scrollIntoView` instead of re-reading
   `scrollHeight` every frame. *Biggest win for the least effort.*
10. **Virtualize the message list** (PERF-2): render only the viewport ± buffer, recycle nodes.
    Makes step 9 nearly free and bounds memory/listeners.
11. **Size-aware throttle + delta-append** for streaming text and tool output (PERF-3): cap full
    re-parses, append deltas, only live-update the trailing in-progress block.

### Phase 1c — Obsidian conformance (1–2 days)
12. **Move heavy `onload` work into `app.workspace.onLayoutReady`** (OBS-1).
13. **Make `getView()`/`ensureViewOpen()` deferred-aware** (`await leaf.loadIfDeferred()` +
    `instanceof`); fix `EnvSnippetManager.ts:379` to use the safe accessor (OBS-3).
14. **`vault.process()` for note writes** (OBS-4); isolate private-API access behind feature-
    detecting helpers (OBS-2); sweep to `registerDomEvent`/`registerInterval`/`registerEvent`
    (OBS-5).
15. Finish the remaining concurrency hardening: CON-3 (Codex watchdog), CON-4 (Claude abort
    listener + SIGKILL), CON-5 (route silent catches through the logger; track retry timers).

### Phase 2 — Architecture de-coupling (3–5 days; enables future features)
16. **Extract a narrow `PluginContext` interface** and replace `ClaudianPlugin` in `core/` and
    provider boundary types (ARCH-1). Type-only, incremental — collapses most of the 184 cycles
    (ARCH-2) and the mocking burden in one move.
17. **Route provider default configs through registration** instead of the static
    `defaultProviderConfigs` barrel (ARCH-2).
18. **Split the god files** along existing seams: `Tab.ts` → lifecycle/provider-sync/fork-rewind/
    input-wiring (a "Chat tab composition" module with one small interface); extract
    `QueuedMessageController` + `ApprovalPromptController` from `InputController.ts` (ARCH-5).
19. **Extract a provider-neutral stream-projection layer** from `StreamController` with DOM
    rendering as a thin adapter (ARCH-6). Design this **with** Phase 1b — both reshape the
    rendering boundary; doing them together avoids reworking the same seam twice.
20. **Move conversation/session CRUD into a `ConversationStore`** so the plugin shell becomes an
    Obsidian-lifecycle adapter (ARCH-3); keep `providerState` opaque behind provider history
    helpers.
21. **Fold Claude & Cursor auxiliary services onto the shared `QueryBacked*` modules** via
    provider query-runner adapters (ARCH-7); add a provider settings load-normalization hook so
    the app shell stops importing provider-specific settings logic (ARCH-8).
22. **Realign the Cursor "ACP" docs** (correct both CLAUDE.md files now; schedule Cursor→ACP
    convergence to delete ~1,200 duplicate lines later) (ARCH-4).

### Phase 3 — Lock in quality (1–2 days; prevents regression)
23. **Add guardrails:** `no-explicit-any: 'warn'`, a `coverageThreshold` floor (higher on
    `src/utils`, `src/providers/*/runtime`, security paths), wire `test:coverage` into CI (Q-3).
24. **Add `asSettingsBag()` helper**, replace the 34 casts (Q-2).
25. **Cover the untested security/robustness paths** — `ClaudeApprovalHandler`,
    `AcpToolStreamAdapter`, `HomeFileAdapter`, deny/error/cancellation branches (Q-4).
26. **Route hardcoded Notices through `t()`** — start with `InputController.ts` + `main.ts`,
    then sweep `features/tasks`/settings/provider UIs (Q-1). Resolve the two `Phase F` TODOs.

---

## Sequencing rationale

- **Phase 0 is non-negotiable and first** — you cannot trust any further change while CI is red
  and teardown leaks processes.
- **Security (1a) and performance (1b) are independent and parallelizable** — different files,
  no overlap; 1b is the user-visible win.
- **Architecture (Phase 2) is deliberately after** the stability/security/perf work: it touches
  the most files and benefits from a green CI and the new tests as a safety net.
- **Guardrails (Phase 3) come last** so the thresholds are set against an already-improved
  baseline rather than codifying current gaps.

## What is already good (do not re-litigate)
Clean provider boundary (no provider branching in `features/`); no `innerHTML`; `onunload`
correctly does not detach leaves; no long-lived view references; per-provider services are
genuinely shared not copy-pasted; history is **not** re-encoded/re-read per turn; regexes are
linear; subprocess args are arrays (no `shell:true`); path containment uses realpath + segment
checks; i18n keys perfectly synced.

---

## Implementation status (branch `claude/codebase-review-improvements-nwhg5`, PR #9)

**Landed & verified (typecheck/lint/test/build green):**
- **Phase 0** — CI green (platform-coupled tests fixed + win32/ubuntu matrix); subprocess-leak
  fixes (awaitable `cleanup()`, `onunload` disposal, hardened `shutdown()`, Cursor SIGKILL).
- **fileLink** containment hardening (reject `..` candidates).
- **Phase 1a** — SEC-1 (safe default `'normal'`, YOLO opt-in + one-time warning), SEC-3 (vault
  MCP default-disabled **with a one-time grandfather migration** for existing installs), SEC-4
  (curated env for MCP *test* spawns), SEC-6 (broadened + anchored redaction).
- **Phase 1b** — PERF-1 (no per-chunk reflow; O(N·T)→O(1)), PERF-3 (size-aware streaming
  throttle, byte-exact final render), PERF-2 lazy image attrs.
- **Phase 2 (round 1)** — ARCH-7 (Claude & Cursor auxiliary folded onto shared `QueryBacked*`,
  −450 LOC, 4 adapters), ARCH-8 (provider settings load-normalization hook; app shell no longer
  imports provider-specific settings logic), ARCH-4 (Cursor "ACP" docs corrected). Each
  independently reviewed: behavior-preserving, nothing blocking.
- **Phase 3 (guardrails)** — `no-explicit-any → warn` (src; the lone `EventBus` `any` is now an
  explained, justified disable → **zero lint warnings**), `coverageThreshold` floors (global +
  higher on security/runtime paths), CI coverage job.

**Tracked follow-ups (from the cross-phase reviews):**
- **ARCH-8** — `persistProviderLastModel`/`persistProviderEnvironmentHash` are implemented only on
  Claude's reconciler; if a future caller invokes them while a non-Claude provider is the active
  settings provider, the write silently no-ops. Implement the hooks on the other reconcilers (or
  fall back/log) before wiring a real caller. `normalizeOnLoad` is a forward-looking seam with no
  implementer yet (justified by the decoupling; harmless).
- **Phase 2 (remaining, dedicated rounds — too entangled to parallelize):** ARCH-1 `PluginContext`
  extraction (collapses the 184 cycles), ARCH-3 `ConversationStore`, ARCH-5 god-file splits
  (`Tab.ts`/`InputController.ts`), ARCH-6 stream-projection extraction (pair with the Phase 1b
  rendering adapter).
- **Q-2** — `asSettingsBag()` helper replacing the 34 `settings as unknown as Record<…>` casts
  (deferred until the auxiliary/settings refactors landed; now unblocked).
- **SEC-2** — wire `vaultTrust.shouldHonorProjectSettings` into the live `resolveClaudeSettingSources`
  call sites + a confirmation modal. Until then, risky project `.claude/settings.json` (hooks /
  `permissions.allow`) is still honored. This is also the proper close for the SEC-3 residual
  (a fresh install whose first-opened vault contains untrusted MCP servers).
- **SEC-4** — extend the curated child env to **live** chat MCP spawns (currently only the
  in-app test-connection flow), e.g. per-server `env` via the SDK `mcpServers` option.
- **PERF-2** — full message-list virtualization (deferred; design note captured).
- **Perf hygiene** — wire `StreamController.resetStreamingState()` into the force session-reset
  teardown (removes dead code + closes a benign stale-timer window); route the two remaining
  non-hot-path `scrollHeight` reads through `scrollMessagesToBottom`.
- **i18n** — translate the `chat.permissionMode.yoloWarning` string (currently English in all
  locales).
- **Phase 2 (architecture)** and **Phase 3 (guardrails)** remain as planned above.
