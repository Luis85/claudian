# Quick-action provider+model prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prompt provider+model before dispatching a quick-action from a non-chat entry point (file/folder context menu, work-order favorites submenu), with per-action last-used persistence in `.claudian/cache/quick-action-last-used.json`.

**Architecture:** New `launchQuickAction(plugin, file, action)` seam called by `openContextMenuQuickAction` (picker onRun) and `appendQuickActionFavoritesAndPicker` (favorites items). Seam resolves preset from `QuickActionLastUsedStore` (or global default), opens `QuickActionLaunchModal`, persists the choice, and delegates to `runQuickActionForFile` with a `{ providerId, model }` override. The override threads through `createTab` as `defaultProviderId` + `pinnedModel`. Chat-header toolbar path stays unchanged.

**Tech Stack:** TypeScript, Obsidian Plugin API, Jest (jsdom), `ProviderRegistry`, `VaultFileAdapter`.

**Spec:** [[docs/superpowers/specs/2026-06-06-quick-action-provider-model-prompt-design.md]]

---

## File Structure

### New files

| Path | Responsibility |
|------|----------------|
| `src/features/quickActions/quickActionLastUsedStore.ts` | Module exporting `QuickActionLastUsedStore` class + serialize/parse helpers. Hydrates from `.claudian/cache/quick-action-last-used.json`, mutates in-memory map, debounced write to disk. |
| `src/features/quickActions/launchQuickAction.ts` | Single seam. Resolves preset, validates against current providers, opens launch modal, persists confirmed choice, delegates to `runQuickActionForFile` with override. |
| `src/features/quickActions/ui/QuickActionLaunchModal.ts` | Obsidian `Modal` subclass. Provider dropdown + model dropdown + optional fallback notice + Run/Cancel. |
| `tests/unit/features/quickActions/quickActionLastUsedStore.test.ts` | Unit tests for serialize/parse + store behavior. |
| `tests/unit/features/quickActions/launchQuickAction.test.ts` | Unit tests for seam (store hit valid/invalid, miss, cancel, confirm). |
| `tests/unit/features/quickActions/ui/QuickActionLaunchModal.test.ts` | Unit tests for modal UI. |
| `tests/integration/features/quickActions/launchFromContextMenu.test.ts` | End-to-end: picker → launch modal → confirm → tab opened with chosen provider+model → prompt dispatched. |

### Modified files

| Path | Change |
|------|--------|
| `src/features/quickActions/runQuickActionForFile.ts` | Add optional 4th param `override?: { providerId; model }`. When set, skip blank-tab reuse on wrong provider; pass `defaultProviderId` + `pinnedModel` to `createTab`. |
| `src/features/quickActions/openContextMenuQuickAction.ts` | `onRun` calls `launchQuickAction(plugin, file, action)` instead of `runQuickActionForFile`. |
| `src/features/quickActions/appendQuickActionMenu.ts` | Favorites entry `onClick` calls `launchQuickAction(plugin, file, fav)` instead of `runQuickActionForFile`. |
| `src/main.ts` | Construct + hydrate `QuickActionLastUsedStore` in `completeDeferredOnload` after `ProviderWorkspaceRegistry.initializeAll`. Expose as `plugin.quickActionLastUsedStore`. Flush in `onunload`. |
| `src/i18n/locales/*.ts` | Add new strings: `quickActions.launchModal.title`, `runButton`, `cancelButton`, `providerLabel`, `modelLabel`, `fallbackNotice`, `noProvidersEnabled`. (English at minimum; other locales fall back if untranslated.) |

---

## Task 1: `QuickActionLastUsedStore` — serialize/parse helpers

**Files:**
- Create: `src/features/quickActions/quickActionLastUsedStore.ts` (helpers section only)
- Test: `tests/unit/features/quickActions/quickActionLastUsedStore.test.ts` (parse/serialize block)

- [ ] **Step 1: Write failing tests for serialize/parse**

Create `tests/unit/features/quickActions/quickActionLastUsedStore.test.ts`:

```ts
import {
  PERSISTED_SCHEMA_VERSION,
  parsePersistedLastUsed,
  serializePersistedLastUsed,
} from '@/features/quickActions/quickActionLastUsedStore';

describe('quickActionLastUsedStore persistence', () => {
  describe('serializePersistedLastUsed', () => {
    it('writes schemaVersion + entries map', () => {
      const map = new Map([
        ['summarize', { providerId: 'claude' as const, model: 'claude-sonnet-4-5', updatedAt: 1700000000000 }],
      ]);
      const json = serializePersistedLastUsed(map, 1700000000123);
      const parsed = JSON.parse(json);
      expect(parsed.schemaVersion).toBe(PERSISTED_SCHEMA_VERSION);
      expect(parsed.writtenAt).toBe(1700000000123);
      expect(parsed.entries.summarize).toEqual({
        providerId: 'claude',
        model: 'claude-sonnet-4-5',
        updatedAt: 1700000000000,
      });
    });
  });

  describe('parsePersistedLastUsed', () => {
    it('returns Map for valid input', () => {
      const raw = JSON.stringify({
        schemaVersion: PERSISTED_SCHEMA_VERSION,
        writtenAt: 0,
        entries: {
          summarize: { providerId: 'claude', model: 'claude-sonnet-4-5', updatedAt: 1 },
        },
      });
      const out = parsePersistedLastUsed(raw);
      expect(out?.get('summarize')).toEqual({
        providerId: 'claude',
        model: 'claude-sonnet-4-5',
        updatedAt: 1,
      });
    });

    it('returns null on malformed JSON', () => {
      expect(parsePersistedLastUsed('not-json')).toBeNull();
    });

    it('returns null on schema-version mismatch', () => {
      const raw = JSON.stringify({ schemaVersion: 999, writtenAt: 0, entries: {} });
      expect(parsePersistedLastUsed(raw)).toBeNull();
    });

    it('returns null when entries missing', () => {
      const raw = JSON.stringify({ schemaVersion: PERSISTED_SCHEMA_VERSION, writtenAt: 0 });
      expect(parsePersistedLastUsed(raw)).toBeNull();
    });

    it('skips non-object entry values without throwing', () => {
      const raw = JSON.stringify({
        schemaVersion: PERSISTED_SCHEMA_VERSION,
        writtenAt: 0,
        entries: {
          bad: 'not-an-object',
          good: { providerId: 'claude', model: 'm', updatedAt: 1 },
        },
      });
      const out = parsePersistedLastUsed(raw);
      expect(out?.has('bad')).toBe(false);
      expect(out?.get('good')?.model).toBe('m');
    });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test -- tests/unit/features/quickActions/quickActionLastUsedStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement helpers**

Create `src/features/quickActions/quickActionLastUsedStore.ts`:

```ts
import type { ProviderId } from '@/core/providers/types';

export const PERSISTED_SCHEMA_VERSION = 1;

export interface LastUsedEntry {
  providerId: ProviderId;
  model: string;
  updatedAt: number;
}

interface PersistedShape {
  schemaVersion: number;
  writtenAt: number;
  entries: Record<string, LastUsedEntry>;
}

