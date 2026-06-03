---
title: Cursor Hardening — Telemetry log codes (design)
date: 2026-05-30
status: design / deferred to PR2
scope: src/providers/cursor/history, src/providers/acp, src/providers/cursor/runtime
supersedes: none
related:
  - docs/superpowers/plans/2026-05-30-cursor-integration-hardening.md (parent plan)
  - docs/reviews/2026-06-02-cursor-hardening-verified.md (verification report)
---

# Cursor Hardening — Telemetry log codes

Planned log lines at `info` level for post-deploy verification of the hardening fixes. Implementation deferred to PR2 because three of the four call sites lack a `plugin.logger` reference today; PR2 already touches `AcpSubprocess` and `AcpJsonRpcTransport`, which is the right time to plumb the logger.

## Planned codes

| Code | Site | Trigger | Owner PR |
|------|------|---------|----------|
| `cursor.history.load_failed` | `CursorConversationHistoryService.hydrateConversationHistory` | `loadCursorChatMessagesFromStoreResult` returns a non-undefined `error` | PR2 (needs logger in service constructor; currently the service is instantiated bare in `registration.ts:26`) |
| `acp.transport.close_with_pending` | `AcpJsonRpcTransport.close`/`dispose` | At least one pending request is rejected on close | PR2 (Task 7 / 8 area; logger needs plumbing into the transport) |
| `acp.subprocess.kill_escalated` | `AcpSubprocess` shutdown | SIGKILL escalation timer fires after SIGTERM | PR2 (Task 6 already touches this file) |
| `cursor.inline_edit.cancel` | `CursorInlineEditService.cancel` (or shared `QueryBackedInlineEditService.cancel`) | User cancels mid-stream | Could land in PR1 (the service already extends a shared base that has plugin access via `ff3a179`); deferred to PR2 for cohesion with the other three codes |

## Field shape

All four entries log with `level: 'info'` and a structured args object:

```ts
plugin.logger.scope('cursor.hardening').info(code, { /* args */ });
```

Common args:

- `cursor.history.load_failed` — `{ conversationId, errorRedacted }` (the redacted message from `getLastHistoryLoadError`)
- `acp.transport.close_with_pending` — `{ pendingCount, reason }`
- `acp.subprocess.kill_escalated` — `{ platform, escalatedAfterMs }`
- `cursor.inline_edit.cancel` — `{ providerId: 'cursor', cancelReason? }`

## Why deferred

PR1 was scoped "cold paths, low risk, no constructor-signature changes" (see plan `## PR split`). Three of the four log sites today have no logger in scope:

- `CursorConversationHistoryService` is instantiated as a bare `new ...()` in `registration.ts:26`; plumbing a logger means changing the `ProviderRegistration.historyService` shape from a singleton instance to a factory.
- `AcpJsonRpcTransport` and `AcpSubprocess` are constructed inside the ACP layer; their constructors don't currently take a logger. PR2 already touches both files for kill-signal + id-allocation fixes; adding logger access then is a single hop.

Adding logger plumbing in PR1 would (a) break the "no constructor-signature changes" risk tier, and (b) be undone or re-done by PR2 anyway. Defer to PR2.
