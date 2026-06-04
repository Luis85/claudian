---
status: done
---
# Thumbs feedback actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add thumbs-up and thumbs-down icon buttons to every completed agent response in the chat toolbar. Click dispatches a canned i18n-backed prompt as a normal user turn.

**Architecture:** Two new `ChatMessageAction` entries registered in `src/main.ts` alongside the existing `create-work-order-from-message`. Both delegate to a shared helper `sendFeedbackPrompt(plugin, message, conversationId, direction)` that resolves the target tab via `plugin.findConversationAcrossViews` (falling back to the active tab) and calls `inputController.sendMessage({ content })`. No schema change, no persistence.

**Tech Stack:** TypeScript, Obsidian Plugin API, Jest, existing i18n module (`@/i18n/i18n`), existing `ChatMessageAction` registry in `src/core/types/chat.ts`.

**Spec:** [[docs/superpowers/specs/2026-06-04-thumbs-feedback-actions-design.md]]

---

## File Structure

| File | Purpose | Created or Modified |
|------|---------|---------------------|
| `src/features/chat/feedback/sendFeedbackPrompt.ts` | Pure helper that resolves target tab and dispatches the i18n prompt | Create (Task 2) |
| `tests/unit/features/chat/feedback/sendFeedbackPrompt.test.ts` | Unit tests for the helper | Create (Task 2) |
| `src/i18n/locales/en.json` | English defaults for `chat.feedback.thumbsUp.*` and `chat.feedback.thumbsDown.*` | Modify (Task 1) |
| `src/i18n/locales/de.json` … `zh-TW.json` (9 files) | Localized copies of the four new keys | Modify (Task 1) |
| `tests/unit/i18n/locales.test.ts` | Extend `localizedKeys` allowlist with the four new keys | Modify (Task 1) |
| `src/main.ts` | Register `thumbs-up-feedback` and `thumbs-down-feedback` actions | Modify (Task 3) |

---

## Task 1: Add i18n keys across all 10 locales

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/de.json`
- Modify: `src/i18n/locales/es.json`
- Modify: `src/i18n/locales/fr.json`
- Modify: `src/i18n/locales/ja.json`
- Modify: `src/i18n/locales/ko.json`
- Modify: `src/i18n/locales/pt.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Modify: `src/i18n/locales/zh-TW.json`
- Modify: `tests/unit/i18n/locales.test.ts`

The locale-completeness test asserts every non-English locale defines the **same key set** as English (`expect(localeKeys).toEqual(englishKeys)`), and the `localizedKeys` allowlist asserts certain keys are translated (not identical to English). Both must be satisfied in one pass.

- [ ] **Step 1: Add the `feedback` block to English**

Insert this block inside the existing `"chat": {...}` object in `src/i18n/locales/en.json`, immediately after the closing `}` of the `"fork": {...}` block (around line 119) and before `"bangBash"`:

```json
    "feedback": {
      "thumbsUp": {
        "label": "Helpful",
        "prompt": "That response was helpful. Briefly note what worked so we keep it in mind going forward."
      },
      "thumbsDown": {
        "label": "Not helpful",
        "prompt": "That response wasn't helpful. Ask me one focused follow-up question to learn why I disagree before retrying."
      }
    },
```

- [ ] **Step 2: Add the `feedback` block to German (`de.json`)**

Insert the same shape into the `chat` object of `src/i18n/locales/de.json`:

```json
    "feedback": {
      "thumbsUp": {
        "label": "Hilfreich",
        "prompt": "Diese Antwort war hilfreich. Halte kurz fest, was funktioniert hat, damit wir es uns für die Zukunft merken."
      },
      "thumbsDown": {
        "label": "Nicht hilfreich",
        "prompt": "Diese Antwort war nicht hilfreich. Stelle mir eine gezielte Rückfrage, um zu verstehen, warum ich anderer Meinung bin, bevor du es erneut versuchst."
      }
    },
```

- [ ] **Step 3: Add the `feedback` block to Spanish (`es.json`)**

```json
    "feedback": {
      "thumbsUp": {
        "label": "Útil",
        "prompt": "Esa respuesta fue útil. Anota brevemente qué funcionó para tenerlo en cuenta en el futuro."
      },
      "thumbsDown": {
        "label": "No útil",
        "prompt": "Esa respuesta no fue útil. Hazme una pregunta concreta para entender por qué no estoy de acuerdo antes de intentarlo de nuevo."
      }
    },
```

