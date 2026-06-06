---
title: Skills tab responsiveness via persistent index, pre-warm, progressive render, and SWR
date: 2026-06-04
status: shipped
scope: features/quickActions
parent: "[[Quick Actions]]"
---

## Problem

Opening the Skills tab in `QuickActionsModal` re-walks every provider's vault skill catalog on each open. For users with many `.claude/skills/*/SKILL.md` files, this is dozens of sequential disk reads. Codex's `listVaultEntries` may also spawn a short-lived `codex app-server` process (cached only 5s inside `CodexSkillListingService`). The result is a visible blank-then-fill latency every time the user clicks the tab, scaling badly with skill count.

The root cause is structural, not algorithmic:

1. `openQuickActionsModal()` builds a fresh `VaultSkillAggregator` per call ([openQuickActionsModal.ts:41](../../../src/features/quickActions/openQuickActionsModal.ts)) — no cache survives across opens.
2. `VaultSkillAggregator.listAll()` uses a `Promise.all` barrier across providers — slowest provider blocks render of all rows.
3. `SkillStorage.loadAll()` ([SkillStorage.ts:18-45](../../../src/providers/claude/storage/SkillStorage.ts)) sequences `exists()` + `read()` per skill folder.
4. Nothing persists across plugin reloads — first open after Obsidian restart is always cold.

Vault-event-based invalidation is unavailable here: `.claude/`, `.codex/`, `.agents/` are dot-folders that Obsidian excludes from its vault index, so `vault.on('create'|'modify'|'delete'|'rename')` does not fire for `SKILL.md` mutations inside them.

## Goal

Make the Skills tab feel instantly responsive on the second-and-subsequent opens, with no visible blank-then-fill on the first open after plugin load, while remaining correct as users add, edit, delete, enable, and disable skills.

## Non-goals

- Replacing `CodexSkillListingService`'s own 5s TTL cache — that layer stays as-is; the new aggregator caches on top of it.
- Caching `listDropdownEntries` for the chat `/` and `$` typeahead — out of scope (separate code path with different freshness needs).
- Caching beyond the Skills tab. Provider settings UIs still call `listVaultEntries()` directly when needed; the new cache is shared, but the design only optimizes the modal flow.
- Cross-platform file watchers (chokidar / `fs.watch`) on dot-folders. Deferred until TTL feels insufficient in practice.
- Editing or running the skills themselves — unchanged.

## Design

Five layers combine. Each is independently valuable; together they collapse Skills tab open latency to one paint of cached data plus a silent background revalidation.

### 1. Plugin-singleton `VaultSkillAggregator`

`ClaudianPlugin.onload()` constructs the aggregator once and exposes it as `plugin.vaultSkillAggregator`. `openQuickActionsModal()` reads from there instead of building a new instance per call. `onunload()` disposes it (unsubscribes EventBus, clears caches, persists final index).

This is the precondition for every other layer: without a long-lived instance, caching is impossible.

### 2. Per-provider in-memory TTL cache

Inside `VaultSkillAggregator`:

```ts
private cache = new Map<ProviderId, { entries: ProviderCommandEntry[]; expiresAt: number }>();
private readonly ttlMs: number;   // default 60_000
```

Cache hit semantics:

- `listAll()` walks `getProviderRecords()`. For each provider:
  - If `cache.get(providerId).expiresAt > now` → reuse cached `ProviderCommandEntry[]`.
  - Else fetch fresh via `record.commandCatalog.listVaultEntries()` (skill-kind only), store, set `expiresAt = now + ttlMs`.
- Always re-tag `providerEnabled` and `providerDisplayName` from the **current** `record` on every `listAll()` call, even on cache hit. This means provider enable/disable mid-session updates the dimming state instantly without an invalidation step.
- On per-provider fetch error, log at `warn` and store an empty bucket so a flaky provider doesn't thrash retries within the TTL window.

`ttlMs` is the staleness bound for external-CLI edits that bypass our write paths. 60 s is generous because in-app edits invalidate explicitly via layer 4.

### 3. Persistent disk index at `.claudian/cache/skill-index.json`

Hot in-memory cache dies on plugin reload. Persist it so first-open-after-Obsidian-restart is also instant.

Format:

```json
{
  "schemaVersion": 1,
  "writtenAt": 1717459200000,
  "buckets": {
    "claude": [
      {
        "id": "skill-tdd",
        "providerId": "claude",
        "kind": "skill",
        "name": "tdd",
        "description": "…",
        "content": "",
        "scope": "vault",
        "source": "user",
        "isEditable": true,
        "isDeletable": true,
        "displayPrefix": "/",
        "insertPrefix": "/",
        "sourceFilePath": ".claude/skills/tdd/SKILL.md"
      }
    ],
    "codex": [ ... ]
  }
}
```

