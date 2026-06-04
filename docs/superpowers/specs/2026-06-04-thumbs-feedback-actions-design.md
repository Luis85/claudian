---
title: "Thumbs up / thumbs down feedback actions on agent responses"
date: 2026-06-04
status: draft
scope: features/chat, main.ts, i18n
---

# Thumbs up / thumbs down feedback actions on agent responses

## Problem

Today the only direct affordances on a completed agent response are **Copy** and **Create work order**. There is no fast way for the user to signal that an answer landed well or missed the mark, and no built-in path to ask the agent for a course-correcting follow-up when it missed. Users have to type the same kind of feedback message by hand every time.

## Goal

Add two icon buttons — thumbs-up and thumbs-down — to the same per-message action row as **Create work order** and **Copy**. Clicking either button dispatches a canned prompt as a normal user turn:

- **Thumbs-up** sends a short positive acknowledgement asking the agent to note what worked so it carries forward.
- **Thumbs-down** sends a prompt asking the agent to first ask one focused follow-up question about why the user disagrees, before retrying.

Both clicks produce real turns visible in the transcript, indistinguishable from a typed message from the user's perspective.

## Non-goals

- No persistence of the rating on the `ChatMessage` (no `rating` field, no UI "selected" state, no analytics surface).
- No settings UI to override the prompt text. Defaults ship in i18n; user overrides deferred until requested.
- No vault quick-action file backing this feature. The two prompts are i18n strings, not `docs/quick-actions/*.md` entries.
- No new contract on `ChatMessageAction`. We use the existing registry as-is.
- No provider gating. Available on Claude, Codex, Opencode, and Cursor — every runtime already consumes a `ChatTurnRequest` the same way through `sendMessage({ content })`.

## Approach

Reuse the existing `ChatMessageAction` registry that already powers **Create work order**. Register two new actions in `main.ts`, both delegating to a small shared helper that resolves the target tab and dispatches a turn via `tab.controllers.inputController.sendMessage({ content })`. This is the same dispatch shape used by `features/quickActions/openContextMenuQuickAction.ts` and the orchestrator goal flow.

Rationale: smallest diff that ships the feature, mirrors an established pattern, no new contracts. If a second feedback feature lands later (e.g. persistence, configurable prompts), the helper is the natural seam to lift into a `features/feedback/` slice.

## Architecture

```text
User clicks thumbs icon (.claudian-text-action-btn)
  -> MessageRenderer.addAssistantMessageActions invokes action.run(msg, conversationId)
     -> sendFeedbackPrompt(plugin, msg, conversationId, direction)
        -> resolve target tab via plugin.getView().getTabManager()
           (match by conversationId; fall back to active tab if null/no match)
        -> read i18n string `chat.feedback.thumbs<Direction>.prompt`
        -> tab.controllers.inputController.sendMessage({ content: prompt })
           -> standard ChatTurnRequest -> ChatRuntime.query -> StreamController
```

No new types in `core/`. The helper sits inside `features/chat/feedback/` so it can reach `TabManager` and `InputController` directly without crossing the `core` boundary.

## Components

