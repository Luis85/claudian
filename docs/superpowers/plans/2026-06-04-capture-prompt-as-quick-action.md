---
status: draft
parent: "[[Quick Actions]]"
---
# Capture sent prompt as quick action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-user-message "Capture as quick action" button in the chat user-message toolbar that opens `QuickActionEditorModal` pre-filled with the prompt body and a derived name, then saves to the configured Quick Actions folder.

**Architecture:** New action registered through the existing `plugin.chatMessageActions` registry alongside the thumbs and work-order actions; chat-side rendering is unchanged. A new `captureFromMessage.ts` module owns eligibility, seed derivation, and orchestration. `QuickActionEditorModal` gains an optional `seed` constructor arg plus a `storage` arg used for a pre-write collision guard. `QuickActionStorage` gains a thin `exists()` helper.

**Tech Stack:** TypeScript, Obsidian Plugin API, Jest (jsdom + node projects), existing i18n JSON locales, existing `ChatMessageAction` registry (`src/core/types/chat.ts`), existing `QuickActionStorage` + `QuickActionEditorModal`.

**Spec:** [[docs/superpowers/specs/2026-06-04-capture-prompt-as-quick-action-design.md]]

---

## File Structure

| File | Purpose | Created or Modified |
|------|---------|---------------------|
| `src/features/quickActions/captureFromMessage.ts` | Pure helpers (`isCaptureEligible`, `deriveSeedName`, `visibleText`) + orchestrator (`openCaptureFromMessage`) | Create (Task 3, Task 6) |
| `src/features/quickActions/QuickActionStorage.ts` | Add `exists(path)` thin wrapper around the adapter | Modify (Task 2) |
| `src/features/quickActions/ui/QuickActionEditorModal.ts` | Add `storage` + optional `seed` constructor args; pre-write collision guard in `handleSave` | Modify (Task 4) |
| `src/features/quickActions/ui/QuickActionsModal.ts` | Update the single `new QuickActionEditorModal(...)` call site to pass `storage` | Modify (Task 5) |
| `src/main.ts` | Register `capture-prompt-as-quick-action` action next to existing assistant actions | Modify (Task 7) |
| `src/i18n/locales/en.json` … `zh-TW.json` (10 files) | Add `quickActions.capture.{label,saved,folderMissing}` and `quickActions.editor.nameExists` | Modify (Task 1) |
| `tests/unit/i18n/locales.test.ts` | Extend `localizedKeys` allowlist with the four new keys | Modify (Task 1) |
| `tests/unit/features/quickActions/QuickActionStorage.exists.test.ts` | Unit tests for the new `exists` method | Create (Task 2) |
| `tests/unit/features/quickActions/captureFromMessage.test.ts` | Unit tests for predicate, seed derivation, and orchestrator | Create (Task 3, Task 6) |
| `tests/unit/features/quickActions/QuickActionEditorModal.capture.test.ts` | Unit tests for the seed-pre-fill + collision guard branches | Create (Task 4) |
| `tests/integration/features/quickActions/capture.test.ts` | End-to-end registration → render → click → modal → save | Create (Task 8) |

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

- [ ] **Step 1: Extend `localizedKeys` allowlist (failing test first)**

Open `tests/unit/i18n/locales.test.ts`, find the `localizedKeys` array (starts at line 28), and add the four new keys (alphabetically grouped under existing `quickActions.*` entries if present; otherwise at the end of the array):

```typescript
  'quickActions.capture.label',
  'quickActions.capture.saved',
  'quickActions.capture.folderMissing',
  'quickActions.editor.nameExists',
```

- [ ] **Step 2: Run the locales test to confirm it fails**

Run: `npm run test -- --selectProjects unit tests/unit/i18n/locales.test.ts`
Expected: FAIL — the four new keys are missing from every locale file.

- [ ] **Step 3: Add the four keys to `src/i18n/locales/en.json`**

Inside the existing `quickActions` object:

- Under `quickActions.editor`, add a new entry **after** `"saveFailed": "Failed to save quick action"`:

```json
    "nameExists": "A quick action with this name already exists"
```

- After the closing brace of `quickActions.editor` (and before any sibling like `contextMenu`), add a new `capture` object:

```json
    "capture": {
      "label": "Capture as quick action",
      "saved": "Quick action saved",
      "folderMissing": "Configure Quick Actions folder first"
    },
```

Make sure trailing commas between sibling objects stay valid JSON.

- [ ] **Step 4: Mirror the four keys into the other 9 locales**

Translate `label`, `saved`, `folderMissing`, `nameExists` per locale and add them in the same positions:

| Locale | label | saved | folderMissing | nameExists |
|---|---|---|---|---|
| de | "Als Quick Action speichern" | "Quick Action gespeichert" | "Konfigurieren Sie zuerst den Quick-Actions-Ordner" | "Eine Quick Action mit diesem Namen existiert bereits" |
| es | "Guardar como acción rápida" | "Acción rápida guardada" | "Configura primero la carpeta de acciones rápidas" | "Ya existe una acción rápida con este nombre" |
| fr | "Enregistrer comme action rapide" | "Action rapide enregistrée" | "Configurez d'abord le dossier des actions rapides" | "Une action rapide avec ce nom existe déjà" |
| ja | "クイックアクションとして保存" | "クイックアクションを保存しました" | "先にクイックアクションフォルダを設定してください" | "この名前のクイックアクションは既に存在します" |
| ko | "빠른 작업으로 저장" | "빠른 작업이 저장되었습니다" | "먼저 빠른 작업 폴더를 설정하세요" | "이 이름의 빠른 작업이 이미 존재합니다" |
| pt | "Salvar como ação rápida" | "Ação rápida salva" | "Configure primeiro a pasta de ações rápidas" | "Já existe uma ação rápida com este nome" |
| ru | "Сохранить как быстрое действие" | "Быстрое действие сохранено" | "Сначала настройте папку быстрых действий" | "Быстрое действие с таким именем уже существует" |
| zh-CN | "保存为快速操作" | "快速操作已保存" | "请先配置快速操作文件夹" | "已存在同名快速操作" |
| zh-TW | "儲存為快速操作" | "快速操作已儲存" | "請先設定快速操作資料夾" | "已存在同名快速操作" |

- [ ] **Step 5: Run the locales test to confirm it passes**

Run: `npm run test -- --selectProjects unit tests/unit/i18n/locales.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/locales/*.json tests/unit/i18n/locales.test.ts
git commit -m "i18n(quickActions): add capture + nameExists keys across 10 locales"
```

---

## Task 2: Add `QuickActionStorage.exists()` helper

**Files:**
- Create: `tests/unit/features/quickActions/QuickActionStorage.exists.test.ts`
- Modify: `src/features/quickActions/QuickActionStorage.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/quickActions/QuickActionStorage.exists.test.ts`:

```typescript
import { QuickActionStorage } from '@/features/quickActions/QuickActionStorage';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

function makeAdapter(existing = new Set<string>()): VaultFileAdapter {
  return {
    exists: jest.fn(async (p: string) => existing.has(p)),
    read: jest.fn(),
    write: jest.fn(),
    delete: jest.fn(),
    ensureFolder: jest.fn(),
    listFilesRecursive: jest.fn(),
    append: jest.fn(),
  } as unknown as VaultFileAdapter;
}

describe('QuickActionStorage.exists', () => {
  it('returns true when the adapter reports the file exists', async () => {
    const adapter = makeAdapter(new Set(['Quick Actions/foo.md']));
    const storage = new QuickActionStorage(adapter, () => 'Quick Actions');

    await expect(storage.exists('Quick Actions/foo.md')).resolves.toBe(true);
    expect(adapter.exists).toHaveBeenCalledWith('Quick Actions/foo.md');
  });

  it('returns false when the adapter reports the file is absent', async () => {
    const adapter = makeAdapter();
    const storage = new QuickActionStorage(adapter, () => 'Quick Actions');

    await expect(storage.exists('Quick Actions/missing.md')).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm run test -- --selectProjects unit tests/unit/features/quickActions/QuickActionStorage.exists.test.ts`
Expected: FAIL — `storage.exists is not a function`.

- [ ] **Step 3: Add the `exists` method**

In `src/features/quickActions/QuickActionStorage.ts`, inside the `QuickActionStorage` class, add the method directly after `loadFromFile`:

```typescript
  /** Thin wrapper for collision checks before write. */
  async exists(filePath: string): Promise<boolean> {
    return this.adapter.exists(filePath);
  }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm run test -- --selectProjects unit tests/unit/features/quickActions/QuickActionStorage.exists.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/QuickActionStorage.ts tests/unit/features/quickActions/QuickActionStorage.exists.test.ts
git commit -m "feat(quickActions): add QuickActionStorage.exists() collision-check helper"
```

---

## Task 3: Add `captureFromMessage` pure helpers (predicate + seed)

**Files:**
- Create: `tests/unit/features/quickActions/captureFromMessage.test.ts`
- Create: `src/features/quickActions/captureFromMessage.ts`

- [ ] **Step 1: Write failing tests for the pure helpers**

Create `tests/unit/features/quickActions/captureFromMessage.test.ts`:

