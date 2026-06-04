---
title: Skills tab in quick actions modal
date: 2026-06-04
status: shipped
scope: features/quickActions, core/providers, providers/{claude,codex,opencode,cursor}
parent: "[[Quick Actions]]"
---

# Skills tab in quick actions modal

## Problem

Users can run quick actions (vault-defined prompt templates) from the toolbar and from the file-tree context menu. Skills (provider-defined behavior packs, `.claude/skills/`, `.codex/skills/`, `.agents/skills/`, runtime-discovered Opencode skills, etc.) live behind a different surface — the chat input dropdown triggered by `/` or `$`. Discovery and execution patterns diverge for two artifacts that, from a user's perspective, are siblings: "things I can run against the current file."

The idea note ([[docs/ideas/Make project skills available to Quick-Actions]]) proposes unifying discovery by adding a Skills tab inside the Quick Actions modal. The same right-click → modal → pick → run flow should apply, with the result being a chat turn that invokes the skill via its provider's native prefix syntax.

## Goal

Quick Actions modal gains a tabbed surface. The first tab keeps today's Quick Actions behavior unchanged. The second tab lists every skill discovered across all providers, grouped by provider, read-only. Selecting a skill row routes execution to a chat tab matching that provider, attaches the right-clicked file or folder as a context pill (when invoked via context menu), and sends the provider-native skill invocation (`$skill-name` or `/skill-name`).

Editing skills is not in scope for the modal. Provider settings tabs already own CRUD for skills they manage.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Tab lists skills from **all providers**, grouped by provider | Vault is the single source of truth for discovery. Active provider is resolved at execution time via tab routing, not at listing time. |
| 2 | Skill execution **routes to a chat tab whose provider matches the skill** | Provider mismatch breaks skill resolution. A Claude tab cannot handle `$codex-skill`. Reuses blank tabs when the active provider matches; otherwise creates a new tab with a provider override. |
| 3 | Skill tab is **read-only**: list + run only | Skill authoring is provider-specific and lower frequency than running. Provider settings tabs already own CRUD. Opencode runtime-discovered skills have no editable file path. An "Edit" affordance opens the provider settings tab. |
| 4 | Right-click → Skills tab **inherits the file/folder pill attach** | Skills routinely operate on file context. Pill + prefix matches the manual workflow users already perform in chat. |
| 5 | Default tab = **Quick Actions** always. Search is **per-tab**. | Predictable, no hidden state. Quick Actions is the primary feature; Skills is secondary read-only browse. Per-tab search avoids cross-domain name collisions confusing the filter. |

## Design

### Architecture

New aggregation module under the Quick Actions feature:

```
src/features/quickActions/skills/
  VaultSkillAggregator.ts   — gathers skills from all provider command catalogs
  runVaultSkill.ts          — execution helper (tab routing + pill attach + send)
  types.ts                  — SkillTabEntry shape
```

The aggregator consumes the existing `ProviderCommandCatalog.listVaultEntries()` contract — the same surface Claude (`ClaudeCommandCatalog`) and Codex (`CodexSkillCatalog`) already implement. This keeps the provider boundary intact: the aggregator never reads provider storage directly.

```ts
// src/features/quickActions/skills/types.ts
import type { ProviderId } from '../../../core/types';

export interface SkillTabEntry {
  /** Aggregator-assigned ID, unique across providers, e.g. "claude:skill-tdd" */
  id: string;
  providerId: ProviderId;
  providerDisplayName: string;
  /** Skill name as invoked in chat (without prefix). */
  name: string;
  description: string;
  /** Provider-native trigger prefix. From ProviderCommandEntry.insertPrefix. */
  insertPrefix: '/' | '$';
  /** SKILL.md path when known. null for runtime-discovered (e.g. Opencode). */
  sourceFilePath: string | null;
  /** Cached at listing time; used to gate execution and dim disabled rows. */
  providerEnabled: boolean;
}
```

```ts
// src/features/quickActions/skills/VaultSkillAggregator.ts
export interface ProviderRecord {
  providerId: ProviderId;
  displayName: string;
  isEnabled: boolean;
  commandCatalog: ProviderCommandCatalog;
}

export class VaultSkillAggregator {
  constructor(private getProviderRecords: () => ProviderRecord[]) {}

  async listAll(): Promise<SkillTabEntry[]> {
    const providers = this.getProviderRecords();
    const buckets = await Promise.all(
      providers.map((p) => this.collectFromProvider(p).catch(() => [])),
    );
    return buckets.flat();
  }

  private async collectFromProvider(p: ProviderRecord): Promise<SkillTabEntry[]> {
    const entries = await p.commandCatalog.listVaultEntries();
    return entries
      .filter((e) => e.kind === 'skill')
      .map((e) => ({
        id: `${p.providerId}:${e.id}`,
        providerId: p.providerId,
        providerDisplayName: p.displayName,
        name: e.name,
        description: e.description,
        insertPrefix: e.insertPrefix as '/' | '$',
        sourceFilePath: e.sourceFilePath ?? null,
        providerEnabled: p.isEnabled,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
```

