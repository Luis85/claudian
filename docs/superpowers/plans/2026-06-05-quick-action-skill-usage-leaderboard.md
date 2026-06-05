# Quick-action and skill usage leaderboard implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track per-entry usage counts and last-used timestamps for vault quick-actions and skills, then surface the data through a new **Stats** tab in `QuickActionsModal` (Top-K + drop candidates + sortable table) plus inline badges on existing rows.

**Architecture:** Cross-cutting `UsageTracker` in `src/core/usage/` (single subscriber to a new `usage.recorded` / `usage.cleared` `EventBus` map) backed by `.claudian/usage.json` with debounced writes. Helpers `runQuickActionForFile` and `runVaultSkill` emit on successful dispatch. UI lives in `src/features/quickActions/ui/UsageStatsTab.ts` plus a shared `formatUsageBadge` helper used inline on existing tabs.

**Tech Stack:** TypeScript, Obsidian plugin API, existing `EventBus`, `VaultFileAdapter`, `Logger`, Jest (unit + integration).

**Related spec:** [`docs/superpowers/specs/2026-06-05-quick-action-skill-usage-leaderboard-design.md`](../specs/2026-06-05-quick-action-skill-usage-leaderboard-design.md)

---

## Conventions

- TDD: every behavior gets a failing test first, then minimal implementation.
- All file paths in this plan are relative to repo root.
- Commits use Conventional Commits with a short subject; co-author trailer added by the harness.
- Run `npm run typecheck && npm run lint && npm run test` after the final task at minimum.
- The runtime forbids `Date.now()` in tests where determinism matters — inject `now: () => number` for the tracker, pass a fixture clock in unit tests.

---

## Task 1: Usage types module

**Files:**
- Create: `src/core/usage/types.ts`

- [ ] **Step 1: Write the file**

```typescript
import type { ProviderId } from '../providers/types';

export type UsageEntryKind = 'quickAction' | 'skill';

/**
 * Stable identifier for a tracked entry.
 *
 * - quickAction: filename stem (e.g. "summarize") — derived from filePath at
 *   emit time so YAML `name` renames do not create a new counter while the
 *   file is unchanged on disk.
 * - skill: skill folder name + owning providerId. Same skill name across
 *   providers (e.g. `$deep-research` for Claude and Codex) keeps separate
 *   counters.
 */
export interface UsageKey {
  kind: UsageEntryKind;
  name: string;
  providerId?: ProviderId;
}

export interface UsageRecord {
  count: number;
  lastUsedAt: number;
}

export const USAGE_INDEX_SCHEMA_VERSION = 1 as const;

export interface UsageIndex {
  version: typeof USAGE_INDEX_SCHEMA_VERSION;
  records: Record<string, UsageRecord>;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no diagnostics for new file).

- [ ] **Step 3: Commit**

```bash
git add src/core/usage/types.ts
git commit -m "feat(core/usage): add usage tracker type scaffolding"
```

---

## Task 2: Composite key serializer

**Files:**
- Create: `src/core/usage/keys.ts`
- Test: `tests/unit/core/usage/keys.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { parseKey, serializeKey } from '@/core/usage/keys';

