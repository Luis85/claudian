---
status: open
parent: "[[Quick Actions]]"
---
# Skills tab responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the Skills tab open-latency in `QuickActionsModal` by caching results in memory and on disk, invalidating on in-app skill writes via EventBus, pre-warming at plugin load, and streaming per-provider results into the renderer.

**Architecture:** Hoist `VaultSkillAggregator` to a plugin-singleton with a TTL cache, persistent `.claudian/cache/skill-index.json`, EventBus subscription to a new `vaultSkill.changed` event emitted by `ClaudeCommandCatalog` and `CodexSkillCatalog`, in-flight fetch deduplication, and a streaming `listAllStreaming` API consumed by a stale-while-revalidate `SkillsTabRenderer`. Claude's `SkillStorage.loadAll` is parallelized so cold fetches scale with disk concurrency, not skill count.

**Tech Stack:** TypeScript, Jest (`unit` project), Obsidian Plugin API, existing `EventBus<ClaudianEventMap>`, existing `VaultFileAdapter`.

---

## Spec

See `docs/superpowers/specs/2026-06-04-skills-tab-responsiveness-design.md`.

## File structure

| File | Status | Responsibility |
|------|--------|----------------|
| `src/features/quickActions/events.ts` | Create | Declare `QuickActionsEventMap` with `vaultSkill.changed`. |
| `src/app/events/claudianEvents.ts` | Modify | Merge `QuickActionsEventMap` into `ClaudianEventMap`. |
| `src/features/quickActions/skills/types.ts` | Modify | Extend `VaultSkillSource` (add `listCachedNow`, `listAllStreaming`, `invalidate`, `dispose`). Extend `VaultSkillAggregatorOptions` (add `eventBus`, `ttlMs`, `cacheAdapter`, `cachePath`, `nowMs`). |
| `src/features/quickActions/skills/VaultSkillAggregator.ts` | Modify | TTL cache, EventBus subscription, in-flight dedupe, disk hydrate/persist, streaming API. |
| `src/features/quickActions/skills/skillIndexPersistence.ts` | Create | Pure (de)serialization of persistent index. Schema validation, content stripping. |
| `src/features/quickActions/openQuickActionsModal.ts` | Modify | Consume `plugin.vaultSkillAggregator` instead of building one. |
| `src/features/quickActions/ui/SkillsTabRenderer.ts` | Modify | Phase A (cached paint) + phase B (streaming refresh) + skeleton rows + refresh button. |
| `src/main.ts` | Modify | Construct aggregator at `onload`, hydrate, pre-warm, dispose at `onunload`. |
| `src/providers/claude/commands/ClaudeCommandCatalog.ts` | Modify | Accept optional `EventBus`, emit `vaultSkill.changed` on skill save/delete. |
| `src/providers/codex/commands/CodexSkillCatalog.ts` | Modify | Accept optional `EventBus`, emit `vaultSkill.changed` on save/delete. |
| `src/providers/claude/storage/SkillStorage.ts` | Modify | Parallelize `loadAll` via `Promise.all`. |
| `src/features/quickActions/CLAUDE.md` | Modify | Document caching, invalidation, dot-folder rationale, persistent index format. |
| `tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts` | Modify | Add TTL, EventBus invalidation, hydrate/persist, streaming, re-tag, dedupe cases. |
| `tests/unit/features/quickActions/skills/skillIndexPersistence.test.ts` | Create | Serialization/deserialization, content stripping, schema mismatch. |
| `tests/unit/providers/claude/storage/SkillStorage.test.ts` | Create | Parallel `loadAll` correctness. |
| `tests/unit/providers/claude/commands/ClaudeCommandCatalog.test.ts` | Modify | EventBus emit on skill save/delete; no emit on command save/delete. |
| `tests/unit/providers/codex/commands/CodexSkillCatalog.test.ts` | Modify | EventBus emit on save/delete. |

---

## Task 1: Add `QuickActionsEventMap` with `vaultSkill.changed`

**Files:**
- Create: `src/features/quickActions/events.ts`
- Modify: `src/app/events/claudianEvents.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/app/events/claudianEvents.test.ts` (or extend existing) — but a compile-time type test is simpler. Add an inline runtime check in a new file:

Create `tests/unit/features/quickActions/events.test.ts`:

```ts
import { EventBus } from '@/core/events/EventBus';
import type { ClaudianEventMap } from '@/app/events/claudianEvents';

describe('QuickActionsEventMap wiring', () => {
  it('exposes vaultSkill.changed with providerId payload via ClaudianEventMap', () => {
    const bus = new EventBus<ClaudianEventMap>();
    const received: Array<{ providerId: string }> = [];
    const off = bus.on('vaultSkill.changed', (p) => { received.push(p); });
    bus.emit('vaultSkill.changed', { providerId: 'claude' });
    off();
    expect(received).toEqual([{ providerId: 'claude' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/events.test.ts`
Expected: FAIL — TS error: `Argument of type '"vaultSkill.changed"' is not assignable...`

- [ ] **Step 3: Create the event map**

Create `src/features/quickActions/events.ts`:

```ts
import type { ProviderId } from '../../core/providers/types';

export interface QuickActionsEventMap {
  /**
   * Emitted by provider command catalogs after a skill-kind entry is saved
   * or deleted via in-app flows. The `VaultSkillAggregator` subscribes and
   * invalidates the matching provider bucket so the next Skills-tab open
   * shows fresh data without waiting for the TTL.
   *
   * External CLI edits (`SKILL.md` modified outside Obsidian) do NOT emit
   * this event — they rely on the aggregator's TTL fallback.
   */
  'vaultSkill.changed': { providerId: ProviderId };
}
```

- [ ] **Step 4: Merge into `ClaudianEventMap`**

Edit `src/app/events/claudianEvents.ts`:

```ts
import type { ChatEventMap } from '../../features/chat/events';
import type { QuickActionsEventMap } from '../../features/quickActions/events';
import type { SettingsEventMap } from '../../features/settings/events';
import type { TaskEventMap } from '../../features/tasks/events';

export type ClaudianEventMap = ChatEventMap
  & QuickActionsEventMap
  & SettingsEventMap
  & TaskEventMap;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/events.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/quickActions/events.ts src/app/events/claudianEvents.ts tests/unit/features/quickActions/events.test.ts
git commit -m "feat(quickActions): add vaultSkill.changed event to ClaudianEventMap"
```

---

## Task 2: Extend `VaultSkillSource` and `VaultSkillAggregatorOptions`

**Files:**
- Modify: `src/features/quickActions/skills/types.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts` (at the end of the existing `describe`):

```ts
  it('exposes streaming + cached + invalidate + dispose contract', () => {
    const agg = new VaultSkillAggregator(() => []);
    expect(typeof agg.listAll).toBe('function');
    expect(typeof agg.listCachedNow).toBe('function');
    expect(typeof agg.listAllStreaming).toBe('function');
    expect(typeof agg.invalidate).toBe('function');
    expect(typeof agg.dispose).toBe('function');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts -t "exposes streaming"`
Expected: FAIL — methods undefined.

- [ ] **Step 3: Extend type contracts (interface only — methods stubbed in Task 3)**

Edit `src/features/quickActions/skills/types.ts` — replace the existing `VaultSkillSource` interface and add new option fields:

```ts
import type { EventBus } from '../../../core/events/EventBus';
import type { ClaudianEventMap } from '../../../app/events/claudianEvents';
import type { Logger } from '../../../core/logging/Logger';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderId } from '../../../core/providers/types';

export interface SkillTabEntry {
  id: string;
  providerId: ProviderId;
  providerDisplayName: string;
  name: string;
  description: string;
  insertPrefix: '/' | '$';
  sourceFilePath: string | null;
  providerEnabled: boolean;
}

export interface ProviderRecord {
  providerId: ProviderId;
  displayName: string;
  isEnabled: boolean;
  commandCatalog: ProviderCommandCatalog;
}

/**
 * Read API consumed by `SkillsTabRenderer`.
 *
 * - `listAll`: full async fetch (cache-aware). Existing callers keep working.
 * - `listCachedNow`: synchronous, returns whatever is currently in the
 *   in-memory cache; empty if cold. Used for instant Phase-A paint.
 * - `listAllStreaming`: walks providers concurrently, fires `onProviderResolved`
 *   per provider as its fetch settles. Used for Phase-B refresh.
 * - `invalidate`: drop one bucket (with providerId) or all (without).
 * - `dispose`: unsubscribe EventBus, clear caches, flush pending persist.
 */
export interface VaultSkillSource {
  listAll(): Promise<SkillTabEntry[]>;
  listCachedNow(): SkillTabEntry[];
  listAllStreaming(
    onProviderResolved: (providerId: ProviderId, entries: SkillTabEntry[]) => void,
  ): Promise<void>;
  invalidate(providerId?: ProviderId): void;
  dispose(): void;
}

export interface VaultSkillAggregatorOptions {
  logger?: Logger;
  /** Defaults to 60_000 ms. */
  ttlMs?: number;
  /** When supplied, aggregator subscribes to `vaultSkill.changed`. */
  eventBus?: EventBus<ClaudianEventMap>;
  /** When supplied, aggregator hydrates from / persists to this adapter. */
  cacheAdapter?: VaultFileAdapter;
  /** Defaults to `.claudian/cache/skill-index.json`. */
  cachePath?: string;
  /** Clock injection for deterministic tests. Defaults to `Date.now`. */
  nowMs?: () => number;
}
```

