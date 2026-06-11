---
type: tech-debt
title: "RuntimeHost exists but ChatRuntime still exposes mutable callback setters"
date: 2026-06-07
updated: 2026-06-10
status: done
priority: "2 - normal"
severity: medium
scope: provider-runtime-interface
tags:
  - tech-debt
  - architecture
  - runtime
  - provider-boundary
related:
  - "[[0001-transport-agnostic-provider-seam]]"
  - "[[2026-06-03-comprehensive-improvement-proposal]]"
---

# RuntimeHost exists but ChatRuntime still exposes mutable callback setters

## Summary

ADR-0001 designed a `RuntimeHost` interface to replace the runtime's callback setter surface, but the migration is only partial. The type exists in `src/core/runtime/RuntimeHost.ts`; the runtime interface and provider implementations still use seven mutable `set*Callback` methods.

## Evidence

- `src/core/runtime/RuntimeHost.ts` defines the intended host object.
- `src/core/runtime/ChatRuntime.ts` still exposes:
  - `setApprovalCallback`
  - `setApprovalDismisser`
  - `setAskUserQuestionCallback`
  - `setExitPlanModeCallback`
  - `setPermissionModeSyncCallback`
  - `setSubagentHookProvider`
  - `setAutoTurnCallback`
- `src/features/chat/tabs/tabControllers.ts` still wires callbacks through `setupServiceCallbacks` after runtime creation.
- Cursor and Opencode still implement several no-op setter methods despite their capabilities being gated.
- `rg RuntimeHost src` finds the type definition but no production caller using it as the construction-time host.

## Why it matters

The current interface is wider than callers need to understand, and it permits null callback states that the runtime has to defend against. This is a shallow interface: provider adapters must implement a large surface even when most callbacks are unsupported or no-op. A construction-time `RuntimeHost` would concentrate UI callback behavior at one seam and increase locality.

## Suggested remediation

1. Construct a `RuntimeHost` once in the chat tab composition layer.
2. Pass it into provider runtime construction or initialization.
3. Migrate functional callback paths first: approvals, ask-user, plan exit, permission-mode sync, auto turns, subagent state.
4. Delete no-op setter implementations for unsupported provider capabilities.
5. Update tests from "setter was called" to "runtime invokes host behavior".

## Acceptance criteria

- [x] `ChatRuntime` no longer exposes the seven callback setters.
- [x] Providers receive a non-null `RuntimeHost` at construction or initialization.
- [x] Cancel/reset paths still dismiss approval UI.
- [x] Cursor and Opencode no-op callback methods are removed rather than preserved as stubs.
- [x] Runtime tests cover the host interaction through behavior, not setter call counts.

## Resolution (2026-06-10)

`CreateChatRuntimeOptions` carries a required `host: RuntimeHost`; all four
provider registrations pass it to their runtime constructors. The production
host is built in `src/features/chat/tabs/tabRuntimeHost.ts` at the single
runtime-creation site (`tabLifecycle.initializeTabService`);
`setupServiceCallbacks` is deleted. Runtimes created outside a chat tab
(Opencode warmup paths) use `createHeadlessRuntimeHost()`, whose members
reproduce the old null-callback fail-closed outcomes by construction.
Provider-side nullable callback fields, no-op stubs, and null-guard branches
are gone; `ClaudeApprovalHandler` / `CodexServerRequestRouter` depend on
narrowed `Pick<RuntimeHost, …>` views. Cancel→dismiss is asserted through
host behavior for Claude and Codex, and the setter-call test suites were
rewritten against a typed `MockRuntimeHost` (tests/helpers/runtimeHost.ts).