Notes:
- `ProviderCommandEntry` does not currently carry `sourceFilePath` for every provider. A small extension to the contract adds this optional field; Claude and Codex set it from their storage, Opencode leaves it `null` for runtime-discovered skills.
- `ProviderWorkspaceRegistry` today is a static class without an iteration method — registrations live in a private `Partial<Record<ProviderId, ProviderWorkspaceRegistration>>`. Add a new static `listRegisteredProviderIds(): ProviderId[]` returning the registered keys; the constructor of the aggregator receives a `getProviderRecords` factory that maps each registered ID to `{ providerId, displayName, isEnabled, commandCatalog }` (display name + enabled flag from settings, command catalog from `getCommandCatalog`). Keeping the factory at the call site keeps the aggregator pure and unit-testable.
- `Promise.all` with per-provider `.catch(() => [])` ensures one failing catalog never blocks the others. Failures are logged via the leveled logger at `warn`.

### Modal UX

`QuickActionsModal` gains a tab strip rendered above the existing search input. Two tabs: **Quick Actions** (default), **Skills**.

```
┌─────────────────────────────────────────────┐
│  [Quick Actions]  [Skills]                  │  tab strip
├─────────────────────────────────────────────┤
│  🔍 Search...                          [✕]  │  per-tab search
├─────────────────────────────────────────────┤
│  Claude                                     │  provider header
│  ────                                       │
│  📜  brainstorming                          │
│      explore intent before implementation   │
│                                             │
│  📜  tdd                                    │
│      red-green-refactor loop                │
│                                             │
│  Codex                                      │
│  ────                                       │
│  📜  my-codex-skill                         │
│      ...                                    │
└─────────────────────────────────────────────┘
```

Behavior:
- Tab state lives on the modal instance only. Not persisted across opens.
- Switching tabs clears the search input (per-tab isolation). Focus moves to the search input.
- Skills tab footer hides the **Add** button (read-only).
- Each skill row: icon (`book-open` default), name in bold, description.
- Each row exposes an **Edit** action when `sourceFilePath != null` — closes the modal and opens the matching provider settings tab. Hidden for runtime-only skills.
- Provider header rows render in a stable provider order: Claude, Codex, Opencode, Cursor (matches the existing registry order).
- Rows for a disabled provider render dimmed with a small "disabled" badge. Clicking still triggers `onRunSkill`, which surfaces the disabled-provider Notice — keeps the affordance discoverable.

Empty states:
- No skills found at all → "No vault skills. Skills live in `.claude/skills/`, `.codex/skills/`, `.agents/skills/`, etc."
- Search returns no match → reuse `quickActions.modal.noResults` copy.

### Execution path

```ts
// src/features/quickActions/skills/runVaultSkill.ts
export async function runVaultSkill(
  plugin: ClaudianPlugin,
  entry: SkillTabEntry,
  file: TAbstractFile | null,
): Promise<void> {
  if (!entry.providerEnabled) {
    new Notice(t('quickActions.skills.providerDisabled', { provider: entry.providerDisplayName }));
    return;
  }

  let view = plugin.getView();
  if (!view) {
    await plugin.activateView();
    view = plugin.getView();
  }
  if (!view) return;

  const tabManager = view.getTabManager();
  if (!tabManager) return;

  const targetTab = await resolveTargetTab(tabManager, entry.providerId);
  if (!targetTab) {
    new Notice(t('quickActions.contextMenu.tabLimitReached'));
    return;
  }

  await tabManager.switchToTab(targetTab.id);

  if (file instanceof TFile) {
    targetTab.ui.fileContextManager?.attachFileAsPill(file.path);
  } else if (file instanceof TFolder) {
    targetTab.ui.fileContextManager?.attachFolderAsPill(file.path);
  }

  const message = `${entry.insertPrefix}${entry.name}`;
  void targetTab.controllers.inputController?.sendMessage({ content: message });
}
```

`resolveTargetTab` rules, in order:
1. Active tab's provider matches `entry.providerId` and active tab is blank → reuse.
2. Active tab matches and is not blank → create a new tab with the same provider.
3. Active tab provider mismatch → look for an existing blank tab on the target provider; if found, reuse.
4. No blank match → create a new tab with the target provider via `tabManager.createTab(null, { activate: false, providerId: entry.providerId })`.
5. `canCreateTab()` returns false → return `null` (caller shows the tab-limit Notice).