Lifecycle:

- **Hydrate**: `plugin.onload()` awaits one async read of this file before triggering pre-warm. Populates `cache` with `expiresAt = now + ttlMs` so hydrated entries are considered fresh and `listCachedNow` returns them immediately on the next Skills tab open. If the file is missing or the schema does not match `schemaVersion`, the read is ignored and caches stay empty; the cold path is used on the next fetch. The read does not block other `onload` steps from completing — pre-warm fires after hydrate; modal opens before pre-warm completes simply see whatever the disk hydrate populated.
- **Persist**: after every successful in-memory cache write (i.e. after a real fetch), debounce a write (e.g. 1 s trailing) of the full `buckets` map. Debounce avoids write-amplification when several providers refresh near-simultaneously.
- **Drop `content` field at persist time**: skill bodies can be large and aren't needed to render the Skills tab (the tab shows `name` + `description` + provider header only). Store `content` as empty string in the persisted form; the `runVaultSkill()` execution path re-reads the file. Cuts disk-cache size and write latency.

The aggregator owns the index. `VaultFileAdapter` performs the I/O.

### 4. EventBus invalidation from in-app write paths

Dot-folders cannot be watched via Obsidian vault events, so explicit invalidation covers every in-app mutation:

New event type in `core/events`:

```ts
'vaultSkill.changed': { providerId: ProviderId };
```

Emitters: any `ProviderCommandCatalog` method that mutates skill-kind storage emits after the storage call returns. Concretely:

- `ClaudeCommandCatalog.saveVaultEntry()` and `.deleteVaultEntry()` — only when `entry.kind === 'skill'`.
- `CodexSkillCatalog.saveVaultEntry()` and `.deleteVaultEntry()` — all entries (Codex catalog only manages skills).

Subscriber: `VaultSkillAggregator` subscribes in its constructor, calls `this.invalidate(providerId)` on emit (clears that provider's bucket; persistence layer rewrites on next fetch).

EventBus is injected via `VaultSkillAggregatorOptions.eventBus`. Catalogs take an optional `eventBus` constructor arg too; if absent they no-op the emit (keeps tests simple).

External CLI edits (user runs `claude` CLI, edits `SKILL.md` in a separate editor, etc.) still rely on the TTL fallback.

### 5. Progressive per-provider rendering ("stale-while-revalidate" UX)

Replaces the single `Promise.all` barrier in `SkillsTabRenderer.refresh()`. Two phases:

**Phase A — instant paint from cache:**
- On modal open, call `aggregator.listCachedNow()` — synchronous read of the in-memory `cache` map, returning `SkillTabEntry[]` for any bucket that has data (even if expired). Paint these immediately. Provider-enabled flag re-tagged from current settings.
- If cache empty for a provider, render that provider's header with a small skeleton row group while it loads.

**Phase B — background revalidate, per-provider streaming:**
- Aggregator exposes a new method `listAllStreaming(onProviderResolved: (providerId, entries) => void): Promise<void>`. It walks providers without `Promise.all`; each provider fetches in parallel via its own promise, and `onProviderResolved` fires as each settles.
- `SkillsTabRenderer` registers `onProviderResolved` to patch its in-memory `this.skills` array — remove the provider's stale rows, splice in fresh rows, re-render.
- Patches use the existing `renderList()` (full re-render of the list region). Cheap because the list is small and Obsidian DOM is fast.

Net effect: user clicks Skills tab → cached rows appear in the same frame → fresh rows update over the next 20–500 ms per provider as their fetches resolve.

**Skeleton placeholder for cold start:**
- When `listCachedNow()` returns zero buckets (first ever open, plugin reload before pre-warm completed), render N=5 grey skeleton rows under each provider header. Replaced as `listAllStreaming` resolves.

### 6. Plugin-load pre-warm

In `ClaudianPlugin.onload()`, after hydrating the persistent index:

```ts
void this.vaultSkillAggregator.listAllStreaming(() => {});
```

Fire-and-forget. Refreshes hydrated buckets in the background so users opening the modal seconds later get fresh data without paying for it. Ignored if Obsidian quits mid-warm.

Additionally:

- **Hover pre-warm**: bind `mouseenter` on the per-tab quick-actions toolbar button to `void aggregator.listAllStreaming(() => {})`. Catches the case where TTL has expired between pre-warm and click. Idempotent (in-flight fetches deduplicated — see below).

### 7. Parallelized `SkillStorage.loadAll()`

Concurrent rewrite of the Claude provider's vault skill loader:

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
        ...parsedToSlashCommand(parsed, { id: `skill-${skillName}`, name: skillName, source: 'user' }),
        kind: 'skill',
      },
      filePath: skillPath,
    };
  } catch {
    return null;
  }
}
```

Wins on cold fetches (TTL expiry, first ever load, post-invalidation). Risk-free: same output, parallel I/O.

### 8. In-flight fetch deduplication

If two callers ask for `listAllStreaming` while a fetch is already running (e.g. pre-warm + user click), the second caller piggybacks on the in-flight promise instead of starting a duplicate fetch. Tracked per-provider via `Map<ProviderId, Promise<ProviderCommandEntry[]>>`. Cleared on resolution.

Prevents redundant disk walks and double Codex subprocess spawns under racy access patterns.

## Architecture summary

```
ClaudianPlugin.onload()
  └─ vaultSkillAggregator = new VaultSkillAggregator({ eventBus, ttlMs: 60_000 })
     ├─ hydrateFromDisk('.claudian/cache/skill-index.json')   # layer 3
     └─ void listAllStreaming(() => {})                        # layer 6 pre-warm