- [ ] **Step 4: Add the `feedback` block to French (`fr.json`)**

```json
    "feedback": {
      "thumbsUp": {
        "label": "Utile",
        "prompt": "Cette réponse a été utile. Note brièvement ce qui a fonctionné pour t'en souvenir par la suite."
      },
      "thumbsDown": {
        "label": "Pas utile",
        "prompt": "Cette réponse n'a pas été utile. Pose-moi une question ciblée pour comprendre pourquoi je ne suis pas d'accord avant de réessayer."
      }
    },
```

- [ ] **Step 5: Add the `feedback` block to Japanese (`ja.json`)**

```json
    "feedback": {
      "thumbsUp": {
        "label": "役に立った",
        "prompt": "この回答は役に立ちました。今後も活かせるよう、うまくいった点を簡潔にまとめてください。"
      },
      "thumbsDown": {
        "label": "役に立たなかった",
        "prompt": "この回答は役に立ちませんでした。再試行する前に、なぜ私が同意しないのかを理解するための具体的な質問を1つしてください。"
      }
    },
```

- [ ] **Step 6: Add the `feedback` block to Korean (`ko.json`)**

```json
    "feedback": {
      "thumbsUp": {
        "label": "도움 됨",
        "prompt": "이 응답은 도움이 되었습니다. 앞으로도 참고할 수 있도록 잘 작동한 부분을 간단히 기록해 주세요."
      },
      "thumbsDown": {
        "label": "도움 안 됨",
        "prompt": "이 응답은 도움이 되지 않았습니다. 다시 시도하기 전에 제가 동의하지 않는 이유를 파악할 수 있는 구체적인 후속 질문을 하나만 해주세요."
      }
    },
```

- [ ] **Step 7: Add the `feedback` block to Portuguese (`pt.json`)**

```json
    "feedback": {
      "thumbsUp": {
        "label": "Útil",
        "prompt": "Essa resposta foi útil. Anote brevemente o que funcionou para que possamos considerar isso daqui para frente."
      },
      "thumbsDown": {
        "label": "Não útil",
        "prompt": "Essa resposta não foi útil. Faça-me uma pergunta direta para entender por que eu discordo antes de tentar de novo."
      }
    },
```

- [ ] **Step 8: Add the `feedback` block to Russian (`ru.json`)**

```json
    "feedback": {
      "thumbsUp": {
        "label": "Полезно",
        "prompt": "Этот ответ был полезен. Кратко отметь, что сработало, чтобы учесть это в дальнейшем."
      },
      "thumbsDown": {
        "label": "Не полезно",
        "prompt": "Этот ответ не был полезным. Прежде чем пробовать снова, задай мне один конкретный уточняющий вопрос, чтобы понять, с чем я не согласен."
      }
    },
```

- [ ] **Step 9: Add the `feedback` block to Simplified Chinese (`zh-CN.json`)**

```json
    "feedback": {
      "thumbsUp": {
        "label": "有帮助",
        "prompt": "这个回答有帮助。请简要记下哪里做得好，便于今后继续保持。"
      },
      "thumbsDown": {
        "label": "没帮助",
        "prompt": "这个回答没有帮助。在重试之前，请向我提出一个聚焦的后续问题，以便了解我为什么不同意。"
      }
    },
```

- [ ] **Step 10: Add the `feedback` block to Traditional Chinese (`zh-TW.json`)**

```json
    "feedback": {
      "thumbsUp": {
        "label": "有幫助",
        "prompt": "這個回答有幫助。請簡要記下哪裡做得好，方便日後繼續沿用。"
      },
      "thumbsDown": {
        "label": "沒幫助",
        "prompt": "這個回答沒有幫助。在重試之前，請向我提出一個聚焦的後續問題，以了解我為什麼不同意。"
      }
    },
```

- [ ] **Step 11: Extend `localizedKeys` in `tests/unit/i18n/locales.test.ts`**

Find the `localizedKeys` array (begins at line 28). Append these four entries just before the closing `] as const;`:

```ts
  'chat.feedback.thumbsUp.label',
  'chat.feedback.thumbsUp.prompt',
  'chat.feedback.thumbsDown.label',
  'chat.feedback.thumbsDown.prompt',
```

Final tail of the array (replace the previous tail with this):

