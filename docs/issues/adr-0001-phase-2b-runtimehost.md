---
type: issue
id: issue-20260603-adr0001-phase2b-runtimehost
title: ADR-0001 Phase 2b — migrate runtimes onto RuntimeHost and delete the seven callback setters
status: open
priority: 1 - high
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (ARCH-1)"
related:
  - "[[docs/adr/0001-transport-agnostic-provider-seam.md]]"
scope: provider-runtime-seam
tags:
  - architecture
  - provider-boundary
  - tech-debt
  - dead-code
---

# ADR-0001 Phase 2b — RuntimeHost migration

## Problem

ADR-0001 Phase 2a defined `src/core/runtime/RuntimeHost.ts` (51 LOC) as the typed replacement for the
seven `set*Callback` setters, but **it is imported by zero files** — dead code. All seven setters
(`setApprovalCallback`, `setApprovalDismisser`, `setAskUserQuestionCallback`, `setExitPlanModeCallback`,
`setPermissionModeSyncCallback`, `setSubagentHookProvider`, `setAutoTurnCallback`) remain on the
`ChatRuntime` interface and are implemented by every runtime. Cursor and Opencode each carry **7 no-op
`{}` stubs**. The interface still permits the `set*(null)` escape hatch the ADR wanted to close.

## Evidence

- `src/core/runtime/RuntimeHost.ts` — defined, unused.
- `src/core/runtime/ChatRuntime.ts:54-60` — the seven setters.
- `src/providers/cursor/runtime/CursorChatRuntime.ts:330,338` (and siblings) — no-op stubs.
- `src/providers/opencode/runtime/OpencodeChatRuntime.ts:527-537` — no-op stubs.
- Wiring site: `src/features/chat/tabs/tabControllers.ts:473-511` — calls all seven setters.

## Proposed change

Per ADR-0001 Move 3 / Phase 2b: pass a `RuntimeHost` object at runtime construction (single wiring site),
remove the seven setters from `ChatRuntime`, and delete the ~14 no-op stubs across Cursor/Opencode.
Preserve the `plugin.logger.scope('runtime')` breadcrumbs inside the host callbacks.

## Acceptance criteria

- `RuntimeHost` is consumed by all four runtimes at construction; the seven `set*Callback` members are gone.
- The cancel-dismiss invariant test asserts `host.dismissApproval()` fires on cancel/reset for both Claude
  (`ClaudeChatRuntime.ts:1660`) and Codex (`CodexChatRuntime.ts:752`).
- A typed `createMockRuntime()` drift guard fails compilation if a `ChatRuntime` member is added without
  the helper.
- `typecheck && lint && test && build` green.

## Out of scope

- Phase 3 transport extraction (tracked separately).
- Capability-mixin hierarchy (ADR demotes this to marking optional members optional).