This requires extending `TabManager.createTab` to accept an optional `providerId` override in its options object. Today that argument carries `{ activate }` only. The override is honored only at creation time and follows existing provider-default fallback when omitted.

### Wiring

`QuickActionsModalCallbacks` extends:

```ts
export interface QuickActionsModalCallbacks {
  onRun: (action: QuickAction) => void;          // existing
  onRunSkill: (entry: SkillTabEntry) => void;    // new
  storage: QuickActionStorage;                   // existing
  aggregator: VaultSkillAggregator;              // new
}
```

`openContextMenuQuickAction` is the only existing caller; it constructs the aggregator and wires `onRunSkill → runVaultSkill(plugin, entry, file)`. The same wiring will apply to any future entry points (command palette, ribbon button) — they pass `file = null` when no context is attached.

### Provider extension: `sourceFilePath` on `ProviderCommandEntry`

The aggregator needs to know whether a skill is editable in the vault. Today, `ProviderCommandEntry` carries `persistenceKey` (Codex) and an `isEditable` flag, but no path. Add:

```ts
interface ProviderCommandEntry {
  // ...existing fields
  sourceFilePath?: string;  // SKILL.md path when known
}
```

- `ClaudeCommandCatalog`: populate from `SlashCommand` storage path (already known to `SkillStorage`).
- `CodexSkillCatalog`: populate from `CodexSkillStorage.load(location).path` when available.
- `OpencodeCommandCatalog`: leave undefined for runtime-discovered skills.
- `CursorCommandCatalog`: populate when Cursor adds skill support; undefined today.

### i18n

New keys under `quickActions`:

| Key | English |
|-----|---------|
| `quickActions.modal.tabs.quickActions` | "Quick actions" |
| `quickActions.modal.tabs.skills` | "Skills" |
| `quickActions.skills.emptyAll` | "No vault skills found." |
| `quickActions.skills.emptyHint` | "Skills live in `.claude/skills/`, `.codex/skills/`, and `.agents/skills/`." |
| `quickActions.skills.providerDisabled` | "Provider '{provider}' is disabled. Enable in settings." |
| `quickActions.skills.editInSettings` | "Edit in {provider} settings" |
| `quickActions.skills.providerHeader` | "{provider}" |
| `quickActions.skills.disabledBadge` | "disabled" |

All 10 locale files receive the new keys. Non-English locales fall back to English where translations are pending.

## Edge cases

- **Provider catalog throws on `listVaultEntries`**: caught at the aggregator, logged warn, that provider's bucket returns `[]`. Other providers still surface.
- **Skill present in vault but provider disabled**: surfaces as a dimmed row with disabled badge. Clicking shows the "Provider disabled" Notice. Listing-time presence preserves discoverability.
- **Skill present in vault but provider not registered** (e.g. plugin not built for this provider): aggregator simply doesn't see it because `listProviders()` doesn't return it. No row rendered.
- **Skill name collisions across providers**: provider grouping makes the collision visually obvious. Row IDs are provider-prefixed (`claude:skill-foo` vs `codex:skill-foo`), so DOM keys remain unique. Per-tab search matches across providers; both rows surface and the user picks by group header.
- **Runtime-discovered skill (no file path)**: Edit button hidden. Run still works because the provider runtime resolves the prefix at send time.
- **Tab limit reached** during execution: existing `quickActions.contextMenu.tabLimitReached` Notice reused. Skill is not sent.
- **Concurrent modal opens**: aggregator call is async. Tab strip renders immediately; skill list renders empty until the aggregator resolves (same pattern as the existing `refreshList()`). Modal-close mid-load is safe — async result is discarded if `listEl` is null.
- **`fileContextManager` null on the target tab**: pill attach silently skipped, same as the existing quick-action path. Skill still fires.
- **Active tab is blank but provider mismatches**: aggregator routing prefers a new tab over wiping the blank tab's provider, because the blank tab's provider is a user-visible state (model selector, plan mode toggle, etc.).

## Testing

Unit tests mirror `src/` under `tests/unit/`:

**`tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts`**
- Lists skills across stubbed provider catalogs, mixing `kind: 'skill'` and `kind: 'command'` entries; only skills pass through.
- Tags each entry with `providerId` and `providerDisplayName`.
- Sort order is alphabetical within each provider; provider order matches the registry order.
- A provider whose `listVaultEntries` throws does not break the aggregate; other providers still surface.
- Empty registry returns `[]`.
- Runtime-discovered skill (`sourceFilePath` undefined on entry) maps to `sourceFilePath: null`.
- Disabled provider's skills still surface with `providerEnabled: false`.