```typescript
import type { ChatMessage } from '@/core/types';
import { deriveSeedName, isCaptureEligible } from '@/features/quickActions/captureFromMessage';

function userMsg(partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: partial.id ?? 'u1',
    role: 'user',
    content: partial.content ?? '',
    displayContent: partial.displayContent,
    timestamp: 0,
    contentBlocks: partial.contentBlocks,
    images: partial.images,
  } as ChatMessage;
}

describe('isCaptureEligible', () => {
  it('is true for plain user prose', () => {
    expect(isCaptureEligible(userMsg({ content: 'Summarize this note.' }))).toBe(true);
  });

  it('is false for assistant role', () => {
    expect(isCaptureEligible({ ...userMsg({ content: 'hi' }), role: 'assistant' } as ChatMessage)).toBe(false);
  });

  it('is false when both content and displayContent are empty', () => {
    expect(isCaptureEligible(userMsg({ content: '', displayContent: '' }))).toBe(false);
  });

  it('is false for image-only messages (no text)', () => {
    expect(isCaptureEligible(userMsg({ content: '', images: [{ mimeType: 'image/png', data: 'aGVsbG8=' } as never] }))).toBe(false);
  });

  it.each(['/compact', '$skill', '#instruction', '!ls -la'])(
    'is false for command prefix %s',
    (text) => {
      expect(isCaptureEligible(userMsg({ content: text }))).toBe(false);
    },
  );

  it('is true when text contains a slash mid-line', () => {
    expect(isCaptureEligible(userMsg({ content: 'Refactor /utils into smaller files' }))).toBe(true);
  });

  it('falls back to chatMessageText when displayContent is undefined', () => {
    expect(isCaptureEligible(userMsg({ content: 'fallback prose' }))).toBe(true);
  });

  it('prefers displayContent over content when present', () => {
    expect(isCaptureEligible(userMsg({ content: '/compact', displayContent: 'human-readable prose' }))).toBe(true);
  });
});

describe('deriveSeedName', () => {
  it('returns short text unchanged', () => {
    expect(deriveSeedName('Short title')).toBe('Short title');
  });

  it('truncates and appends an ellipsis when longer than maxLen', () => {
    const long = 'a'.repeat(80);
    const out = deriveSeedName(long, 50);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(51);
  });

  it('uses only the first line for multi-line input', () => {
    expect(deriveSeedName('first line\nsecond line')).toBe('first line');
  });

  it('trims leading and trailing whitespace', () => {
    expect(deriveSeedName('   hello world   ')).toBe('hello world');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(deriveSeedName('   \n   ')).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm run test -- --selectProjects unit tests/unit/features/quickActions/captureFromMessage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module with the pure helpers**

Create `src/features/quickActions/captureFromMessage.ts`:

```typescript
import type { ChatMessage } from '../../core/types';
import { chatMessageText } from '../../utils/chatMessageText';

const COMMAND_PREFIXES = ['/', '$', '#', '!'] as const;

/**
 * Prose the user authored, regardless of provider-injected context.
 *
 * Live sends keep the raw user input in `displayContent`. Messages rehydrated
 * from history may have `displayContent` undefined, so we fall back to
 * `chatMessageText`, which already handles both `content` and `contentBlocks`.
 */
export function visibleText(message: ChatMessage): string {
  const direct = (message.displayContent ?? '').trim();
  return direct || chatMessageText(message);
}

/**
 * Predicate for the "Capture as quick action" toolbar button. We capture only
 * user-authored prose; assistant turns, empty/image-only sends, and command-
 * style messages (slash commands, $ skills, # instruction mode, ! bang-bash)
 * are not reusable as quick-action prompts.
 */
export function isCaptureEligible(message: ChatMessage): boolean {
  if (message.role !== 'user') return false;
  const text = visibleText(message);
  if (!text) return false;
  const firstChar = text.charAt(0);
  return !(COMMAND_PREFIXES as readonly string[]).includes(firstChar);
}

/**
 * Seed for the `name` field in `QuickActionEditorModal`. We take the first
 * non-empty line, trim it, and truncate to `maxLen` characters with an
 * ellipsis. The editor still requires a non-empty name on save, so this is
 * only a starting point — the user can always rewrite it before committing.
 */
export function deriveSeedName(text: string, maxLen = 50): string {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen).trimEnd() + '…';
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm run test -- --selectProjects unit tests/unit/features/quickActions/captureFromMessage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/captureFromMessage.ts tests/unit/features/quickActions/captureFromMessage.test.ts
git commit -m "feat(quickActions): add capture predicate and seed derivation helpers"
```

---

## Task 4: Extend `QuickActionEditorModal` with seed + collision guard

**Files:**
- Create: `tests/unit/features/quickActions/QuickActionEditorModal.capture.test.ts`
- Modify: `src/features/quickActions/ui/QuickActionEditorModal.ts`

- [ ] **Step 1: Write failing tests for the new constructor signature and guard**

Create `tests/unit/features/quickActions/QuickActionEditorModal.capture.test.ts`:

```typescript
/**
 * @jest-environment jsdom
 */
