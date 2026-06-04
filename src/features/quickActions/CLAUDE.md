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

`VaultSkillAggregator` walks `ProviderRegistry.getRegisteredProviderIds()` via `buildProviderRecords`, asks each provider's `ProviderCommandCatalog.listVaultEntries()` for skill-kind entries, and tags them with provider metadata for the modal. Per-provider failures are swallowed (with a `warn` breadcrumb to `plugin.logger.scope('quickActions')`) so a single broken provider can't blank out the tab.

`runVaultSkill(plugin, entry, file)` re-checks `ProviderRegistry.isEnabled` at execution time — `SkillTabEntry.providerEnabled` is a listing-time cache used only for picker dimming; a provider toggled while the modal was open must not silently dispatch into a disabled provider, and a provider re-enabled while the modal was open must not silently fail. The helper then resolves a target tab in this order:

1. Active tab matches provider and is `blank` → reuse.
2. Active tab matches provider but is not blank → create new tab.
3. Active tab provider mismatches:
   - Another blank tab on the target provider exists → reuse it.
   - Else → create new tab with `defaultProviderId: entry.providerId`.

**Pill attach order**: `switchToTab` must precede `attachFileAsPill`/`attachFolderAsPill`. A blank tab's `initializeWelcome` wipes any pill attached before the switch.

## Gotchas

- `QuickActionsModalCallbacks.aggregator` is typed as the `VaultSkillSource` interface (just `listAll(): Promise<SkillTabEntry[]>`) — not the concrete `VaultSkillAggregator` class — so the modal doesn't couple to a single source implementation and tests don't need `as unknown` casts.
- `SkillsTabRenderer` owns all skills-side state and DOM. The modal shell only handles the tab strip + delegates body rendering. Don't move skills state back onto the modal — it shares its instance with the Quick Actions tab and TS can't track which tab assigned which input element.
- `ProviderCommandEntry.sourceFilePath` is set for entries backed by an editable file on disk (vault `.claude/skills/<name>/SKILL.md`, home `~/.codex/skills/...`). It is undefined for runtime-discovered entries (Opencode skills) and SDK built-ins. The Skills tab uses presence/absence to gate the Edit button.
