# Quick Actions Feature

Vault-defined one-tap prompts surfaced through the chat composer modal. The modal hosts two tabs: Quick Actions (vault-authored prompt notes) and Skills (read-only listing of provider-discovered skills routed to a provider-matched chat tab).

## Modal Construction

All modal sites go through `openQuickActionsModal(plugin, { onRun, file? })`:

| Site | File | `onRun` strategy | `file` |
|------|------|------------------|--------|
| File/folder context menu | `openContextMenuQuickAction.ts` | `runQuickAction` — resolves a tab and attaches the file as a pill | the right-clicked file |
| Chat header toolbar | `ClaudianView.ts` `quickActionsBtn` | Sends prompt into the currently active tab | `null` |
| Per-tab input toolbar | `tabs/tabUi.ts` `onQuickActionsOpen` | Sends prompt into the originating tab | `null` |

`openQuickActionsModal` owns the shared wiring: `QuickActionStorage` (`plugin.storage.getAdapter()`), `VaultSkillAggregator` (`buildProviderRecords` factory, `plugin.logger`), and the Skills-tab `onRunSkill` callback that routes to `runVaultSkill`. Adding a fourth modal entry point means calling the helper — never reassembling the wiring inline.

## Skills Tab

`VaultSkillAggregator` walks `ProviderRegistry.getRegisteredProviderIds()` via `buildProviderRecords`, asks each provider's `ProviderCommandCatalog.listVaultEntries()` for skill-kind entries, and tags them with provider metadata for the modal. Per-provider failures are swallowed (with a `warn` breadcrumb to `plugin.logger.scope('quickActions')`) so a single broken provider can't blank out the tab. The aggregator is a plugin-lifetime singleton, not a per-modal instance — see [Skills Tab Caching](#skills-tab-caching) for the freshness model, on-disk index, and EventBus invalidation seam.

`runVaultSkill(plugin, entry, file)` re-checks `ProviderRegistry.isEnabled` at execution time — `SkillTabEntry.providerEnabled` is a listing-time cache used only for picker dimming; a provider toggled while the modal was open must not silently dispatch into a disabled provider, and a provider re-enabled while the modal was open must not silently fail. The helper then resolves a target tab in this order:

1. Active tab matches provider and is `blank` → reuse.
2. Active tab matches provider but is not blank → create new tab.
3. Active tab provider mismatches:
   - Another blank tab on the target provider exists → reuse it.
   - Else → create new tab with `defaultProviderId: entry.providerId`.

**Pill attach order**: `switchToTab` must precede `attachFileAsPill`/`attachFolderAsPill`. A blank tab's `initializeWelcome` wipes any pill attached before the switch.

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

## Gotchas

- `QuickActionsModalCallbacks.aggregator` is typed as the `VaultSkillSource` interface (`listAll`, `listCachedNow`, `listAllStreaming`, `invalidate`, `dispose`) — not the concrete `VaultSkillAggregator` class — so the modal doesn't couple to a single source implementation and tests don't need `as unknown` casts.
- `SkillsTabRenderer` owns all skills-side state and DOM. The modal shell only handles the tab strip + delegates body rendering. Don't move skills state back onto the modal — it shares its instance with the Quick Actions tab and TS can't track which tab assigned which input element.
- `ProviderCommandEntry.sourceFilePath` is set for entries backed by an editable file on disk (vault `.claude/skills/<name>/SKILL.md`, home `~/.codex/skills/...`). It is undefined for runtime-discovered entries (Opencode skills) and SDK built-ins. The Skills tab uses presence/absence to gate the Edit button.