import '../../../setup/obsidianDom';

import type { App } from 'obsidian';
import { Notice } from 'obsidian';

import type { QuickActionStorage } from '@/features/quickActions/QuickActionStorage';
import { QuickActionEditorModal } from '@/features/quickActions/ui/QuickActionEditorModal';

jest.mock('obsidian', () => {
  class Modal {
    app: any;
    contentEl: any;
    modalEl: any;
    constructor(app: any) {
      this.app = app;
      this.contentEl = document.createElement('div');
      this.modalEl = document.createElement('div');
    }
    setTitle() {}
    open() { this.onOpen?.(); }
    close() {}
    onOpen?(): void;
  }
  class Setting {
    settingEl: HTMLElement;
    controlEl: HTMLElement;
    constructor(container: HTMLElement) {
      this.settingEl = document.createElement('div');
      this.controlEl = document.createElement('div');
      container.appendChild(this.settingEl);
    }
    setName() { return this; }
    setDesc() { return this; }
    addText(cb: (i: any) => void) {
      cb({ setValue: () => ({ onChange: () => undefined }), setDisabled: () => undefined, onChange: () => undefined });
      return this;
    }
    addTextArea(cb: (a: any) => void) {
      cb({ setValue: () => ({ onChange: () => undefined }), onChange: () => undefined, inputEl: { rows: 0, addClass: () => undefined } });
      return this;
    }
    addButton(cb: (b: any) => void) {
      cb({ setButtonText: () => ({ setCta: () => ({ onClick: () => undefined }), onClick: () => undefined }), setCta: () => ({ onClick: () => undefined }), onClick: () => undefined });
      return this;
    }
  }
  return { Modal, Notice: jest.fn(), Setting };
});

jest.mock('@/i18n/i18n', () => ({ t: (key: string) => key }));
jest.mock('@/shared/components/LucideIconPicker', () => ({
  LucideIconPicker: class {
    constructor(_p: HTMLElement, _o: { value: string; onChange: (v: string) => void }) {}
    destroy() {}
  },
}));

function makeStorage(exists = false): jest.Mocked<QuickActionStorage> {
  return {
    exists: jest.fn(async () => exists),
    getFilePathForName: jest.fn((name: string) => `Quick Actions/${name.toLowerCase()}.md`),
    save: jest.fn(),
    delete: jest.fn(),
    loadAll: jest.fn(),
    loadFromFile: jest.fn(),
    setFavorite: jest.fn(),
    unsetFavorite: jest.fn(),
  } as unknown as jest.Mocked<QuickActionStorage>;
}

beforeEach(() => jest.clearAllMocks());