```ts
  'settings.requireCommandOrControlEnterToSend.name',
  'settings.requireCommandOrControlEnterToSend.desc',
  'chat.feedback.thumbsUp.label',
  'chat.feedback.thumbsUp.prompt',
  'chat.feedback.thumbsDown.label',
  'chat.feedback.thumbsDown.prompt',
] as const;
```

- [ ] **Step 12: Run i18n tests**

Run:

```bash
npm run test -- --selectProjects unit --testPathPattern=i18n/locales
```

Expected: **PASS**. The first `it` ("keeps every locale structurally aligned with English") passes because all 10 locales gained the same four keys. The second `it` ("localizes the recent bang bash and subagent additions") iterates `localizedKeys`; each new entry must be defined and not equal to the English string — satisfied since every locale has its own translation.

- [ ] **Step 13: Run typecheck and lint**

Run:

```bash
npm run typecheck && npm run lint
```

Expected: clean (0 errors, 0 warnings). JSON edits should not affect either; this is a smoke check.

- [ ] **Step 14: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/de.json src/i18n/locales/es.json src/i18n/locales/fr.json src/i18n/locales/ja.json src/i18n/locales/ko.json src/i18n/locales/pt.json src/i18n/locales/ru.json src/i18n/locales/zh-CN.json src/i18n/locales/zh-TW.json tests/unit/i18n/locales.test.ts
git commit -m "feat(i18n): add chat.feedback.thumbsUp/thumbsDown keys across 10 locales"
```

---

## Task 2: Implement `sendFeedbackPrompt` helper with TDD

**Files:**
- Create: `src/features/chat/feedback/sendFeedbackPrompt.ts`
- Test: `tests/unit/features/chat/feedback/sendFeedbackPrompt.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/features/chat/feedback/sendFeedbackPrompt.test.ts`:

```ts
import { sendFeedbackPrompt } from '@/features/chat/feedback/sendFeedbackPrompt';
import { t } from '@/i18n/i18n';
import type { ChatMessage } from '@/core/types';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'Hello',
    timestamp: 0,
    ...overrides,
  };
}

interface FakeTab {
  id: string;
  controllers: { inputController: { sendMessage: jest.Mock } };
}

function makeTab(id = 'tab-1'): FakeTab {
  return {
    id,
    controllers: { inputController: { sendMessage: jest.fn().mockResolvedValue(undefined) } },
  };
}

function makeTabManager(tabs: FakeTab[], activeId: string | null) {
  const map = new Map(tabs.map((t) => [t.id, t]));
  return {
    getActiveTab: jest.fn(() => (activeId ? map.get(activeId) ?? null : null)),
    getTab: jest.fn((id: string) => map.get(id) ?? null),
  };
}

function makePlugin(opts: {
  view?: { getTabManager: () => unknown } | null;
  crossView?: { view: { getTabManager: () => unknown }; tabId: string } | null;
} = {}) {
  return {
    getView: jest.fn(() => opts.view ?? null),
    findConversationAcrossViews: jest.fn(() => opts.crossView ?? null),
    logger: { scope: () => ({ debug: jest.fn() }) },
  };
}

