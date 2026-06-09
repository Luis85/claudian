---
type: issue
id: issue-20260603-deferred-view-load-time
title: Confirm chat view defers (isDeferred/loadIfDeferred) and no child process spawns at load
status: done
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-09
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (OBS-D)"
scope: obsidian-compliance
tags:
  - obsidian-compliance
  - performance
  - load-time
---

# Deferred-view / load-time confirmation

## Problem

Obsidian's load-time guidance flags eager heavy work at startup. OBS-1 moved heavy `onload` work into
`app.workspace.onLayoutReady`, but this issue is the explicit confirmation that the chat sidebar view
**defers** (honors `WorkspaceLeaf.isDeferred` / calls `loadIfDeferred()`) and that **no child process
spawns at load** — both are automated-review/startup-bloat flags.

## Proposed change

Verify the chat view's deferred-load behavior and that no provider subprocess is spawned during `onload`
or initial view mount; fix any eager spawn/IO.

## Acceptance criteria

- Chat view is deferred-load-safe; provider processes spawn only on first use, not at plugin/view load.
- Documented confirmation (or a guard test) of no load-time spawn.

## Resolution (2026-06-09)

Traced `src/main.ts` `onload()`, `src/app/lifecycle/`, `src/app/views/PluginViewActivator.ts`,
`src/core/providers/ProviderWorkspaceRegistry.ts`, the chat tab lifecycle, and every provider runtime's
spawn entry point. **Confirmed on both counts for the default configuration; no source fix required.**
Two opt-in, deliberately designed warmups are documented below as gated exceptions.

### (a) Deferred-view semantics — confirmed safe

- The chat view is registered normally (`registerView(VIEW_TYPE_CLAUDIAN, ...)`, `src/main.ts:164-167`);
  nothing in the startup path force-loads a deferred leaf.
- All startup-path leaf lookups go through `getView()`/`getAllViews()` (`src/main.ts:825-833`), which map
  `leaf.view` through the duck-typed `isClaudianView` predicate
  (`src/features/chat/isClaudianView.ts:16-20`). An Obsidian `DeferredView` placeholder has no
  `getTabManager`, so deferred leaves are filtered out — never cast, never loaded. The post-layout
  `completeDeferredOnload()` view reprobe (`src/main.ts:349-355`) iterates the same filtered set.
- The only `loadIfDeferred()` call site is `src/features/settings/ui/EnvSnippetManager.ts:423-429`,
  inside an explicit user action (applying env changes) — the correct pattern per the predicate's doc
  comment.
- View activation (`PluginViewActivator.activateView`, `src/app/views/PluginViewActivator.ts:13-28`)
  runs only from the ribbon icon, commands, or other explicit user entry points; `onload` never calls it.
- `onunload` (`src/main.ts:358-383`) does not detach Claudian leaves (compliant with the deferred-view
  guidance to leave leaves in place).

### (b) No provider child process at onload / initial view mount — confirmed for the default path

- `onload()` (`src/main.ts:136-312`) constructs no runtime and spawns nothing. Heavy provider workspace
  init is deferred to `app.workspace.onLayoutReady` → `completeDeferredOnload()` (`src/main.ts:309-311`).
- Chat runtime creation is lazy per tab: `initializeTabService`
  (`src/features/chat/tabs/tabLifecycle.ts:19`, "This is the ONLY place a runtime is created") is reached
  via `ensureServiceInitialized()` in `InputController.sendMessage()`
  (`src/features/chat/controllers/InputController.ts:460-461`,
  `src/features/chat/tabs/tabControllers.ts:459`) — i.e. on the first send. Tab create/restore performs
  passive `syncConversationState` only.
- Every runtime constructor is passive; the actual spawn sites are all on the query/ensureReady path:
  - Claude: persistent query starts on demand inside `query()`
    (`src/providers/claude/runtime/ClaudeChatRuntime.ts:1790-1791`); spawn seam is
    `customSpawn.ts`.
  - Codex: `new CodexAppServerProcess(...)` in `startProcess`
    (`src/providers/codex/runtime/CodexChatRuntime.ts:821`), reached from `ensureReady()`/`query()`.
  - Cursor: `spawn(...)` per turn inside `query()`
    (`src/providers/cursor/runtime/CursorChatRuntime.ts:168`).
  - Opencode: `startProcess` from `ensureReady()`
    (`src/providers/opencode/runtime/OpencodeChatRuntime.ts:313`).
- With default settings (only Claude enabled), **zero child processes are spawned at plugin load or chat
  view mount**; the Claude CLI starts on the first send. Claude's runtime-command probe
  (`probeRuntimeCommands`) is a lazy thunk inside `ClaudeCommandCatalog`
  (`src/providers/claude/app/ClaudeWorkspaceServices.ts:113`) invoked on first slash-command use, not at
  init.
- Non-provider note: `GitStatusWatcher` (installed at onload, `src/main.ts:151`) constructs objects only;
  `git` subprocesses run on debounced vault-event refreshes, not at load, and are not provider CLIs.

### Documented exceptions (opt-in providers' intentional warmups, not changed)

1. **Cursor model-catalog probe** — `warmCursorModelCatalog`
   (`src/providers/cursor/app/CursorWorkspaceServices.ts:23-42`) runs during
   `ProviderWorkspaceRegistry.initializeAll` from `completeDeferredOnload` (post-`onLayoutReady`, not in
   `onload`). It spawns a short-lived `cursor-agent --list-models`
   (`src/providers/cursor/runtime/cursorModelCatalog.ts:142-196`) **only when the Cursor provider is
   enabled (opt-in, default off) and its CLI resolves**; fire-and-forget with a 10s timeout and
   tree-kill. Rationale: the chat model dropdown and settings reconciler read the catalog cache-only,
   so without the warm they would sit on static fallbacks.
2. **Opencode command-metadata warmup** — at view mount `ClaudianView.initTabContent` calls
   `tabManager.primeProviderRuntime()` (`src/features/chat/ClaudianView.ts:304`), and tab activation
   primes the active tab (`src/features/chat/tabs/TabManager.ts:371`). Opencode is the only provider
   registering a `tabWarmupPolicy` (mode `'commands'`,
   `src/providers/opencode/app/OpencodeWorkspaceServices.ts:23-27`); the warmup runs
   `OpencodeRuntimeCommandLoader.loadCommands`
   (`src/providers/opencode/app/OpencodeRuntimeCommandLoader.ts:15-66`), which may start an isolated
   short-lived Opencode runtime to discover ACP slash commands (cleaned up in `finally`). **Gated on the
   Opencode provider being enabled (opt-in, default off) and the active tab being an Opencode tab.**
   If the chat leaf is deferred at startup (hidden sidebar), the view mounts — and this warmup runs —
   only when the user reveals it.

Both are existing, commented design decisions (runtime-discovered commands / cache-only model catalog),
gated behind providers that are disabled by default, and run off the `onload` critical path. They are
recorded here rather than removed; revisit only if Obsidian review flags them.

### Tests added (guard the lazy-spawn contract)

- `tests/unit/providers/cursor/runtime/CursorChatRuntime.test.ts`: constructing the runtime + passive
  `syncConversationState` never calls `spawn`.
- `tests/unit/providers/codex/runtime/CodexChatRuntime.test.ts`: construction + passive sync never
  instantiates or starts `CodexAppServerProcess`.
- `tests/unit/providers/opencode/OpencodeChatRuntime.test.ts`: construction + passive sync never calls
  `startProcess`; `process` stays null.
- Claude already guarded: `ClaudianService.test.ts` "should NOT call ensureReady when setting session ID
  (passive sync)".