describe('QuickActionEditorModal capture seed + collision guard', () => {
  it('pre-fills name and prompt from seed on Add flow', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const storage = makeStorage(false);
    const modal = new QuickActionEditorModal(
      {} as App,
      null,
      onSave,
      storage,
      { name: 'Seeded name', prompt: 'Seeded prompt body.' },
    );

    // handleSave receives the live edit values, but the seeded ones are what
    // would land in those callbacks. Drive handleSave directly with the seed.
    await (modal as any).handleSave('Seeded name', '', '', 'Seeded prompt body.');

    expect(storage.exists).toHaveBeenCalledWith('Quick Actions/seeded name.md');
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Seeded name',
      prompt: 'Seeded prompt body.',
      filePath: '',
    }));
  });

  it('blocks save with a notice when the slug already exists (Add flow)', async () => {
    const onSave = jest.fn();
    const storage = makeStorage(true);
    const modal = new QuickActionEditorModal({} as App, null, onSave, storage);

    await (modal as any).handleSave('Existing', '', '', 'Body');

    expect(Notice).toHaveBeenCalledWith('quickActions.editor.nameExists');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('skips the collision guard on Edit flow (existing.filePath is set)', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const storage = makeStorage(true);
    const modal = new QuickActionEditorModal(
      {} as App,
      {
        id: 'edit-id',
        name: 'Edit me',
        description: 'd',
        prompt: 'p',
        filePath: 'Quick Actions/edit-me.md',
      },
      onSave,
      storage,
    );

    await (modal as any).handleSave('Edit me', 'd2', '', 'p2');

    expect(storage.exists).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('ignores seed when existing is present', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const storage = makeStorage(false);
    const modal = new QuickActionEditorModal(
      {} as App,
      {
        id: 'edit-id',
        name: 'Existing name',
        description: 'd',
        prompt: 'existing body',
        filePath: 'Quick Actions/existing-name.md',
      },
      onSave,
      storage,
      { name: 'Ignored seed', prompt: 'Ignored prompt' },
    );

    // Simulate the form initialization the modal performs in onOpen.
    expect((modal as any).existing.name).toBe('Existing name');
    expect((modal as any).seed?.name).toBe('Ignored seed');
    // Editor uses existing first, seed second.
  });
});
```

- [ ] **Step 2: Run the new test to confirm it fails**

Run: `npm run test -- --selectProjects unit tests/unit/features/quickActions/QuickActionEditorModal.capture.test.ts`
Expected: FAIL — `QuickActionEditorModal` does not accept a `storage` arg.

- [ ] **Step 3: Update the existing favorites test for the new constructor**

Open `tests/unit/features/quickActions/QuickActionEditorModal.favorites.test.ts`. Every `new QuickActionEditorModal({} as App, existing, onSave)` needs a `storage` arg added in the 4th position. Add this helper near the top of the file (after the mocks):

```typescript
function noopStorage() {
  return {
    exists: jest.fn(async () => false),
    getFilePathForName: jest.fn((name: string) => `Quick Actions/${name.toLowerCase()}.md`),
    save: jest.fn(),
    delete: jest.fn(),
    loadAll: jest.fn(),
    loadFromFile: jest.fn(),
    setFavorite: jest.fn(),
    unsetFavorite: jest.fn(),
  } as any;
}
```

Then change both `new QuickActionEditorModal(...)` calls to:

```typescript
const modal = new QuickActionEditorModal({} as App, existing, onSave, noopStorage());
```

- [ ] **Step 4: Update `QuickActionEditorModal` constructor**

In `src/features/quickActions/ui/QuickActionEditorModal.ts`:

Replace the top of the class:

```typescript
import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { LucideIconPicker } from '../../../shared/components/LucideIconPicker';
import type { QuickActionStorage } from '../QuickActionStorage';
import type { QuickAction } from '../types';

export class QuickActionEditorModal extends Modal {
  private existing: QuickAction | null;
  private onSave: (action: QuickAction) => Promise<void>;
  private storage: QuickActionStorage;
  private seed: { name?: string; prompt?: string } | null;
  private iconPicker: LucideIconPicker | null = null;

