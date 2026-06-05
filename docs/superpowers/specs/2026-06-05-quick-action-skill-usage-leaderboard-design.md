---
title: Quick-action and skill usage leaderboard
date: 2026-06-05
status: approved (design)
scope: core/usage, features/quickActions, features/quickActions/ui
parent: "[[Quick Actions]]"
relations:
  - "[[2026-06-04-quick-action-favorites-design]]"
  - "[[2026-06-04-skills-tab-in-quick-actions-modal-design]]"
---

# Quick-action and skill usage leaderboard

## Problem

Quick actions and vault skills accumulate over time. Users build a library expecting daily use, but in practice a handful get fired constantly while many sit untouched. The Quick Actions modal lists everything alphabetically with no signal of which entries earn their slot. There is no data to answer "which of these should I drop?"

The idea note `docs/ideas/As a User I want to track skill and action usage.md` asks for usage tracking plus a leaderboard view to surface candidates for removal.

## Goal

Track per-entry usage counts and last-used timestamps for quick actions and vault skills. Surface the data through:

- A new **Stats** tab in `QuickActionsModal` showing Top-K most-used, drop candidates, and a full sortable table.
- Inline usage badges on the existing Quick Actions and Skills tab rows.
- A **Clear all stats** action in the Stats tab for reset.

Usage data is local, vault-scoped, syncs with the rest of the vault via Obsidian Sync or git.

## Non-goals

- Tracking slash commands, subagent mentions, inline-edit, plan-mode toggles, or any prompt source outside of quick actions and vault skills.
- Per-row reset, per-day rolling windows, charts, or trend lines.
- Opt-out toggle: data never leaves the vault, no PII, no network. Clear-all covers privacy reset.
- Cross-vault aggregation or anonymous telemetry.
- Surviving rename: a rename creates a new identity; the old counter becomes an orphan and is hidden.

## Architecture

### Module layout

```
src/core/usage/
  UsageTracker.ts         # in-memory map, debounced flush, public API
  UsageStorage.ts         # VaultFileAdapter wrapper; load/save .claudian/usage.json
  types.ts                # UsageRecord, UsageEntryKind, UsageKey, UsageIndex
  events.ts               # UsageEventMap: 'usage.recorded', 'usage.cleared'
  keys.ts                 # serializeKey / parseKey helpers

src/features/quickActions/
  runQuickActionForFile.ts   # emits 'usage.recorded' after sendMessage resolves
  skills/runVaultSkill.ts    # emits 'usage.recorded' after sendMessage resolves
  ui/
    UsageStatsTab.ts           # NEW — Top-K cards + drop candidates + full table
    QuickActionsModal.ts       # mount 3rd tab "Stats"
    SkillsTabRenderer.ts       # render inline badge per row
    QuickActionsTabRenderer    # render inline badge per row (existing tab)
    formatUsageBadge.ts        # shared badge formatter
```

Rationale:

- `UsageTracker` is cross-cutting (any caller can emit a `usage.recorded` event). It belongs in `src/core/` next to `EventBus`, `Logger`, and `SessionStorage`.
- UI is quick-actions-modal-specific. It stays in `src/features/quickActions/ui/`.
- Single subscriber, single writer: the tracker. Helpers only emit. Matches the existing `vaultSkill.changed` precedent.

### Lifecycle

`completeDeferredOnload()`:

1. Construct `UsageStorage(VaultFileAdapter)`.
2. Construct `UsageTracker(events, storage, () => Date.now())`.
3. `await tracker.hydrate()` — reads `.claudian/usage.json` into the in-memory map; missing or malformed file is a cold start.
4. Tracker subscribes to `usage.recorded` and `usage.cleared` on construction. Helpers can emit safely from this point onward.
5. Expose `plugin.usageTracker` as a read-only accessor for UI consumers.

`onunload`:

- `await tracker.flush()` — forces an immediate write if dirty, cancels the debounced timer. Worst-case loss is the last few invocations if the OS kills the process mid-write.

## Data model

`src/core/usage/types.ts`:

```typescript
export type UsageEntryKind = 'quickAction' | 'skill';

export interface UsageKey {
  kind: UsageEntryKind;
  // quickAction: filename stem (e.g. "summarize")
  // skill: skill folder name (e.g. "deep-research")
  name: string;
  // skill only — undefined for quickAction
  providerId?: ProviderId;
}

export interface UsageRecord {
  count: number;        // total invocations
  lastUsedAt: number;   // epoch ms; updated on each record()
}

export interface UsageIndex {
  version: 1;
  // composite key string: see keys.ts
  records: Record<string, UsageRecord>;
}
```