| File | Purpose |
|------|---------|
| `src/features/chat/feedback/sendFeedbackPrompt.ts` | New. Pure function `sendFeedbackPrompt(plugin, message, conversationId, direction)`. Resolves target tab, reads the i18n-keyed prompt, calls `inputController.sendMessage({ content })`. Logs `debug` and returns when no view, no matching tab, or no `inputController`. |
| `src/main.ts` | Two more `this.registerChatMessageAction({...})` calls placed immediately after the existing `create-work-order-from-message` registration. Eligibility: `msg.role === 'assistant' && Boolean(chatMessageText(msg))`. Icons: `'thumbs-up'`, `'thumbs-down'` (both ship with Obsidian's bundled lucide icons). |
| `src/i18n/locales/en.json` (+ `de`, `es`, `fr`, `ja`, `ko`, `pt`, `ru`, `zh-CN`, `zh-TW`) | Four new keys under `chat.feedback`:<br>• `thumbsUp.label` — "Helpful"<br>• `thumbsUp.prompt` — "Looks good. Proceed with that approach." (proceed-acknowledgement — gives the agent a green light to continue, not a request to reflect)<br>• `thumbsDown.label` — "Not helpful"<br>• `thumbsDown.prompt` — "That response wasn't helpful. Ask me one focused follow-up question to learn why I disagree before retrying." |
| `src/style/components/messages.css` | No expected change. `.claudian-text-actions .claudian-text-action-btn` already styles icon-only spans. Verify visually during implementation; only add icon-tuning if the two new icons render off-baseline. |

## Action contract reuse

`ChatMessageAction` in `src/core/types/chat.ts` stays unchanged:

```ts
export interface ChatMessageAction {
  id: string;
  label: string;
  icon: string;
  isEligible(message: ChatMessage): boolean;
  run(message: ChatMessage, conversationId: string | null): void;
}
```

Two registrations, in order, in `main.ts` `onload`:

```ts
this.registerChatMessageAction({
  id: 'thumbs-up-feedback',
  label: t('chat.feedback.thumbsUp.label'),
  icon: 'thumbs-up',
  isEligible: (msg) => msg.role === 'assistant' && Boolean(chatMessageText(msg)),
  run: (msg, conversationId) => {
    void sendFeedbackPrompt(this, msg, conversationId, 'up');
  },
});

this.registerChatMessageAction({
  id: 'thumbs-down-feedback',
  label: t('chat.feedback.thumbsDown.label'),
  icon: 'thumbs-down',
  isEligible: (msg) => msg.role === 'assistant' && Boolean(chatMessageText(msg)),
  run: (msg, conversationId) => {
    void sendFeedbackPrompt(this, msg, conversationId, 'down');
  },
});
```

Render order in the registered-actions row will be: `Create work order`, `Thumbs up`, `Thumbs down`, since `MessageRenderer.addAssistantMessageActions` renders in registration order into `.claudian-text-actions` (flex row, left-to-right). The copy button is positioned to the right of `.claudian-text-actions` by CSS (`.claudian-text-copy-btn` at `inset-inline-end: 0`; `.claudian-text-actions` at `inset-inline-end: 22px`). Final left-to-right visual order on hover: `Create work order`, `Thumbs up`, `Thumbs down`, `Copy`.

## Helper shape

```ts
// src/features/chat/feedback/sendFeedbackPrompt.ts
import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';
import type { ChatMessage } from '@/core/types';

export type FeedbackDirection = 'up' | 'down';

export function sendFeedbackPrompt(
  plugin: ClaudianPlugin,
  _message: ChatMessage,
  conversationId: string | null,
  direction: FeedbackDirection,
): void {
  // Prefer the view+tab that actually owns the rated conversation so the
  // feedback turn lands in the correct chat across multi-view setups; fall
  // back to the active view's active tab when no conversationId is given.
  let targetView = plugin.getView();
  let targetTab = targetView?.getTabManager()?.getActiveTab() ?? null;

  if (conversationId) {
    const cross = plugin.findConversationAcrossViews(conversationId);
    if (cross) {
      targetView = cross.view;
      targetTab = cross.view.getTabManager()?.getTab(cross.tabId) ?? targetTab;
    }
  }
  if (!targetView || !targetTab) return;

  const promptKey = direction === 'up'
    ? 'chat.feedback.thumbsUp.prompt'
    : 'chat.feedback.thumbsDown.prompt';
  const content = t(promptKey);
  if (!content) {
    plugin.logger.scope('feedback').debug('empty prompt for direction', direction);
    return;
  }

  void targetTab.controllers.inputController?.sendMessage({ content });
}
```

`_message` is unused today but stays in the signature for forward compatibility (e.g. a later iteration may want to quote the rated text into the prompt). Underscore-prefixed to satisfy lint.

Tab resolution uses the existing `plugin.findConversationAcrossViews(conversationId)` helper (already used by `TabManager` and `ClaudianView`) plus `TabManager.getTab(tabId)` — both exist in the current codebase. If `getTab(tabId)` is private under another name, the helper falls back to the active tab of the active view. No new public surface needs to be added to `TabManager` for this design; if a thin wrapper is required during implementation it stays inside `features/chat/tabs/`.

## Data flow

1. Renderer mounts `.claudian-text-actions` row on a completed assistant message via `addAssistantMessageActions`.
2. User clicks the thumbs-up or thumbs-down span. Click handler stops propagation and calls `action.run(msg, snapshot.id ?? null)`.
3. Helper resolves the target tab. If the user has switched conversations between render and click, we still target the conversation the message belongs to.
4. Helper reads the i18n string and dispatches `sendMessage({ content })`. The send path produces a standard user message in the transcript followed by an assistant response — identical to typing the same text by hand.
5. If a turn is already streaming on the target tab, `sendMessage` falls through its existing queue/no-op logic. No special handling at the action layer.

## Error handling

| Failure | Behavior |
|---------|----------|
| No active `ClaudianView` (view closed between render and click) | Helper returns silently. No notice — closing the view already removed the visible UI. |
| `TabManager` not available (provider workspace not ready) | Helper returns silently after a `debug` log. |
| `conversationId` is null or the conversation moved tabs | Fall back to the active tab; if none, return silently. |
| Target tab is mid-stream | Defer to `inputController.sendMessage`'s normal queue/skip logic. No double-send guard at the action layer. |
| i18n key missing or empty | Helper logs `debug` and returns. Keys must ship in every locale; covered by the locale-completeness test. |
| Provider error during the resulting turn | Surfaces through the normal `StreamController` error path. Same as a typed user message. |

## Testing

### Unit

- `tests/unit/features/chat/feedback/sendFeedbackPrompt.test.ts`
  - Calls `inputController.sendMessage` with the resolved English `thumbsUp.prompt` for `direction: 'up'`.
  - Calls `inputController.sendMessage` with the resolved English `thumbsDown.prompt` for `direction: 'down'`.
  - Returns without throwing when `getView()` returns null.
  - Returns without throwing when no view, no tab manager, and no active tab.
  - Uses `findConversationAcrossViews` result when `conversationId` matches a tab in any open view.
  - Falls back to the active view's active tab when `conversationId` is null.
  - Falls back to the active view's active tab when `findConversationAcrossViews` returns null.
- `tests/unit/main.test.ts` (extend existing or add): asserts both action ids are registered in order after `create-work-order-from-message`, and that `isEligible` returns `false` for user messages and assistant messages with empty text.

### Integration

No new integration spec required. The dispatch path is already exercised by `tests/integration/main.test.ts` and the quickActions integration coverage. A short follow-up assertion can be appended there to confirm the registered ids are non-empty.

### Perf

The renderer perf spec `tests/perf/messageRenderer.perf.test.ts` already exercises the `chatMessageActions` loop and stays within its bounded window. Two extra registered actions are well inside the existing budget; no new perf test.

### i18n

`tests/unit/i18n/locales.test.ts` already exists and asserts each non-English locale defines the keys listed in its `localizedKeys` allowlist. Add the four new keys (`chat.feedback.thumbsUp.label`, `chat.feedback.thumbsUp.prompt`, `chat.feedback.thumbsDown.label`, `chat.feedback.thumbsDown.prompt`) to that allowlist so all nine non-English locales must populate them, otherwise the test fails.

## Out of scope (deferred)

- Recording the rating on the `ChatMessage` for later analytics.
- Persisting the user's free-text follow-up answer (the agent's response to thumbs-down) as structured feedback metadata.
- A settings tab field to override the canned prompts.
- Provider-specific prompt variants (e.g. a different thumbs-down prompt for Codex). Single English default for now, translated to the existing locales.
- A telemetry event on click. Not added; we have no analytics sink today.

## Open questions

None at design time. All decisions captured above were chosen during brainstorming:

1. Click sends a real turn (not silent rating, not staged in composer).
2. No persistence of the rating.
3. All four providers eligible.
4. Prompt source is i18n-hardcoded.
5. Eligibility is every completed assistant message with non-empty text.

## Acceptance

- Thumbs-up and thumbs-down icons render on every completed assistant message in the same row as `Create work order`, across Claude, Codex, Opencode, and Cursor.
- Clicking thumbs-up sends the i18n `thumbsUp.prompt` as a new user turn in the same conversation.
- Clicking thumbs-down sends the i18n `thumbsDown.prompt` as a new user turn in the same conversation.
- No mutations to `ChatMessage` shape; no new `Conversation` fields.
- `npm run typecheck && npm run lint && npm run test && npm run build` all green.