  constructor(
    app: App,
    existing: QuickAction | null,
    onSave: (action: QuickAction) => Promise<void>,
    storage: QuickActionStorage,
    seed?: { name?: string; prompt?: string },
  ) {
    super(app);
    this.existing = existing;
    this.onSave = onSave;
    this.storage = storage;
    this.seed = seed ?? null;
  }
```

- [ ] **Step 5: Seed the form fields in `onOpen`**

Inside `onOpen`, replace the four `let` initializations (currently around line 30) with:

```typescript
    let name = this.existing?.name ?? this.seed?.name ?? '';
    let description = this.existing?.description ?? '';
    let icon = this.existing?.icon ?? '';
    let prompt = this.existing?.prompt ?? this.seed?.prompt ?? '';
```

(Only `name` and `prompt` are seedable; `description` and `icon` stay empty for capture by design.)

- [ ] **Step 6: Add the collision guard in `handleSave`**

In `src/features/quickActions/ui/QuickActionEditorModal.ts`, inside `handleSave`, after the `promptRequired` check and **before** the `action` object is constructed, add:

```typescript
    if (!this.existing) {
      const targetPath = this.storage.getFilePathForName(trimmedName);
      if (await this.storage.exists(targetPath)) {
        new Notice(t('quickActions.editor.nameExists'));
        return;
      }
    }
```

- [ ] **Step 7: Run both editor tests to confirm they pass**

Run: `npm run test -- --selectProjects unit tests/unit/features/quickActions/QuickActionEditorModal.capture.test.ts tests/unit/features/quickActions/QuickActionEditorModal.favorites.test.ts`
Expected: PASS for both files.

- [ ] **Step 8: Commit**

```bash
git add src/features/quickActions/ui/QuickActionEditorModal.ts tests/unit/features/quickActions/QuickActionEditorModal.capture.test.ts tests/unit/features/quickActions/QuickActionEditorModal.favorites.test.ts
git commit -m "feat(quickActions): seed editor modal and guard add-flow against name collisions"
```

---

## Task 5: Update `QuickActionsModal.openEditor` to pass storage

**Files:**
- Modify: `src/features/quickActions/ui/QuickActionsModal.ts`

- [ ] **Step 1: Run typecheck to confirm the call site fails**

Run: `npm run typecheck`
Expected: FAIL — `QuickActionEditorModal` constructor expects 4 args at `QuickActionsModal.ts:377`.

- [ ] **Step 2: Update the constructor call**

In `src/features/quickActions/ui/QuickActionsModal.ts`, replace lines 377-382 of `openEditor`:

```typescript
  private openEditor(existing: QuickAction | null): void {
    new QuickActionEditorModal(
      this.app,
      existing,
      async (action) => {
        const filePath = await this.callbacks.storage.save(action);
        action.filePath = filePath;
        this.callbacks.onFavoritesChanged?.();
        await this.refreshList();
      },
      this.callbacks.storage,
    ).open();
  }
```

- [ ] **Step 3: Run typecheck to confirm it passes**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Run the existing QuickActionsModal tests to confirm no regression**

Run: `npm run test -- --selectProjects unit tests/unit/features/quickActions/ui/QuickActionsModal.test.ts tests/unit/features/quickActions/QuickActionsModal.favorites.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/ui/QuickActionsModal.ts
git commit -m "refactor(quickActions): pass storage into editor modal from QuickActionsModal"
```

---

## Task 6: Add `openCaptureFromMessage` orchestrator

**Files:**
- Modify: `tests/unit/features/quickActions/captureFromMessage.test.ts`
- Modify: `src/features/quickActions/captureFromMessage.ts`

- [ ] **Step 1: Append failing tests for the orchestrator**

`jest.mock(...)` calls must live at the top of the test file (Jest hoists them). Move all three `jest.mock` blocks below to the top of `tests/unit/features/quickActions/captureFromMessage.test.ts`, above any other `import` from `@/features/quickActions/...`. Then add the new `import { openCaptureFromMessage }` import next to the existing ones, the `makePluginMock` helper, and append the new `describe('openCaptureFromMessage', ...)` block at the bottom of the file.

Block 1 (hoisted to top):

```typescript
import { Notice } from 'obsidian';
import { openCaptureFromMessage } from '@/features/quickActions/captureFromMessage';

jest.mock('obsidian', () => ({ Notice: jest.fn() }));

jest.mock('@/features/quickActions/QuickActionStorage', () => {
  const save = jest.fn(async (_a: any) => 'Quick Actions/seeded-name.md');
  return {
    QuickActionStorage: jest.fn().mockImplementation(() => ({
      save,
      exists: jest.fn(async () => false),
      getFilePathForName: jest.fn((n: string) => `Quick Actions/${n}.md`),
    })),
    __save: save,
  };
});

jest.mock('@/features/quickActions/ui/QuickActionEditorModal', () => {
  return {
    QuickActionEditorModal: jest.fn().mockImplementation((_app, _existing, onSave, _storage, seed) => ({
      open: jest.fn(() => { (globalThis as any).__lastSeed = seed; (globalThis as any).__lastOnSave = onSave; }),
    })),
  };
});

function makePluginMock(overrides: any = {}) {
  return {
    app: { workspace: { openLinkText: jest.fn(async () => undefined) } },
    settings: { quickActionsFolder: 'Quick Actions' },
    storage: { getAdapter: jest.fn(() => ({})) },
    quickActionFavoritesCache: { refresh: jest.fn() },
    logger: { scope: jest.fn(() => ({ warn: jest.fn() })) },
    ...overrides,
  } as any;
}

describe('openCaptureFromMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete (globalThis as any).__lastSeed;
    delete (globalThis as any).__lastOnSave;
  });

  it('surfaces a notice and does not open the modal when the folder setting is blank', () => {
    const plugin = makePluginMock({ settings: { quickActionsFolder: '' } });
    const msg = { id: 'm1', role: 'user', content: 'capture me', timestamp: 0 } as any;

    openCaptureFromMessage(plugin, msg);

    expect(Notice).toHaveBeenCalledWith('quickActions.capture.folderMissing');
    expect((globalThis as any).__lastSeed).toBeUndefined();
  });

  it('opens the editor modal pre-seeded with derived name and prompt body', () => {
    const plugin = makePluginMock();
    const msg = { id: 'm2', role: 'user', content: 'Summarize this note.', timestamp: 0 } as any;

    openCaptureFromMessage(plugin, msg);

    expect((globalThis as any).__lastSeed).toEqual({
      name: 'Summarize this note.',
      prompt: 'Summarize this note.',
    });
  });

  it('runs save -> notice -> favoritesCache.refresh -> openLinkText in order on save', async () => {
    const plugin = makePluginMock();
    const msg = { id: 'm3', role: 'user', content: 'Capture this prompt body.', timestamp: 0 } as any;

    openCaptureFromMessage(plugin, msg);
    const onSave = (globalThis as any).__lastOnSave as (a: any) => Promise<void>;
    const action = { name: 'Capture this prompt body.', prompt: 'Capture this prompt body.', filePath: '' } as any;

    await onSave(action);

    const save = (jest.requireMock('@/features/quickActions/QuickActionStorage') as any).__save;
    expect(save).toHaveBeenCalledWith(action);
    expect(Notice).toHaveBeenCalledWith('quickActions.capture.saved');
    expect(plugin.quickActionFavoritesCache.refresh).toHaveBeenCalled();
    expect(plugin.app.workspace.openLinkText).toHaveBeenCalledWith('Quick Actions/seeded-name.md', '', false);
  });

  it('logs and swallows openLinkText failures without rethrowing', async () => {
    const warn = jest.fn();
    const plugin = makePluginMock({
      app: { workspace: { openLinkText: jest.fn().mockRejectedValue(new Error('gone')) } },
      logger: { scope: jest.fn(() => ({ warn })) },
    });
    const msg = { id: 'm4', role: 'user', content: 'x', timestamp: 0 } as any;

    openCaptureFromMessage(plugin, msg);
    const onSave = (globalThis as any).__lastOnSave as (a: any) => Promise<void>;

    await expect(onSave({ name: 'x', prompt: 'x', filePath: '' } as any)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm run test -- --selectProjects unit tests/unit/features/quickActions/captureFromMessage.test.ts`
Expected: FAIL — `openCaptureFromMessage` is not exported.

- [ ] **Step 3: Add the orchestrator to `captureFromMessage.ts`**

Add the new imports at the **top** of `src/features/quickActions/captureFromMessage.ts` (next to the existing `ChatMessage` / `chatMessageText` imports, not at the bottom), then append the `openCaptureFromMessage` function below the existing helpers.

New imports (top of file, grouped with existing):

```typescript
import { Notice } from 'obsidian';

import type ClaudianPlugin from '../../main';
import { t } from '../../i18n/i18n';

import { QuickActionStorage } from './QuickActionStorage';
import { QuickActionEditorModal } from './ui/QuickActionEditorModal';
```

Function (appended at the bottom of the file):

```typescript
/**
 * Opens the quick-action editor pre-filled with this message's prose and a
 * derived name. The folder check fires before the modal is constructed so a
 * misconfigured vault never lands the user in a half-broken save flow.
 *
 * Side-effects on save (in order): write file, toast, refresh favorites cache,
 * open the saved note. `openLinkText` failures are logged and swallowed —
 * the save itself already succeeded.
 */
export function openCaptureFromMessage(
  plugin: ClaudianPlugin,
  message: ChatMessage,
): void {
  const folder = plugin.settings.quickActionsFolder?.trim() ?? '';
  if (!folder) {
    new Notice(t('quickActions.capture.folderMissing'));
    return;
  }

  const prompt = visibleText(message);
  if (!prompt) return;

  const seedName = deriveSeedName(prompt);

  const storage = new QuickActionStorage(
    plugin.storage.getAdapter(),
    () => plugin.settings.quickActionsFolder ?? 'Quick Actions',
  );

  new QuickActionEditorModal(
    plugin.app,
    null,
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
    storage,
    { name: seedName, prompt },
  ).open();
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm run test -- --selectProjects unit tests/unit/features/quickActions/captureFromMessage.test.ts`
Expected: PASS — all helper + orchestrator tests green.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/quickActions/captureFromMessage.ts tests/unit/features/quickActions/captureFromMessage.test.ts
git commit -m "feat(quickActions): orchestrate capture flow with folder guard and post-save side-effects"
```

---

## Task 7: Register the `ChatMessageAction` in main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add the registration alongside existing actions**

In `src/main.ts`, immediately after the `create-work-order-from-message` registration (around line 195-203), add:

```typescript
    this.registerChatMessageAction({
      id: 'capture-prompt-as-quick-action',
      label: t('quickActions.capture.label'),
      icon: 'bookmark-plus',
      isEligible: isCaptureEligible,
      run: (msg) => openCaptureFromMessage(this, msg),
    });
```

And add the import near the other `quickActions` imports (next to `QuickActionStorage`):

```typescript
import { isCaptureEligible, openCaptureFromMessage } from './features/quickActions/captureFromMessage';
```

- [ ] **Step 2: Verify typecheck, lint, and the unit suite**

Run these in parallel:
- `npm run typecheck`
- `npm run lint`
- `npm run test -- --selectProjects unit`

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(chat): register 'Capture as quick action' message action"
```

---

## Task 8: End-to-end integration test

**Files:**
- Create: `tests/integration/features/quickActions/capture.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/features/quickActions/capture.test.ts`:

```typescript
import type { ChatMessage } from '@/core/types';
import { eligibleMessageActions } from '@/features/chat/rendering/messageActions';
import { isCaptureEligible, deriveSeedName } from '@/features/quickActions/captureFromMessage';
import { parseQuickActionContent } from '@/features/quickActions/quickActionParse';
import { QuickActionStorage } from '@/features/quickActions/QuickActionStorage';

function makeAdapter(initial = new Map<string, string>()) {
  return {
    exists: jest.fn(async (p: string) => initial.has(p)),
    read: jest.fn(async (p: string) => initial.get(p) ?? ''),
    write: jest.fn(async (p: string, c: string) => { initial.set(p, c); }),
    delete: jest.fn(async (p: string) => { initial.delete(p); }),
    ensureFolder: jest.fn(async () => undefined),
    listFilesRecursive: jest.fn(async () => Array.from(initial.keys())),
    append: jest.fn(),
  } as any;
}

const captureAction = {
  id: 'capture-prompt-as-quick-action',
  label: 'Capture as quick action',
  icon: 'bookmark-plus',
  isEligible: isCaptureEligible,
  run: jest.fn(),
};

describe('capture flow integration', () => {
  it('shows the action for plain user messages and hides it for command prefixes', () => {
    const user: ChatMessage = { id: 'u', role: 'user', content: 'Summarize this PR', timestamp: 0 } as ChatMessage;
    const command: ChatMessage = { id: 'c', role: 'user', content: '/compact', timestamp: 0 } as ChatMessage;
    const assistant: ChatMessage = { id: 'a', role: 'assistant', content: 'sure', timestamp: 0 } as ChatMessage;

    expect(eligibleMessageActions([captureAction], user).map((a) => a.id)).toContain('capture-prompt-as-quick-action');
    expect(eligibleMessageActions([captureAction], command)).toEqual([]);
    expect(eligibleMessageActions([captureAction], assistant)).toEqual([]);
  });

  it('writes a parseable quick-action file when the seeded modal saves', async () => {
    const fs = new Map<string, string>();
    const storage = new QuickActionStorage(makeAdapter(fs), () => 'Quick Actions');

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Summarize the highlighted note in three bullet points.',
      timestamp: 0,
    } as ChatMessage;

    const action = {
      id: deriveSeedName(msg.content!),
      name: deriveSeedName(msg.content!),
      description: deriveSeedName(msg.content!),
      prompt: msg.content!,
      filePath: '',
    };

    const filePath = await storage.save(action);
    expect(filePath).toBe('Quick Actions/summarize-the-highlighted-note-in-three-bul.md');

    const parsed = parseQuickActionContent(fs.get(filePath)!, filePath);
    expect(parsed?.prompt).toBe(msg.content);
    expect(parsed?.name).toBe(deriveSeedName(msg.content!));
  });

  it('blocks a second capture against the same slug via the storage.exists guard', async () => {
    const fs = new Map<string, string>();
    const storage = new QuickActionStorage(makeAdapter(fs), () => 'Quick Actions');

    const action = { id: 'Dup', name: 'Dup', description: 'd', prompt: 'one', filePath: '' };
    const firstPath = await storage.save(action);
    expect(await storage.exists(firstPath)).toBe(true);

    // Second capture would slugify to the same path.
    const targetPath = storage.getFilePathForName('Dup');
    expect(targetPath).toBe(firstPath);
    expect(await storage.exists(targetPath)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `npm run test -- --selectProjects integration tests/integration/features/quickActions/capture.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/features/quickActions/capture.test.ts
git commit -m "test(quickActions): integration coverage for capture flow"
```

---

## Task 9: Final verification

**Files:** none

- [ ] **Step 1: Run the full pre-merge gate**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all PASS, build artifact produced.

- [ ] **Step 2: Manual smoke (Obsidian)**

Verify each in the dev vault:

1. Send a plain user prompt → button appears in the toolbar → click → modal opens with seeded name + prompt → save → file written under `Quick Actions/`, opens in pane, toast surfaces, favorites menu updates after favoriting.
2. Send `/compact`, `$skill`, `#instruction`, `!ls` → no button on any of these messages.
3. Send an image-only message → no button.
4. Open a resumed conversation with prior user messages → button appears on the rehydrated user messages → capture works against them.
5. Capture against an existing name → notice fires, modal stays open, user renames and saves.
6. Clear the Quick Actions folder setting → click capture → notice fires, modal not opened.

- [ ] **Step 3: Mark the plan done**

In this plan file, change `status: draft` to `status: ready-for-review` in the YAML frontmatter.

```bash
git add docs/superpowers/plans/2026-06-04-capture-prompt-as-quick-action.md
git commit -m "docs(plans): mark capture-prompt-as-quick-action plan ready for review"
```