### Identity key

Stable across moves, breaks on rename — accepted trade-off per Q3.

- Quick action key: filename stem of the `.md` note.
- Skill key: skill folder name plus the owning `providerId`.

Same skill name across providers (e.g. `$deep-research` for Claude and Codex) → separate counters. The modal already keys this way.

### Composite key string

Flat single-map storage. `src/core/usage/keys.ts`:

```typescript
export function serializeKey(key: UsageKey): string {
  return `${key.kind}:${key.providerId ?? '_'}:${key.name}`;
}

export function parseKey(serialized: string): UsageKey | null {
  // [kind, providerId | '_', ...nameParts] — name may contain ':'.
  // Split on first two ':' only.
}
```

Examples:

- `quickAction:_:summarize`
- `skill:claude:deep-research`
- `skill:codex:deep-research`

### Storage file

`.claudian/usage.json`:

```json
{
  "version": 1,
  "records": {
    "quickAction:_:summarize": { "count": 47, "lastUsedAt": 1717545600000 },
    "skill:claude:deep-research": { "count": 12, "lastUsedAt": 1717459200000 }
  }
}
```

- **Read**: hydrate during `onload`. Malformed JSON or version mismatch → cold start (empty index), warn-log via `plugin.logger.scope('usage')`, bad file backed up to `.claudian/usage.corrupt.json` (single overwrite slot).
- **Write**: debounced 1 s trailing, mirrors `skillIndexPersistence.ts`. `flush()` forces immediate write on unload.
- **Concurrency**: single writer (the tracker). No locking.
- **Size**: O(distinct actions × ~100 bytes). 100 actions ≈ 10 KB. No rotation.
- **.claudian/ folder**: `UsageStorage` ensures it exists before first write.

## Event flow & instrumentation

### Event map

`src/core/usage/events.ts`:

```typescript
export interface UsageEventMap {
  'usage.recorded': {
    kind: UsageEntryKind;
    name: string;
    providerId?: ProviderId;
  };
  'usage.cleared': void;
}
```

Merged into the top-level `EventBus` map alongside the existing chat, task, and quickActions maps.

### Emit sites

`src/features/quickActions/runQuickActionForFile.ts` — at the end of the helper, after `sendMessage` resolves:

```typescript
await targetTab.controllers.inputController?.sendMessage({ content: action.prompt });
plugin.events.emit('usage.recorded', {
  kind: 'quickAction',
  name: action.name,
});
```

`src/features/quickActions/skills/runVaultSkill.ts` — same pattern with provider:

```typescript
await target.controllers.inputController?.sendMessage({ content });
plugin.events.emit('usage.recorded', {
  kind: 'skill',
  name: entry.name,
  providerId: entry.providerId,
});
```

**Count-on-success contract**: switch from `void` to `await` so the emit only fires when `sendMessage` resolves without throwing. Early returns (no view, no tab manager, tab limit, provider disabled) skip the emit naturally.

### Tracker

`src/core/usage/UsageTracker.ts`:

```typescript
class UsageTracker {
  private records = new Map<string, UsageRecord>();
  private dirty = false;
  private writeTimer?: number;

  constructor(
    private events: EventBus<UsageEventMap>,
    private storage: UsageStorage,
    private now: () => number,
    private logger: Logger,
  ) {
    this.unsubRecorded = events.on('usage.recorded', (e) => this.handleRecord(e));
    this.unsubCleared = events.on('usage.cleared', () => this.handleClear());
  }

  async hydrate(): Promise<void> { /* read storage into records */ }

  private handleRecord({ kind, name, providerId }: UsageEventMap['usage.recorded']): void {
    const key = serializeKey({ kind, name, providerId });
    const prev = this.records.get(key);
    this.records.set(key, {
      count: (prev?.count ?? 0) + 1,
      lastUsedAt: this.now(),
    });
    this.scheduleWrite();
  }

  private handleClear(): void {
    this.records.clear();
    this.scheduleWrite();
  }

  // Read API for UI
  get(key: UsageKey): UsageRecord | undefined;
  getAll(): ReadonlyMap<string, UsageRecord>;

  // Lifecycle
  async flush(): Promise<void>;
  dispose(): void;
}
```

