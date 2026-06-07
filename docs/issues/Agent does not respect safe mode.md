---
status: fixed
priority: 3 - low
relations:
  - "[[sidepanel-chat]]"
tags:
type: bug
---
When setting the chat into safe mode, the agent is still able to create a new file

## Root cause

`ClaudeChatRuntime.applyDynamicUpdates` and `createApprovalCallback` both read
`this.plugin.settings.permissionMode` (the raw global setting) instead of the
Claude-projected value from `getScopedSettings().permissionMode`. When a non-Claude
provider (e.g. Codex in YOLO mode) is the active settings provider,
`plugin.settings.permissionMode` carries that provider's value and overrides
Claude's own saved safe-mode, allowing agent-board Claude tasks to bypass
permissions.

## Fix

`src/providers/claude/runtime/ClaudeChatRuntime.ts` — both `getPermissionMode`
closures changed from `() => this.plugin.settings.permissionMode` to
`() => this.getScopedSettings().permissionMode as PermissionMode`.

Direct-chat behavior is unchanged: when Claude is the active settings provider,
both expressions return the same value.

## Regression test

`tests/unit/core/providers/ProviderSettingsCoordinator.test.ts` — new case
"returns the Claude-saved permission mode when a non-Claude provider is active in
YOLO" verifies the projection invariant the fix relies on.
