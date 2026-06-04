---
type: issue
id: issue-20260603-opencode-plan-approval-card
title: Opencode plan turns never emit planCompleted, so the inline plan-approval card never opens
status: shipped
priority: 2 - normal
triage: done
created: 2026-06-03
updated: 2026-06-04
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (PN-4 correction); [[plan-mode]]"
scope: opencode-capability
tags:
  - opencode
  - plan-mode
  - approval
---

# Opencode plan-approval card gap

## Already shipped (do NOT rebuild)

Opencode plan **mode** is wired: `supportsPlanMode: true` (`opencode/capabilities.ts:7`), the toolbar
toggle / Shift+Tab switches the session into the managed `plan` mode via
`setConfigOption({ configId: 'mode' })` (`opencode/modes.ts:124-147`), and runtime slash commands are
already surfaced (`AcpSessionUpdateNormalizer.ts:97-99` → `OpencodeRuntimeCommandLoader`). This issue is
**not** about ungating plan mode or adding slash commands.

## Problem (the one real gap)

The Opencode runtime **never sets `planCompleted` on the turn metadata**. The shared `InlinePlanApproval`
card is gated on that flag, so it does not open for Opencode plan turns — the session runs with planning
constraints but the user never gets the inline approve / revise / cancel prompt and must drive the next
step from the chat input manually. (Documented under "Gated providers" in `plan-mode.md`.)

## Evidence

- `docs/product/user-manuals/plan-mode.md` § "Gated providers".
- Claude/Codex/Cursor report `planCompleted` and open the shared `InlinePlanApproval` card; Opencode does not.

## Proposed change

Detect plan completion in the Opencode stream/runtime (e.g. an end-of-plan signal in the ACP
`session/update` stream or a managed `plan`→exit transition) and set `planCompleted` so the shared
post-plan approval flow opens, consistent with the other providers.

## Acceptance criteria

- An Opencode plan turn opens the shared `InlinePlanApproval` card (approve / revise / cancel).
- No regression to the toolbar toggle / Shift+Tab mode switch that already works.

## Resolution (2026-06-04)

`OpencodeChatRuntime` now captures `currentTurnIsPlan` after `applySelectedMode` (mode === `OPENCODE_PLAN_MODE_ID`)
and flips `currentTurnSawAssistantContent` whenever an `agent_message_chunk` normalizes into non-empty
stream chunks. On successful prompt resolution, `finalizePlanTurnMetadata` sets
`currentTurnMetadata.planCompleted = true`, so the shared `InlinePlanApproval` card opens once
`consumeTurnMetadata` is read by `InputController`. Covered by `OpencodeChatRuntime.test.ts` "plan-completion
metadata" (plan + content → planCompleted, non-plan → omitted, plan + no content → omitted).