- `now()` injected for testability vs `Date.now()` directly.
- Read API returns read-only views; UI never mutates.
- `EventBus.errorSink` already swallows subscriber throws so a tracker bug never breaks `sendMessage`.

## UI — Stats tab

Third tab in `QuickActionsModal`, after Quick Actions + Skills.

### Layout

```
┌───────────────────────────────────────────────────────────────┐
│  Top 5 — Most used                                            │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 1.  ⚡ summarize           47 uses · today           │     │
│  │ 2.  🧠 deep-research(claude) 32 uses · 2 days ago    │     │
│  │ 3.  ⚡ daily-standup       18 uses · 1 day ago       │     │
│  │ ...                                                   │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                               │
│  Drop candidates                                              │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ ⚡ old-prompt          1 use · 67 days ago           │     │
│  │ 🧠 unused-skill(codex) 0 uses · never                │     │
│  │ ...                                                   │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                               │
│  All — sort: [most used ▾]                                    │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ Type │ Name                  │ Count │ Last used    │     │
│  │ ⚡   │ summarize             │   47  │ today        │     │
│  │ 🧠   │ deep-research(claude) │   32  │ 2 days ago   │     │
│  │ ...                                                   │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                               │
│                                      [Clear all stats]        │
└───────────────────────────────────────────────────────────────┘
```

### Data source

`UsageStatsTab.render()` calls:

1. `plugin.usageTracker.getAll()` — snapshot map.
2. `QuickActionStorage.list()` — live quick-actions (orphan filter source).
3. `plugin.vaultSkillAggregator.listCachedNow()` — live skills (orphan filter source).

Left-outer join: any usage key without a matching live entry is hidden. Counter stays in storage; reappears if the underlying note is recreated with the same name.

### Drop-candidate heuristic

Computed at render time over live (non-orphan) entries:

```typescript
const dropCandidates = entries.filter(e =>
  daysSince(e.lastUsedAt, now) > 30 && e.count < median(allCounts)
);
```

Cap at 10 rows. Empty section if nothing qualifies.

### Sort dropdown

Values for the **All** table: `most used | least used | longest unused | recently used`. Default: `most used`.

### Clear-all button

Bottom-right of tab. Opens an Obsidian `Modal` confirm:

> "Clear all usage stats? This cannot be undone."

On confirm → `plugin.events.emit('usage.cleared')`. Tracker wipes map + persists empty index + tab re-renders empty state.

### Empty state

When `records.size === 0`:

> "No usage tracked yet. Run a quick-action or skill to start the leaderboard."

### Live refresh

While mounted, the tab subscribes to `usage.recorded` and re-renders debounced 250 ms. Unsubscribes on close.

## UI — Inline badges

Reuse `formatUsageBadge(record | null): string` helper:

- `null` → `"0 · never"`.
- `count: 1, lastUsedAt: today` → `"1 · today"`.
- `count: 47, lastUsedAt: 2 days ago` → `"47 · 2 days ago"`.

Append as small muted text after the action / skill name on each row in:

- Quick Actions tab rows.
- Skills tab rows in `SkillsTabRenderer`.

Both tabs already accept the modal-shared `usageTracker` accessor; rendering is a `getAll()` lookup per row at paint time.

## Error handling & edge cases

| Failure | Behavior |
|---------|----------|
| `.claudian/usage.json` missing on load | Cold start; empty index; no warn. |
| Malformed JSON | Warn-log; backup to `.claudian/usage.corrupt.json`; cold start. |
| Schema version mismatch | Warn-log; cold start. No v1 auto-migration. |
| Write fails | Warn-log; counter stays in memory; next flush retries; no throw. |
| `.claudian/` folder missing | Auto-created before first write. |
| EventBus subscriber throw | Swallowed by existing `EventBus.errorSink`. |
| Concurrent emits | In-memory `Map.set()` is atomic; debounced timer collapses bursts. |
| `sendMessage` rejects | `await` throws; emit skipped; counter not bumped. |
| Provider disabled mid-session | `runVaultSkill` early-returns before `sendMessage`; no emit. |
| Rename / move | Stable name typically unchanged → counter survives. Actual rename → new entry, old becomes orphan, hidden. |
| Plugin reload during pending write | `onunload` calls `flush()`. |
| Modal opens before tracker hydrated | `getAll()` returns empty map → empty-state paint. Hydrate is fast enough that this is rare. |

