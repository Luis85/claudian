---
date: 2026-06-04
status: shipped
type: user-manual
parent: "[[sidepanel-chat]]"
---
# Specorator — Plan mode

This manual covers **plan mode**: a per-tab toggle that asks the agent to draft a plan and *not* run write-side tools until you approve it. Each provider implements plan mode against its own runtime, so the same toggle gives you different guarantees and surfaces depending on which provider is active in the tab.

Plan mode is provider-native draft-before-run behavior inside normal chat.

---

## Before you start

Plan mode is a per-conversation setting. There is nothing to install — the toggle appears on the input toolbar whenever the active provider declares `supportsPlanMode`. The button is hidden for providers that gate plan mode.

If you flip plan mode mid-conversation, Specorator remembers the **previous permission mode** in the tab state and restores it after a successful approval (see [Approving or rejecting a plan](#approving-or-rejecting-a-plan)).

---

## Provider support

| Provider | Plan mode | Plan file directory | Notes |
|----------|-----------|---------------------|-------|
| **Claude** | Yes | `/.claude/plans/` | Driven by the SDK's `EnterPlanMode` / `ExitPlanMode` tools. The SDK auto-approves `EnterPlanMode`; Specorator detects it in the stream to sync the toolbar. `ExitPlanMode` triggers the inline approval card. |
| **Codex** | Yes | (no fixed prefix) | Sent as `collaborationMode: { mode: 'plan' }` on `turn/start`. `approvalPolicy` becomes `on-request` and sandbox stays `workspace-write`. Approval card fires when the turn metadata reports `planCompleted` (set when both `isPlanTurn` and `sawPlanDelta` are true after the turn). |
| **Cursor** | Yes | `.cursor/plans` | Passes `--mode plan` to `cursor-agent` and tracks the `CreatePlan` tool result. When that tool completes, the turn reports `planCompleted: true` and the shared approval card opens. |
| **Opencode** | Yes | — | Routes plan turns through Opencode's managed `plan` mode (`OPENCODE_PLAN_MODE_ID`) via `setConfigOption({ configId: 'mode' })`. The runtime captures `isPlanTurn` after the mode is applied and tracks assistant content during the stream; when the prompt resolves with at least one assistant chunk, the turn reports `planCompleted: true` and the shared approval card opens. |

> Per-provider capabilities live in `src/providers/<id>/capabilities.ts`. Only providers with `supportsPlanMode: true` ever show the toggle.

---

## Turning plan mode on

Three ways, all do the same thing — flip the active tab into plan mode and remember the prior mode for restore.

- **Toolbar button** — the map icon next to the permission toggle. Aria label `Toggle plan mode`. Tooltip is `Plan mode — click or Shift+Tab to enter` when inactive and `Plan mode on — click or Shift+Tab to exit` when active.
- **Shift+Tab** — a view-level keybind on the chat panel. Toggles plan mode for the active tab regardless of which element has focus. The handler checks `supportsPlanMode` first; on providers that gate plan mode, Shift+Tab does nothing.
- **Click the `PLAN` label on the permission toggle** — when plan mode is on, the normal Normal/Yolo switch hides and the label flips to `PLAN` (`plan-active`). Clicking the plan-mode button again turns it off.

When plan mode is active, the input wrapper picks up the `specorator-input-plan-mode` class — the input area gets a distinct plan-mode treatment from `src/style/features/plan-mode.css`.

---

## What plan mode changes

The same toggle drives different per-provider behavior at the moment the runtime starts a turn:

- **Claude** — `permissionMode` resolves to the SDK's `plan` mode through `resolveClaudeSdkPermissionMode`. The Claude SDK restricts the tool set to read-only operations and stages `EnterPlanMode` automatically. Plan mode propagates through dynamic updates, so flipping the toggle takes effect on the *next* turn without restarting the persistent query.
- **Codex** — `turn/start` is sent with `collaborationMode: { mode: 'plan', settings: { model, reasoning_effort, developer_instructions: null } }`, `approvalPolicy: 'on-request'`, and `sandbox: 'workspace-write'`. The notification router opens the turn with `beginTurn({ isPlanTurn: true })` so that `item/plan/delta` events arm the planCompleted signal.
- **Cursor** — `cursor-agent` is launched with `--mode plan --sandbox <enabled|disabled>`. The chunk tracker watches for a `CreatePlan` tool result; only then does the turn report `planCompleted`.
- **Opencode** — the runtime calls `setConfigOption({ configId: 'mode', value: 'plan' })` before sending the prompt, captures `currentTurnIsPlan` from the session mode after the switch, and tracks `currentTurnSawAssistantContent` as agent message chunks arrive. When the prompt resolves successfully with at least one assistant chunk, `finalizePlanTurnMetadata` sets `planCompleted: true`.

Across all four providers, plan mode is meant to keep the agent in a read-and-think loop. The runtime decides which tools are off-limits — Specorator does not enforce a tool allowlist of its own.

---

## Reading the plan

The chat renderer surfaces plan turns inline:

- For Claude, the `EnterPlanMode` and `ExitPlanMode` tool calls render with the labels `Entering plan mode` and `Plan complete`. They appear in the message stream alongside other tool blocks.
- For Codex, Cursor, and Opencode, plan content streams as part of the assistant message; the trigger for the approval card is the `planCompleted` flag in the turn metadata, not a specific tool icon.

If a write-side tool is dispatched against the provider's plan directory during plan mode, `StreamController.capturePlanFilePath` records the path on `state.planFilePath` for the tab. The capture only fires when the tool's `file_path` lies under `capabilities.planPathPrefix` — `/.claude/plans/` for Claude, `.cursor/plans` for Cursor. Codex has no plan-path prefix, so this path is never captured there.

The captured path lets the post-plan approval card load the actual plan file from disk and preview its Markdown alongside the approval choices.

---

## Approving or rejecting a plan

When a plan turn completes, Specorator opens a provider-agnostic approval card inline below the response. It always shows the plan content first (from the captured plan file if available, otherwise from the turn metadata):

- **Claude** uses `InlineExitPlanMode`, driven by the SDK's `ExitPlanMode` tool. The choices are:
  - `1. Approve (new session)` — defaults to the `Implement this plan:` prefix followed by the plan markdown. Closes the current turn, starts a fresh conversation, and auto-sends the plan as the first message.
  - `2. Approve (current session)` — keeps the conversation; the SDK returns `approve` and continues in-place.
  - `3. <feedback box>` — type and press Enter to send feedback. Plan mode stays on.
- **Codex** and **Cursor** use the shared `InlinePlanApproval` card, fed by `buildPlanArtifactFromChatState({ planFilePath })`. The choices are:
  - `1. Implement` — restores the pre-plan permission mode and auto-sends `Implement the plan.` as the next user message.
  - `2. <feedback box>` — `Revise` keeps plan mode active and pastes the feedback text into the input for you to edit and send.
  - `3. Cancel` — restores the pre-plan permission mode and stops here.

The approval card supports arrow keys to navigate, Enter to select, and Esc to dismiss. Dismissing is equivalent to canceling — pre-plan mode is restored.

If the file at `planFilePath` falls *outside* the provider's `planPathPrefix`, the card refuses to read it and shows a `Could not read plan file` notice; "Approve (new session)" then falls back to the literal text `Implement the approved plan.`

---

## Typical flow

1. Open a tab with a plan-mode provider (Claude, Codex, Cursor, or Opencode).
2. Hit **Shift+Tab** or click the map icon — the input wrapper picks up the plan-mode class and the toolbar label switches to `PLAN`.
3. Send your request. The runtime drafts a plan; for Claude you'll see explicit `Entering plan mode` and `Plan complete` tool blocks; for Codex, Cursor, and Opencode the plan streams as assistant text.
4. When the turn ends, the approval card appears below the response with the plan preview.
5. Pick **Implement** / **Approve** to act on it, **Revise** / type feedback to iterate, or **Cancel** / Esc to step out. Pre-plan permission mode is restored on Implement / Approve / Cancel; Revise keeps you in plan mode.

To leave plan mode without a plan turn (e.g., you flipped the toggle by accident), press **Shift+Tab** again or click the active plan-mode button. Your previous permission mode is restored from `state.prePlanPermissionMode`.
