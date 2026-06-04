---
type: issue
id: issue-20260603-opencode-plan-approval-card
title: Opencode plan turns never emit planCompleted, so the inline plan-approval card never opens
status: open
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (PN-4 correction); [[docs/product/user-manuals/plan-mode.md]]"
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