## Performance

- No new `perf` suite spec. `getAll()` snapshot + sort is bounded by distinct-action count (human-scale).
- Debounced writes collapse rapid invocation bursts into one disk hit.
- Inline badge lookup is one `Map.get()` per row at paint time.

## Testing

### Unit tests

`tests/unit/core/usage/UsageTracker.test.ts`:

- `record()` increments count + updates `lastUsedAt` from injected `now()`.
- Subsequent `record()` for the same key adds 1.
- Different `providerId` on the same skill name → separate counters.
- `clear()` empties the map and triggers a write.
- Subscribes on construction; unsubscribes via `dispose()`.
- Debounced write fires once for N rapid records (use fake timers).
- `flush()` forces immediate write + cancels timer.

`tests/unit/core/usage/UsageStorage.test.ts`:

- Round-trip: write → read returns identical index.
- Missing file → returns empty index.
- Malformed JSON → returns empty + writes backup to `.claudian/usage.corrupt.json`.
- Version mismatch → returns empty.
- Write failure → does not throw.
- `.claudian/` auto-created.

`tests/unit/core/usage/keys.test.ts`:

- `serializeKey({kind:'quickAction', name:'x'})` → `"quickAction:_:x"`.
- `serializeKey({kind:'skill', providerId:'claude', name:'x'})` → `"skill:claude:x"`.
- Round-trip via `parseKey`.

`tests/unit/features/quickActions/runQuickActionForFile.test.ts` (extend existing):

- Emits `usage.recorded` with `{kind:'quickAction', name}` after `sendMessage` resolves.
- Does NOT emit if `sendMessage` rejects.
- Does NOT emit on early return (no view, no tab manager, tab limit).

`tests/unit/features/quickActions/skills/runVaultSkill.test.ts` (extend existing):

- Emits `usage.recorded` with `{kind:'skill', name, providerId}` after `sendMessage` resolves.
- Provider-disabled path → no emit.

`tests/unit/features/quickActions/ui/UsageStatsTab.test.ts`:

- Top-5 rendered most-used desc.
- Drop-candidate filter: `lastUsedDaysAgo > 30 AND count < median`.
- Orphan filter: usage key not in live action/skill list → row hidden.
- Sort dropdown drives all-table order.
- Empty state when `records.size === 0`.
- Clear-all confirm → emits `usage.cleared`.
- Subscribes to `usage.recorded` while mounted; debounced re-render.

`tests/unit/features/quickActions/ui/formatUsageBadge.test.ts`:

- `null` → `"0 · never"`.
- `count: 1, lastUsedAt: today` → `"1 · today"`.
- `count: 47, lastUsedAt: -2 days` → `"47 · 2 days ago"`.

### Integration test

`tests/integration/features/quickActions/usageEndToEnd.test.ts`:

- Quick-action run → tracker records → `.claudian/usage.json` contains the entry after debounce flush.
- Skill run → same with provider key.
- Reload plugin → tracker rehydrates from disk → counts intact.

### Manual smoke

- Open modal, fire quick-action, switch to Stats tab, see count = 1.
- Run skill, see count in Stats tab + inline badge on Skills tab.
- Delete a quick-action that has stats → row vanishes from leaderboard (orphan hide).
- Click **Clear all stats** → confirm → tab empties.

## i18n

New keys under `quickActions.usage.*`:

- `quickActions.usage.tabLabel` — "Stats"
- `quickActions.usage.topUsed` — "Top 5 — Most used"
- `quickActions.usage.dropCandidates` — "Drop candidates"
- `quickActions.usage.all` — "All"
- `quickActions.usage.sort.mostUsed` / `leastUsed` / `longestUnused` / `recentlyUsed`
- `quickActions.usage.column.type` / `name` / `count` / `lastUsed`
- `quickActions.usage.empty` — "No usage tracked yet. Run a quick-action or skill to start the leaderboard."
- `quickActions.usage.clearAll` — "Clear all stats"
- `quickActions.usage.clearConfirm.title` / `body` / `confirm` / `cancel`
- `quickActions.usage.lastUsed.today` / `never` / `daysAgo` (with `{count}` token)
- `quickActions.usage.uses` (with `{count}` token)

All 10 locales updated.

## Migration

First-run behavior: missing `.claudian/usage.json` → cold start. No data migration. No breaking changes to existing features.