describe('usage keys', () => {
  it('serializes a quick-action key with placeholder providerId slot', () => {
    expect(serializeKey({ kind: 'quickAction', name: 'summarize' })).toBe(
      'quickAction:_:summarize',
    );
  });

  it('serializes a skill key with provider', () => {
    expect(
      serializeKey({ kind: 'skill', providerId: 'claude', name: 'deep-research' }),
    ).toBe('skill:claude:deep-research');
  });

  it('round-trips quick-action keys', () => {
    const key = { kind: 'quickAction', name: 'a:weird:name' } as const;
    expect(parseKey(serializeKey(key))).toEqual(key);
  });

  it('round-trips skill keys', () => {
    const key = { kind: 'skill', providerId: 'codex', name: 'do:stuff' } as const;
    expect(parseKey(serializeKey(key))).toEqual(key);
  });

  it('returns null for malformed serialized keys', () => {
    expect(parseKey('garbage')).toBeNull();
    expect(parseKey('quickAction:only')).toBeNull();
    expect(parseKey('badKind:_:x')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm run test -- --selectProjects unit -t "usage keys"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { ProviderId } from '../providers/types';

import type { UsageEntryKind, UsageKey } from './types';

const QUICK_ACTION_PROVIDER_SLOT = '_';
const KINDS: readonly UsageEntryKind[] = ['quickAction', 'skill'];

export function serializeKey(key: UsageKey): string {
  const providerSlot = key.providerId ?? QUICK_ACTION_PROVIDER_SLOT;
  return `${key.kind}:${providerSlot}:${key.name}`;
}

export function parseKey(serialized: string): UsageKey | null {
  const firstSep = serialized.indexOf(':');
  if (firstSep <= 0) return null;
  const secondSep = serialized.indexOf(':', firstSep + 1);
  if (secondSep <= firstSep) return null;

  const kind = serialized.slice(0, firstSep) as UsageEntryKind;
  if (!KINDS.includes(kind)) return null;

  const providerSlot = serialized.slice(firstSep + 1, secondSep);
  const name = serialized.slice(secondSep + 1);
  if (!name) return null;

  if (providerSlot === QUICK_ACTION_PROVIDER_SLOT) {
    return { kind, name };
  }
  return { kind, name, providerId: providerSlot as ProviderId };
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npm run test -- --selectProjects unit -t "usage keys"`
Expected: PASS — all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/usage/keys.ts tests/unit/core/usage/keys.test.ts
git commit -m "feat(core/usage): add composite key serialize/parse helpers"
```

---

## Task 3: Usage event map

**Files:**
- Create: `src/core/usage/events.ts`

- [ ] **Step 1: Write the file**

```typescript
import type { ProviderId } from '../providers/types';

import type { UsageEntryKind } from './types';

export interface UsageEventMap {
  'usage.recorded': {
    kind: UsageEntryKind;
    name: string;
    providerId?: ProviderId;
  };
  'usage.cleared': void;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/core/usage/events.ts
git commit -m "feat(core/usage): declare usage.recorded + usage.cleared event map"
```

---

## Task 4: Wire `UsageEventMap` into `ClaudianEventMap`

**Files:**
- Modify: `src/app/events/claudianEvents.ts`

- [ ] **Step 1: Add the import + intersection**

Replace the entire file with:

```typescript
import type { UsageEventMap } from '../../core/usage/events';
import type { ChatEventMap } from '../../features/chat/events';
import type { QuickActionsEventMap } from '../../features/quickActions/events';
import type { SettingsEventMap } from '../../features/settings/events';
import type { TaskEventMap } from '../../features/tasks/events';

export type ClaudianEventMap = ChatEventMap
  & QuickActionsEventMap
  & SettingsEventMap
  & TaskEventMap
  & UsageEventMap;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/events/claudianEvents.ts
git commit -m "feat(app/events): include usage event map in ClaudianEventMap"
```

---

## Task 5: `UsageStorage` round-trip + cold-start failure modes

**Files:**
- Create: `src/core/usage/UsageStorage.ts`
- Test: `tests/unit/core/usage/UsageStorage.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import type { Logger } from '@/core/logging/Logger';
import { UsageStorage } from '@/core/usage/UsageStorage';
import { USAGE_INDEX_SCHEMA_VERSION, type UsageIndex } from '@/core/usage/types';

interface FakeAdapter {
  files: Map<string, string>;
  exists: jest.Mock;
  read: jest.Mock;
  write: jest.Mock;
  ensureFolder: jest.Mock;
}

function makeAdapter(initial: Record<string, string> = {}): FakeAdapter {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    exists: jest.fn(async (p: string) => files.has(p)),
    read: jest.fn(async (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`missing ${p}`);
      return v;
    }),
    write: jest.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    ensureFolder: jest.fn(async () => undefined),
  };
}

function silentLogger(): Logger {
  const noop = () => undefined;
  return {
    scope: () => ({ debug: noop, info: noop, warn: noop, error: noop, isEnabled: () => false }),
  } as unknown as Logger;
}

describe('UsageStorage', () => {
  const PATH = '.claudian/usage.json';
  const CORRUPT = '.claudian/usage.corrupt.json';

  it('returns empty index when file missing', async () => {
    const adapter = makeAdapter();
    const storage = new UsageStorage(adapter as never, silentLogger());
    const idx = await storage.load();
    expect(idx).toEqual({ version: USAGE_INDEX_SCHEMA_VERSION, records: {} });
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it('round-trips a non-empty index', async () => {
    const adapter = makeAdapter();
    const storage = new UsageStorage(adapter as never, silentLogger());
    const idx: UsageIndex = {
      version: USAGE_INDEX_SCHEMA_VERSION,
      records: { 'quickAction:_:summarize': { count: 3, lastUsedAt: 1000 } },
    };
    await storage.save(idx);
    expect(adapter.files.get(PATH)).toContain('"summarize"');
    const reloaded = await storage.load();
    expect(reloaded).toEqual(idx);
  });

  it('backs up + cold-starts on malformed JSON', async () => {
    const adapter = makeAdapter({ [PATH]: 'not json' });
    const storage = new UsageStorage(adapter as never, silentLogger());
    const idx = await storage.load();
    expect(idx.records).toEqual({});
    expect(adapter.files.get(CORRUPT)).toBe('not json');
  });

  it('cold-starts on schema version mismatch', async () => {
    const adapter = makeAdapter({
      [PATH]: JSON.stringify({ version: 999, records: {} }),
    });
    const storage = new UsageStorage(adapter as never, silentLogger());
    const idx = await storage.load();
    expect(idx.records).toEqual({});
  });

  it('does not throw on write failure', async () => {
    const adapter = makeAdapter();
    adapter.write.mockRejectedValueOnce(new Error('disk full'));
    const storage = new UsageStorage(adapter as never, silentLogger());
    await expect(storage.save({
      version: USAGE_INDEX_SCHEMA_VERSION, records: {},
    })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm run test -- --selectProjects unit -t "UsageStorage"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```typescript
import type { Logger } from '../logging/Logger';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';

import { USAGE_INDEX_SCHEMA_VERSION, type UsageIndex, type UsageRecord } from './types';

const DEFAULT_PATH = '.claudian/usage.json';
const CORRUPT_PATH = '.claudian/usage.corrupt.json';

export class UsageStorage {
  constructor(
    private adapter: VaultFileAdapter,
    private logger: Logger,
    private path: string = DEFAULT_PATH,
    private corruptPath: string = CORRUPT_PATH,
  ) {}

  async load(): Promise<UsageIndex> {
    const scope = this.logger.scope('usage');
    try {
      if (!(await this.adapter.exists(this.path))) {
        return coldStart();
      }
      const raw = await this.adapter.read(this.path);
      const parsed = this.parse(raw);
      if (parsed) return parsed;

      scope.warn('usage.json malformed or version mismatch, backing up + resetting');
      try {
        await this.adapter.write(this.corruptPath, raw);
      } catch (err) {
        scope.warn('failed to back up malformed usage.json', err);
      }
      return coldStart();
    } catch (err) {
      scope.warn('failed to read usage.json, treating as cold start', err);
      return coldStart();
    }
  }

  async save(index: UsageIndex): Promise<void> {
    const scope = this.logger.scope('usage');
    try {
      const json = JSON.stringify(index);
      await this.adapter.write(this.path, json);
    } catch (err) {
      scope.warn('failed to write usage.json', err);
    }
  }

  private parse(raw: string): UsageIndex | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<UsageIndex>;
    if (candidate.version !== USAGE_INDEX_SCHEMA_VERSION) return null;
    if (!candidate.records || typeof candidate.records !== 'object') return null;

    const records: Record<string, UsageRecord> = {};
    for (const [key, value] of Object.entries(candidate.records)) {
      if (!value || typeof value !== 'object') continue;
      const rec = value as Partial<UsageRecord>;
      if (typeof rec.count !== 'number' || typeof rec.lastUsedAt !== 'number') continue;
      records[key] = { count: rec.count, lastUsedAt: rec.lastUsedAt };
    }
    return { version: USAGE_INDEX_SCHEMA_VERSION, records };
  }
}

function coldStart(): UsageIndex {
  return { version: USAGE_INDEX_SCHEMA_VERSION, records: {} };
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npm run test -- --selectProjects unit -t "UsageStorage"`
Expected: PASS — all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/usage/UsageStorage.ts tests/unit/core/usage/UsageStorage.test.ts
git commit -m "feat(core/usage): add UsageStorage with cold-start + corrupt-file backup"
```

---

## Task 6: `UsageTracker` — record, clear, debounced flush, hydrate

**Files:**
- Create: `src/core/usage/UsageTracker.ts`
- Test: `tests/unit/core/usage/UsageTracker.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { EventBus } from '@/core/events/EventBus';
import type { Logger } from '@/core/logging/Logger';
import type { UsageEventMap } from '@/core/usage/events';
import { UsageTracker } from '@/core/usage/UsageTracker';
import { USAGE_INDEX_SCHEMA_VERSION, type UsageIndex } from '@/core/usage/types';

function silentLogger(): Logger {
  const noop = () => undefined;
  return {
    scope: () => ({ debug: noop, info: noop, warn: noop, error: noop, isEnabled: () => false }),
  } as unknown as Logger;
}

function makeStorage(initial?: UsageIndex) {
  const writes: UsageIndex[] = [];
  return {
    writes,
    load: jest.fn(async () => initial ?? { version: USAGE_INDEX_SCHEMA_VERSION, records: {} }),
    save: jest.fn(async (idx: UsageIndex) => {
      writes.push(JSON.parse(JSON.stringify(idx)) as UsageIndex);
    }),
  };
}

describe('UsageTracker', () => {
  let bus: EventBus<UsageEventMap>;
  let nowValue = 1_000;
  const now = () => nowValue;

  beforeEach(() => {
    jest.useFakeTimers();
    bus = new EventBus<UsageEventMap>();
    nowValue = 1_000;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('increments count + updates lastUsedAt on usage.recorded', async () => {
    const storage = makeStorage();
    const tracker = new UsageTracker(bus, storage as never, now, silentLogger());
    await tracker.hydrate();

    nowValue = 2_000;
    bus.emit('usage.recorded', { kind: 'quickAction', name: 'summarize' });
    nowValue = 3_000;
    bus.emit('usage.recorded', { kind: 'quickAction', name: 'summarize' });

    expect(tracker.get({ kind: 'quickAction', name: 'summarize' })).toEqual({
      count: 2,
      lastUsedAt: 3_000,
    });
  });

  it('separates counters per provider for same skill name', async () => {
    const storage = makeStorage();
    const tracker = new UsageTracker(bus, storage as never, now, silentLogger());
    await tracker.hydrate();

    bus.emit('usage.recorded', { kind: 'skill', name: 'x', providerId: 'claude' });
    bus.emit('usage.recorded', { kind: 'skill', name: 'x', providerId: 'codex' });

    expect(tracker.get({ kind: 'skill', name: 'x', providerId: 'claude' })?.count).toBe(1);
    expect(tracker.get({ kind: 'skill', name: 'x', providerId: 'codex' })?.count).toBe(1);
  });

  it('debounces writes — burst of records produces one save', async () => {
    const storage = makeStorage();
    const tracker = new UsageTracker(bus, storage as never, now, silentLogger());
    await tracker.hydrate();
    storage.save.mockClear();

    for (let i = 0; i < 5; i++) {
      bus.emit('usage.recorded', { kind: 'quickAction', name: 'x' });
    }
    expect(storage.save).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(storage.writes[0].records['quickAction:_:x'].count).toBe(5);
  });

  it('flush forces immediate write + cancels pending timer', async () => {
    const storage = makeStorage();
    const tracker = new UsageTracker(bus, storage as never, now, silentLogger());
    await tracker.hydrate();
    storage.save.mockClear();

    bus.emit('usage.recorded', { kind: 'quickAction', name: 'x' });
    await tracker.flush();
    expect(storage.save).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2_000);
    expect(storage.save).toHaveBeenCalledTimes(1);
  });

  it('clears all records on usage.cleared', async () => {
    const storage = makeStorage();
    const tracker = new UsageTracker(bus, storage as never, now, silentLogger());
    await tracker.hydrate();
    bus.emit('usage.recorded', { kind: 'quickAction', name: 'x' });
    bus.emit('usage.cleared');

    expect(tracker.getAll().size).toBe(0);
  });

  it('dispose unsubscribes so further events do not mutate state', async () => {
    const storage = makeStorage();
    const tracker = new UsageTracker(bus, storage as never, now, silentLogger());
    await tracker.hydrate();
    tracker.dispose();

    bus.emit('usage.recorded', { kind: 'quickAction', name: 'x' });
    expect(tracker.getAll().size).toBe(0);
  });

  it('hydrates initial records from storage', async () => {
    const storage = makeStorage({
      version: USAGE_INDEX_SCHEMA_VERSION,
      records: { 'quickAction:_:seed': { count: 7, lastUsedAt: 500 } },
    });
    const tracker = new UsageTracker(bus, storage as never, now, silentLogger());
    await tracker.hydrate();

    expect(tracker.get({ kind: 'quickAction', name: 'seed' })).toEqual({
      count: 7,
      lastUsedAt: 500,
    });
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm run test -- --selectProjects unit -t "UsageTracker"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```typescript
import type { EventBus } from '../events/EventBus';
import type { Logger } from '../logging/Logger';

import type { UsageEventMap } from './events';
import { parseKey, serializeKey } from './keys';
import type { UsageStorage } from './UsageStorage';
import {
  USAGE_INDEX_SCHEMA_VERSION,
  type UsageIndex,
  type UsageKey,
  type UsageRecord,
} from './types';

const DEBOUNCE_MS = 1_000;

export class UsageTracker {
  private records = new Map<string, UsageRecord>();
  private dirty = false;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubRecorded: () => void;
  private readonly unsubCleared: () => void;
  private disposed = false;

  constructor(
    private events: EventBus<UsageEventMap>,
    private storage: UsageStorage,
    private now: () => number,
    private logger: Logger,
  ) {
    this.unsubRecorded = events.on('usage.recorded', (payload) => {
      this.handleRecord(payload);
    });
    this.unsubCleared = events.on('usage.cleared', () => {
      this.handleClear();
    });
  }

  async hydrate(): Promise<void> {
    const index = await this.storage.load();
    this.records.clear();
    for (const [key, value] of Object.entries(index.records)) {
      this.records.set(key, { count: value.count, lastUsedAt: value.lastUsedAt });
    }
  }

  get(key: UsageKey): UsageRecord | undefined {
    return this.records.get(serializeKey(key));
  }

  /**
   * Read-only snapshot. Callers iterate; mutations are ignored — they would
   * not affect the live map nor trigger a write.
   */
  getAll(): ReadonlyMap<string, UsageRecord> {
    return this.records;
  }

  async flush(): Promise<void> {
    if (this.writeTimer !== null) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    await this.storage.save(this.snapshot());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubRecorded();
    this.unsubCleared();
    if (this.writeTimer !== null) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
  }

  private handleRecord(payload: UsageEventMap['usage.recorded']): void {
    const key = serializeKey({
      kind: payload.kind,
      name: payload.name,
      providerId: payload.providerId,
    });
    const prev = this.records.get(key);
    this.records.set(key, {
      count: (prev?.count ?? 0) + 1,
      lastUsedAt: this.now(),
    });
    this.markDirty();
  }

  private handleClear(): void {
    this.records.clear();
    this.markDirty();
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.writeTimer !== null) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      if (!this.dirty) return;
      this.dirty = false;
      void this.storage.save(this.snapshot()).catch((err) => {
        this.logger.scope('usage').warn('debounced usage write failed', err);
      });
    }, DEBOUNCE_MS);
  }

  private snapshot(): UsageIndex {
    const records: Record<string, UsageRecord> = {};
    for (const [key, value] of this.records) {
      // Cheap defensive validation: skip any key the serializer cannot
      // round-trip rather than corrupt the file.
      if (parseKey(key) !== null) {
        records[key] = { count: value.count, lastUsedAt: value.lastUsedAt };
      }
    }
    return { version: USAGE_INDEX_SCHEMA_VERSION, records };
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npm run test -- --selectProjects unit -t "UsageTracker"`
Expected: PASS — all 7 cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/usage/UsageTracker.ts tests/unit/core/usage/UsageTracker.test.ts
git commit -m "feat(core/usage): add UsageTracker with debounced flush + hydrate"
```

---

## Task 7: Plugin lifecycle wiring

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Locate field declarations**

Read `src/main.ts` around the `vaultSkillAggregator` field declaration (around line 91 per the spec context) to find the surrounding `public` / `private` field block, then add a sibling field:

```typescript
public usageTracker: UsageTracker | null = null;
```

Add the matching imports at the top of the file:

```typescript
import { UsageStorage } from './core/usage/UsageStorage';
import { UsageTracker } from './core/usage/UsageTracker';
```

- [ ] **Step 2: Construct + hydrate in `completeDeferredOnload`**

Inside `completeDeferredOnload()` (around line 248), AFTER `await ProviderWorkspaceRegistry.initializeAll(this)` succeeds and BEFORE the `VaultSkillAggregator` block, insert:

```typescript
const usageStorage = new UsageStorage(new VaultFileAdapter(this.app), this.logger);
this.usageTracker = new UsageTracker(
  this.events,
  usageStorage,
  () => Date.now(),
  this.logger,
);
await this.usageTracker.hydrate();
```

- [ ] **Step 3: Flush + dispose in `onunload`**

Inside `onunload()` (around line 279), BEFORE the existing `this.vaultSkillAggregator?.dispose();` line, insert:

```typescript
if (this.usageTracker) {
  void this.usageTracker.flush();
  this.usageTracker.dispose();
  this.usageTracker = null;
}
```

(The `void` is deliberate — `onunload` is synchronous; the flush runs in the background and most installs persist by then.)

- [ ] **Step 4: Typecheck + lint + smoke unit test**

Run: `npm run typecheck && npm run lint`
Expected: PASS, 0/0 lint.

Run: `npm run test -- --selectProjects unit -t "usage"`
Expected: PASS — earlier suites still green.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(app): wire UsageTracker into plugin lifecycle"
```

---

## Task 8: Emit `usage.recorded` from `runQuickActionForFile`

**Files:**
- Modify: `src/features/quickActions/runQuickActionForFile.ts`
- Test: `tests/unit/features/quickActions/runQuickActionForFile.test.ts`

- [ ] **Step 1: Append failing tests**

Open the existing test file and add a new `describe('usage emission', ...)` block. Tests reuse the file's existing mocks/builders; if helpers differ, mirror the file's current style. Add:

```typescript
describe('runQuickActionForFile usage emission', () => {
  it('emits usage.recorded with quick-action filename stem after sendMessage resolves', async () => {
    const events = new EventBus<UsageEventMap>();
    const recorded: Array<UsageEventMap['usage.recorded']> = [];
    events.on('usage.recorded', (e) => recorded.push(e));

    const plugin = makePluginStub({ events });
    const file = makeFileStub('Notes/x.md');
    const action = makeActionStub({
      filePath: 'Quick Actions/summarize.md',
      name: 'Summarize selection',
    });

    await runQuickActionForFile(plugin, file, action);

    expect(recorded).toEqual([{ kind: 'quickAction', name: 'summarize' }]);
  });

  it('does NOT emit if sendMessage rejects', async () => {
    const events = new EventBus<UsageEventMap>();
    const recorded: Array<UsageEventMap['usage.recorded']> = [];
    events.on('usage.recorded', (e) => recorded.push(e));

    const plugin = makePluginStub({ events, sendMessageImpl: async () => {
      throw new Error('send failed');
    }});
    const action = makeActionStub({ filePath: 'Quick Actions/x.md' });

    await expect(runQuickActionForFile(plugin, makeFileStub('a.md'), action))
      .rejects.toThrow('send failed');
    expect(recorded).toEqual([]);
  });

  it('does NOT emit on early return (no view)', async () => {
    const events = new EventBus<UsageEventMap>();
    const recorded: Array<UsageEventMap['usage.recorded']> = [];
    events.on('usage.recorded', (e) => recorded.push(e));

    const plugin = makePluginStub({ events, view: null });
    const action = makeActionStub({ filePath: 'Quick Actions/x.md' });

    await runQuickActionForFile(plugin, makeFileStub('a.md'), action);
    expect(recorded).toEqual([]);
  });
});
```

If the existing file lacks `makePluginStub` / `makeActionStub` / `makeFileStub` helpers, factor them out at the top of the file. If equivalents exist under different names, use those names.

Imports to add (top of test file):

```typescript
import { EventBus } from '@/core/events/EventBus';
import type { UsageEventMap } from '@/core/usage/events';
```

- [ ] **Step 2: Run tests, expect failure**

Run: `npm run test -- --selectProjects unit -t "runQuickActionForFile usage"`
Expected: FAIL — no emit.

- [ ] **Step 3: Add a filename-stem helper**

Add to the top of `runQuickActionForFile.ts` (or in `quickActionParse.ts` if you prefer co-location — keep it `export`):

```typescript
/**
 * Filename stem (no extension, no folder path). Used as the stable
 * identity key for usage tracking — survives moves, breaks on rename.
 */
export function quickActionStemFromPath(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.md$/i, '');
}
```

- [ ] **Step 4: Emit after dispatch**

Locate the final dispatch line inside `runQuickActionForFile`:

```typescript
  void targetTab.controllers.inputController?.sendMessage({ content: action.prompt });
}
```

Replace with:

```typescript
  await targetTab.controllers.inputController?.sendMessage({ content: action.prompt });
  plugin.events.emit('usage.recorded', {
    kind: 'quickAction',
    name: quickActionStemFromPath(action.filePath),
  });
}
```

(Note: switch from `void` to `await` per the spec's count-on-success contract.)

- [ ] **Step 5: Run tests, expect pass**

Run: `npm run test -- --selectProjects unit -t "runQuickActionForFile"`
Expected: PASS — including any pre-existing cases. The await switch may break a stub that returned `undefined` synchronously; if so, make the stub return `Promise.resolve()`.

- [ ] **Step 6: Commit**

```bash
git add src/features/quickActions/runQuickActionForFile.ts tests/unit/features/quickActions/runQuickActionForFile.test.ts
git commit -m "feat(quickActions): emit usage.recorded after quick-action dispatch"
```

---

## Task 9: Emit `usage.recorded` from `runVaultSkill`

**Files:**
- Modify: `src/features/quickActions/skills/runVaultSkill.ts`
- Test: `tests/unit/features/quickActions/skills/runVaultSkill.test.ts`

- [ ] **Step 1: Append failing tests**

```typescript
describe('runVaultSkill usage emission', () => {
  it('emits usage.recorded with skill name + providerId after sendMessage resolves', async () => {
    const events = new EventBus<UsageEventMap>();
    const recorded: Array<UsageEventMap['usage.recorded']> = [];
    events.on('usage.recorded', (e) => recorded.push(e));

    const plugin = makePluginStub({ events, providerEnabled: true });
    const entry = makeEntryStub({ name: 'deep-research', providerId: 'claude' });

    await runVaultSkill(plugin, entry, null);

    expect(recorded).toEqual([
      { kind: 'skill', name: 'deep-research', providerId: 'claude' },
    ]);
  });

  it('does NOT emit when provider is disabled', async () => {
    const events = new EventBus<UsageEventMap>();
    const recorded: Array<UsageEventMap['usage.recorded']> = [];
    events.on('usage.recorded', (e) => recorded.push(e));

    const plugin = makePluginStub({ events, providerEnabled: false });
    const entry = makeEntryStub({ name: 'x', providerId: 'claude' });

    await runVaultSkill(plugin, entry, null);
    expect(recorded).toEqual([]);
  });

  it('does NOT emit if sendMessage rejects', async () => {
    const events = new EventBus<UsageEventMap>();
    const recorded: Array<UsageEventMap['usage.recorded']> = [];
    events.on('usage.recorded', (e) => recorded.push(e));

    const plugin = makePluginStub({
      events,
      providerEnabled: true,
      sendMessageImpl: async () => { throw new Error('boom'); },
    });
    const entry = makeEntryStub({ name: 'x', providerId: 'claude' });

    await expect(runVaultSkill(plugin, entry, null)).rejects.toThrow('boom');
    expect(recorded).toEqual([]);
  });
});
```

(Reuse the file's existing builders. If they don't exist, factor them at the top.)

Imports:

```typescript
import { EventBus } from '@/core/events/EventBus';
import type { UsageEventMap } from '@/core/usage/events';
```

- [ ] **Step 2: Run tests, expect failure**

Run: `npm run test -- --selectProjects unit -t "runVaultSkill usage"`
Expected: FAIL.

- [ ] **Step 3: Emit after dispatch**

Locate the final dispatch line inside `runVaultSkill`:

```typescript
  const content = `${entry.insertPrefix}${entry.name}`;
  void target.controllers.inputController?.sendMessage({ content });
}
```

Replace with:

```typescript
  const content = `${entry.insertPrefix}${entry.name}`;
  await target.controllers.inputController?.sendMessage({ content });
  plugin.events.emit('usage.recorded', {
    kind: 'skill',
    name: entry.name,
    providerId: entry.providerId,
  });
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npm run test -- --selectProjects unit -t "runVaultSkill"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/skills/runVaultSkill.ts tests/unit/features/quickActions/skills/runVaultSkill.test.ts
git commit -m "feat(quickActions): emit usage.recorded after skill dispatch"
```

---

## Task 10: `formatUsageBadge` helper + i18n keys

**Files:**
- Create: `src/features/quickActions/ui/formatUsageBadge.ts`
- Test: `tests/unit/features/quickActions/ui/formatUsageBadge.test.ts`
- Modify: `src/i18n/locales/en.json` and all other 9 locale files (`de`, `es`, `fr`, `ja`, `ko`, `pt`, `ru`, `zh-CN`, `zh-TW`).

- [ ] **Step 1: Add i18n keys to `en.json`**

Inside the existing `"quickActions": { ... }` block, add a new `"usage"` sub-block. Example shape (place after the existing `"skills"` block for consistency with how `vault-skill-aggregator` references siblings):

```json
"usage": {
  "tabLabel": "Stats",
  "topUsed": "Top 5 — Most used",
  "dropCandidates": "Drop candidates",
  "all": "All",
  "uses": "{count} uses",
  "uses_one": "1 use",
  "uses_zero": "0 uses",
  "lastUsed": {
    "never": "never",
    "today": "today",
    "daysAgo": "{count} days ago",
    "daysAgo_one": "1 day ago"
  },
  "sort": {
    "label": "Sort by",
    "mostUsed": "Most used",
    "leastUsed": "Least used",
    "longestUnused": "Longest unused",
    "recentlyUsed": "Recently used"
  },
  "column": {
    "type": "Type",
    "name": "Name",
    "count": "Count",
    "lastUsed": "Last used"
  },
  "type": {
    "quickAction": "Quick action",
    "skill": "Skill"
  },
  "empty": "No usage tracked yet. Run a quick-action or skill to start the leaderboard.",
  "clearAll": "Clear all stats",
  "clearConfirm": {
    "title": "Clear all usage stats?",
    "body": "This cannot be undone.",
    "confirm": "Clear",
    "cancel": "Cancel"
  }
}
```

Mirror identical keys (translated values) into the other 9 locale files. If your repo provides an i18n verification script, run it; otherwise translate using the conventions already present in each locale (English fallback acceptable for first-pass if no translator available — flag in commit body).

- [ ] **Step 2: Write the failing badge test**

```typescript
import { formatUsageBadge } from '@/features/quickActions/ui/formatUsageBadge';
import type { UsageRecord } from '@/core/usage/types';

const i18nFixture = {
  uses_zero: '0 uses',
  uses_one: '1 use',
  uses_many: '{count} uses',
  never: 'never',
  today: 'today',
  daysAgo_one: '1 day ago',
  daysAgo_many: '{count} days ago',
};

const oneDayMs = 24 * 60 * 60 * 1000;

describe('formatUsageBadge', () => {
  it('renders never for null record', () => {
    expect(formatUsageBadge(null, 100_000, i18nFixture)).toBe('0 uses · never');
  });

  it('renders today for same-day timestamps', () => {
    const rec: UsageRecord = { count: 1, lastUsedAt: 100_000 };
    expect(formatUsageBadge(rec, 100_000, i18nFixture)).toBe('1 use · today');
  });

  it('renders "1 day ago" for exactly one day', () => {
    const rec: UsageRecord = { count: 5, lastUsedAt: 100_000 };
    expect(formatUsageBadge(rec, 100_000 + oneDayMs, i18nFixture))
      .toBe('5 uses · 1 day ago');
  });

  it('renders "N days ago" for older', () => {
    const rec: UsageRecord = { count: 47, lastUsedAt: 100_000 };
    expect(formatUsageBadge(rec, 100_000 + oneDayMs * 12, i18nFixture))
      .toBe('47 uses · 12 days ago');
  });
});
```

- [ ] **Step 3: Run test, expect failure**

Run: `npm run test -- --selectProjects unit -t "formatUsageBadge"`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```typescript
import type { UsageRecord } from '../../../core/usage/types';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface UsageBadgeI18n {
  uses_zero: string;
  uses_one: string;
  uses_many: string;       // contains "{count}"
  never: string;
  today: string;
  daysAgo_one: string;
  daysAgo_many: string;    // contains "{count}"
}

/**
 * Returns the small muted text shown after an action or skill name.
 * Examples: "0 uses · never", "1 use · today", "47 uses · 12 days ago".
 *
 * `nowMs` is injected so callers can pass a fixture clock in tests.
 */
export function formatUsageBadge(
  record: UsageRecord | null,
  nowMs: number,
  i18n: UsageBadgeI18n,
): string {
  const count = record?.count ?? 0;
  const usesPart =
    count === 0 ? i18n.uses_zero
    : count === 1 ? i18n.uses_one
    : i18n.uses_many.replace('{count}', String(count));

  if (!record || count === 0) {
    return `${usesPart} · ${i18n.never}`;
  }

  const days = Math.floor((nowMs - record.lastUsedAt) / ONE_DAY_MS);
  const lastPart =
    days < 1 ? i18n.today
    : days === 1 ? i18n.daysAgo_one
    : i18n.daysAgo_many.replace('{count}', String(days));

  return `${usesPart} · ${lastPart}`;
}
```

- [ ] **Step 5: Run test, expect pass**

Run: `npm run test -- --selectProjects unit -t "formatUsageBadge"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/quickActions/ui/formatUsageBadge.ts tests/unit/features/quickActions/ui/formatUsageBadge.test.ts src/i18n/locales
git commit -m "feat(quickActions): add formatUsageBadge helper + i18n usage keys"
```

---

## Task 11: `UsageStatsTab` — Top-K, drop candidates, full table

**Files:**
- Create: `src/features/quickActions/ui/UsageStatsTab.ts`
- Test: `tests/unit/features/quickActions/ui/UsageStatsTab.test.ts`

The tab is rendered by `QuickActionsModal` (Task 12). It takes the tracker, the live quick-action list, and a snapshot of live skills, then paints three sections.

- [ ] **Step 1: Write the failing test**

```typescript
import type { ReadonlyMap } from '@/core/usage/types'; // if not exported, use lib map
import { EventBus } from '@/core/events/EventBus';
import type { UsageEventMap } from '@/core/usage/events';
import { serializeKey } from '@/core/usage/keys';
import type { UsageRecord } from '@/core/usage/types';
import { UsageStatsTab } from '@/features/quickActions/ui/UsageStatsTab';
import type { QuickAction } from '@/features/quickActions/types';
import type { SkillTabEntry } from '@/features/quickActions/skills/types';

const NOW = 1_000_000_000_000;
const ONE_DAY = 24 * 60 * 60 * 1000;

function makeTrackerStub(records: Record<string, UsageRecord>) {
  return {
    getAll(): ReadonlyMap<string, UsageRecord> {
      return new Map(Object.entries(records));
    },
    get(key: { kind: string; name: string; providerId?: string }) {
      return new Map(Object.entries(records)).get(
        serializeKey(key as never),
      );
    },
  };
}

function makeQuickAction(stem: string): QuickAction {
  return {
    id: `Quick Actions/${stem}`,
    name: stem,
    description: '',
    prompt: 'p',
    filePath: `Quick Actions/${stem}.md`,
  };
}

function makeSkill(name: string, providerId: 'claude' | 'codex'): SkillTabEntry {
  return {
    id: `${providerId}:${name}`,
    providerId,
    providerDisplayName: providerId,
    name,
    description: '',
    insertPrefix: '$',
    sourceFilePath: null,
    providerEnabled: true,
  };
}

describe('UsageStatsTab', () => {
  let bus: EventBus<UsageEventMap>;

  beforeEach(() => {
    bus = new EventBus<UsageEventMap>();
  });

  it('renders empty state when no records exist', () => {
    const tab = new UsageStatsTab({
      tracker: makeTrackerStub({}),
      events: bus,
      quickActions: () => [],
      skills: () => [],
      now: () => NOW,
      onClearAll: jest.fn(),
    });
    const host = document.createElement('div');
    tab.render(host);
    expect(host.textContent).toContain('No usage tracked yet');
  });

  it('paints top-5 most-used live entries in count-desc order', () => {
    const records: Record<string, UsageRecord> = {};
    for (let i = 1; i <= 6; i++) {
      records[serializeKey({ kind: 'quickAction', name: `a${i}` })] = {
        count: i * 5,
        lastUsedAt: NOW,
      };
    }
    const liveActions = [1, 2, 3, 4, 5, 6].map((i) => makeQuickAction(`a${i}`));
    const tab = new UsageStatsTab({
      tracker: makeTrackerStub(records),
      events: bus,
      quickActions: () => liveActions,
      skills: () => [],
      now: () => NOW,
      onClearAll: jest.fn(),
    });
    const host = document.createElement('div');
    tab.render(host);

    const topRows = host.querySelectorAll('.claudian-usage-top-row');
    expect(topRows).toHaveLength(5);
    expect(topRows[0].textContent).toContain('a6');
    expect(topRows[4].textContent).toContain('a2');
  });

  it('hides orphans (usage key with no live action) from all sections', () => {
    const records: Record<string, UsageRecord> = {
      [serializeKey({ kind: 'quickAction', name: 'gone' })]: { count: 10, lastUsedAt: NOW },
      [serializeKey({ kind: 'quickAction', name: 'live' })]: { count: 1, lastUsedAt: NOW },
    };
    const tab = new UsageStatsTab({
      tracker: makeTrackerStub(records),
      events: bus,
      quickActions: () => [makeQuickAction('live')],
      skills: () => [],
      now: () => NOW,
      onClearAll: jest.fn(),
    });
    const host = document.createElement('div');
    tab.render(host);

    expect(host.textContent).not.toContain('gone');
    expect(host.textContent).toContain('live');
  });

  it('lists drop candidates: count below median AND last used > 30 days ago', () => {
    const liveActions = ['heavy', 'medium', 'stale'].map(makeQuickAction);
    const records: Record<string, UsageRecord> = {
      [serializeKey({ kind: 'quickAction', name: 'heavy' })]:  { count: 100, lastUsedAt: NOW },
      [serializeKey({ kind: 'quickAction', name: 'medium' })]: { count: 50,  lastUsedAt: NOW },
      [serializeKey({ kind: 'quickAction', name: 'stale' })]:  { count: 1,   lastUsedAt: NOW - 60 * ONE_DAY },
    };
    const tab = new UsageStatsTab({
      tracker: makeTrackerStub(records),
      events: bus,
      quickActions: () => liveActions,
      skills: () => [],
      now: () => NOW,
      onClearAll: jest.fn(),
    });
    const host = document.createElement('div');
    tab.render(host);

    const dropRows = host.querySelectorAll('.claudian-usage-drop-row');
    expect(dropRows).toHaveLength(1);
    expect(dropRows[0].textContent).toContain('stale');
  });

  it('clear-all confirm emits usage.cleared via onClearAll callback', () => {
    const onClearAll = jest.fn();
    const tab = new UsageStatsTab({
      tracker: makeTrackerStub({}),
      events: bus,
      quickActions: () => [],
      skills: () => [],
      now: () => NOW,
      onClearAll,
    });
    const host = document.createElement('div');
    tab.render(host);

    const btn = host.querySelector<HTMLButtonElement>('.claudian-usage-clear-all');
    btn?.click();
    expect(onClearAll).toHaveBeenCalled();
  });

  it('separate-provider skill counters render as distinct rows', () => {
    const records: Record<string, UsageRecord> = {
      [serializeKey({ kind: 'skill', name: 'x', providerId: 'claude' })]: { count: 4, lastUsedAt: NOW },
      [serializeKey({ kind: 'skill', name: 'x', providerId: 'codex' })]:  { count: 2, lastUsedAt: NOW },
    };
    const skills = [makeSkill('x', 'claude'), makeSkill('x', 'codex')];
    const tab = new UsageStatsTab({
      tracker: makeTrackerStub(records),
      events: bus,
      quickActions: () => [],
      skills: () => skills,
      now: () => NOW,
      onClearAll: jest.fn(),
    });
    const host = document.createElement('div');
    tab.render(host);

    const rows = host.querySelectorAll('.claudian-usage-all-row');
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm run test -- --selectProjects unit -t "UsageStatsTab"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import type { EventBus } from '../../../core/events/EventBus';
import type { UsageEventMap } from '../../../core/usage/events';
import { serializeKey } from '../../../core/usage/keys';
import type { UsageRecord } from '../../../core/usage/types';
import { t } from '../../../i18n/i18n';

import { formatUsageBadge, type UsageBadgeI18n } from './formatUsageBadge';
import type { QuickAction } from '../types';
import type { SkillTabEntry } from '../skills/types';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DROP_DAYS_THRESHOLD = 30;
const TOP_K = 5;
const DROP_CANDIDATE_LIMIT = 10;

type SortKey = 'mostUsed' | 'leastUsed' | 'longestUnused' | 'recentlyUsed';

interface Row {
  kind: 'quickAction' | 'skill';
  name: string;
  providerId?: string;
  providerDisplayName?: string;
  count: number;
  lastUsedAt: number;
}

export interface UsageStatsTabOptions {
  tracker: {
    getAll(): ReadonlyMap<string, UsageRecord>;
  };
  events: EventBus<UsageEventMap>;
  quickActions: () => QuickAction[];
  skills: () => SkillTabEntry[];
  now: () => number;
  onClearAll: () => void;
}

export class UsageStatsTab {
  private host: HTMLElement | null = null;
  private sort: SortKey = 'mostUsed';
  private unsubscribe: (() => void) | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private opts: UsageStatsTabOptions) {}

  render(host: HTMLElement): void {
    this.host = host;
    this.unsubscribe?.();
    this.unsubscribe = this.opts.events.on('usage.recorded', () => this.scheduleRefresh());
    this.paint();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.paint();
    }, 250);
  }

  private paint(): void {
    if (!this.host) return;
    this.host.empty();
    const rows = this.collectLiveRows();

    if (rows.length === 0) {
      this.host.createDiv({
        cls: 'claudian-usage-empty',
        text: t('quickActions.usage.empty'),
      });
      this.renderClearAllButton();
      return;
    }

    this.renderTop(rows);
    this.renderDropCandidates(rows);
    this.renderAll(rows);
    this.renderClearAllButton();
  }

  private collectLiveRows(): Row[] {
    const all = this.opts.tracker.getAll();
    const liveActionStems = new Set(
      this.opts.quickActions().map((a) => filenameStem(a.filePath)),
    );
    const liveSkillKeys = new Set(
      this.opts.skills().map((s) => `${s.providerId}:${s.name}`),
    );
    const providerDisplay = new Map(
      this.opts.skills().map((s) => [s.providerId, s.providerDisplayName]),
    );

    const out: Row[] = [];
    for (const [key, record] of all) {
      if (key.startsWith('quickAction:_:')) {
        const name = key.slice('quickAction:_:'.length);
        if (!liveActionStems.has(name)) continue;
        out.push({
          kind: 'quickAction', name,
          count: record.count, lastUsedAt: record.lastUsedAt,
        });
      } else if (key.startsWith('skill:')) {
        const rest = key.slice('skill:'.length);
        const sep = rest.indexOf(':');
        if (sep <= 0) continue;
        const providerId = rest.slice(0, sep);
        const name = rest.slice(sep + 1);
        if (!liveSkillKeys.has(`${providerId}:${name}`)) continue;
        out.push({
          kind: 'skill', name, providerId,
          providerDisplayName: providerDisplay.get(providerId) ?? providerId,
          count: record.count, lastUsedAt: record.lastUsedAt,
        });
      }
    }
    return out;
  }

  private renderTop(rows: Row[]): void {
    if (!this.host) return;
    const section = this.host.createDiv({ cls: 'claudian-usage-section' });
    section.createEl('h3', { text: t('quickActions.usage.topUsed') });
    const top = [...rows].sort((a, b) => b.count - a.count).slice(0, TOP_K);
    for (const row of top) {
      const el = section.createDiv({ cls: 'claudian-usage-top-row' });
      this.paintRowLabel(el, row);
    }
  }

  private renderDropCandidates(rows: Row[]): void {
    if (!this.host) return;
    const counts = rows.map((r) => r.count).sort((a, b) => a - b);
    const median = counts.length === 0 ? 0 : counts[Math.floor(counts.length / 2)];
    const now = this.opts.now();
    const candidates = rows
      .filter((r) => r.count < median && (now - r.lastUsedAt) > DROP_DAYS_THRESHOLD * ONE_DAY_MS)
      .sort((a, b) => (a.lastUsedAt - b.lastUsedAt))
      .slice(0, DROP_CANDIDATE_LIMIT);

    if (candidates.length === 0) return;

    const section = this.host.createDiv({ cls: 'claudian-usage-section' });
    section.createEl('h3', { text: t('quickActions.usage.dropCandidates') });
    for (const row of candidates) {
      const el = section.createDiv({ cls: 'claudian-usage-drop-row' });
      this.paintRowLabel(el, row);
    }
  }

  private renderAll(rows: Row[]): void {
    if (!this.host) return;
    const section = this.host.createDiv({ cls: 'claudian-usage-section' });
    const header = section.createDiv({ cls: 'claudian-usage-all-header' });
    header.createEl('h3', { text: t('quickActions.usage.all') });

    const sortSel = header.createEl('select', { cls: 'claudian-usage-sort' });
    for (const key of ['mostUsed', 'leastUsed', 'longestUnused', 'recentlyUsed'] as const) {
      const opt = sortSel.createEl('option', {
        text: t(`quickActions.usage.sort.${key}`),
        value: key,
      });
      if (this.sort === key) opt.selected = true;
    }
    sortSel.addEventListener('change', () => {
      this.sort = sortSel.value as SortKey;
      this.paint();
    });

    const sorted = sortRows(rows, this.sort);
    for (const row of sorted) {
      const el = section.createDiv({ cls: 'claudian-usage-all-row' });
      this.paintRowLabel(el, row);
    }
  }

  private renderClearAllButton(): void {
    if (!this.host) return;
    const footer = this.host.createDiv({ cls: 'claudian-usage-footer' });
    const btn = footer.createEl('button', {
      cls: 'claudian-usage-clear-all',
      text: t('quickActions.usage.clearAll'),
    });
    btn.addEventListener('click', () => this.opts.onClearAll());
  }

  private paintRowLabel(el: HTMLElement, row: Row): void {
    const typeLabel = row.kind === 'quickAction'
      ? t('quickActions.usage.type.quickAction')
      : t('quickActions.usage.type.skill');
    const displayName = row.kind === 'skill'
      ? `${row.name} (${row.providerDisplayName ?? row.providerId})`
      : row.name;
    el.createSpan({ cls: 'claudian-usage-row-type', text: typeLabel });
    el.createSpan({ cls: 'claudian-usage-row-name', text: displayName });
    el.createSpan({
      cls: 'claudian-usage-row-badge',
      text: formatUsageBadge(
        { count: row.count, lastUsedAt: row.lastUsedAt },
        this.opts.now(),
        loadBadgeI18n(),
      ),
    });
  }
}

function sortRows(rows: Row[], key: SortKey): Row[] {
  switch (key) {
    case 'mostUsed':       return [...rows].sort((a, b) => b.count - a.count);
    case 'leastUsed':      return [...rows].sort((a, b) => a.count - b.count);
    case 'longestUnused':  return [...rows].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    case 'recentlyUsed':   return [...rows].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }
}

function filenameStem(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.md$/i, '');
}

function loadBadgeI18n(): UsageBadgeI18n {
  return {
    uses_zero: t('quickActions.usage.uses_zero'),
    uses_one: t('quickActions.usage.uses_one'),
    uses_many: t('quickActions.usage.uses'),
    never: t('quickActions.usage.lastUsed.never'),
    today: t('quickActions.usage.lastUsed.today'),
    daysAgo_one: t('quickActions.usage.lastUsed.daysAgo_one'),
    daysAgo_many: t('quickActions.usage.lastUsed.daysAgo'),
  };
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npm run test -- --selectProjects unit -t "UsageStatsTab"`
Expected: PASS — all 6 cases. If the renderer's `t()` calls fail under Jest's jsdom env (no locale loaded), patch the test to register a minimal i18n stub mirroring keys added in Task 10 — match whatever pattern existing UI tests use (search `tests/unit/features/quickActions/ui` for a similar setup).

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/ui/UsageStatsTab.ts tests/unit/features/quickActions/ui/UsageStatsTab.test.ts
git commit -m "feat(quickActions): add UsageStatsTab renderer"
```

---

## Task 12: Mount the Stats tab on `QuickActionsModal`

**Files:**
- Modify: `src/features/quickActions/ui/QuickActionsModal.ts`
- Modify: `src/features/quickActions/openQuickActionsModal.ts`

The modal needs:
1. A new `'stats'` value in `ActiveTab`.
2. A `UsageStatsTab` instance constructed in the constructor.
3. A new entry in the `renderTabStrip()` entries array.
4. A new branch in `renderActiveTab()` to call `usageStatsTab.render(host)`.
5. The `UsageStatsTabCallbacks` (tracker accessor, events bus, onClearAll) threaded through `QuickActionsModalCallbacks`.

`openQuickActionsModal` provides the additional callbacks: pulls `tracker` from `plugin.usageTracker`, emits `usage.cleared` on confirm.

- [ ] **Step 1: Add the new callback fields**

In `QuickActionsModal.ts`, extend `QuickActionsModalCallbacks`:

```typescript
import type { EventBus } from '../../../core/events/EventBus';
import type { UsageEventMap } from '../../../core/usage/events';
import type { UsageRecord } from '../../../core/usage/types';
// ...

export interface QuickActionsModalCallbacks {
  onRun: (action: QuickAction) => void;
  onRunSkill: (entry: SkillTabEntry) => void;
  onEditSkill: (entry: SkillTabEntry) => void;
  storage: QuickActionStorage;
  aggregator: VaultSkillSource;
  onFavoritesChanged?: () => void;
  usageTracker: { getAll(): ReadonlyMap<string, UsageRecord> } | null;
  events: EventBus<UsageEventMap>;
  now?: () => number;
}
```

- [ ] **Step 2: Extend the tab union**

Change:

```typescript
type ActiveTab = 'quickActions' | 'skills';
```

to:

```typescript
type ActiveTab = 'quickActions' | 'skills' | 'stats';
```

- [ ] **Step 3: Construct the stats renderer**

Inside `QuickActionsModal` add a field + initialize in the constructor (next to `this.skillsRenderer`):

```typescript
private statsTab: UsageStatsTab | null = null;

// In constructor, after this.skillsRenderer = ...:
if (callbacks.usageTracker) {
  this.statsTab = new UsageStatsTab({
    tracker: callbacks.usageTracker,
    events: callbacks.events,
    quickActions: () => this.actions,
    skills: () => callbacks.aggregator.listCachedNow(),
    now: callbacks.now ?? (() => Date.now()),
    onClearAll: () => this.confirmClearAll(),
  });
}
```

Import `UsageStatsTab` from `./UsageStatsTab`.

- [ ] **Step 4: Extend `renderTabStrip` and `renderActiveTab`**

In `renderTabStrip()`, append a `'stats'` entry to `entries` only if `this.statsTab !== null`:

```typescript
const entries: Array<{ key: ActiveTab; label: string }> = [
  { key: 'quickActions', label: t('quickActions.modal.tabs.quickActions') },
  { key: 'skills', label: t('quickActions.modal.tabs.skills') },
];
if (this.statsTab) {
  entries.push({ key: 'stats', label: t('quickActions.usage.tabLabel') });
}
```

In `renderActiveTab()` add a branch:

```typescript
if (this.activeTab === 'stats' && this.statsTab) {
  this.statsTab.render(this.bodyEl);
  return;
}
```

The early-return is correct — no input element to focus on the stats tab.

- [ ] **Step 5: Add `confirmClearAll` method**

```typescript
private confirmClearAll(): void {
  const modal = new Modal(this.app);
  modal.titleEl.setText(t('quickActions.usage.clearConfirm.title'));
  modal.contentEl.createEl('p', { text: t('quickActions.usage.clearConfirm.body') });
  const footer = modal.contentEl.createDiv({ cls: 'modal-button-container' });
  footer.createEl('button', { text: t('quickActions.usage.clearConfirm.cancel') })
    .addEventListener('click', () => modal.close());
  const confirm = footer.createEl('button', {
    text: t('quickActions.usage.clearConfirm.confirm'),
    cls: 'mod-warning',
  });
  confirm.addEventListener('click', () => {
    this.callbacks.events.emit('usage.cleared');
    modal.close();
    // Re-render so the empty state appears.
    if (this.activeTab === 'stats') {
      void this.renderActiveTab();
    }
  });
  modal.open();
}
```

- [ ] **Step 6: Dispose**

Override `onClose()` to clean up the stats subscription:

```typescript
onClose(): void {
  this.statsTab?.dispose();
  super.onClose?.();
}
```

(If `onClose` already exists in this file, extend it instead.)

- [ ] **Step 7: Thread callbacks from `openQuickActionsModal`**

In `openQuickActionsModal.ts`, after the existing wiring, pass the new fields:

```typescript
new QuickActionsModal(plugin.app, {
  storage,
  aggregator,
  onRun: options.onRun,
  onRunSkill: (entry) => {
    void runVaultSkill(plugin, entry, file);
  },
  onEditSkill: (entry) => {
    openClaudianProviderSettings(
      plugin.app,
      plugin.manifest.id,
      entry.providerId,
    );
  },
  onFavoritesChanged:
    options.onFavoritesChanged ?? (() => plugin.quickActionFavoritesCache?.refresh()),
  usageTracker: plugin.usageTracker,
  events: plugin.events,
}).open();
```

- [ ] **Step 8: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS, 0/0 lint.

- [ ] **Step 9: Run all unit tests**

Run: `npm run test -- --selectProjects unit`
Expected: PASS. If existing `QuickActionsModal` tests construct callbacks without `usageTracker` / `events`, extend their builders to pass `usageTracker: null` and a fresh `EventBus`.

- [ ] **Step 10: Commit**

```bash
git add src/features/quickActions/ui/QuickActionsModal.ts src/features/quickActions/openQuickActionsModal.ts
git commit -m "feat(quickActions): mount Stats tab on QuickActionsModal"
```

---

## Task 13: Inline badges on Quick Actions tab rows

**Files:**
- Modify: `src/features/quickActions/ui/QuickActionsModal.ts`

- [ ] **Step 1: Inject tracker into `renderRow`**

Inside the existing `renderRow(action)` method, after the `textCol.createEl('strong', { text: action.name });` line, append:

```typescript
if (this.callbacks.usageTracker) {
  const stem = action.filePath
    ? action.filePath.split('/').pop()!.replace(/\.md$/i, '')
    : action.name;
  const record = this.callbacks.usageTracker.getAll().get(`quickAction:_:${stem}`);
  textCol.createSpan({
    cls: 'claudian-quick-action-usage-badge',
    text: formatUsageBadge(
      record ?? null,
      this.callbacks.now?.() ?? Date.now(),
      loadBadgeI18n(),
    ),
  });
}
```

Import `formatUsageBadge` from `./formatUsageBadge` and `loadBadgeI18n` (either factor it out of `UsageStatsTab.ts` into `./formatUsageBadge.ts` — preferred — or copy a small inline equivalent here).

Refactor: move `loadBadgeI18n` into `formatUsageBadge.ts` and export it so both tab and modal share it. Update the import in `UsageStatsTab.ts` to match.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Smoke test**

Run: `npm run test -- --selectProjects unit -t "QuickActionsModal|UsageStatsTab|formatUsageBadge"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/quickActions/ui/QuickActionsModal.ts src/features/quickActions/ui/formatUsageBadge.ts src/features/quickActions/ui/UsageStatsTab.ts
git commit -m "feat(quickActions): render usage badge on Quick Actions rows"
```

---

## Task 14: Inline badges on Skills tab rows

**Files:**
- Modify: `src/features/quickActions/ui/SkillsTabRenderer.ts`
- Modify: `src/features/quickActions/ui/QuickActionsModal.ts` (wire usageTracker into the renderer constructor)

- [ ] **Step 1: Extend `SkillsTabRenderer` constructor**

Add a fifth constructor argument:

```typescript
constructor(
  private source: VaultSkillSource,
  private onRunSkill: (entry: SkillTabEntry) => void,
  private onEditSkill: (entry: SkillTabEntry) => void,
  private close: () => void,
  private usageTracker: { getAll(): ReadonlyMap<string, UsageRecord> } | null = null,
  private now: () => number = () => Date.now(),
) {}
```

(Default values keep existing callsites — if any — compiling.)

- [ ] **Step 2: Render the badge inside the skill row**

Locate the row-rendering routine in `SkillsTabRenderer` (the function that creates each skill's primary text). After the skill name element is appended, append:

```typescript
if (this.usageTracker) {
  const key = `skill:${entry.providerId}:${entry.name}`;
  const record = this.usageTracker.getAll().get(key) ?? null;
  textCol.createSpan({
    cls: 'claudian-skill-usage-badge',
    text: formatUsageBadge(record, this.now(), loadBadgeI18n()),
  });
}
```

Import `formatUsageBadge, loadBadgeI18n` from `./formatUsageBadge`.

- [ ] **Step 3: Pass tracker into the renderer from `QuickActionsModal`**

In `QuickActionsModal` constructor, change the `SkillsTabRenderer` construction to:

```typescript
this.skillsRenderer = new SkillsTabRenderer(
  callbacks.aggregator,
  callbacks.onRunSkill,
  callbacks.onEditSkill,
  () => this.close(),
  callbacks.usageTracker,
  callbacks.now ?? (() => Date.now()),
);
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Smoke test**

Run: `npm run test -- --selectProjects unit -t "SkillsTabRenderer|QuickActionsModal"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/quickActions/ui/SkillsTabRenderer.ts src/features/quickActions/ui/QuickActionsModal.ts
git commit -m "feat(quickActions): render usage badge on Skills tab rows"
```

---

## Task 15: Integration — hydrate → record → persist → reload

**Files:**
- Create: `tests/integration/features/quickActions/usageEndToEnd.test.ts`

This test exercises the tracker + storage against an in-memory `VaultFileAdapter`-shaped fake to prove an emit lands on disk after debounce and re-hydrates intact.

- [ ] **Step 1: Write the test**

```typescript
import { EventBus } from '@/core/events/EventBus';
import type { Logger } from '@/core/logging/Logger';
import { UsageStorage } from '@/core/usage/UsageStorage';
import { UsageTracker } from '@/core/usage/UsageTracker';
import type { UsageEventMap } from '@/core/usage/events';
import { serializeKey } from '@/core/usage/keys';

function silentLogger(): Logger {
  const noop = () => undefined;
  return {
    scope: () => ({ debug: noop, info: noop, warn: noop, error: noop, isEnabled: () => false }),
  } as unknown as Logger;
}

function makeFakeAdapter() {
  const files = new Map<string, string>();
  return {
    files,
    exists: async (p: string) => files.has(p),
    read: async (p: string) => files.get(p) ?? '',
    write: async (p: string, c: string) => { files.set(p, c); },
    ensureFolder: async () => undefined,
  };
}

describe('usage tracker end-to-end', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('records → debounces → persists → reload sees the count', async () => {
    const adapter = makeFakeAdapter();
    const storage = new UsageStorage(adapter as never, silentLogger());
    const bus = new EventBus<UsageEventMap>();
    let now = 100_000;
    const tracker = new UsageTracker(bus, storage, () => now, silentLogger());
    await tracker.hydrate();

    bus.emit('usage.recorded', { kind: 'quickAction', name: 'summarize' });
    now = 200_000;
    bus.emit('usage.recorded', { kind: 'skill', name: 'deep-research', providerId: 'claude' });

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.files.get('.claudian/usage.json')).toBeDefined();

    // Simulate plugin reload: dispose, rebuild from disk.
    tracker.dispose();
    const bus2 = new EventBus<UsageEventMap>();
    const tracker2 = new UsageTracker(bus2, storage, () => now, silentLogger());
    await tracker2.hydrate();

    expect(tracker2.get({ kind: 'quickAction', name: 'summarize' }))
      .toEqual({ count: 1, lastUsedAt: 100_000 });
    expect(tracker2.get({ kind: 'skill', name: 'deep-research', providerId: 'claude' }))
      .toEqual({ count: 1, lastUsedAt: 200_000 });
  });

  it('usage.cleared wipes the persisted index', async () => {
    const adapter = makeFakeAdapter();
    const storage = new UsageStorage(adapter as never, silentLogger());
    const bus = new EventBus<UsageEventMap>();
    const tracker = new UsageTracker(bus, storage, () => 0, silentLogger());
    await tracker.hydrate();

    bus.emit('usage.recorded', { kind: 'quickAction', name: 'x' });
    await tracker.flush();
    expect(JSON.parse(adapter.files.get('.claudian/usage.json')!).records[
      serializeKey({ kind: 'quickAction', name: 'x' })
    ]).toBeDefined();

    bus.emit('usage.cleared');
    await tracker.flush();
    expect(JSON.parse(adapter.files.get('.claudian/usage.json')!).records).toEqual({});
  });
});
```

- [ ] **Step 2: Run test, expect pass**

Run: `npm run test -- --selectProjects integration -t "usage tracker end-to-end"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/features/quickActions/usageEndToEnd.test.ts
git commit -m "test(integration): usage tracker hydrate → record → persist → reload"
```

---

## Task 16: Full verify + build

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS, `0 errors, 0 warnings`.

- [ ] **Step 3: All tests (unit + integration)**

Run: `npm run test`
Expected: all suites PASS.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Manual smoke (out-of-band — record outcome in PR body)**

In Obsidian, with the dev plugin loaded:

1. Open the QuickActions modal, fire any quick-action. Open the new **Stats** tab — count = 1, last used "today".
2. Run a vault skill via the Skills tab. Stats tab now shows it under a separate row; inline badge appears on the Skills row too.
3. Delete a quick-action note that has stats. Re-open Stats tab — that row is hidden.
4. Click **Clear all stats** → confirm → empty state paints. Re-open `.claudian/usage.json` — `records` is `{}`.
5. Reload the plugin (`Ctrl/Cmd+R`). Stats tab still empty (cleared state persisted).
6. Fire a quick-action again → reload → count persists.

- [ ] **Step 6: Final commit (if any pending)**

```bash
git status
# If clean, skip. Otherwise:
git add -A
git commit -m "chore: post-verify cleanup"
```

---

## Out-of-scope (call out, do NOT implement)

- Per-row reset button.
- Rolling 7d/30d windows.
- Charts or sparklines.
- Cross-vault aggregation or telemetry.
- Tracking sources other than quick-actions and skills (commands, subagents, inline-edit, plan-mode).
- Auto-purge orphans (kept on disk so re-creating the same name restores history).

## Self-Review Findings

1. **Spec coverage** — Each spec section maps to ≥1 task:
   - Architecture & module layout → Tasks 1, 3, 5, 6, 7.
   - Data model + composite key → Tasks 1, 2.
   - Event flow + emit sites + tracker → Tasks 3, 4, 6, 8, 9.
   - UI Stats tab → Tasks 10, 11, 12.
   - Inline badges → Tasks 13, 14.
   - Error handling (cold start, malformed, write failure) → Task 5 cases.
   - Testing (unit + integration + manual) → spread across all tasks + Tasks 15, 16.
   - i18n keys → Task 10.

2. **Placeholder scan** — No `TBD` / `TODO` / "handle edge cases" / "similar to Task N". All code blocks complete.

3. **Type consistency** — `UsageKey`, `UsageRecord`, `UsageIndex` declared in Task 1, used unchanged in Tasks 2–14. `UsageEventMap` declared in Task 3, used unchanged through Task 15. `formatUsageBadge` signature stays `(record | null, nowMs, i18n)` across Tasks 10, 11, 13, 14.

4. **Ambiguity** — `quickActionStemFromPath` (Task 8) and `filenameStem` (Task 11) are intentionally separate utilities; same logic, kept local to avoid premature cross-feature import. Either path-stem helper is acceptable since both reduce to `.split('/').pop().replace(/\.md$/i, '')`.