- [ ] **Step 4: Stub the four new methods on `VaultSkillAggregator`**

Edit `src/features/quickActions/skills/VaultSkillAggregator.ts` — add stubs (real implementations come in later tasks):

```ts
  listCachedNow(): SkillTabEntry[] {
    return [];
  }

  async listAllStreaming(
    _onProviderResolved: (providerId: ProviderId, entries: SkillTabEntry[]) => void,
  ): Promise<void> {
    // Implementation in Task 8
  }

  invalidate(_providerId?: ProviderId): void {
    // Implementation in Task 5
  }

  dispose(): void {
    // Implementation in Task 5
  }
```

Also import `ProviderId` and `SkillTabEntry` at the top of the file.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts`
Expected: existing tests still PASS, new contract test PASSES.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/quickActions/skills/types.ts src/features/quickActions/skills/VaultSkillAggregator.ts tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts
git commit -m "feat(quickActions): extend VaultSkillSource contract with streaming + cache methods"
```

---

## Task 3: Per-provider TTL cache in `VaultSkillAggregator`

**Files:**
- Modify: `src/features/quickActions/skills/VaultSkillAggregator.ts`
- Modify: `tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `VaultSkillAggregator.test.ts`:

```ts
  it('caches per-provider listVaultEntries calls within TTL', async () => {
    const fetch = jest.fn().mockResolvedValue([makeSkillEntry({ id: 'skill-a', name: 'a' })]);
    const records = [makeRecord({ entries: fetch })];
    const agg = new VaultSkillAggregator(() => records, { ttlMs: 60_000 });

    await agg.listAll();
    await agg.listAll();
    await agg.listAll();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refetches after TTL expiry', async () => {
    let now = 1_000;
    const fetch = jest.fn().mockResolvedValue([makeSkillEntry({ id: 'skill-a', name: 'a' })]);
    const records = [makeRecord({ entries: fetch })];
    const agg = new VaultSkillAggregator(() => records, {
      ttlMs: 1_000,
      nowMs: () => now,
    });

    await agg.listAll();
    now += 500;
    await agg.listAll();
    now += 600;            // total elapsed 1100ms > ttl
    await agg.listAll();

    expect(fetch).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts -t "caches per-provider"`
Expected: FAIL — fetch called 3 times instead of 1.

- [ ] **Step 3: Add the TTL cache**

Edit `src/features/quickActions/skills/VaultSkillAggregator.ts` — full file replacement:

```ts
import type { Logger } from '../../../core/logging/Logger';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import type { ProviderId } from '../../../core/providers/types';
import type {
  ProviderRecord,
  SkillTabEntry,
  VaultSkillAggregatorOptions,
  VaultSkillSource,
} from './types';

interface CachedBucket {
  entries: ProviderCommandEntry[];
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60_000;

export class VaultSkillAggregator implements VaultSkillSource {
  private readonly logger?: Logger;
  private readonly ttlMs: number;
  private readonly nowMs: () => number;
  private readonly cache = new Map<ProviderId, CachedBucket>();

  constructor(
    private getProviderRecords: () => ProviderRecord[],
    options: VaultSkillAggregatorOptions = {},
  ) {
    this.logger = options.logger?.scope('quickActions');
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.nowMs = options.nowMs ?? Date.now;
  }

  async listAll(): Promise<SkillTabEntry[]> {
    const records = this.getProviderRecords();
    const buckets = await Promise.all(
      records.map((r) => this.fetchBucket(r).then((raw) => this.mapBucket(raw, r))),
    );
    return buckets.flat();
  }

  listCachedNow(): SkillTabEntry[] {
    return [];
  }

  async listAllStreaming(
    _onProviderResolved: (providerId: ProviderId, entries: SkillTabEntry[]) => void,
  ): Promise<void> {
    // Implementation in Task 8
  }

  invalidate(_providerId?: ProviderId): void {
    // Implementation in Task 5
  }

  dispose(): void {
    // Implementation in Task 5
  }

  /** Returns the raw cached or freshly-fetched provider entries (skill kind). */
  private async fetchBucket(record: ProviderRecord): Promise<ProviderCommandEntry[]> {
    const now = this.nowMs();
    const cached = this.cache.get(record.providerId);
    if (cached && cached.expiresAt > now) {
      return cached.entries;
    }
    try {
      const all = await record.commandCatalog.listVaultEntries();
      const raw = all.filter((e) => e.kind === 'skill');
      this.cache.set(record.providerId, {
        entries: raw,
        expiresAt: now + this.ttlMs,
      });
      return raw;
    } catch (err) {
      this.logger?.warn('vault skill aggregation failed', {
        providerId: record.providerId,
        err,
      });
      // Cache empty so we don't thrash retries within TTL
      this.cache.set(record.providerId, {
        entries: [],
        expiresAt: now + this.ttlMs,
      });
      return [];
    }
  }

  private mapBucket(
    raw: ProviderCommandEntry[],
    record: ProviderRecord,
  ): SkillTabEntry[] {
    return raw
      .map((e) => this.mapEntry(e, record))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private mapEntry(
    entry: ProviderCommandEntry,
    record: ProviderRecord,
  ): SkillTabEntry {
    const prefix = entry.insertPrefix === '$' ? '$' : '/';
    return {
      id: `${record.providerId}:${entry.id}`,
      providerId: record.providerId,
      providerDisplayName: record.displayName,
      name: entry.name,
      description: entry.description ?? '',
      insertPrefix: prefix,
      sourceFilePath: entry.sourceFilePath ?? null,
      providerEnabled: record.isEnabled,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts`
Expected: all existing tests still PASS, both new TTL tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/skills/VaultSkillAggregator.ts tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts
git commit -m "feat(quickActions): per-provider TTL cache in VaultSkillAggregator"
```

---

## Task 4: Re-tag `providerEnabled` from current records on cache hit

**Files:**
- Modify: `tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
  it('reflects current providerEnabled on cache hit (no refetch needed)', async () => {
    const fetch = jest.fn().mockResolvedValue([makeSkillEntry({ id: 'skill-a', name: 'a' })]);
    let enabled = true;
    const recordsFactory = () => [
      makeRecord({
        entries: fetch,
        get isEnabled() {
          return enabled;
        },
      } as never),
    ];
    const agg = new VaultSkillAggregator(recordsFactory, { ttlMs: 60_000 });

    const [first] = await agg.listAll();
    expect(first.providerEnabled).toBe(true);

    enabled = false;
    const [second] = await agg.listAll();
    expect(second.providerEnabled).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);   // bucket reused
  });
```

- [ ] **Step 2: Run test to verify it fails or already passes**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts -t "reflects current providerEnabled"`
Expected: PASS (Task 3 already maps on every `listAll`). If it fails, the cache is mistakenly storing mapped entries — fix.

- [ ] **Step 3: If passed, no implementation change needed. If failed, fix by ensuring `cache` stores `ProviderCommandEntry[]` not `SkillTabEntry[]`.**

(Task 3 already does this — confirm visually that `CachedBucket.entries` is `ProviderCommandEntry[]`, and `mapBucket` is called on every `listAll`.)

- [ ] **Step 4: Commit (test-only addition)**

```bash
git add tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts
git commit -m "test(quickActions): assert providerEnabled re-tag on cache hit"
```

---

## Task 5: `invalidate()`, EventBus subscription, and `dispose()`

**Files:**
- Modify: `src/features/quickActions/skills/VaultSkillAggregator.ts`
- Modify: `tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
  it('invalidate(providerId) clears only that bucket', async () => {
    const fetchA = jest.fn().mockResolvedValue([makeSkillEntry({ id: 'a', name: 'a' })]);
    const fetchB = jest.fn().mockResolvedValue([
      makeSkillEntry({ id: 'b', name: 'b', providerId: 'codex', insertPrefix: '$' }),
    ]);
    const records = [
      makeRecord({ providerId: 'claude', entries: fetchA }),
      makeRecord({ providerId: 'codex', displayName: 'Codex', entries: fetchB }),
    ];
    const agg = new VaultSkillAggregator(() => records, { ttlMs: 60_000 });
    await agg.listAll();
    expect(fetchA).toHaveBeenCalledTimes(1);
    expect(fetchB).toHaveBeenCalledTimes(1);

    agg.invalidate('claude');
    await agg.listAll();
    expect(fetchA).toHaveBeenCalledTimes(2);
    expect(fetchB).toHaveBeenCalledTimes(1);
  });

  it('invalidate() with no arg clears all buckets', async () => {
    const fetch = jest.fn().mockResolvedValue([makeSkillEntry({ id: 'a', name: 'a' })]);
    const records = [makeRecord({ entries: fetch })];
    const agg = new VaultSkillAggregator(() => records, { ttlMs: 60_000 });
    await agg.listAll();
    agg.invalidate();
    await agg.listAll();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('subscribes to EventBus vaultSkill.changed and invalidates the matching provider', async () => {
    const { EventBus } = await import('@/core/events/EventBus');
    const bus = new EventBus<{ 'vaultSkill.changed': { providerId: 'claude' | 'codex' } }>();
    const fetch = jest.fn().mockResolvedValue([makeSkillEntry({ id: 'a', name: 'a' })]);
    const records = [makeRecord({ providerId: 'claude', entries: fetch })];
    const agg = new VaultSkillAggregator(() => records, {
      ttlMs: 60_000,
      eventBus: bus as never,
    });

    await agg.listAll();
    expect(fetch).toHaveBeenCalledTimes(1);

    bus.emit('vaultSkill.changed', { providerId: 'claude' });
    await agg.listAll();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('dispose() unsubscribes EventBus and clears caches', async () => {
    const { EventBus } = await import('@/core/events/EventBus');
    const bus = new EventBus<{ 'vaultSkill.changed': { providerId: 'claude' | 'codex' } }>();
    const fetch = jest.fn().mockResolvedValue([makeSkillEntry({ id: 'a', name: 'a' })]);
    const records = [makeRecord({ providerId: 'claude', entries: fetch })];
    const agg = new VaultSkillAggregator(() => records, {
      ttlMs: 60_000,
      eventBus: bus as never,
    });

    await agg.listAll();
    agg.dispose();

    // After dispose, emit should not invalidate (cache cleared anyway, but
    // event handler must be unregistered to prevent late re-entry)
    bus.emit('vaultSkill.changed', { providerId: 'claude' });

    // Cache cleared by dispose, so this refetches
    await agg.listAll();
    expect(fetch).toHaveBeenCalledTimes(2);
    // No double-invalidate from a stale handler
    await agg.listAll();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts -t "invalidate"`
Expected: FAIL — stubs don't clear cache.

- [ ] **Step 3: Implement `invalidate`, EventBus subscription, and `dispose`**

Edit `src/features/quickActions/skills/VaultSkillAggregator.ts` — add fields and replace stub methods:

```ts
  private readonly eventBusUnsubscribe?: () => void;

  // In constructor (after this.nowMs assignment):
  if (options.eventBus) {
    this.eventBusUnsubscribe = options.eventBus.on(
      'vaultSkill.changed',
      ({ providerId }) => this.invalidate(providerId),
    );
  }

  // Replace stubs:
  invalidate(providerId?: ProviderId): void {
    if (providerId === undefined) {
      this.cache.clear();
    } else {
      this.cache.delete(providerId);
    }
  }

  dispose(): void {
    this.eventBusUnsubscribe?.();
    this.cache.clear();
  }
```

Make `eventBusUnsubscribe` a mutable field (drop `readonly` if TS complains about conditional init, or assign via local then assign field):

```ts
  private eventBusUnsubscribe: (() => void) | undefined;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/skills/VaultSkillAggregator.ts tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts
git commit -m "feat(quickActions): EventBus-driven invalidation in VaultSkillAggregator"
```

---

## Task 6: In-flight fetch deduplication

**Files:**
- Modify: `src/features/quickActions/skills/VaultSkillAggregator.ts`
- Modify: `tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts`

- [ ] **Step 1: Write failing test**

Append:

```ts
  it('deduplicates concurrent fetches per provider', async () => {
    let resolveFn: (v: ProviderCommandEntry[]) => void = () => {};
    const pending = new Promise<ProviderCommandEntry[]>((r) => { resolveFn = r; });
    const fetch = jest.fn().mockReturnValue(pending);
    const records = [makeRecord({ entries: fetch })];
    const agg = new VaultSkillAggregator(() => records, { ttlMs: 60_000 });

    const p1 = agg.listAll();
    const p2 = agg.listAll();
    const p3 = agg.listAll();
    resolveFn([makeSkillEntry({ id: 'a', name: 'a' })]);
    await Promise.all([p1, p2, p3]);

    expect(fetch).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts -t "deduplicates concurrent"`
Expected: FAIL — fetch called 3 times.

- [ ] **Step 3: Add in-flight map to aggregator**

Edit `src/features/quickActions/skills/VaultSkillAggregator.ts`:

```ts
  private readonly inFlight = new Map<ProviderId, Promise<ProviderCommandEntry[]>>();

  // Replace fetchBucket with:
  private fetchBucket(record: ProviderRecord): Promise<ProviderCommandEntry[]> {
    const now = this.nowMs();
    const cached = this.cache.get(record.providerId);
    if (cached && cached.expiresAt > now) {
      return Promise.resolve(cached.entries);
    }
    const existing = this.inFlight.get(record.providerId);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const all = await record.commandCatalog.listVaultEntries();
        const raw = all.filter((e) => e.kind === 'skill');
        this.cache.set(record.providerId, {
          entries: raw,
          expiresAt: this.nowMs() + this.ttlMs,
        });
        return raw;
      } catch (err) {
        this.logger?.warn('vault skill aggregation failed', {
          providerId: record.providerId,
          err,
        });
        this.cache.set(record.providerId, {
          entries: [],
          expiresAt: this.nowMs() + this.ttlMs,
        });
        return [];
      } finally {
        this.inFlight.delete(record.providerId);
      }
    })();
    this.inFlight.set(record.providerId, promise);
    return promise;
  }
```

Also clear `inFlight` in `dispose()`:

```ts
  dispose(): void {
    this.eventBusUnsubscribe?.();
    this.cache.clear();
    this.inFlight.clear();
  }
```

And clear matching entries in `invalidate()`:

```ts
  invalidate(providerId?: ProviderId): void {
    if (providerId === undefined) {
      this.cache.clear();
      this.inFlight.clear();
    } else {
      this.cache.delete(providerId);
      this.inFlight.delete(providerId);
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/skills/VaultSkillAggregator.ts tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts
git commit -m "feat(quickActions): deduplicate concurrent per-provider fetches"
```

---

## Task 7: `listCachedNow()` synchronous reader

**Files:**
- Modify: `src/features/quickActions/skills/VaultSkillAggregator.ts`
- Modify: `tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts`

- [ ] **Step 1: Write failing test**

Append:

```ts
  it('listCachedNow returns empty before any fetch', () => {
    const agg = new VaultSkillAggregator(() => []);
    expect(agg.listCachedNow()).toEqual([]);
  });

  it('listCachedNow returns SkillTabEntry[] from in-memory cache after fetch', async () => {
    const records = [
      makeRecord({
        entries: [
          makeSkillEntry({ id: 'skill-z', name: 'z' }),
          makeSkillEntry({ id: 'skill-a', name: 'a' }),
        ],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records, { ttlMs: 60_000 });
    await agg.listAll();
    const cached = agg.listCachedNow();
    expect(cached.map((e) => e.name)).toEqual(['a', 'z']);
  });

  it('listCachedNow returns cached entries even after TTL expiry', async () => {
    let now = 1_000;
    const records = [
      makeRecord({ entries: [makeSkillEntry({ id: 'skill-a', name: 'a' })] }),
    ];
    const agg = new VaultSkillAggregator(() => records, {
      ttlMs: 100,
      nowMs: () => now,
    });
    await agg.listAll();
    now += 5_000;
    expect(agg.listCachedNow().map((e) => e.name)).toEqual(['a']);
  });

  it('listCachedNow re-tags providerEnabled from current records', async () => {
    let enabled = true;
    const recordsFactory = () => [
      makeRecord({
        entries: [makeSkillEntry({ id: 'skill-a', name: 'a' })],
        get isEnabled() { return enabled; },
      } as never),
    ];
    const agg = new VaultSkillAggregator(recordsFactory, { ttlMs: 60_000 });
    await agg.listAll();
    enabled = false;
    const [entry] = agg.listCachedNow();
    expect(entry.providerEnabled).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts -t "listCachedNow"`
Expected: FAIL — stub returns [].

- [ ] **Step 3: Implement `listCachedNow`**

Edit `src/features/quickActions/skills/VaultSkillAggregator.ts` — replace stub:

```ts
  listCachedNow(): SkillTabEntry[] {
    const records = this.getProviderRecords();
    const out: SkillTabEntry[] = [];
    for (const record of records) {
      const cached = this.cache.get(record.providerId);
      if (!cached) continue;
      out.push(...this.mapBucket(cached.entries, record));
    }
    return out;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/skills/VaultSkillAggregator.ts tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts
git commit -m "feat(quickActions): listCachedNow() synchronous cached reader"
```

---

## Task 8: `listAllStreaming()` per-provider streaming API

**Files:**
- Modify: `src/features/quickActions/skills/VaultSkillAggregator.ts`
- Modify: `tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
  it('listAllStreaming fires callback once per provider in resolution order', async () => {
    let resolveFast: (v: ProviderCommandEntry[]) => void = () => {};
    let resolveSlow: (v: ProviderCommandEntry[]) => void = () => {};
    const fast = new Promise<ProviderCommandEntry[]>((r) => { resolveFast = r; });
    const slow = new Promise<ProviderCommandEntry[]>((r) => { resolveSlow = r; });
    const records = [
      makeRecord({ providerId: 'claude', entries: () => slow }),
      makeRecord({ providerId: 'codex', displayName: 'Codex', entries: () => fast }),
    ];
    const agg = new VaultSkillAggregator(() => records, { ttlMs: 60_000 });

    const seen: string[] = [];
    const done = agg.listAllStreaming((providerId) => { seen.push(providerId); });

    resolveFast([makeSkillEntry({ id: 'codex-x', name: 'x', providerId: 'codex', insertPrefix: '$' })]);
    resolveSlow([makeSkillEntry({ id: 'skill-y', name: 'y' })]);

    await done;
    expect(seen).toEqual(['codex', 'claude']);
  });

  it('listAllStreaming resolves after every provider settles', async () => {
    const records = [
      makeRecord({ entries: [makeSkillEntry({ id: 'a', name: 'a' })] }),
      makeRecord({
        providerId: 'codex',
        displayName: 'Codex',
        entries: [makeSkillEntry({ id: 'b', name: 'b', providerId: 'codex', insertPrefix: '$' })],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records, { ttlMs: 60_000 });
    const seen: string[] = [];
    await agg.listAllStreaming((p) => { seen.push(p); });
    expect(new Set(seen)).toEqual(new Set(['claude', 'codex']));
  });

  it('listAllStreaming callback receives sorted SkillTabEntry[] for that provider', async () => {
    const records = [
      makeRecord({
        entries: [
          makeSkillEntry({ id: 'skill-z', name: 'z' }),
          makeSkillEntry({ id: 'skill-a', name: 'a' }),
        ],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records, { ttlMs: 60_000 });
    let received: SkillTabEntry[] = [];
    await agg.listAllStreaming((_id, entries) => { received = entries; });
    expect(received.map((e) => e.name)).toEqual(['a', 'z']);
  });

  it('listAllStreaming still fires for a provider whose fetch throws (empty entries)', async () => {
    const records = [
      makeRecord({
        providerId: 'claude',
        entries: () => Promise.reject(new Error('boom')),
      }),
    ];
    const agg = new VaultSkillAggregator(() => records, { ttlMs: 60_000 });
    const seen: Array<{ p: string; n: number }> = [];
    await agg.listAllStreaming((p, e) => { seen.push({ p, n: e.length }); });
    expect(seen).toEqual([{ p: 'claude', n: 0 }]);
  });
```

Also add `SkillTabEntry` to top imports of the test file if not present (it's already imported indirectly via the contract test in Task 2 — confirm and add if missing).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts -t "listAllStreaming"`
Expected: FAIL — stub does nothing.

- [ ] **Step 3: Implement `listAllStreaming`**

Edit `src/features/quickActions/skills/VaultSkillAggregator.ts` — replace stub:

```ts
  async listAllStreaming(
    onProviderResolved: (providerId: ProviderId, entries: SkillTabEntry[]) => void,
  ): Promise<void> {
    const records = this.getProviderRecords();
    await Promise.all(
      records.map(async (r) => {
        const raw = await this.fetchBucket(r);
        try {
          onProviderResolved(r.providerId, this.mapBucket(raw, r));
        } catch (err) {
          this.logger?.warn('skill stream callback threw', {
            providerId: r.providerId,
            err,
          });
        }
      }),
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/skills/VaultSkillAggregator.ts tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts
git commit -m "feat(quickActions): listAllStreaming for per-provider Phase-B refresh"
```

---

## Task 9: Disk-index persistence helper module

**Files:**
- Create: `src/features/quickActions/skills/skillIndexPersistence.ts`
- Create: `tests/unit/features/quickActions/skills/skillIndexPersistence.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/features/quickActions/skills/skillIndexPersistence.test.ts`:

```ts
import type { ProviderCommandEntry } from '@/core/providers/commands/ProviderCommandEntry';
import type { ProviderId } from '@/core/providers/types';
import {
  PERSISTED_SCHEMA_VERSION,
  parsePersistedSkillIndex,
  serializePersistedSkillIndex,
} from '@/features/quickActions/skills/skillIndexPersistence';

function entry(overrides: Partial<ProviderCommandEntry> = {}): ProviderCommandEntry {
  return {
    id: 'skill-a',
    providerId: 'claude',
    kind: 'skill',
    name: 'a',
    description: 'd',
    content: 'long body here',
    scope: 'vault',
    source: 'user',
    isEditable: true,
    isDeletable: true,
    displayPrefix: '/',
    insertPrefix: '/',
    sourceFilePath: '.claude/skills/a/SKILL.md',
    ...overrides,
  };
}

describe('skillIndexPersistence', () => {
  it('serializes buckets with content stripped', () => {
    const buckets = new Map<ProviderId, ProviderCommandEntry[]>([
      ['claude', [entry({ content: 'should be stripped' })]],
    ]);
    const json = serializePersistedSkillIndex(buckets, 1_700_000_000_000);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(PERSISTED_SCHEMA_VERSION);
    expect(parsed.writtenAt).toBe(1_700_000_000_000);
    expect(parsed.buckets.claude[0].content).toBe('');
  });

  it('round-trips via parse', () => {
    const original = new Map<ProviderId, ProviderCommandEntry[]>([
      ['codex', [entry({ providerId: 'codex', insertPrefix: '$' })]],
    ]);
    const json = serializePersistedSkillIndex(original, 1);
    const out = parsePersistedSkillIndex(json);
    expect(out).not.toBeNull();
    expect(out!.get('codex')?.[0].name).toBe('a');
  });

  it('returns null on malformed JSON', () => {
    expect(parsePersistedSkillIndex('not-json')).toBeNull();
  });

  it('returns null on schema mismatch', () => {
    const json = JSON.stringify({
      schemaVersion: 999,
      writtenAt: 0,
      buckets: { claude: [] },
    });
    expect(parsePersistedSkillIndex(json)).toBeNull();
  });

  it('returns null on missing buckets field', () => {
    const json = JSON.stringify({
      schemaVersion: PERSISTED_SCHEMA_VERSION,
      writtenAt: 0,
    });
    expect(parsePersistedSkillIndex(json)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/skills/skillIndexPersistence.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create the helper module**

Create `src/features/quickActions/skills/skillIndexPersistence.ts`:

```ts
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import type { ProviderId } from '../../../core/providers/types';

export const PERSISTED_SCHEMA_VERSION = 1;

interface PersistedShape {
  schemaVersion: number;
  writtenAt: number;
  buckets: Record<string, ProviderCommandEntry[]>;
}

/**
 * Serializes the in-memory per-provider buckets to a JSON string for
 * `.claudian/cache/skill-index.json`. Skill bodies (`content`) are stripped
 * before write — they are large and the Skills tab only renders metadata.
 * `runVaultSkill` re-reads the actual `SKILL.md` at execution time anyway.
 */
export function serializePersistedSkillIndex(
  buckets: Map<ProviderId, ProviderCommandEntry[]>,
  writtenAt: number,
): string {
  const out: PersistedShape = {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    writtenAt,
    buckets: {},
  };
  for (const [providerId, entries] of buckets) {
    out.buckets[providerId] = entries.map((e) => ({ ...e, content: '' }));
  }
  return JSON.stringify(out);
}

/**
 * Returns the deserialized per-provider buckets, or `null` if the JSON is
 * malformed, the schema version does not match, or required fields are
 * missing. Callers treat `null` as "cold cache" and continue normally.
 */
export function parsePersistedSkillIndex(
  raw: string,
): Map<ProviderId, ProviderCommandEntry[]> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const shape = parsed as Partial<PersistedShape>;
  if (shape.schemaVersion !== PERSISTED_SCHEMA_VERSION) return null;
  if (!shape.buckets || typeof shape.buckets !== 'object') return null;

  const out = new Map<ProviderId, ProviderCommandEntry[]>();
  for (const [providerId, entries] of Object.entries(shape.buckets)) {
    if (!Array.isArray(entries)) continue;
    out.set(providerId as ProviderId, entries as ProviderCommandEntry[]);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/skills/skillIndexPersistence.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/skills/skillIndexPersistence.ts tests/unit/features/quickActions/skills/skillIndexPersistence.test.ts
git commit -m "feat(quickActions): persisted skill-index serialization helper"
```

---

## Task 10: Wire hydrate/persist into `VaultSkillAggregator`

**Files:**
- Modify: `src/features/quickActions/skills/VaultSkillAggregator.ts`
- Modify: `tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `VaultSkillAggregator.test.ts`:

```ts
  it('hydrate() populates cache from a stubbed adapter so listCachedNow returns entries before any fetch', async () => {
    const stored = JSON.stringify({
      schemaVersion: 1,
      writtenAt: 1,
      buckets: {
        claude: [
          {
            id: 'skill-hydrated',
            providerId: 'claude',
            kind: 'skill',
            name: 'hydrated',
            description: 'from disk',
            content: '',
            scope: 'vault',
            source: 'user',
            isEditable: true,
            isDeletable: true,
            displayPrefix: '/',
            insertPrefix: '/',
            sourceFilePath: '.claude/skills/hydrated/SKILL.md',
          },
        ],
      },
    });
    const adapter = {
      exists: jest.fn().mockResolvedValue(true),
      read: jest.fn().mockResolvedValue(stored),
      write: jest.fn().mockResolvedValue(undefined),
    };
    const fetch = jest.fn().mockResolvedValue([]);
    const records = [makeRecord({ entries: fetch })];
    const agg = new VaultSkillAggregator(() => records, {
      ttlMs: 60_000,
      cacheAdapter: adapter as never,
      cachePath: '.claudian/cache/skill-index.json',
    });
    await agg.hydrate();
    expect(adapter.read).toHaveBeenCalledWith('.claudian/cache/skill-index.json');
    expect(agg.listCachedNow().map((e) => e.name)).toEqual(['hydrated']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('hydrate() no-ops when cache file missing', async () => {
    const adapter = {
      exists: jest.fn().mockResolvedValue(false),
      read: jest.fn(),
      write: jest.fn(),
    };
    const agg = new VaultSkillAggregator(() => [], {
      cacheAdapter: adapter as never,
    });
    await agg.hydrate();
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it('hydrate() ignores malformed JSON and logs a warn', async () => {
    const warn = jest.fn();
    const logger = { scope: jest.fn().mockReturnValue({ warn }) };
    const adapter = {
      exists: jest.fn().mockResolvedValue(true),
      read: jest.fn().mockResolvedValue('not json'),
      write: jest.fn(),
    };
    const agg = new VaultSkillAggregator(() => [], {
      cacheAdapter: adapter as never,
      logger: logger as never,
    });
    await agg.hydrate();
    expect(warn).toHaveBeenCalled();
  });

  it('persists to disk after a successful fetch (debounced)', async () => {
    jest.useFakeTimers();
    const adapter = {
      exists: jest.fn().mockResolvedValue(false),
      read: jest.fn(),
      write: jest.fn().mockResolvedValue(undefined),
    };
    const records = [makeRecord({ entries: [makeSkillEntry({ id: 'a', name: 'a' })] })];
    const agg = new VaultSkillAggregator(() => records, {
      ttlMs: 60_000,
      cacheAdapter: adapter as never,
      cachePath: '.claudian/cache/skill-index.json',
    });
    await agg.listAll();
    expect(adapter.write).not.toHaveBeenCalled();    // debounce pending
    jest.advanceTimersByTime(1100);
    await Promise.resolve();                          // flush microtasks
    await Promise.resolve();
    expect(adapter.write).toHaveBeenCalledTimes(1);
    const [path, body] = adapter.write.mock.calls[0];
    expect(path).toBe('.claudian/cache/skill-index.json');
    expect(JSON.parse(body).buckets.claude[0].name).toBe('a');
    jest.useRealTimers();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts -t "hydrate|persists"`
Expected: FAIL — `hydrate` not a function; no writes.

- [ ] **Step 3: Implement hydrate + debounced persist**

Edit `src/features/quickActions/skills/VaultSkillAggregator.ts`:

Add imports at top:

```ts
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import {
  parsePersistedSkillIndex,
  serializePersistedSkillIndex,
} from './skillIndexPersistence';
```

Add fields:

```ts
  private readonly cacheAdapter?: VaultFileAdapter;
  private readonly cachePath: string;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly PERSIST_DEBOUNCE_MS = 1_000;
  private static readonly DEFAULT_CACHE_PATH = '.claudian/cache/skill-index.json';
```

In constructor (after existing assignments):

```ts
    this.cacheAdapter = options.cacheAdapter;
    this.cachePath = options.cachePath ?? VaultSkillAggregator.DEFAULT_CACHE_PATH;
```

Add `hydrate` method:

```ts
  async hydrate(): Promise<void> {
    if (!this.cacheAdapter) return;
    try {
      if (!(await this.cacheAdapter.exists(this.cachePath))) return;
      const raw = await this.cacheAdapter.read(this.cachePath);
      const buckets = parsePersistedSkillIndex(raw);
      if (!buckets) {
        this.logger?.warn('skill index hydrate skipped: malformed or schema mismatch');
        return;
      }
      const expiresAt = this.nowMs() + this.ttlMs;
      for (const [providerId, entries] of buckets) {
        this.cache.set(providerId, { entries, expiresAt });
      }
    } catch (err) {
      this.logger?.warn('skill index hydrate failed', { err });
    }
  }
```

Update `fetchBucket` — schedule persist on every successful real fetch:

After `this.cache.set(...)` for both the success and the catch branches, add:

```ts
        this.schedulePersist();
```

Add `schedulePersist` and `flushPersist`:

```ts
  private schedulePersist(): void {
    if (!this.cacheAdapter) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.flushPersist();
    }, VaultSkillAggregator.PERSIST_DEBOUNCE_MS);
  }

  private async flushPersist(): Promise<void> {
    if (!this.cacheAdapter) return;
    const buckets = new Map<ProviderId, ProviderCommandEntry[]>();
    for (const [providerId, bucket] of this.cache) {
      buckets.set(providerId, bucket.entries);
    }
    const body = serializePersistedSkillIndex(buckets, this.nowMs());
    try {
      await this.cacheAdapter.write(this.cachePath, body);
    } catch (err) {
      this.logger?.warn('skill index persist failed', { err });
    }
  }
```

Update `dispose` to flush sync-ish (best-effort):

```ts
  dispose(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
      void this.flushPersist();   // fire and forget; plugin is unloading
    }
    this.eventBusUnsubscribe?.();
    this.cache.clear();
    this.inFlight.clear();
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --selectProjects unit -- tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/skills/VaultSkillAggregator.ts tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts
git commit -m "feat(quickActions): persist skill index to .claudian/cache/skill-index.json"
```

---

## Task 11: Parallelize `SkillStorage.loadAll`

**Files:**
- Modify: `src/providers/claude/storage/SkillStorage.ts`
- Create: `tests/unit/providers/claude/storage/SkillStorage.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/providers/claude/storage/SkillStorage.test.ts`:

```ts
import { SkillStorage } from '@/providers/claude/storage/SkillStorage';

function makeAdapter(map: Record<string, string>) {
  return {
    listFolders: jest.fn().mockResolvedValue(Object.keys(map).map((k) => `.claude/skills/${k}`)),
    exists: jest.fn().mockImplementation((p: string) => Promise.resolve(p in map || p.replace('/SKILL.md', '').split('/').pop()! in map)),
    read: jest.fn().mockImplementation((p: string) => {
      const name = p.replace('/SKILL.md', '').split('/').pop()!;
      const body = map[name];
      if (body === undefined) throw new Error(`missing ${p}`);
      return Promise.resolve(body);
    }),
  } as never;
}

describe('SkillStorage.loadAll', () => {
  it('returns one LoadedSkill per SKILL.md folder', async () => {
    const adapter = makeAdapter({
      tdd: '---\ndescription: TDD skill\n---\nbody',
      review: '---\ndescription: Review skill\n---\nbody',
    });
    const storage = new SkillStorage(adapter);
    const result = await storage.loadAll();
    expect(result.map((s) => s.skill.name).sort()).toEqual(['review', 'tdd']);
  });

  it('runs file reads in parallel', async () => {
    const order: string[] = [];
    const adapter = {
      listFolders: jest.fn().mockResolvedValue(['.claude/skills/a', '.claude/skills/b', '.claude/skills/c']),
      exists: jest.fn().mockResolvedValue(true),
      read: jest.fn().mockImplementation(async (p: string) => {
        order.push(`start:${p}`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`end:${p}`);
        return '---\ndescription: x\n---\n';
      }),
    } as never;
    const storage = new SkillStorage(adapter);
    await storage.loadAll();
    // Parallel: all "start" entries appear before any "end"
    const startCount = order.findIndex((e) => e.startsWith('end:'));
    expect(order.slice(0, startCount).every((e) => e.startsWith('start:'))).toBe(true);
  });

  it('skips folders without a SKILL.md without throwing', async () => {
    const adapter = {
      listFolders: jest.fn().mockResolvedValue(['.claude/skills/a', '.claude/skills/orphan']),
      exists: jest.fn().mockImplementation((p: string) => Promise.resolve(p.endsWith('/a/SKILL.md'))),
      read: jest.fn().mockResolvedValue('---\ndescription: a\n---\n'),
    } as never;
    const storage = new SkillStorage(adapter);
    const result = await storage.loadAll();
    expect(result.map((s) => s.skill.name)).toEqual(['a']);
  });

  it('returns [] when root listing throws', async () => {
    const adapter = {
      listFolders: jest.fn().mockRejectedValue(new Error('nope')),
      exists: jest.fn(),
      read: jest.fn(),
    } as never;
    const storage = new SkillStorage(adapter);
    expect(await storage.loadAll()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify the parallelism test fails**

Run: `npm test -- --selectProjects unit -- tests/unit/providers/claude/storage/SkillStorage.test.ts -t "runs file reads in parallel"`
Expected: FAIL — sequential `await` produces interleaved `start:end:start:end`.

- [ ] **Step 3: Parallelize `loadAll`**

Edit `src/providers/claude/storage/SkillStorage.ts` — replace `loadAll`:

```ts
  async loadAll(): Promise<LoadedSkill[]> {
    try {
      const folders = await this.adapter.listFolders(SKILLS_PATH);
      const results = await Promise.all(folders.map((f) => this.loadOne(f)));
      return results.filter((x): x is LoadedSkill => x !== null);
    } catch {
      return [];
    }
  }

  private async loadOne(folder: string): Promise<LoadedSkill | null> {
    const skillName = folder.split('/').pop()!;
    const skillPath = `${SKILLS_PATH}/${skillName}/SKILL.md`;
    try {
      if (!(await this.adapter.exists(skillPath))) return null;
      const content = await this.adapter.read(skillPath);
      const parsed = parseSlashCommandContent(content);
      return {
        skill: {
          ...parsedToSlashCommand(parsed, {
            id: `skill-${skillName}`,
            name: skillName,
            source: 'user',
          }),
          kind: 'skill',
        },
        filePath: skillPath,
      };
    } catch {
      return null;
    }
  }
```

- [ ] **Step 4: Run all SkillStorage tests**

Run: `npm test -- --selectProjects unit -- tests/unit/providers/claude/storage/SkillStorage.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/claude/storage/SkillStorage.ts tests/unit/providers/claude/storage/SkillStorage.test.ts
git commit -m "perf(claude): parallelize SkillStorage.loadAll for faster cold scan"
```

---

## Task 12: `ClaudeCommandCatalog` emits `vaultSkill.changed`

**Files:**
- Modify: `src/providers/claude/commands/ClaudeCommandCatalog.ts`
- Modify: `tests/unit/providers/claude/commands/ClaudeCommandCatalog.test.ts`

- [ ] **Step 1: Read the existing test for shape**

Run: `cat tests/unit/providers/claude/commands/ClaudeCommandCatalog.test.ts | head -40` to confirm the mock construction pattern; preserve it. (Skip if already familiar.)

- [ ] **Step 2: Write failing tests**

Append to `tests/unit/providers/claude/commands/ClaudeCommandCatalog.test.ts`:

```ts
import { EventBus } from '@/core/events/EventBus';
import type { ProviderCommandEntry } from '@/core/providers/commands/ProviderCommandEntry';

describe('ClaudeCommandCatalog EventBus emission', () => {
  function skillEntry(overrides: Partial<ProviderCommandEntry> = {}): ProviderCommandEntry {
    return {
      id: 'skill-x', providerId: 'claude', kind: 'skill',
      name: 'x', description: '', content: '',
      scope: 'vault', source: 'user',
      isEditable: true, isDeletable: true,
      displayPrefix: '/', insertPrefix: '/',
      ...overrides,
    };
  }
  function commandEntry(overrides: Partial<ProviderCommandEntry> = {}): ProviderCommandEntry {
    return { ...skillEntry({ id: 'cmd-x', kind: 'command' }), ...overrides };
  }
  function mkStorage() {
    return {
      loadAll: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    } as never;
  }

  it('emits vaultSkill.changed when a skill is saved', async () => {
    const bus = new EventBus<{ 'vaultSkill.changed': { providerId: 'claude' } }>();
    const events: Array<{ providerId: string }> = [];
    bus.on('vaultSkill.changed', (p) => { events.push(p); });
    const catalog = new (await import('@/providers/claude/commands/ClaudeCommandCatalog')).ClaudeCommandCatalog(
      mkStorage(), mkStorage(), undefined, bus as never,
    );
    await catalog.saveVaultEntry(skillEntry());
    expect(events).toEqual([{ providerId: 'claude' }]);
  });

  it('emits vaultSkill.changed when a skill is deleted', async () => {
    const bus = new EventBus<{ 'vaultSkill.changed': { providerId: 'claude' } }>();
    const events: Array<{ providerId: string }> = [];
    bus.on('vaultSkill.changed', (p) => { events.push(p); });
    const catalog = new (await import('@/providers/claude/commands/ClaudeCommandCatalog')).ClaudeCommandCatalog(
      mkStorage(), mkStorage(), undefined, bus as never,
    );
    await catalog.deleteVaultEntry(skillEntry());
    expect(events).toEqual([{ providerId: 'claude' }]);
  });

  it('does NOT emit when a non-skill command is saved or deleted', async () => {
    const bus = new EventBus<{ 'vaultSkill.changed': { providerId: 'claude' } }>();
    const events: unknown[] = [];
    bus.on('vaultSkill.changed', (p) => { events.push(p); });
    const catalog = new (await import('@/providers/claude/commands/ClaudeCommandCatalog')).ClaudeCommandCatalog(
      mkStorage(), mkStorage(), undefined, bus as never,
    );
    await catalog.saveVaultEntry(commandEntry());
    await catalog.deleteVaultEntry(commandEntry());
    expect(events).toEqual([]);
  });

  it('works without an EventBus (no throw)', async () => {
    const catalog = new (await import('@/providers/claude/commands/ClaudeCommandCatalog')).ClaudeCommandCatalog(
      mkStorage(), mkStorage(),
    );
    await expect(catalog.saveVaultEntry(skillEntry())).resolves.not.toThrow();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --selectProjects unit -- tests/unit/providers/claude/commands/ClaudeCommandCatalog.test.ts -t "EventBus emission"`
Expected: FAIL — constructor doesn't accept 4th arg / no emit.

- [ ] **Step 4: Wire EventBus into the catalog**

Edit `src/providers/claude/commands/ClaudeCommandCatalog.ts`:

Add imports:

```ts
import type { ClaudianEventMap } from '../../../app/events/claudianEvents';
import type { EventBus } from '../../../core/events/EventBus';
```

Extend constructor:

```ts
  constructor(
    private commandStorage: SlashCommandStorage,
    private skillStorage: SkillStorage,
    private probe?: CommandProbe,
    private eventBus?: EventBus<ClaudianEventMap>,
  ) {}
```

Update `saveVaultEntry`:

```ts
  async saveVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    const cmd = entryToSlashCommand(entry);
    if (entry.kind === 'skill') {
      await this.skillStorage.save(cmd);
      this.eventBus?.emit('vaultSkill.changed', { providerId: 'claude' });
    } else {
      await this.commandStorage.save(cmd);
    }
  }
```

Update `deleteVaultEntry`:

```ts
  async deleteVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    if (entry.kind === 'skill') {
      await this.skillStorage.delete(entry.id);
      this.eventBus?.emit('vaultSkill.changed', { providerId: 'claude' });
    } else {
      await this.commandStorage.delete(entry.id);
    }
  }
```

- [ ] **Step 5: Update construction site to pass the bus**

Run: `grep -rn "new ClaudeCommandCatalog" src/` to find all construction sites. Update each to pass `plugin.events` as the 4th argument. Expected sites: `src/providers/claude/runtime/` factories and `src/providers/claude/ClaudeProviderModule.ts` (or similar).

For each found site:

```ts
new ClaudeCommandCatalog(
  commandStorage,
  skillStorage,
  probe,
  plugin.events,
);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --selectProjects unit -- tests/unit/providers/claude/commands/ClaudeCommandCatalog.test.ts`
Expected: all PASS.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/providers/claude/commands/ClaudeCommandCatalog.ts tests/unit/providers/claude/commands/ClaudeCommandCatalog.test.ts $(grep -rl "new ClaudeCommandCatalog" src/ | tr '\n' ' ')
git commit -m "feat(claude): emit vaultSkill.changed on skill save/delete"
```

---

## Task 13: `CodexSkillCatalog` emits `vaultSkill.changed`

**Files:**
- Modify: `src/providers/codex/commands/CodexSkillCatalog.ts`
- Modify: `tests/unit/providers/codex/commands/CodexSkillCatalog.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/providers/codex/commands/CodexSkillCatalog.test.ts`:

```ts
import { EventBus } from '@/core/events/EventBus';
import type { ProviderCommandEntry } from '@/core/providers/commands/ProviderCommandEntry';

describe('CodexSkillCatalog EventBus emission', () => {
  function skillEntry(): ProviderCommandEntry {
    return {
      id: 'codex-skill-vault-codex-x',
      providerId: 'codex',
      kind: 'skill',
      name: 'x',
      description: '',
      content: 'body',
      scope: 'vault',
      source: 'user',
      isEditable: true,
      isDeletable: true,
      displayPrefix: '$',
      insertPrefix: '$',
      sourceFilePath: '.codex/skills/x/SKILL.md',
      persistenceKey: 'vault-codex::x',
    };
  }
  function mkStorage() {
    return {
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue(null),
    } as never;
  }
  function mkListProvider() {
    return {
      listSkills: jest.fn().mockResolvedValue([]),
      invalidate: jest.fn(),
    } as never;
  }

  it('emits vaultSkill.changed on save', async () => {
    const bus = new EventBus<{ 'vaultSkill.changed': { providerId: 'codex' } }>();
    const events: Array<{ providerId: string }> = [];
    bus.on('vaultSkill.changed', (p) => { events.push(p); });
    const catalog = new (await import('@/providers/codex/commands/CodexSkillCatalog')).CodexSkillCatalog(
      mkStorage(), mkListProvider(), '/vault', bus as never,
    );
    await catalog.saveVaultEntry(skillEntry());
    expect(events).toEqual([{ providerId: 'codex' }]);
  });

  it('emits vaultSkill.changed on delete', async () => {
    const bus = new EventBus<{ 'vaultSkill.changed': { providerId: 'codex' } }>();
    const events: Array<{ providerId: string }> = [];
    bus.on('vaultSkill.changed', (p) => { events.push(p); });
    const catalog = new (await import('@/providers/codex/commands/CodexSkillCatalog')).CodexSkillCatalog(
      mkStorage(), mkListProvider(), '/vault', bus as never,
    );
    await catalog.deleteVaultEntry(skillEntry());
    expect(events).toEqual([{ providerId: 'codex' }]);
  });

  it('works without an EventBus', async () => {
    const catalog = new (await import('@/providers/codex/commands/CodexSkillCatalog')).CodexSkillCatalog(
      mkStorage(), mkListProvider(), '/vault',
    );
    await expect(catalog.saveVaultEntry(skillEntry())).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --selectProjects unit -- tests/unit/providers/codex/commands/CodexSkillCatalog.test.ts -t "EventBus emission"`
Expected: FAIL — constructor doesn't accept 4th arg.

- [ ] **Step 3: Wire EventBus into the catalog**

Edit `src/providers/codex/commands/CodexSkillCatalog.ts`:

Add imports:

```ts
import type { ClaudianEventMap } from '../../../app/events/claudianEvents';
import type { EventBus } from '../../../core/events/EventBus';
```

Extend constructor:

```ts
  constructor(
    private storage: CodexSkillStorage,
    private listProvider: CodexSkillListProvider,
    private vaultPath: string | null,
    private eventBus?: EventBus<ClaudianEventMap>,
  ) {}
```

Update `saveVaultEntry` — append at the end (after `this.listProvider.invalidate()`):

```ts
    this.eventBus?.emit('vaultSkill.changed', { providerId: 'codex' });
```

Update `deleteVaultEntry` — append at the end (after `this.listProvider.invalidate()`):

```ts
    this.eventBus?.emit('vaultSkill.changed', { providerId: 'codex' });
```

- [ ] **Step 4: Update construction sites**

Run: `grep -rn "new CodexSkillCatalog" src/`. Update each to pass `plugin.events`.

```ts
new CodexSkillCatalog(storage, listProvider, vaultPath, plugin.events);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --selectProjects unit -- tests/unit/providers/codex/commands/CodexSkillCatalog.test.ts`
Expected: all PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/providers/codex/commands/CodexSkillCatalog.ts tests/unit/providers/codex/commands/CodexSkillCatalog.test.ts $(grep -rl "new CodexSkillCatalog" src/ | tr '\n' ' ')
git commit -m "feat(codex): emit vaultSkill.changed on skill save/delete"
```

---

## Task 14: Hoist aggregator to plugin scope (hydrate + pre-warm + dispose)

**Files:**
- Modify: `src/main.ts`
- Modify: `src/features/quickActions/openQuickActionsModal.ts`

- [ ] **Step 1: Add aggregator field and construction to plugin**

Edit `src/main.ts`:

Add imports (alphabetically):

```ts
import { buildProviderRecords } from './features/quickActions/skills/buildProviderRecords';
import { VaultSkillAggregator } from './features/quickActions/skills/VaultSkillAggregator';
```

Add field on `ClaudianPlugin`:

```ts
  public vaultSkillAggregator: VaultSkillAggregator | null = null;
```

In `onload()`, **inside `completeDeferredOnload()` after `ProviderWorkspaceRegistry.initializeAll`** (so command catalogs exist before the aggregator factory runs):

```ts
    // Skills tab cache: hydrate persisted index, then pre-warm in background.
    this.vaultSkillAggregator = new VaultSkillAggregator(
      () => buildProviderRecords(this),
      {
        logger: this.logger,
        eventBus: this.events,
        cacheAdapter: new VaultFileAdapter(this.app),
        ttlMs: 60_000,
      },
    );
    await this.vaultSkillAggregator.hydrate();
    void this.vaultSkillAggregator.listAllStreaming(() => {});
```

In `onunload()`:

```ts
    this.vaultSkillAggregator?.dispose();
    this.vaultSkillAggregator = null;
```

- [ ] **Step 2: Update `openQuickActionsModal` to consume plugin aggregator**

Edit `src/features/quickActions/openQuickActionsModal.ts`:

Replace the body of `openQuickActionsModal`:

```ts
export function openQuickActionsModal(
  plugin: ClaudianPlugin,
  options: OpenQuickActionsModalOptions,
): void {
  const storage = new QuickActionStorage(
    plugin.storage.getAdapter(),
    () => plugin.settings.quickActionsFolder ?? 'Quick Actions',
  );
  // Fallback path: if the deferred onload hasn't run yet (modal opened from
  // the file-menu before workspace layout ready), build a one-shot aggregator
  // without disk cache or EventBus wiring. This is rare in practice.
  const aggregator = plugin.vaultSkillAggregator ?? new VaultSkillAggregator(
    () => buildProviderRecords(plugin),
    { logger: plugin.logger },
  );
  const file = options.file ?? null;

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
  }).open();
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Run all unit tests**

Run: `npm test -- --selectProjects unit`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/features/quickActions/openQuickActionsModal.ts
git commit -m "feat(quickActions): hoist VaultSkillAggregator to plugin scope with hydrate + pre-warm"
```

---

## Task 15: `SkillsTabRenderer` — Phase A paint + Phase B streaming + skeleton

**Files:**
- Modify: `src/features/quickActions/ui/SkillsTabRenderer.ts`

- [ ] **Step 1: Rewrite render to use cached paint + streaming refresh**

Edit `src/features/quickActions/ui/SkillsTabRenderer.ts` — replace `render`, `refresh`, and add skeleton + refresh button:

```ts
import { setIcon } from 'obsidian';

import { t } from '@/i18n/i18n';

import type { ProviderId } from '../../../core/providers/types';
import type { SkillTabEntry, VaultSkillSource } from '../skills/types';

const SKELETON_ROWS = 4;

export class SkillsTabRenderer {
  private skills: SkillTabEntry[] = [];
  private filter = '';
  private searchInputEl: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;

  constructor(
    private source: VaultSkillSource,
    private onRunSkill: (entry: SkillTabEntry) => void,
    private onEditSkill: (entry: SkillTabEntry) => void,
    private close: () => void,
  ) {}

  async render(host: HTMLElement): Promise<HTMLInputElement | null> {
    this.filter = '';
    this.buildSearch(host);
    this.listEl = host.createDiv({
      cls: 'claudian-quick-actions-list claudian-quick-actions-skill-list',
    });

    // Phase A: instant paint from in-memory cache (may be empty on cold start).
    this.skills = this.source.listCachedNow();
    this.renderList();

    // Phase B: background refresh, streaming per-provider updates.
    void this.source.listAllStreaming((providerId, entries) => {
      this.patchProvider(providerId, entries);
    });

    return this.searchInputEl;
  }

  private patchProvider(providerId: ProviderId, freshEntries: SkillTabEntry[]): void {
    this.skills = this.skills.filter((s) => s.providerId !== providerId);
    this.skills.push(...freshEntries);
    this.renderList();
  }

  private buildSearch(host: HTMLElement): void {
    const searchWrap = host.createDiv({ cls: 'claudian-quick-actions-search' });
    const inputContainer = searchWrap.createDiv({
      cls: 'claudian-quick-actions-search-container',
    });
    const placeholder = t('quickActions.skills.searchPlaceholder');
    this.searchInputEl = inputContainer.createEl('input', {
      type: 'search',
      cls: 'claudian-quick-actions-search-input',
      attr: { placeholder, 'aria-label': placeholder },
    });
    this.searchInputEl.addEventListener('input', () => {
      this.filter = this.searchInputEl?.value ?? '';
      this.renderList();
    });
    this.searchInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.runFirstMatch();
      } else if (e.key === 'Escape' && this.searchInputEl?.value) {
        e.preventDefault();
        e.stopPropagation();
        this.searchInputEl.value = '';
        this.filter = '';
        this.renderList();
      }
    });

    const refreshBtn = inputContainer.createEl('button', {
      cls: 'claudian-quick-actions-search-refresh',
      attr: {
        type: 'button',
        title: t('quickActions.skills.refreshTooltip'),
        'aria-label': t('quickActions.skills.refreshTooltip'),
      },
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', () => {
      this.source.invalidate();
      void this.source.listAllStreaming((providerId, entries) => {
        this.patchProvider(providerId, entries);
      });
    });
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    if (this.skills.length === 0) {
      this.renderSkeleton();
      return;
    }
    this.listEl.removeClass('claudian-quick-actions-skills-empty');

    const filtered = this.applyFilter(this.skills);
    filtered.sort((a, b) => {
      if (a.providerId !== b.providerId) {
        return a.providerId.localeCompare(b.providerId);
      }
      return a.name.localeCompare(b.name);
    });

    if (filtered.length === 0) {
      this.listEl.createDiv({
        cls: 'claudian-quick-actions-empty-results',
        text: t('quickActions.skills.noResults'),
      });
      return;
    }

    let lastProvider: string | null = null;
    for (const skill of filtered) {
      if (skill.providerId !== lastProvider) {
        this.listEl.createDiv({
          cls: 'claudian-quick-actions-provider-header',
          text: skill.providerDisplayName,
        });
        lastProvider = skill.providerId;
      }
      this.renderRow(skill);
    }
  }

  private renderSkeleton(): void {
    if (!this.listEl) return;
    this.listEl.addClass('claudian-quick-actions-skills-skeleton');
    for (let i = 0; i < SKELETON_ROWS; i++) {
      const row = this.listEl.createDiv({
        cls: 'claudian-quick-action-row claudian-quick-actions-skill-row is-skeleton',
      });
      row.createDiv({ cls: 'claudian-quick-action-icon is-skeleton-block' });
      const text = row.createDiv({ cls: 'claudian-quick-action-text' });
      text.createDiv({ cls: 'is-skeleton-line is-skeleton-line-title' });
      text.createDiv({ cls: 'is-skeleton-line is-skeleton-line-desc' });
    }
  }

  private applyFilter(skills: SkillTabEntry[]): SkillTabEntry[] {
    const needle = this.filter.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter((s) => {
      if (s.name.toLowerCase().includes(needle)) return true;
      if (s.description.toLowerCase().includes(needle)) return true;
      if (s.providerDisplayName.toLowerCase().includes(needle)) return true;
      return false;
    });
  }

  private runFirstMatch(): void {
    const first = this.applyFilter(this.skills)[0];
    if (!first) return;
    this.onRunSkill(first);
    this.close();
  }

  private renderRow(skill: SkillTabEntry): void {
    if (!this.listEl) return;

    const row = this.listEl.createDiv({
      cls: 'claudian-quick-action-row claudian-quick-actions-skill-row',
    });
    if (!skill.providerEnabled) {
      row.addClass('is-provider-disabled');
    }

    const main = row.createDiv({
      cls: 'claudian-quick-action-main claudian-quick-actions-skill-row-main',
    });

    const iconEl = main.createSpan({ cls: 'claudian-quick-action-icon' });
    setIcon(iconEl, 'book-open');

    const textCol = main.createDiv({ cls: 'claudian-quick-action-text' });
    textCol.createEl('strong', { text: skill.name });
    if (skill.description) {
      textCol.createDiv({
        cls: 'claudian-quick-action-desc',
        text: skill.description,
      });
    }
    if (!skill.providerEnabled) {
      textCol.createSpan({
        cls: 'claudian-quick-actions-skill-disabled-badge',
        text: t('quickActions.skills.disabledBadge'),
      });
    }

    main.addEventListener('click', () => {
      this.onRunSkill(skill);
      this.close();
    });

    if (skill.sourceFilePath) {
      const actions = row.createDiv({ cls: 'claudian-quick-action-actions' });
      const editBtn = actions.createEl('button', {
        cls: 'claudian-quick-actions-skill-edit',
        text: t('quickActions.skills.editInSettings', {
          provider: skill.providerDisplayName,
        }),
      });
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
        this.onEditSkill(skill);
      });
    }
  }
}
```

- [ ] **Step 2: Add the new i18n string**

Run: `grep -rn "skills.searchPlaceholder" src/i18n/` to find the locale files. For each, add `"refreshTooltip": "Refresh skills"` (or locale-appropriate translation) under `quickActions.skills`.

Example for `src/i18n/locales/en.ts` (or `.json`):

```ts
  quickActions: {
    skills: {
      searchPlaceholder: '...',
      refreshTooltip: 'Refresh skills',
      // ... existing keys
    },
  },
```

- [ ] **Step 3: Add minimal skeleton CSS**

Append to the relevant style file (find via `grep -rn "claudian-quick-actions-skill-row" src/style/`):

```css
.claudian-quick-actions-skill-row.is-skeleton {
  pointer-events: none;
  opacity: 0.55;
}
.is-skeleton-block,
.is-skeleton-line {
  background: var(--background-modifier-border);
  border-radius: 4px;
  animation: claudian-skeleton-pulse 1.4s ease-in-out infinite;
}
.is-skeleton-block { width: 16px; height: 16px; }
.is-skeleton-line { height: 12px; margin: 4px 0; }
.is-skeleton-line-title { width: 40%; }
.is-skeleton-line-desc { width: 70%; }
@keyframes claudian-skeleton-pulse {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 0.85; }
}
.claudian-quick-actions-search-refresh {
  background: transparent;
  border: 0;
  padding: 4px;
  cursor: pointer;
  color: var(--text-muted);
}
.claudian-quick-actions-search-refresh:hover {
  color: var(--text-normal);
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 5: Run all unit tests**

Run: `npm test -- --selectProjects unit`
Expected: all PASS. If any SkillsTabRenderer test fails due to the new `listCachedNow`/`listAllStreaming` API, update the test's stub VaultSkillSource to implement those methods returning empty/`Promise.resolve()`.

- [ ] **Step 6: Commit**

```bash
git add src/features/quickActions/ui/SkillsTabRenderer.ts src/i18n/ src/style/
git commit -m "feat(quickActions): SWR Skills tab paint with cached-now + streaming refresh + skeleton + refresh button"
```

---

## Task 16: Update `src/features/quickActions/CLAUDE.md` documentation

**Files:**
- Modify: `src/features/quickActions/CLAUDE.md`

- [ ] **Step 1: Append a "Skills tab caching" section**

Edit `src/features/quickActions/CLAUDE.md` — append before the existing "Gotchas" section:

```markdown
## Skills Tab Caching

`VaultSkillAggregator` is a plugin singleton (`plugin.vaultSkillAggregator`) built once in `completeDeferredOnload()` after provider workspace services initialize. Each open of `QuickActionsModal` reuses it; do not construct a new aggregator per modal open.

### Three-layer freshness model

1. **In-memory per-provider TTL cache** (60 s default). `listAll()` and `listAllStreaming()` consult the cache before invoking `record.commandCatalog.listVaultEntries()`. `providerEnabled` and `providerDisplayName` are re-tagged from the current `ProviderRecord` on every read, so toggling a provider mid-session updates dimming immediately without invalidation.
2. **Persistent disk index** at `.claudian/cache/skill-index.json`. Hydrated synchronously-via-async during `onload`, written debounced (1 s trailing) after every successful fetch. Skill bodies (`content`) are stripped at persist time — only metadata required for the picker is stored. Schema mismatch or malformed JSON is treated as a cold cache.
3. **EventBus `vaultSkill.changed`** emitted by `ClaudeCommandCatalog` and `CodexSkillCatalog` after in-app skill save/delete. The aggregator subscribes and invalidates the matching provider bucket.

### Why no vault file watcher

`.claude/`, `.codex/`, and `.agents/` are dot-folders that Obsidian excludes from its vault index. `vault.on('create'|'modify'|'delete'|'rename')` does not fire for `SKILL.md` mutations inside them, so the EventBus-from-write-paths approach is the only correct in-app invalidation seam. External CLI edits rely on the TTL fallback or the manual refresh button in the Skills tab header.

### Streaming + stale-while-revalidate UX

`SkillsTabRenderer.render()` first calls `aggregator.listCachedNow()` for a synchronous Phase-A paint, then kicks off `aggregator.listAllStreaming((providerId, entries) => this.patchProvider(...))` for a Phase-B background refresh. Each provider's freshly-fetched rows replace its stale rows as soon as that provider's `listVaultEntries()` resolves — there is no `Promise.all` barrier across providers.

If `listCachedNow()` returns an empty array (cold start before disk hydrate completed, or first install) the renderer paints a small skeleton placeholder; rows replace the skeleton incrementally as streaming results arrive.

### Pre-warm

`onload` triggers `void aggregator.listAllStreaming(() => {})` as fire-and-forget after hydrate. Users opening the modal seconds later read a hot cache.

### In-flight deduplication

Two concurrent callers (pre-warm + user click; user click + EventBus-triggered refresh) share underlying per-provider fetch promises via `inFlight: Map<ProviderId, Promise<...>>`. The underlying `listVaultEntries()` is invoked at most once per provider per refresh cycle.
```

- [ ] **Step 2: Commit**

```bash
git add src/features/quickActions/CLAUDE.md
git commit -m "docs(quickActions): describe Skills tab cache, EventBus invalidation, dot-folder rationale"
```

---

## Task 17: Full repository verification

**Files:**
- None (verification only)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Full unit test suite**

Run: `npm test -- --selectProjects unit`
Expected: all PASS.

- [ ] **Step 4: Integration tests**

Run: `npm test -- --selectProjects integration`
Expected: all PASS. If anything in `features/quickActions` integration suites broke due to the aggregator hoisting, fix by injecting a mock `vaultSkillAggregator` on the test plugin.

- [ ] **Step 5: Production build**

Run: `npm run build`
Expected: success, no errors.

- [ ] **Step 6: Manual smoke (optional but recommended)**

1. Open Obsidian with the dev build loaded.
2. Open chat. Click the quick-actions toolbar button.
3. Click the Skills tab. Confirm rows appear instantly (cold start: skeleton then rows).
4. Close the modal. Open it again immediately. Confirm zero perceptible latency.
5. Open Claude provider settings, edit a `SKILL.md` description, save. Reopen Skills tab — confirm fresh description shows without 60 s wait.
6. Confirm `.claudian/cache/skill-index.json` exists and contains the bucket map.

- [ ] **Step 7: Final commit (only if Steps 1–5 surfaced anything to fix)**

```bash
git add <files>
git commit -m "chore(quickActions): post-verification fixes"
```

---

## Self-review

- [x] **Spec coverage**: Sections 1–8 in the spec ("Plugin singleton", "TTL cache", "Persistent index", "EventBus invalidation", "Progressive render", "Pre-warm", "Parallelize SkillStorage", "In-flight dedupe") each map to at least one task (Tasks 3, 5, 9–10, 12–13, 8+15, 14, 11, 6 respectively).
- [x] **Failure modes table** in the spec all covered: corrupt persistent index → Task 9 schema mismatch test + Task 10 hydrate-warn test; per-provider catalog throw → existing test extended in Task 3 caching error path; provider toggle mid-session → Task 4; in-app skill edit → Tasks 12–13; external CLI edit → TTL covered by Task 3.
- [x] **Type consistency**: `vaultSkill.changed` payload `{ providerId: ProviderId }` used identically in events.ts, EventBus subscription, both catalog emits, and all tests. `listAllStreaming` signature `(onProviderResolved: (providerId, entries) => void): Promise<void>` consistent across Task 2 type extension, Task 8 implementation, and Task 15 renderer consumer.
- [x] **No placeholders**: every code step shows full code; every test step shows real assertions; no "implement later" notes.
- [x] **Optional escape hatch** (refresh button) in spec is included in Task 15.
- [x] **i18n** for the new tooltip string is called out in Task 15 Step 2 with explicit locale-file edit instructions.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-04-skills-tab-responsiveness.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