export function serializePersistedLastUsed(
  entries: Map<string, LastUsedEntry>,
  writtenAt: number,
): string {
  const out: PersistedShape = {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    writtenAt,
    entries: {},
  };
  for (const [stem, entry] of entries) {
    out.entries[stem] = { ...entry };
  }
  return JSON.stringify(out);
}

export function parsePersistedLastUsed(raw: string): Map<string, LastUsedEntry> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const shape = parsed as Partial<PersistedShape>;
  if (shape.schemaVersion !== PERSISTED_SCHEMA_VERSION) return null;
  if (!shape.entries || typeof shape.entries !== 'object') return null;

  const out = new Map<string, LastUsedEntry>();
  for (const [stem, value] of Object.entries(shape.entries)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Partial<LastUsedEntry>;
    if (typeof entry.providerId !== 'string') continue;
    if (typeof entry.model !== 'string') continue;
    if (typeof entry.updatedAt !== 'number') continue;
    out.set(stem, {
      providerId: entry.providerId as ProviderId,
      model: entry.model,
      updatedAt: entry.updatedAt,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm run test -- tests/unit/features/quickActions/quickActionLastUsedStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/quickActionLastUsedStore.ts tests/unit/features/quickActions/quickActionLastUsedStore.test.ts
git commit -m "feat(quickActions): serialize/parse helpers for last-used store"
```

---

## Task 2: `QuickActionLastUsedStore` — class with hydrate, get, set, flush

**Files:**
- Modify: `src/features/quickActions/quickActionLastUsedStore.ts`
- Test: `tests/unit/features/quickActions/quickActionLastUsedStore.test.ts`

- [ ] **Step 1: Add failing tests for the class**

Append to `tests/unit/features/quickActions/quickActionLastUsedStore.test.ts`:

```ts
import { QuickActionLastUsedStore } from '@/features/quickActions/quickActionLastUsedStore';

class StubAdapter {
  files: Record<string, string> = {};
  writeCount = 0;
  async exists(p: string): Promise<boolean> { return p in this.files; }
  async read(p: string): Promise<string> { return this.files[p]; }
  async write(p: string, content: string): Promise<void> {
    this.writeCount += 1;
    this.files[p] = content;
  }
}

function makeStore(adapter: StubAdapter, logger?: { warn: jest.Mock }) {
  return new QuickActionLastUsedStore({
    adapter: adapter as any,
    cachePath: '.claudian/cache/quick-action-last-used.json',
    debounceMs: 10,
    logger: logger ?? { warn: jest.fn() },
    now: () => 5000,
  });
}

describe('QuickActionLastUsedStore', () => {
  it('hydrates to empty when file does not exist', async () => {
    const adapter = new StubAdapter();
    const store = makeStore(adapter);
    await store.hydrate();
    expect(store.get('summarize')).toBeNull();
  });

  it('hydrates from a valid file', async () => {
    const adapter = new StubAdapter();
    adapter.files['.claudian/cache/quick-action-last-used.json'] = JSON.stringify({
      schemaVersion: 1,
      writtenAt: 0,
      entries: { summarize: { providerId: 'claude', model: 'm', updatedAt: 1 } },
    });
    const store = makeStore(adapter);
    await store.hydrate();
    expect(store.get('summarize')).toEqual({ providerId: 'claude', model: 'm', updatedAt: 1 });
  });

  it('warn-logs and treats malformed JSON as cold cache', async () => {
    const adapter = new StubAdapter();
    adapter.files['.claudian/cache/quick-action-last-used.json'] = 'not-json';
    const logger = { warn: jest.fn() };
    const store = makeStore(adapter, logger);
    await store.hydrate();
    expect(store.get('summarize')).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('set updates in-memory immediately', () => {
    const store = makeStore(new StubAdapter());
    store.set('summarize', { providerId: 'claude', model: 'm' });
    expect(store.get('summarize')).toEqual({ providerId: 'claude', model: 'm', updatedAt: 5000 });
  });

  it('coalesces multiple set calls into one debounced write', async () => {
    const adapter = new StubAdapter();
    const store = makeStore(adapter);
    store.set('a', { providerId: 'claude', model: 'm1' });
    store.set('b', { providerId: 'claude', model: 'm2' });
    store.set('c', { providerId: 'claude', model: 'm3' });
    await store.flush();
    expect(adapter.writeCount).toBe(1);
    const parsed = JSON.parse(adapter.files['.claudian/cache/quick-action-last-used.json']);
    expect(Object.keys(parsed.entries).sort()).toEqual(['a', 'b', 'c']);
  });

  it('flush awaits pending write', async () => {
    const adapter = new StubAdapter();
    const store = makeStore(adapter);
    store.set('x', { providerId: 'claude', model: 'm' });
    await store.flush();
    expect(adapter.writeCount).toBe(1);
  });

  it('swallows write errors and warn-logs', async () => {
    const adapter = new StubAdapter();
    adapter.write = jest.fn().mockRejectedValue(new Error('disk full'));
    const logger = { warn: jest.fn() };
    const store = makeStore(adapter, logger);
    store.set('x', { providerId: 'claude', model: 'm' });
    await store.flush();
    expect(logger.warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test -- tests/unit/features/quickActions/quickActionLastUsedStore.test.ts`
Expected: FAIL — `QuickActionLastUsedStore` not exported.

- [ ] **Step 3: Implement the class**

Append to `src/features/quickActions/quickActionLastUsedStore.ts`:

```ts
export interface LastUsedAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
}

export interface LastUsedLogger {
  warn(...args: unknown[]): void;
}

export interface QuickActionLastUsedStoreOptions {
  adapter: LastUsedAdapter;
  cachePath?: string;
  debounceMs?: number;
  logger: LastUsedLogger;
  now?: () => number;
}

const DEFAULT_CACHE_PATH = '.claudian/cache/quick-action-last-used.json';
const DEFAULT_DEBOUNCE_MS = 500;

export class QuickActionLastUsedStore {
  private readonly adapter: LastUsedAdapter;
  private readonly cachePath: string;
  private readonly debounceMs: number;
  private readonly logger: LastUsedLogger;
  private readonly now: () => number;

  private entries = new Map<string, LastUsedEntry>();
  private hydrated = false;
  private dirty = false;
  private pendingWrite: Promise<void> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: QuickActionLastUsedStoreOptions) {
    this.adapter = options.adapter;
    this.cachePath = options.cachePath ?? DEFAULT_CACHE_PATH;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.logger = options.logger;
    this.now = options.now ?? (() => Date.now());
  }

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      if (!(await this.adapter.exists(this.cachePath))) return;
      const raw = await this.adapter.read(this.cachePath);
      const parsed = parsePersistedLastUsed(raw);
      if (!parsed) {
        this.logger.warn(`[quickActionLastUsedStore] malformed cache at ${this.cachePath}, starting cold`);
        return;
      }
      this.entries = parsed;
    } catch (error) {
      this.logger.warn(`[quickActionLastUsedStore] hydrate failed`, error);
    }
  }

  get(stem: string): LastUsedEntry | null {
    return this.entries.get(stem) ?? null;
  }

  set(stem: string, choice: { providerId: ProviderId; model: string }): void {
    this.entries.set(stem, {
      providerId: choice.providerId,
      model: choice.model,
      updatedAt: this.now(),
    });
    this.dirty = true;
    this.scheduleWrite();
  }

  /** Remove a stale entry (e.g. provider got disabled or model removed). */
  delete(stem: string): void {
    if (!this.entries.delete(stem)) return;
    this.dirty = true;
    this.scheduleWrite();
  }

  async flush(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pendingWrite) {
      await this.pendingWrite;
    }
    if (this.dirty) {
      await this.persistNow();
    }
  }

  private scheduleWrite(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.persistNow();
    }, this.debounceMs);
  }

  private async persistNow(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    const snapshot = new Map(this.entries);
    const writtenAt = this.now();
    const payload = serializePersistedLastUsed(snapshot, writtenAt);
    const write = this.adapter
      .write(this.cachePath, payload)
      .catch((error) => {
        this.logger.warn(`[quickActionLastUsedStore] write failed`, error);
        this.dirty = true;
      });
    this.pendingWrite = write;
    try {
      await write;
    } finally {
      this.pendingWrite = null;
    }
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm run test -- tests/unit/features/quickActions/quickActionLastUsedStore.test.ts`
Expected: PASS — all serialize/parse + class tests green.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/quickActionLastUsedStore.ts tests/unit/features/quickActions/quickActionLastUsedStore.test.ts
git commit -m "feat(quickActions): QuickActionLastUsedStore with debounced write"
```

---

## Task 3: Wire the store into `main.ts` lifecycle

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Declare the field**

In `src/main.ts`, near the existing `quickActionFavoritesCache` declaration on the `ClaudianPlugin` class, add:

```ts
quickActionLastUsedStore: QuickActionLastUsedStore | null = null;
```

Import at the top of the file:

```ts
import { QuickActionLastUsedStore } from './features/quickActions/quickActionLastUsedStore';
import { VaultFileAdapter } from './core/storage/VaultFileAdapter';
```

(The `VaultFileAdapter` import may already exist — check before duplicating.)

- [ ] **Step 2: Construct + hydrate in `completeDeferredOnload`**

Inside `completeDeferredOnload`, after `this.vaultSkillAggregator = aggregator; await aggregator.hydrate();` and after the `if (this.unloaded || ...)` guard, add:

```ts
    const lastUsedStore = new QuickActionLastUsedStore({
      adapter: new VaultFileAdapter(this.app),
      logger: { warn: (...args) => this.logger.scope('quickActions').warn(...args) },
    });
    await lastUsedStore.hydrate();
    if (this.unloaded) return;
    this.quickActionLastUsedStore = lastUsedStore;
```

- [ ] **Step 3: Flush in `onunload`**

In `onunload`, before `this.lifecycle?.shutdownActiveRuntimes()`, add:

```ts
    if (this.quickActionLastUsedStore) {
      void this.quickActionLastUsedStore.flush();
      this.quickActionLastUsedStore = null;
    }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): wire QuickActionLastUsedStore lifecycle"
```

---

## Task 4: `QuickActionLaunchModal` skeleton + render test

**Files:**
- Create: `src/features/quickActions/ui/QuickActionLaunchModal.ts`
- Test: `tests/unit/features/quickActions/ui/QuickActionLaunchModal.test.ts`

- [ ] **Step 1: Add the i18n strings**

In `src/i18n/locales/en.ts` (or wherever the English locale lives — check `src/i18n/i18n.ts` for the registry), add under `quickActions`:

```ts
launchModal: {
  title: 'Run "{name}"',
  providerLabel: 'Provider',
  modelLabel: 'Model',
  runButton: 'Run',
  cancelButton: 'Cancel',
  fallbackNotice: 'Previous choice ({provider} / {model}) unavailable, defaulted to current selection.',
  noProvidersEnabled: 'No providers enabled — configure in settings.',
},
```

If the other locale files use a strict shape, mirror the keys (English copy as placeholder). Otherwise leave them alone — i18n falls back to English.

- [ ] **Step 2: Write failing UI tests**

Create `tests/unit/features/quickActions/ui/QuickActionLaunchModal.test.ts`:

```ts
import {
  QuickActionLaunchModal,
  type QuickActionLaunchModalOptions,
} from '@/features/quickActions/ui/QuickActionLaunchModal';
import type { QuickAction } from '@/features/quickActions/types';

jest.mock('obsidian', () => {
  class Modal {
    contentEl = document.createElement('div');
    constructor(public app: unknown) {}
    open(): void { this.onOpen(); }
    close(): void { this.onClose(); }
    onOpen(): void {}
    onClose(): void {}
  }
  return { Modal };
});

jest.mock('@/i18n/i18n', () => ({
  t: (key: string, vars?: Record<string, string>) => {
    if (!vars) return key;
    return Object.entries(vars).reduce(
      (acc, [k, v]) => acc.replace(`{${k}}`, v),
      key,
    );
  },
}));

const ACTION: QuickAction = {
  id: 'a',
  name: 'Summarize',
  description: 'd',
  prompt: 'p',
  filePath: 'qa/summarize.md',
};

function makeOptions(over: Partial<QuickActionLaunchModalOptions> = {}): QuickActionLaunchModalOptions {
  return {
    app: {} as never,
    action: ACTION,
    presetProviderId: 'claude',
    presetModel: 'claude-sonnet-4-5',
    enabledProviders: [
      { id: 'claude', displayName: 'Claude', models: [
        { value: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
        { value: 'claude-opus-4-5', label: 'Opus 4.5' },
      ] },
      { id: 'codex', displayName: 'Codex', models: [
        { value: 'gpt-5-codex', label: 'gpt-5-codex' },
      ] },
    ],
    resolveDefaultModelForProvider: (id) => (id === 'claude' ? 'claude-sonnet-4-5' : 'gpt-5-codex'),
    onConfirm: jest.fn(),
    ...over,
  };
}

describe('QuickActionLaunchModal', () => {
  it('renders provider + model selects pre-filled with preset', () => {
    const opts = makeOptions();
    const modal = new QuickActionLaunchModal(opts);
    modal.open();
    const providerSelect = modal.contentEl.querySelector<HTMLSelectElement>('[data-testid="qa-provider"]');
    const modelSelect = modal.contentEl.querySelector<HTMLSelectElement>('[data-testid="qa-model"]');
    expect(providerSelect?.value).toBe('claude');
    expect(modelSelect?.value).toBe('claude-sonnet-4-5');
  });

  it('lists only enabled providers', () => {
    const opts = makeOptions();
    const modal = new QuickActionLaunchModal(opts);
    modal.open();
    const providerSelect = modal.contentEl.querySelector<HTMLSelectElement>('[data-testid="qa-provider"]')!;
    const ids = Array.from(providerSelect.options).map((o) => o.value);
    expect(ids).toEqual(['claude', 'codex']);
  });

  it('switching provider resets model to that provider default', () => {
    const opts = makeOptions();
    const modal = new QuickActionLaunchModal(opts);
    modal.open();
    const providerSelect = modal.contentEl.querySelector<HTMLSelectElement>('[data-testid="qa-provider"]')!;
    const modelSelect = modal.contentEl.querySelector<HTMLSelectElement>('[data-testid="qa-model"]')!;
    providerSelect.value = 'codex';
    providerSelect.dispatchEvent(new Event('change'));
    expect(modelSelect.value).toBe('gpt-5-codex');
  });

  it('shows the fallback notice when present', () => {
    const opts = makeOptions({
      fallbackNotice: { storedProviderId: 'codex', storedModel: 'gpt-5-codex' },
    });
    const modal = new QuickActionLaunchModal(opts);
    modal.open();
    const notice = modal.contentEl.querySelector('[data-testid="qa-fallback-notice"]');
    expect(notice?.textContent).toContain('codex');
    expect(notice?.textContent).toContain('gpt-5-codex');
  });

  it('hides the fallback notice when absent', () => {
    const modal = new QuickActionLaunchModal(makeOptions());
    modal.open();
    expect(modal.contentEl.querySelector('[data-testid="qa-fallback-notice"]')).toBeNull();
  });

  it('Run fires onConfirm with selected pair, then closes', () => {
    const opts = makeOptions();
    const modal = new QuickActionLaunchModal(opts);
    modal.open();
    const runBtn = modal.contentEl.querySelector<HTMLButtonElement>('[data-testid="qa-run"]')!;
    runBtn.click();
    expect(opts.onConfirm).toHaveBeenCalledWith({ providerId: 'claude', model: 'claude-sonnet-4-5' });
  });

  it('Cancel does not fire onConfirm', () => {
    const opts = makeOptions();
    const modal = new QuickActionLaunchModal(opts);
    modal.open();
    const cancelBtn = modal.contentEl.querySelector<HTMLButtonElement>('[data-testid="qa-cancel"]')!;
    cancelBtn.click();
    expect(opts.onConfirm).not.toHaveBeenCalled();
  });

  it('disables Run + shows configure notice when no providers enabled', () => {
    const opts = makeOptions({ enabledProviders: [] });
    const modal = new QuickActionLaunchModal(opts);
    modal.open();
    const runBtn = modal.contentEl.querySelector<HTMLButtonElement>('[data-testid="qa-run"]')!;
    expect(runBtn.disabled).toBe(true);
    const empty = modal.contentEl.querySelector('[data-testid="qa-empty"]');
    expect(empty?.textContent).toContain('No providers enabled');
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `npm run test -- tests/unit/features/quickActions/ui/QuickActionLaunchModal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the modal**

Create `src/features/quickActions/ui/QuickActionLaunchModal.ts`:

```ts
import { Modal, type App } from 'obsidian';

import type { ProviderId } from '@/core/providers/types';
import { t } from '@/i18n/i18n';

import type { QuickAction } from '../types';

export interface QuickActionLaunchModelOption {
  value: string;
  label: string;
}

export interface QuickActionLaunchProvider {
  id: ProviderId;
  displayName: string;
  models: QuickActionLaunchModelOption[];
}

export interface QuickActionLaunchModalOptions {
  app: App;
  action: QuickAction;
  presetProviderId: ProviderId;
  presetModel: string;
  enabledProviders: QuickActionLaunchProvider[];
  resolveDefaultModelForProvider: (providerId: ProviderId) => string;
  fallbackNotice?: {
    storedProviderId: ProviderId;
    storedModel: string;
  };
  onConfirm: (choice: { providerId: ProviderId; model: string }) => void;
}

export class QuickActionLaunchModal extends Modal {
  private readonly options: QuickActionLaunchModalOptions;
  private providerSelect: HTMLSelectElement | null = null;
  private modelSelect: HTMLSelectElement | null = null;
  private confirmed = false;

  constructor(options: QuickActionLaunchModalOptions) {
    super(options.app);
    this.options = options;
  }

  onOpen(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('claudian-qa-launch-modal');

    root.createEl('h3', { text: t('quickActions.launchModal.title', { name: this.options.action.name }) });

    if (this.options.fallbackNotice) {
      const notice = root.createDiv({ cls: 'claudian-qa-launch-notice' });
      notice.setAttr('data-testid', 'qa-fallback-notice');
      notice.setText(t('quickActions.launchModal.fallbackNotice', {
        provider: this.options.fallbackNotice.storedProviderId,
        model: this.options.fallbackNotice.storedModel,
      }));
    }

    if (this.options.enabledProviders.length === 0) {
      const empty = root.createDiv({ cls: 'claudian-qa-launch-empty' });
      empty.setAttr('data-testid', 'qa-empty');
      empty.setText(t('quickActions.launchModal.noProvidersEnabled'));
      this.renderActions(root, /* runDisabled */ true);
      return;
    }

    this.renderProviderRow(root);
    this.renderModelRow(root);
    this.renderActions(root, /* runDisabled */ false);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderProviderRow(root: HTMLElement): void {
    const row = root.createDiv({ cls: 'claudian-qa-launch-row' });
    row.createEl('label', { text: t('quickActions.launchModal.providerLabel') });
    const select = row.createEl('select');
    select.setAttr('data-testid', 'qa-provider');
    for (const provider of this.options.enabledProviders) {
      const opt = select.createEl('option', { value: provider.id, text: provider.displayName });
      if (provider.id === this.options.presetProviderId) opt.selected = true;
    }
    select.addEventListener('change', () => {
      const next = select.value as ProviderId;
      const defaultModel = this.options.resolveDefaultModelForProvider(next);
      this.renderModelOptions(next, defaultModel);
    });
    this.providerSelect = select;
  }

  private renderModelRow(root: HTMLElement): void {
    const row = root.createDiv({ cls: 'claudian-qa-launch-row' });
    row.createEl('label', { text: t('quickActions.launchModal.modelLabel') });
    const select = row.createEl('select');
    select.setAttr('data-testid', 'qa-model');
    this.modelSelect = select;
    this.renderModelOptions(this.options.presetProviderId, this.options.presetModel);
  }

  private renderModelOptions(providerId: ProviderId, selectedValue: string): void {
    if (!this.modelSelect) return;
    this.modelSelect.empty();
    const provider = this.options.enabledProviders.find((p) => p.id === providerId);
    const models = provider?.models ?? [];
    for (const model of models) {
      const opt = this.modelSelect.createEl('option', { value: model.value, text: model.label });
      if (model.value === selectedValue) opt.selected = true;
    }
    if (this.modelSelect.value !== selectedValue && models.length > 0) {
      this.modelSelect.value = models[0].value;
    }
  }

  private renderActions(root: HTMLElement, runDisabled: boolean): void {
    const actions = root.createDiv({ cls: 'claudian-qa-launch-actions' });

    const cancel = actions.createEl('button', { text: t('quickActions.launchModal.cancelButton') });
    cancel.setAttr('data-testid', 'qa-cancel');
    cancel.addEventListener('click', () => this.close());

    const run = actions.createEl('button', { text: t('quickActions.launchModal.runButton') });
    run.setAttr('data-testid', 'qa-run');
    run.addClass('mod-cta');
    run.disabled = runDisabled;
    run.addEventListener('click', () => {
      if (!this.providerSelect || !this.modelSelect) return;
      const choice = {
        providerId: this.providerSelect.value as ProviderId,
        model: this.modelSelect.value,
      };
      this.confirmed = true;
      this.options.onConfirm(choice);
      this.close();
    });
  }
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `npm run test -- tests/unit/features/quickActions/ui/QuickActionLaunchModal.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/quickActions/ui/QuickActionLaunchModal.ts tests/unit/features/quickActions/ui/QuickActionLaunchModal.test.ts src/i18n/locales/
git commit -m "feat(quickActions): QuickActionLaunchModal UI"
```

---

## Task 5: `launchQuickAction` seam

**Files:**
- Create: `src/features/quickActions/launchQuickAction.ts`
- Test: `tests/unit/features/quickActions/launchQuickAction.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/features/quickActions/launchQuickAction.test.ts`:

```ts
import { TFile } from 'obsidian';

import { launchQuickAction } from '@/features/quickActions/launchQuickAction';
import type { QuickAction } from '@/features/quickActions/types';

jest.mock('obsidian', () => ({
  TFile: class TFile { path = ''; },
  TFolder: class TFolder { path = ''; },
}));

const openModalMock = jest.fn();
jest.mock('@/features/quickActions/ui/QuickActionLaunchModal', () => ({
  QuickActionLaunchModal: jest.fn().mockImplementation((options) => ({
    open: () => openModalMock(options),
  })),
}));

const runMock = jest.fn().mockResolvedValue(undefined);
jest.mock('@/features/quickActions/runQuickActionForFile', () => ({
  runQuickActionForFile: (...args: unknown[]) => runMock(...args),
}));

const isEnabledMock = jest.fn();
const getRegisteredMock = jest.fn();
const getChatUIConfigMock = jest.fn();
const resolveSettingsProviderMock = jest.fn();
jest.mock('@/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    isEnabled: (...args: unknown[]) => isEnabledMock(...args),
    getRegisteredProviderIds: () => getRegisteredMock(),
    getChatUIConfig: (...args: unknown[]) => getChatUIConfigMock(...args),
    resolveSettingsProviderId: (...args: unknown[]) => resolveSettingsProviderMock(...args),
  },
}));

const resolveBlankTabModelMock = jest.fn();
jest.mock('@/features/chat/tabs/tabShared', () => ({
  resolveBlankTabModel: (...args: unknown[]) => resolveBlankTabModelMock(...args),
}));

const ACTION: QuickAction = {
  id: 'a', name: 'Summarize', description: 'd', prompt: 'p',
  filePath: 'qa/summarize.md',
};

function makeFile(): TFile {
  const f = Object.create(TFile.prototype);
  f.path = 'note.md';
  return f;
}

function makePlugin(store: { get: jest.Mock; set: jest.Mock; delete: jest.Mock }) {
  return {
    app: {},
    settings: { provider: 'claude' },
    quickActionLastUsedStore: store,
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  getRegisteredMock.mockReturnValue(['claude', 'codex']);
  getChatUIConfigMock.mockImplementation((id) => ({
    config: { displayName: id === 'claude' ? 'Claude' : 'Codex' },
    getModelOptions: () => (id === 'claude'
      ? [{ value: 'claude-sonnet-4-5', label: 'Sonnet 4.5' }]
      : [{ value: 'gpt-5-codex', label: 'gpt-5-codex' }]),
  }));
  isEnabledMock.mockReturnValue(true);
  resolveSettingsProviderMock.mockReturnValue('claude');
  resolveBlankTabModelMock.mockReturnValue('claude-sonnet-4-5');
});

describe('launchQuickAction', () => {
  it('uses stored entry when valid, no fallback notice', async () => {
    const store = {
      get: jest.fn().mockReturnValue({ providerId: 'codex', model: 'gpt-5-codex', updatedAt: 1 }),
      set: jest.fn(),
      delete: jest.fn(),
    };
    const plugin = makePlugin(store);

    await launchQuickAction(plugin, makeFile(), ACTION);

    const opts = openModalMock.mock.calls[0][0];
    expect(opts.presetProviderId).toBe('codex');
    expect(opts.presetModel).toBe('gpt-5-codex');
    expect(opts.fallbackNotice).toBeUndefined();
  });

  it('falls back + passes fallbackNotice when stored provider is disabled', async () => {
    const store = {
      get: jest.fn().mockReturnValue({ providerId: 'codex', model: 'gpt-5-codex', updatedAt: 1 }),
      set: jest.fn(),
      delete: jest.fn(),
    };
    isEnabledMock.mockImplementation((id) => id !== 'codex');
    const plugin = makePlugin(store);

    await launchQuickAction(plugin, makeFile(), ACTION);

    const opts = openModalMock.mock.calls[0][0];
    expect(opts.presetProviderId).toBe('claude');
    expect(opts.presetModel).toBe('claude-sonnet-4-5');
    expect(opts.fallbackNotice).toEqual({ storedProviderId: 'codex', storedModel: 'gpt-5-codex' });
    expect(store.delete).toHaveBeenCalledWith('summarize');
  });

  it('falls back + passes fallbackNotice when stored model missing', async () => {
    const store = {
      get: jest.fn().mockReturnValue({ providerId: 'claude', model: 'unknown-model', updatedAt: 1 }),
      set: jest.fn(),
      delete: jest.fn(),
    };
    const plugin = makePlugin(store);

    await launchQuickAction(plugin, makeFile(), ACTION);

    const opts = openModalMock.mock.calls[0][0];
    expect(opts.presetModel).toBe('claude-sonnet-4-5');
    expect(opts.fallbackNotice?.storedModel).toBe('unknown-model');
  });

  it('uses global default + no notice on store miss', async () => {
    const store = { get: jest.fn().mockReturnValue(null), set: jest.fn(), delete: jest.fn() };
    const plugin = makePlugin(store);

    await launchQuickAction(plugin, makeFile(), ACTION);

    const opts = openModalMock.mock.calls[0][0];
    expect(opts.presetProviderId).toBe('claude');
    expect(opts.presetModel).toBe('claude-sonnet-4-5');
    expect(opts.fallbackNotice).toBeUndefined();
  });

  it('confirm persists choice and dispatches with override', async () => {
    const store = { get: jest.fn().mockReturnValue(null), set: jest.fn(), delete: jest.fn() };
    const plugin = makePlugin(store);

    await launchQuickAction(plugin, makeFile(), ACTION);
    const opts = openModalMock.mock.calls[0][0];
    opts.onConfirm({ providerId: 'codex', model: 'gpt-5-codex' });
    await new Promise((r) => setImmediate(r));

    expect(store.set).toHaveBeenCalledWith('summarize', { providerId: 'codex', model: 'gpt-5-codex' });
    expect(runMock).toHaveBeenCalledWith(
      plugin,
      expect.any(Object),
      ACTION,
      { providerId: 'codex', model: 'gpt-5-codex' },
    );
  });

  it('cancel (modal closes without onConfirm) does not persist and does not dispatch', async () => {
    const store = { get: jest.fn().mockReturnValue(null), set: jest.fn(), delete: jest.fn() };
    const plugin = makePlugin(store);

    await launchQuickAction(plugin, makeFile(), ACTION);
    // simulate cancel: modal opened, onConfirm never invoked
    expect(store.set).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test -- tests/unit/features/quickActions/launchQuickAction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the seam**

Create `src/features/quickActions/launchQuickAction.ts`:

```ts
import type { TAbstractFile } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ProviderId } from '@/core/providers/types';
import { asSettingsBag } from '@/core/types/settings';
import { resolveBlankTabModel } from '@/features/chat/tabs/tabShared';
import type ClaudianPlugin from '@/main';

import { runQuickActionForFile, quickActionStemFromPath } from './runQuickActionForFile';
import type { QuickAction } from './types';
import {
  QuickActionLaunchModal,
  type QuickActionLaunchProvider,
} from './ui/QuickActionLaunchModal';

export async function launchQuickAction(
  plugin: ClaudianPlugin,
  file: TAbstractFile,
  action: QuickAction,
): Promise<void> {
  const stem = quickActionStemFromPath(action.filePath);
  const settings = asSettingsBag(plugin.settings);

  const enabledProviders = buildEnabledProviders(settings);
  const enabledIds = new Set(enabledProviders.map((p) => p.id));

  const stored = plugin.quickActionLastUsedStore?.get(stem) ?? null;
  let presetProviderId: ProviderId;
  let presetModel: string;
  let fallbackNotice: { storedProviderId: ProviderId; storedModel: string } | undefined;

  if (stored && enabledIds.has(stored.providerId)
      && enabledProviders.find((p) => p.id === stored.providerId)
        ?.models.some((m) => m.value === stored.model)) {
    presetProviderId = stored.providerId;
    presetModel = stored.model;
  } else {
    presetProviderId = ProviderRegistry.resolveSettingsProviderId(settings);
    presetModel = resolveBlankTabModel(plugin, presetProviderId);
    if (stored) {
      fallbackNotice = { storedProviderId: stored.providerId, storedModel: stored.model };
      plugin.quickActionLastUsedStore?.delete(stem);
    }
  }

  const modal = new QuickActionLaunchModal({
    app: plugin.app,
    action,
    presetProviderId,
    presetModel,
    enabledProviders,
    resolveDefaultModelForProvider: (providerId) => resolveBlankTabModel(plugin, providerId),
    fallbackNotice,
    onConfirm: (choice) => {
      plugin.quickActionLastUsedStore?.set(stem, choice);
      void runQuickActionForFile(plugin, file, action, choice);
    },
  });
  modal.open();
}

function buildEnabledProviders(settings: Record<string, unknown>): QuickActionLaunchProvider[] {
  const out: QuickActionLaunchProvider[] = [];
  for (const id of ProviderRegistry.getRegisteredProviderIds()) {
    if (!ProviderRegistry.isEnabled(id, settings)) continue;
    const uiConfig = ProviderRegistry.getChatUIConfig(id);
    const models = uiConfig.getModelOptions(settings).map((opt) => ({
      value: opt.value,
      label: opt.label,
    }));
    out.push({ id, displayName: uiConfig.config.displayName, models });
  }
  return out;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm run test -- tests/unit/features/quickActions/launchQuickAction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/launchQuickAction.ts tests/unit/features/quickActions/launchQuickAction.test.ts
git commit -m "feat(quickActions): launchQuickAction seam with last-used preset"
```

---

## Task 6: Extend `runQuickActionForFile` with override

**Files:**
- Modify: `src/features/quickActions/runQuickActionForFile.ts`
- Test: `tests/unit/features/quickActions/runQuickActionForFile.test.ts`

- [ ] **Step 1: Add failing tests for the override path**

Append to `tests/unit/features/quickActions/runQuickActionForFile.test.ts`:

```ts
describe('runQuickActionForFile with override', () => {
  it('reuses blank active tab when its provider matches override.providerId', async () => {
    const tab = { ...makeMockTab('blank'), providerId: 'claude' } as any;
    const tm = makeMockTabManager({ activeTab: tab, canCreate: true });
    // Inject providerId resolver hook: stub getTabProviderId via global require.
    jest.doMock('@/features/chat/tabs/providerResolution', () => ({
      getTabProviderId: () => 'claude',
    }));
    const plugin = makeMockPlugin(tm);
    const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });

    const { runQuickActionForFile: run } = await import('@/features/quickActions/runQuickActionForFile');
    await run(plugin as any, file, MOCK_ACTION, { providerId: 'claude', model: 'claude-sonnet-4-5' });

    expect(tm.createTab).not.toHaveBeenCalled();
    expect(tm.switchToTab).toHaveBeenCalledWith('tab-1');
  });

  it('creates a new tab with defaultProviderId + pinnedModel when active blank wrong provider', async () => {
    jest.resetModules();
    jest.doMock('@/features/chat/tabs/providerResolution', () => ({
      getTabProviderId: () => 'codex',
    }));
    const newTab = makeMockTab('blank');
    const tab = makeMockTab('blank');
    const tm = makeMockTabManager({ activeTab: tab, canCreate: true, newTab });
    const plugin = makeMockPlugin(tm);
    const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });

    const { runQuickActionForFile: run } = await import('@/features/quickActions/runQuickActionForFile');
    await run(plugin as any, file, MOCK_ACTION, { providerId: 'claude', model: 'claude-sonnet-4-5' });

    expect(tm.createTab).toHaveBeenCalledWith(
      null,
      undefined,
      expect.objectContaining({
        activate: false,
        defaultProviderId: 'claude',
        pinnedModel: 'claude-sonnet-4-5',
      }),
    );
  });

  it('preserves existing behavior when no override given (inherits from active blank)', async () => {
    jest.resetModules();
    jest.doMock('@/features/chat/tabs/providerResolution', () => ({
      getTabProviderId: () => 'codex',
    }));
    const tab = makeMockTab('blank');
    const tm = makeMockTabManager({ activeTab: tab, canCreate: true });
    const plugin = makeMockPlugin(tm);
    const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });

    const { runQuickActionForFile: run } = await import('@/features/quickActions/runQuickActionForFile');
    await run(plugin as any, file, MOCK_ACTION);

    expect(tm.createTab).not.toHaveBeenCalled();
    expect(tm.switchToTab).toHaveBeenCalledWith('tab-1');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test -- tests/unit/features/quickActions/runQuickActionForFile.test.ts`
Expected: FAIL — override parameter not implemented, behavior identical to existing.

- [ ] **Step 3: Implement override path**

Modify `src/features/quickActions/runQuickActionForFile.ts`. Update the signature and tab-resolution branch:

```ts
import { Notice, type TAbstractFile, TFile, TFolder } from 'obsidian';

import type { ProviderId } from '@/core/providers/types';
import { getTabProviderId } from '@/features/chat/tabs/providerResolution';
import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';

import type { QuickAction } from './types';

// ... existing dispatchQuickActionToTab + quickActionStemFromPath unchanged ...

export async function runQuickActionForFile(
  plugin: ClaudianPlugin,
  file: TAbstractFile,
  action: QuickAction,
  override?: { providerId: ProviderId; model: string },
): Promise<void> {
  let view = plugin.getView();
  if (!view) {
    await plugin.activateView();
    view = plugin.getView();
  }
  if (!view) return;

  const tabManager = view.getTabManager();
  if (!tabManager) return;

  const activeTab = tabManager.getActiveTab();
  const isBlank = activeTab?.lifecycleState === 'blank';
  let targetTab;

  const overrideMatchesActive = override !== undefined && isBlank && activeTab
    ? getTabProviderId(activeTab, plugin) === override.providerId
    : false;

  if (override === undefined && isBlank && activeTab) {
    targetTab = activeTab;
  } else if (overrideMatchesActive && activeTab) {
    targetTab = activeTab;
  } else if (tabManager.canCreateTab()) {
    const newTab = await tabManager.createTab(null, undefined, {
      activate: false,
      ...(override !== undefined
        ? { defaultProviderId: override.providerId, pinnedModel: override.model }
        : {}),
    });
    if (!newTab) {
      new Notice(t('quickActions.contextMenu.tabLimitReached'));
      return;
    }
    targetTab = newTab;
  } else {
    new Notice(t('quickActions.contextMenu.tabLimitReached'));
    return;
  }

  await tabManager.switchToTab(targetTab.id);

  if (file instanceof TFile) {
    targetTab.ui.fileContextManager?.attachFileAsPill(file.path);
  } else if (file instanceof TFolder) {
    targetTab.ui.fileContextManager?.attachFolderAsPill(file.path);
  }

  await dispatchQuickActionToTab(plugin, targetTab, action);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm run test -- tests/unit/features/quickActions/runQuickActionForFile.test.ts`
Expected: PASS — both new override tests and the unchanged existing tests are green.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/runQuickActionForFile.ts tests/unit/features/quickActions/runQuickActionForFile.test.ts
git commit -m "feat(quickActions): runQuickActionForFile accepts provider+model override"
```

---

## Task 7: Route picker site (`openContextMenuQuickAction`) through `launchQuickAction`

**Files:**
- Modify: `src/features/quickActions/openContextMenuQuickAction.ts`
- Test: `tests/unit/features/quickActions/openContextMenuQuickAction.test.ts`

- [ ] **Step 1: Update the existing test**

Open `tests/unit/features/quickActions/openContextMenuQuickAction.test.ts` and update so the picker's `onRun` is expected to delegate to `launchQuickAction` (mocked) instead of `runQuickActionForFile`. Add `jest.mock` for `@/features/quickActions/launchQuickAction` and assert it is called with `(plugin, file, action)`.

```ts
const launchMock = jest.fn();
jest.mock('@/features/quickActions/launchQuickAction', () => ({
  launchQuickAction: (...args: unknown[]) => launchMock(...args),
}));

// In the existing "delegates onRun to ..." test:
it('delegates onRun to launchQuickAction', () => {
  // ... existing setup that invokes onRun with an action ...
  // Where the existing test asserted runQuickActionForFile was called, change to:
  expect(launchMock).toHaveBeenCalledWith(plugin, file, action);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm run test -- tests/unit/features/quickActions/openContextMenuQuickAction.test.ts`
Expected: FAIL — picker still calls `runQuickActionForFile`.

- [ ] **Step 3: Implement the change**

Modify `src/features/quickActions/openContextMenuQuickAction.ts`:

```ts
import type { TAbstractFile } from 'obsidian';

import type ClaudianPlugin from '@/main';

import { launchQuickAction } from './launchQuickAction';
import { openQuickActionsModal } from './openQuickActionsModal';

export function openContextMenuQuickAction(
  plugin: ClaudianPlugin,
  file: TAbstractFile,
): void {
  openQuickActionsModal(plugin, {
    file,
    onRun: (action) => {
      void launchQuickAction(plugin, file, action);
    },
  });
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npm run test -- tests/unit/features/quickActions/openContextMenuQuickAction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/openContextMenuQuickAction.ts tests/unit/features/quickActions/openContextMenuQuickAction.test.ts
git commit -m "feat(quickActions): picker onRun routes through launchQuickAction"
```

---

## Task 8: Route favorites menu items through `launchQuickAction`

**Files:**
- Modify: `src/features/quickActions/appendQuickActionMenu.ts`

`appendQuickActionFavoritesAndPicker` is shared by the workspace file/folder menu AND the WO card right-click menu (via `workOrderContextMenu.ts`). Updating it covers both surfaces in one change.

- [ ] **Step 1: Check whether a test covers favorites onClick**

Run: `npm run test -- tests/unit/features/quickActions/ --listTests`
Expected: list of test files.

If `appendQuickActionMenu` is not directly tested, skip to Step 3. Otherwise, update the matching test to assert the favorite onClick calls `launchQuickAction`.

- [ ] **Step 2: Add a new focused test (if none exists)**

Create `tests/unit/features/quickActions/appendQuickActionMenu.test.ts`:

```ts
import { appendQuickActionFavoritesAndPicker } from '@/features/quickActions/appendQuickActionMenu';

const launchMock = jest.fn();
jest.mock('@/features/quickActions/launchQuickAction', () => ({
  launchQuickAction: (...args: unknown[]) => launchMock(...args),
}));

jest.mock('@/i18n/i18n', () => ({ t: (k: string) => k }));

class MockMenu {
  items: Array<{ title: string; icon?: string; onClick?: () => void }> = [];
  addItem(cb: (item: any) => void) {
    const item: any = {};
    item.setTitle = (t: string) => { item.title = t; return item; };
    item.setIcon = (i: string) => { item.icon = i; return item; };
    item.onClick = (h: () => void) => { item.onClick = h; return item; };
    cb(item);
    this.items.push(item);
    return this;
  }
}

beforeEach(() => jest.clearAllMocks());

it('favorite click delegates to launchQuickAction', () => {
  const menu = new MockMenu();
  const plugin = {
    quickActionFavoritesCache: {
      getFavorites: () => [
        { id: 'a', name: 'Fav', description: '', prompt: '', filePath: 'qa/fav.md' },
      ],
    },
  } as any;
  const file = { path: 'note.md' } as any;
  appendQuickActionFavoritesAndPicker(menu as any, plugin, file);
  const favItem = menu.items[1];
  favItem.onClick?.();
  expect(launchMock).toHaveBeenCalledWith(plugin, file, expect.objectContaining({ name: 'Fav' }));
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npm run test -- tests/unit/features/quickActions/appendQuickActionMenu.test.ts`
Expected: FAIL — favorites still call `runQuickActionForFile`.

- [ ] **Step 4: Update the helper**

Modify `src/features/quickActions/appendQuickActionMenu.ts`:

```ts
import type { Menu, TAbstractFile } from 'obsidian';

import { t } from '../../i18n/i18n';
import type ClaudianPlugin from '../../main';
import { launchQuickAction } from './launchQuickAction';
import { openContextMenuQuickAction } from './openContextMenuQuickAction';

export function appendQuickActionFavoritesAndPicker(
  menu: Menu,
  plugin: ClaudianPlugin,
  file: TAbstractFile,
): void {
  menu.addItem((item) => item
    .setTitle(t('quickActions.contextMenu.title'))
    .setIcon('zap')
    .onClick(() => { openContextMenuQuickAction(plugin, file); }));

  const favs = plugin.quickActionFavoritesCache?.getFavorites() ?? [];
  for (const fav of favs) {
    menu.addItem((item) => item
      .setTitle(fav.name)
      .setIcon(fav.icon ?? 'star')
      .onClick(() => { void launchQuickAction(plugin, file, fav); }));
  }
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `npm run test -- tests/unit/features/quickActions/appendQuickActionMenu.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/quickActions/appendQuickActionMenu.ts tests/unit/features/quickActions/appendQuickActionMenu.test.ts
git commit -m "feat(quickActions): favorites menu routes through launchQuickAction"
```

---

## Task 9: Integration test — file context menu end-to-end

**Files:**
- Create: `tests/integration/features/quickActions/launchFromContextMenu.test.ts`

- [ ] **Step 1: Write the integration test**

Create `tests/integration/features/quickActions/launchFromContextMenu.test.ts`:

```ts
import { TFile } from 'obsidian';

jest.mock('obsidian', () => {
  class Modal {
    contentEl = document.createElement('div');
    constructor(public app: unknown) {}
    open(): void { this.onOpen(); }
    close(): void { this.onClose(); }
    onOpen(): void {}
    onClose(): void {}
  }
  return {
    Modal,
    Notice: jest.fn(),
    TFile: class TFile { path = ''; },
    TFolder: class TFolder { path = ''; },
  };
});

jest.mock('@/i18n/i18n', () => ({
  t: (k: string, v?: Record<string, string>) =>
    v ? Object.entries(v).reduce((a, [k, val]) => a.replace(`{${k}}`, val), k) : k,
}));

const isEnabledMock = jest.fn().mockReturnValue(true);
const getRegisteredMock = jest.fn().mockReturnValue(['claude', 'codex']);
const getChatUIConfigMock = jest.fn().mockImplementation((id: string) => ({
  config: { displayName: id },
  getModelOptions: () => (id === 'claude'
    ? [{ value: 'claude-sonnet-4-5', label: 'Sonnet 4.5' }]
    : [{ value: 'gpt-5-codex', label: 'gpt-5-codex' }]),
}));
jest.mock('@/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    isEnabled: (...a: unknown[]) => isEnabledMock(...a),
    getRegisteredProviderIds: () => getRegisteredMock(),
    getChatUIConfig: (...a: unknown[]) => getChatUIConfigMock(...a),
    resolveSettingsProviderId: () => 'claude',
  },
}));

jest.mock('@/features/chat/tabs/tabShared', () => ({
  resolveBlankTabModel: () => 'claude-sonnet-4-5',
}));

jest.mock('@/features/chat/tabs/providerResolution', () => ({
  getTabProviderId: () => 'claude',
}));

import { launchQuickAction } from '@/features/quickActions/launchQuickAction';
import type { QuickAction } from '@/features/quickActions/types';

const ACTION: QuickAction = {
  id: 'a', name: 'Summarize', description: 'd', prompt: 'Summarize this.',
  filePath: 'qa/summarize.md',
};

function makeFile() {
  const f = Object.create(TFile.prototype);
  f.path = 'note.md';
  return f;
}

it('end-to-end: launch modal → confirm Codex → tab created with codex + pinned model → prompt dispatched + pill attached', async () => {
  const createdTab = {
    id: 'new-tab',
    lifecycleState: 'blank',
    ui: { fileContextManager: { attachFileAsPill: jest.fn() } },
    controllers: { inputController: { sendMessage: jest.fn().mockResolvedValue(undefined) } },
  };
  const tabManager = {
    getActiveTab: () => null,
    canCreateTab: () => true,
    createTab: jest.fn().mockResolvedValue(createdTab),
    switchToTab: jest.fn().mockResolvedValue(undefined),
  };
  const view = { getTabManager: () => tabManager };
  const plugin = {
    app: {},
    settings: { provider: 'claude' },
    quickActionLastUsedStore: {
      get: jest.fn().mockReturnValue(null),
      set: jest.fn(),
      delete: jest.fn(),
    },
    events: { emit: jest.fn() },
    getView: () => view,
    activateView: jest.fn(),
  } as any;

  await launchQuickAction(plugin, makeFile(), ACTION);

  // simulate user switching to Codex + clicking Run
  const modalEl = document.body.querySelector('.claudian-qa-launch-modal') ?? document.body;
  const providerSelect = modalEl.querySelector<HTMLSelectElement>('[data-testid="qa-provider"]')!;
  providerSelect.value = 'codex';
  providerSelect.dispatchEvent(new Event('change'));
  const runBtn = modalEl.querySelector<HTMLButtonElement>('[data-testid="qa-run"]')!;
  runBtn.click();

  await new Promise((r) => setImmediate(r));

  expect(plugin.quickActionLastUsedStore.set).toHaveBeenCalledWith('summarize', {
    providerId: 'codex',
    model: 'gpt-5-codex',
  });
  expect(tabManager.createTab).toHaveBeenCalledWith(
    null,
    undefined,
    expect.objectContaining({
      activate: false,
      defaultProviderId: 'codex',
      pinnedModel: 'gpt-5-codex',
    }),
  );
  expect(tabManager.switchToTab).toHaveBeenCalledWith('new-tab');
  expect(createdTab.ui.fileContextManager.attachFileAsPill).toHaveBeenCalledWith('note.md');
  expect(createdTab.controllers.inputController.sendMessage)
    .toHaveBeenCalledWith({ content: 'Summarize this.' });
  expect(plugin.events.emit).toHaveBeenCalledWith('usage.recorded', expect.objectContaining({
    kind: 'quickAction',
    name: 'summarize',
  }));
});
```

- [ ] **Step 2: Run integration test, verify it passes**

Run: `npm run test -- tests/integration/features/quickActions/launchFromContextMenu.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/features/quickActions/launchFromContextMenu.test.ts
git commit -m "test(quickActions): integration coverage for launch modal end-to-end"
```

---

## Task 10: Final verification

**Files:** repo-wide

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Full test suite**

Run: `npm run test`
Expected: every project (unit + integration) green.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Spec status update + final commit**

Update the spec front-matter `status: draft` → `status: implemented` in
`docs/superpowers/specs/2026-06-06-quick-action-provider-model-prompt-design.md`.

```bash
git add docs/superpowers/specs/2026-06-06-quick-action-provider-model-prompt-design.md
git commit -m "docs(spec): mark quick-action provider+model prompt implemented"
```

---

## Self-review

- **Spec coverage**: D1 (trigger scope) → tasks 7+8. D2 (skills excluded) → no `runVaultSkill` changes. D3 (second modal) → task 4. D4 (last-used per QA) → task 5. D5 (sidecar JSON) → tasks 1+2+3. D6 (silent fallback + inline notice) → tasks 4 (notice render) + 5 (resolve+drop). Architecture diagram in the spec is satisfied by tasks 5+6.
- **No placeholders**: every step shows the actual file path and code or the actual command + expected output.
- **Type consistency**: `LastUsedEntry` is the single entry type across store + helpers; `QuickActionLaunchModalOptions` matches the seam's call site; `runQuickActionForFile`'s `override` parameter and `createTab`'s `defaultProviderId` + `pinnedModel` line up with the existing `TabManager.CreateTabOptions` shape.