**`tests/unit/features/quickActions/skills/runVaultSkill.test.ts`**
- Active tab provider matches and is blank → reuses tab, `createTab` not called.
- Active tab matches but not blank → creates a new tab with the matching provider.
- Active tab provider mismatches → finds blank target-provider tab or creates new.
- File argument → `attachFileAsPill` called after `switchToTab` resolves.
- Folder argument → `attachFolderAsPill` called after switch.
- No file argument → no pill attach call.
- `canCreateTab` false → shows tab-limit Notice; `sendMessage` not called.
- `providerEnabled` false → shows disabled-provider Notice; no tab work.
- Sends the message `${insertPrefix}${name}` to the resolved tab.

**`tests/unit/features/quickActions/ui/QuickActionsModal.test.ts`** (extend existing or add)
- Tab strip renders both tabs; Quick Actions is selected by default.
- Switching to the Skills tab calls the aggregator and renders provider-grouped rows.
- Per-tab search isolation: typed filter on the Quick Actions tab is cleared when switching to Skills.
- Provider header rows render in registry order.
- Skill row click triggers `onRunSkill` with the right entry, modal closes.
- Edit button is hidden when `sourceFilePath` is null.
- Disabled-provider rows render with the disabled badge class.
- Empty-skills state renders the all-empty copy.

**Manual smoke** (post-merge dev build):
- Right-click a vault file → Skills tab → pick a Claude skill → Claude chat tab opens with the file pill attached and `/skill-name` fires.
- Same flow with a Codex skill → Codex tab opens with `$skill-name`.
- Active Claude tab present, pick a Codex skill from the modal → new Codex tab created; pill attached on the new tab.
- Disable Codex in settings, open Skills tab → Codex skills render dimmed; clicking surfaces the disabled-provider Notice.

No performance test added — skill counts are small (tens at most) and the aggregator runs once per modal open.

## Out of scope

- Editing or creating skills inside the modal (provider settings tabs already cover this).
- Standalone Skills modal opened from the command palette or ribbon (this spec keeps the tab inside Quick Actions to match the idea note; a standalone entry point can be added later with no new design).
- Argument-passing skills (Claude `argumentHint`, etc.). Skills fire bare from the modal; if a skill requires arguments the user follows up in chat.
- Reordering or favoriting skills inside the tab. Provider grouping plus alphabetical sort is the only order.
- Showing chat-input dropdown skills alongside vault skills (e.g. SDK built-ins). Tab is vault-discovery only.

## File touch list (anticipated)

| Path | Change |
|------|--------|
| `src/features/quickActions/skills/types.ts` | new — `SkillTabEntry` |
| `src/features/quickActions/skills/VaultSkillAggregator.ts` | new |
| `src/features/quickActions/skills/runVaultSkill.ts` | new |
| `src/features/quickActions/ui/QuickActionsModal.ts` | tab strip, skills rendering, callback extension |
| `src/features/quickActions/openContextMenuQuickAction.ts` | wire aggregator + `onRunSkill` |
| `src/core/providers/commands/ProviderCommandEntry.ts` | add optional `sourceFilePath` |
| `src/providers/claude/commands/ClaudeCommandCatalog.ts` | populate `sourceFilePath` |
| `src/providers/codex/commands/CodexSkillCatalog.ts` | populate `sourceFilePath` |
| `src/providers/opencode/commands/...` | leave `sourceFilePath` undefined |
| `src/providers/cursor/commands/...` | leave `sourceFilePath` undefined |
| `src/core/providers/ProviderWorkspaceRegistry.ts` | add `listRegisteredProviderIds()` static |
| `src/features/chat/.../TabManager.ts` | accept optional `providerId` in create options |
| `src/style/...` | tab strip + provider header styles |
| `src/i18n/locales/*.ts` | new keys per the i18n table above |
| `tests/unit/features/quickActions/skills/*.test.ts` | new unit tests |
| `tests/unit/features/quickActions/ui/QuickActionsModal.test.ts` | extend or add |

## Open questions

None blocking. Two verification points for implementation:

1. `TabManager.createTab` signature: confirm the existing options shape supports adding `providerId`, or refactor call sites alongside the new override.
2. `ProviderWorkspaceRegistry.listRegisteredProviderIds()` is new — confirm no existing callers iterate registrations another way (settings tab rendering already happens per-provider via direct `getSettingsTabRenderer(providerId)` calls keyed by a hardcoded list in `ClaudianSettingsTab`; the new method consolidates this).