openQuickActionsModal(plugin, opts)
  └─ new QuickActionsModal(app, { aggregator: plugin.vaultSkillAggregator, ... })

SkillsTabRenderer.render(host)
  ├─ this.skills = aggregator.listCachedNow()                  # layer 5 phase A
  ├─ renderList()                                              # instant paint
  └─ void aggregator.listAllStreaming((providerId, entries) => # layer 5 phase B
        this.patchProvider(providerId, entries))

ClaudeCommandCatalog.saveVaultEntry(entry)
  ├─ skillStorage.save(...)                                    # layer 7 (parallel)
  └─ if entry.kind === 'skill': eventBus.emit('vaultSkill.changed', { providerId: 'claude' })
                                                               # layer 4
CodexSkillCatalog.saveVaultEntry(entry)
  └─ same emit pattern

VaultSkillAggregator on EventBus 'vaultSkill.changed'
  └─ this.invalidate(providerId)                               # clears bucket; next fetch rewrites disk
```

## Failure and correctness handling

| Scenario | Behavior |
|----------|----------|
| Persistent index missing / corrupt | Treat as empty cache; cold path. Log `warn`. |
| Persistent index schema mismatch | Same as missing. Re-write with current schema on first fetch. |
| Per-provider catalog fetch throws | Empty bucket cached with TTL. `warn` logged. Other providers unaffected. |
| Provider disabled mid-session | `mapEntry` re-tags `providerEnabled = false` from current record on next `listAll()`. Bucket not invalidated. |
| Provider re-enabled mid-session | Same — `providerEnabled` flips back to `true`. `runVaultSkill` re-checks `ProviderRegistry.isEnabled` at execution. Existing contract preserved. |
| User edits `SKILL.md` via Claudian's settings UI | Catalog `saveVaultEntry` fires EventBus → bucket invalidated → next paint streams fresh. |
| User edits `SKILL.md` via external CLI / editor | Stale until TTL (max 60 s) or hover pre-warm or manual refresh button (see below). |
| Plugin disabled then re-enabled | `onunload` disposes (final persist), `onload` rehydrates from disk + re-warms. |
| Two `listAllStreaming` calls overlap | Per-provider in-flight promise reused (layer 8). |

## Optional escape hatch

Small refresh button in `SkillsTabRenderer` header next to the search input. Click → `aggregator.invalidate()` then `listAllStreaming`. Lets users force a refetch after an external edit without waiting for TTL.

Scoped as **optional** because the cache + EventBus path handles the common case; this is for the edge user editing via CLI who notices stale results.

## Files touched

| File | Change |
|------|--------|
| `src/features/quickActions/skills/VaultSkillAggregator.ts` | Add TTL cache, EventBus subscription, disk hydrate/persist, `listCachedNow`, `listAllStreaming`, `invalidate`, in-flight dedupe, dispose |
| `src/features/quickActions/skills/types.ts` | `VaultSkillAggregatorOptions` adds `eventBus`, `ttlMs`, `cachePath`; `VaultSkillSource` adds `listCachedNow`, `listAllStreaming` |
| `src/features/quickActions/openQuickActionsModal.ts` | Read `plugin.vaultSkillAggregator` instead of constructing |
| `src/features/quickActions/ui/SkillsTabRenderer.ts` | Phase A/B paint, skeleton rows, optional refresh button |
| `src/main.ts` | Construct aggregator at `onload`, hydrate, pre-warm, dispose at `onunload`, bind hover pre-warm |
| `src/core/events/EventBus.ts` (and event types file) | Add `vaultSkill.changed` event type |
| `src/providers/claude/commands/ClaudeCommandCatalog.ts` | Inject `eventBus`, emit on `saveVaultEntry`/`deleteVaultEntry` when `kind === 'skill'` |
| `src/providers/codex/commands/CodexSkillCatalog.ts` | Inject `eventBus`, emit on save/delete |
| `src/providers/claude/storage/SkillStorage.ts` | Parallelize `loadAll` via `Promise.all` |
| `src/features/quickActions/CLAUDE.md` | Document caching, EventBus invalidation, dot-folder rationale, persistent index format |
| `tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts` | Cache hit/miss/TTL, EventBus invalidation, hydrate/persist, `mapEntry` re-tag on hit, in-flight dedupe, streaming order |
| `tests/unit/providers/claude/storage/SkillStorage.test.ts` (new if absent) | Parallel `loadAll` produces same output as previous sequential version |
| `tests/unit/providers/claude/commands/ClaudeCommandCatalog.test.ts` | EventBus emit on skill save/delete; no emit on command save/delete |
| `tests/unit/providers/codex/commands/CodexSkillCatalog.test.ts` | Same |

## Test plan

Unit tests (Jest, TDD — red before green for every behavior):

1. **Aggregator TTL**: `listAll()` calls cache fresh result; second call within TTL returns cached; second call after TTL refetches.
2. **Aggregator EventBus invalidation**: emit `vaultSkill.changed` for `claude` → next `listAll` refetches only claude bucket.
3. **`listCachedNow` semantics**: returns sync `SkillTabEntry[]` from in-memory cache regardless of expiry; empty array when never fetched.
4. **`listAllStreaming` ordering**: callback fires once per provider as that provider resolves; final return resolves after last provider.
5. **In-flight dedupe**: two concurrent `listAllStreaming` calls share underlying per-provider fetches; underlying catalog `listVaultEntries` called once per provider.
6. **`providerEnabled` re-tag on cache hit**: flip provider enable state between two `listAll()` calls within TTL → second call returns entries with new `providerEnabled` value.
7. **Disk hydrate**: aggregator constructed with a stubbed cache file containing claude bucket → `listCachedNow()` returns those entries before any fetch.
8. **Disk persist**: after a successful fetch, write within debounce window; persisted JSON matches schema with `content: ""` stripped.
9. **Disk hydrate corruption**: malformed JSON or wrong `schemaVersion` → empty caches, no throw.
10. **`SkillStorage.loadAll` parallel**: 100 fake folders → output identical to sequential reference; no missed entries.
11. **`ClaudeCommandCatalog` emit**: `saveVaultEntry({ kind: 'skill', ... })` triggers EventBus emit; `saveVaultEntry({ kind: 'command', ... })` does not.
12. **`CodexSkillCatalog` emit**: same.
13. **Per-provider failure isolation**: one provider's catalog throws → other providers' rows still rendered; failing bucket cached as empty.
14. **Dispose**: aggregator unsubscribes EventBus; subsequent emits do not invalidate after dispose.

Integration test (one): open Skills tab twice in a row → assert second open performs zero `listVaultEntries` calls on any provider within TTL.

## Performance characteristics

| Scenario | Before | After |
|----------|--------|-------|
| First Skills tab open after Obsidian launch | N sequential disk reads + Codex subprocess spawn | Disk read of `skill-index.json` (one small file) + paint cached + background refresh |
| Second open within 60 s | Same as first | `listCachedNow` (sync) + paint |
| Second open after 60 s | Same as first | Cached paint + per-provider streaming refresh in background |
| After editing skill via Claudian settings | Same as first | Bucket invalidated → next open does a cached paint of remaining provider buckets + refresh of edited provider |
| User has 100 Claude skills | ~100 × (exists + read) sequential | ~100 × (exists + read) in parallel, one time (until invalidated) |
| Codex disabled, user opens Skills tab | Codex catalog still invoked (may spawn subprocess) | Codex bucket cached with empty/dimmed entries past first fetch; provider-disabled re-tag is free |

No timing assertions in tests — performance suite (`tests/perf/`) already covers scaling guarantees for similar patterns; we add no new perf spec since the contract is "O(1) on cached open, O(skills) on cold fetch in parallel" which the existing infrastructure validates.

## Open questions

None blocking. Choices already committed:

- TTL = 60 s (configurable via options).
- Persistent index lives at `.claudian/cache/skill-index.json`.
- `content` stripped from persisted entries (re-read at execution time).
- Codex's own 5 s TTL stays as-is.
- Refresh button is optional polish — include in implementation, can be cut if last-mile UX feedback wants a different escape hatch.
