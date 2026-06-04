---
title: Capture sent prompt as quick action
date: 2026-06-04
status: draft
scope: features/quickActions, features/chat
parent: "[[Quick Actions]]"
---

## Problem

Users discover useful prompts while chatting, then have to manually copy the text out and walk through `Add quick action` to save them. The friction kills most captures: by the time the modal is open the user has lost the prompt or moved on. Quick Actions only grows when capture is cheap.

## Goal

Add a per-message "Capture as quick action" button on sent (user-role) chat messages. Click opens the existing `QuickActionEditorModal` pre-filled with the prompt body and a derived name. Save writes a regular quick-action note to the configured folder and opens it in a pane.

## Non-goals

- Capturing assistant messages (assistant text already has the work-order / feedback actions; saving an assistant response as a "prompt" is a category error).
- Capturing command-style messages (slash commands, `$` skills, `#` instruction-mode, `!` bang-bash) — those aren't prompts.
- Bulk capture (multi-select, "capture all from this conversation").
- Capture-and-favorite in one click. Favoriting stays a separate gesture in the quick-actions modal.
- Frontmatter-only "headless" capture (no editor modal). User always lands in the editor to sanity-check name/icon/description.

## Design

### Architecture

Capture rides the existing `plugin.chatMessageActions` registry that already powers thumbs feedback and the work-order promote button. Chat side needs zero new wiring — `MessageRenderer.addRegisteredMessageActions` already renders eligible actions in the user-message toolbar.

```
main.ts
  registerChatMessageAction({
    id: 'capture-prompt-as-quick-action',
    label: t('quickActions.capture.label'),
    icon: 'bookmark-plus',
    isEligible: isCaptureEligible,
    run: (msg) => openCaptureFromMessage(plugin, msg),
  })

features/quickActions/captureFromMessage.ts                 (NEW)
  isCaptureEligible(msg)
  deriveSeedName(text, maxLen)
  openCaptureFromMessage(plugin, msg)

features/quickActions/ui/QuickActionEditorModal.ts          (EDIT)
  constructor gains optional `seed: { name?, prompt? }`
  handleSave gains a pre-write `exists()` collision guard
    (Add path + Capture path; Edit path skips since action.filePath is set)

i18n/locales/*.ts                                           (EDIT)
  new keys: capture.label, capture.saved, capture.folderMissing,
            editor.nameExists
```

Files unchanged: `QuickActionStorage`, `quickActionParse`, `types`, `MessageRenderer`, `messageActions` selector. Renderer already calls every eligible action; the existing predicate-throw guard hides a misbehaving capture action without breaking the toolbar.

### Eligibility predicate

```typescript
const COMMAND_PREFIXES = ['/', '$', '#', '!'] as const;

function visibleText(msg: ChatMessage): string {
  const direct = (msg.displayContent ?? '').trim();
  return direct || chatMessageText(msg);
}

export function isCaptureEligible(msg: ChatMessage): boolean {
  if (msg.role !== 'user') return false;
  const text = visibleText(msg);
  if (!text) return false;
  const firstChar = text.charAt(0);
  return !COMMAND_PREFIXES.includes(firstChar as never);
}
```

- `displayContent` first, `chatMessageText` fallback covers user messages rehydrated from history where `displayContent` isn't persisted.
- Empty text gates out image-only sends.
- Single-char prefix check covers every command sentinel currently in use (`/`, `$`, `#`, `!`). Future provider commands re-use these sentinels.
- The predicate intentionally does **not** read `settings.quickActionsFolder`. The button shows even when the folder is blank; the click then surfaces an actionable notice. This is preferred over hiding the affordance silently — users who haven't configured the folder still get a discoverable hint that capture exists.

### Seed derivation

```typescript
export function deriveSeedName(text: string, maxLen = 50): string {
  const firstLine = text.split(/\r?\n/, 1)[0]!.trim();
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen).trimEnd() + '…';
}
```

`description`, `icon`, `tags` are not seeded. Users tune in the editor. Avoids fake defaults polluting saved files.

### Capture flow

```typescript
export function openCaptureFromMessage(
  plugin: ClaudianPlugin,
  msg: ChatMessage,
): void {
  const folder = plugin.settings.quickActionsFolder?.trim() ?? '';
  if (!folder) {
    new Notice(t('quickActions.capture.folderMissing'));
    return;
  }

  const prompt = visibleText(msg);
  if (!prompt) return;                            // belt-and-braces; predicate gates

  const seedName = deriveSeedName(prompt);

  const storage = new QuickActionStorage(
    plugin.storage.getAdapter(),
    () => plugin.settings.quickActionsFolder ?? 'Quick Actions',
  );

  new QuickActionEditorModal(
    plugin.app,
    null,                                         // Add flow (no existing)
    async (action) => {
      const filePath = await storage.save(action);
      new Notice(t('quickActions.capture.saved'));
      plugin.quickActionFavoritesCache?.refresh();
      try {
        await plugin.app.workspace.openLinkText(filePath, '', false);
      } catch (err) {
        plugin.logger.scope('quickActions').warn('openLinkText after capture failed', err);
      }
    },
    storage,                                      // for collision guard
    { name: seedName, prompt },                   // seed
  ).open();
}
```

### Editor modal changes

Constructor signature gains `storage` (required) and `seed` (optional). Existing call sites in `QuickActionsModal` already construct a `QuickActionStorage`; they pass it through.