describe('sendFeedbackPrompt', () => {
  it('sends the English thumbsUp prompt on the conversation-owning tab', () => {
    const tab = makeTab('tab-A');
    const tabManager = makeTabManager([tab], null);
    const view = { getTabManager: () => tabManager };
    const plugin = makePlugin({
      view,
      crossView: { view, tabId: 'tab-A' },
    });

    sendFeedbackPrompt(plugin as never, makeMessage(), 'conv-1', 'up');

    expect(tab.controllers.inputController.sendMessage).toHaveBeenCalledWith({
      content: t('chat.feedback.thumbsUp.prompt'),
    });
  });

  it('sends the English thumbsDown prompt on the conversation-owning tab', () => {
    const tab = makeTab('tab-A');
    const tabManager = makeTabManager([tab], null);
    const view = { getTabManager: () => tabManager };
    const plugin = makePlugin({
      view,
      crossView: { view, tabId: 'tab-A' },
    });

    sendFeedbackPrompt(plugin as never, makeMessage(), 'conv-1', 'down');

    expect(tab.controllers.inputController.sendMessage).toHaveBeenCalledWith({
      content: t('chat.feedback.thumbsDown.prompt'),
    });
  });

  it('falls back to the active tab when conversationId is null', () => {
    const tab = makeTab('tab-A');
    const tabManager = makeTabManager([tab], 'tab-A');
    const view = { getTabManager: () => tabManager };
    const plugin = makePlugin({ view, crossView: null });

    sendFeedbackPrompt(plugin as never, makeMessage(), null, 'up');

    expect(tab.controllers.inputController.sendMessage).toHaveBeenCalledTimes(1);
    expect(plugin.findConversationAcrossViews).not.toHaveBeenCalled();
  });

  it('falls back to the active tab when findConversationAcrossViews returns null', () => {
    const tab = makeTab('tab-A');
    const tabManager = makeTabManager([tab], 'tab-A');
    const view = { getTabManager: () => tabManager };
    const plugin = makePlugin({ view, crossView: null });

    sendFeedbackPrompt(plugin as never, makeMessage(), 'unknown-conv', 'down');

    expect(tab.controllers.inputController.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does nothing when getView returns null', () => {
    const plugin = makePlugin({ view: null });
    expect(() =>
      sendFeedbackPrompt(plugin as never, makeMessage(), 'conv-1', 'up'),
    ).not.toThrow();
  });

  it('does nothing when no active tab and no cross-view match exist', () => {
    const tabManager = makeTabManager([], null);
    const view = { getTabManager: () => tabManager };
    const plugin = makePlugin({ view, crossView: null });

    expect(() =>
      sendFeedbackPrompt(plugin as never, makeMessage(), 'conv-1', 'down'),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- --selectProjects unit --testPathPattern=sendFeedbackPrompt
```

Expected: **FAIL**. Jest reports `Cannot find module '@/features/chat/feedback/sendFeedbackPrompt'` (helper doesn't exist yet).

- [ ] **Step 3: Implement `sendFeedbackPrompt`**

Create `src/features/chat/feedback/sendFeedbackPrompt.ts`:

```ts
import type { ChatMessage } from '@/core/types';
import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';

export type FeedbackDirection = 'up' | 'down';

/**
 * Sends the i18n-backed thumbs-up or thumbs-down prompt as a normal user turn
 * on the tab that owns the rated message. Falls back to the active view's
 * active tab when no `conversationId` is supplied or no matching tab is found.
 *
 * Side-effect-free apart from the resulting `inputController.sendMessage`
 * dispatch. No persistence on the rated message.
 */
export function sendFeedbackPrompt(
  plugin: ClaudianPlugin,
  _message: ChatMessage,
  conversationId: string | null,
  direction: FeedbackDirection,
): void {
  const activeView = plugin.getView();
  if (!activeView) return;

  // Prefer the view+tab that owns the rated conversation so the feedback turn
  // lands in the correct chat across multi-view setups. Fall back to the
  // active view's active tab when no conversationId is supplied or no tab
  // matches (e.g. conversation moved tabs between render and click).
  let targetTab = activeView.getTabManager()?.getActiveTab() ?? null;
  if (conversationId) {
    const cross = plugin.findConversationAcrossViews(conversationId);
    if (cross) {
      targetTab = cross.view.getTabManager()?.getTab(cross.tabId) ?? targetTab;
    }
  }
  if (!targetTab) return;

  const promptKey =
    direction === 'up'
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

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run test -- --selectProjects unit --testPathPattern=sendFeedbackPrompt
```

Expected: **PASS**. All six test cases pass.

- [ ] **Step 5: Run typecheck and lint**

Run:

```bash
npm run typecheck && npm run lint
```

Expected: clean. If lint flags `_message` as unused, the underscore prefix already exempts it per project convention; if it does not, change the parameter name to `_message` (already done) — no further action.

- [ ] **Step 6: Commit**

```bash
git add src/features/chat/feedback/sendFeedbackPrompt.ts tests/unit/features/chat/feedback/sendFeedbackPrompt.test.ts
git commit -m "feat(chat): add sendFeedbackPrompt helper for thumbs actions"
```

---

## Task 3: Register the two `ChatMessageAction`s in `main.ts`

**Files:**
- Modify: `src/main.ts:111-122` (insert after the existing `create-work-order-from-message` registration)

- [ ] **Step 1: Add the import**

In `src/main.ts`, add this import alongside the existing imports (near line 55, after `import { chatMessageText } from './utils/chatMessageText';`):

```ts
import { sendFeedbackPrompt } from './features/chat/feedback/sendFeedbackPrompt';
```

- [ ] **Step 2: Register both actions**

Immediately after the closing `});` of the `create-work-order-from-message` `registerChatMessageAction` call (currently ending around line 122), add the two registrations:

```ts
    this.registerChatMessageAction({
      id: 'thumbs-up-feedback',
      label: t('chat.feedback.thumbsUp.label'),
      icon: 'thumbs-up',
      isEligible: (msg) => msg.role === 'assistant' && Boolean(chatMessageText(msg)),
      run: (msg, conversationId) => {
        sendFeedbackPrompt(this, msg, conversationId, 'up');
      },
    });

    this.registerChatMessageAction({
      id: 'thumbs-down-feedback',
      label: t('chat.feedback.thumbsDown.label'),
      icon: 'thumbs-down',
      isEligible: (msg) => msg.role === 'assistant' && Boolean(chatMessageText(msg)),
      run: (msg, conversationId) => {
        sendFeedbackPrompt(this, msg, conversationId, 'down');
      },
    });
```

- [ ] **Step 3: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Lint**

Run:

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 5: Run the full unit test suite**

Run:

```bash
npm run test -- --selectProjects unit
```

Expected: **PASS** for all unit tests. The new helper test passes, the locale-completeness test passes, and no existing test broke.

- [ ] **Step 6: Build the plugin**

Run:

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat(chat): register thumbs-up and thumbs-down message actions"
```

---

## Task 4: Manual smoke verification in Obsidian

**Files:** none. Manual verification only.

- [ ] **Step 1: Reload the dev plugin**

The `npm run build` step in Task 3 already copies the build artifacts into the Obsidian dev vault's `.obsidian/plugins/` folder (per [[claudian-dev-build-setup.md]]). In Obsidian: `Cmd/Ctrl+P` -> "Reload app without saving" (or toggle the Claudian plugin off/on in Settings -> Community plugins).

- [ ] **Step 2: Hover an assistant response**

Open Claudian in the sidebar, send any prompt that produces an assistant reply, wait for the response to complete, then hover the last text block of that response.

Expected: the action row shows, left-to-right, `Create work order`, `Thumbs up`, `Thumbs down`, followed by the `Copy` icon at the far right.

- [ ] **Step 3: Click Thumbs up**

Click the thumbs-up icon.

Expected: a new user message appears in the transcript containing the English `chat.feedback.thumbsUp.prompt` text. The agent then produces a follow-up response.

- [ ] **Step 4: Click Thumbs down on a different message**

Send a second prompt, let the agent respond, hover the new response, click the thumbs-down icon.

Expected: a new user message appears in the transcript containing the English `chat.feedback.thumbsDown.prompt` text. The agent's follow-up asks a clarifying question about why the user disagrees.

- [ ] **Step 5: Verify all four providers (if available)**

If you have Codex, Opencode, or Cursor configured locally, open a tab on each and repeat Step 3 to confirm the action row renders and the click dispatches a turn. Skip any provider you do not have set up.

Expected: the buttons render on every provider's assistant messages and clicking them sends the prompt.

- [ ] **Step 6: Document the verification**

If everything looks correct, add a one-line note to the implementation branch's PR description listing the providers actually exercised (e.g. "Smoke-tested on Claude and Codex; Opencode and Cursor not configured locally").

If anything is off (icons missing, prompt empty, wrong tab targeted), do not commit; open an issue or amend the relevant task before merging.

---

## Self-Review Checklist (already run)

- **Spec coverage:** Every spec requirement maps to a task — i18n keys (Task 1), helper (Task 2), action registrations (Task 3), visual verification (Task 4).
- **Placeholder scan:** No `TBD`, `TODO`, vague "appropriate error handling," or unsupported test pseudocode. All code blocks are complete.
- **Type consistency:** `FeedbackDirection`, `sendFeedbackPrompt`, `getTab`, `findConversationAcrossViews`, `chatMessageActions`, and `ChatMessageAction` names are used consistently across all tasks and match the spec.
- **No new public surface assumed:** `TabManager.getTab(tabId)` is verified to exist at `src/features/chat/tabs/TabManager.ts:424`. `plugin.findConversationAcrossViews(conversationId)` is verified on `PluginContext` and `ClaudianPlugin`.