```typescript
constructor(
  app: App,
  existing: QuickAction | null,
  onSave: (action: QuickAction) => Promise<void>,
  storage: QuickActionStorage,
  seed?: { name?: string; prompt?: string },
) { ... }
```

`onOpen` field initialization:

```typescript
let name        = this.existing?.name        ?? this.seed?.name        ?? '';
let prompt      = this.existing?.prompt      ?? this.seed?.prompt      ?? '';
let description = this.existing?.description ?? '';
let icon        = this.existing?.icon        ?? '';
```

Collision guard inside `handleSave`, before calling `this.onSave`:

```typescript
if (!this.existing) {
  const targetPath = this.storage.getFilePathForName(trimmedName);
  if (await this.storage.exists(targetPath)) {
    new Notice(t('quickActions.editor.nameExists'));
    return;                                       // modal stays open
  }
}
```

Requires `QuickActionStorage.exists(path)` thin wrapper (one line, forwards to the adapter). Edit flow is identified by `this.existing` and skips the check (file already owns its slot).

### Post-save side-effects

Centralized in `openCaptureFromMessage`'s `onSave` callback so capture has a single point of orchestration:

1. `storage.save(action)` — writes file via `serializeQuickAction`.
2. `Notice(saved)` — success toast.
3. `favoritesCache?.refresh()` — keeps workspace menu in sync if the user later favorites the new action.
4. `openLinkText(filePath)` — surfaces the saved note; failure is logged and swallowed (save already succeeded).

### Edge cases

| Case | Behavior |
|---|---|
| `quickActionsFolder` blank | Pre-check fires `Notice(folderMissing)`; modal not opened |
| Image-only user message | `visibleText` returns `''` → predicate false → no button |
| Capture from rehydrated history message | `chatMessageText` fallback supplies prose |
| Slug collides with existing file | `handleSave` Notice; user renames; modal stays open |
| `storage.save()` throws (write error) | Existing `handleSave` try/catch → `Notice(saveFailed)` |
| `openLinkText` throws | Caught + warned via `plugin.logger.scope('quickActions')`; save already succeeded |
| `favoritesCache` not started | Optional chain swallows; capture isn't a favorite |
| Predicate throws | `eligibleMessageActions` try/catch hides the button |
| User pasted command then text (`/foo trailing prose`) | Filtered out — first char is `/`. Acceptable: command-prefixed prompts aren't reusable as quick actions anyway |

### i18n keys (all locales in `src/i18n/locales/`)

```
quickActions.capture.label           // "Capture as quick action"
quickActions.capture.saved           // "Quick action saved"
quickActions.capture.folderMissing   // "Configure Quick Actions folder first"
quickActions.editor.nameExists       // "A quick action with this name already exists"
```

Sentence-case per repo lint conventions.

## Testing

Mirrors `src/features/quickActions/` under `tests/unit/features/quickActions/`.

### Unit: `captureFromMessage.test.ts`

- `isCaptureEligible`
  - true: plain text user message
  - false: assistant role
  - false: empty `content` + empty `displayContent`
  - false: image-only (no text)
  - false: text starting with `/`, `$`, `#`, `!`
  - true: text containing `/` mid-line
  - true: rehydrated message with `displayContent` undefined, `content` set
- `deriveSeedName`
  - short prose → returned as-is, trimmed
  - long prose → truncated to 50 chars + ellipsis
  - multi-line prose → first line only
  - leading/trailing whitespace trimmed
- `openCaptureFromMessage`
  - blank `quickActionsFolder` → `Notice(folderMissing)`, modal NOT constructed
  - happy path → modal constructed with `existing=null`, `seed.name = deriveSeedName(prompt)`, `seed.prompt = visibleText(msg)`
  - on-save callback wires `storage.save → Notice → favoritesCache.refresh → openLinkText` in order
  - `openLinkText` rejection → logged via `logger.scope('quickActions').warn`, no rethrow

### Unit: `QuickActionEditorModal.test.ts`

- Seed pre-fills `name` + `prompt` on Add flow.
- Seed ignored when `existing` is present (Edit flow).
- Collision guard: `storage.exists` true → `Notice(nameExists)` fired; `onSave` NOT called; modal not closed.
- Collision guard: `existing` present → guard skipped; `onSave` called.
- `nameRequired` / `promptRequired` still fire (unchanged).

### Integration: `tests/integration/features/quickActions/capture.test.ts`

- `main.ts` registers the action; rendering a user `ChatMessage` through `MessageRenderer` surfaces a button with the capture icon.
- Click → modal opens with seeded prompt and name.
- Save → file written under configured folder, parses back through `parseQuickActionContent` as a valid `QuickAction`, `Notice` fired, `favoritesCache` reloaded.
- Capture against an existing slug → no file written, modal stays open, `nameExists` Notice fired.

### Manual smoke checklist

- [ ] Capture from a streaming-just-finished user message.
- [ ] Capture from a rehydrated message in a resumed conversation.
- [ ] Capture against an existing name → blocked with notice; modal stays open.
- [ ] Capture with blank Quick Actions folder setting → blocked notice; modal not opened.
- [ ] Verify the saved note opens in a pane, parses correctly, and runs through the normal Quick Action picker flow.
- [ ] Verify the new action appears in the favorites workspace menu after favoriting it from the modal.

## Rollout

- No setting flag. The action is always-on once registered; eligibility hides it on non-applicable messages.
- No migration. Frontmatter format is unchanged (`type: quick-action` + existing fields).
- No telemetry changes.
