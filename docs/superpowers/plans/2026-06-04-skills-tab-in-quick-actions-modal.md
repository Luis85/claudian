---
status: done
parent: "[[Quick Actions]]"
---
# Skills Tab in Quick Actions Modal Implementation Plan

> **Status: implemented 2026-06-04** via [[work-order-20260604-skills-tab-quick-actions-modal]]. All 14 tasks completed; full verification (`npm run typecheck && npm run lint && npm run test && npm run build`) passes. Plan-checkbox tracking deliberately not back-filled here — the work order's acceptance criteria is the canonical progress record.
>
> **Deviations from plan during implementation:**
> - Extracted `buildProviderRecords` into `src/features/quickActions/skills/buildProviderRecords.ts` instead of inlining inside `openContextMenuQuickAction.ts`. Reason: the new required `aggregator` + `onRunSkill` modal callbacks forced updates at three modal-construction sites (`openContextMenuQuickAction.ts`, `ClaudianView.ts` header zap button, `tabs/tabUi.ts` `onQuickActionsOpen`). Sharing the helper avoids triplicate registry boilerplate.
> - `QuickActionsModal.renderActiveTab` uses `(this.searchInputEl as HTMLInputElement | null)?.focus()` cast to defeat TS narrowing after the renderXBody method call (TS doesn't track property reassignments through method calls).
> - Modal test mocks needed `@jest-environment jsdom` annotation + `setTimeout` instead of `setImmediate` (jsdom lacks `setImmediate`).
> - `SkillStorage.loadAll` shape change rippled into `StorageService.loadAllSlashCommands` which also had to be updated (`skills.map(entry => entry.skill)`).
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Skills tab to the existing Quick Actions modal that lists vault-discovered skills across every registered provider and routes execution to a provider-matched chat tab, inheriting the right-click file/folder pill attach.

**Architecture:** A new `VaultSkillAggregator` walks `ProviderRegistry.getRegisteredProviderIds()`, asks each provider's `ProviderCommandCatalog.listVaultEntries()` for skill-kind entries, and tags them with provider metadata. A new `runVaultSkill` helper routes execution to a chat tab whose provider matches the skill, reusing existing `TabManager.createTab(_, _, { defaultProviderId, activate })` and the pill-after-switch ordering from `openContextMenuQuickAction`. `QuickActionsModal` gains a two-tab strip; the existing Quick Actions tab stays unchanged, the Skills tab uses the aggregator. Skill is sent as `${insertPrefix}${name}` (e.g. `$tdd` or `/brainstorming`).

**Tech Stack:** TypeScript, Obsidian plugin API, Jest unit tests under `tests/unit/`, JSON locale files under `src/i18n/locales/`, modular CSS in `src/style/`.

**Spec:** [[docs/superpowers/specs/2026-06-04-skills-tab-in-quick-actions-modal-design.md]]

**Implementation note vs spec:**
- Spec assumed a new `TabManager.createTab` provider-override field. Existing `CreateTabOptions.defaultProviderId` already serves this purpose — no TabManager change required. Plan uses the existing field.
- Spec assumed a new `ProviderWorkspaceRegistry.listRegisteredProviderIds()`. `ProviderRegistry.getRegisteredProviderIds()` already exists and is the canonical iteration surface. Plan uses that.

---

## File Structure

| File | Responsibility | New / Modified |
|------|----------------|----------------|
| `src/core/providers/commands/ProviderCommandEntry.ts` | Add optional `sourceFilePath` field | Modified |
| `src/providers/claude/storage/SkillStorage.ts` | Return `filePath` alongside each loaded skill | Modified |
| `src/providers/claude/commands/ClaudeCommandCatalog.ts` | Populate `sourceFilePath` for vault skill entries | Modified |
| `src/providers/codex/commands/CodexSkillCatalog.ts` | Populate `sourceFilePath` for vault skill entries | Modified |
| `src/features/quickActions/skills/types.ts` | `SkillTabEntry`, `ProviderRecord` shapes | New |
| `src/features/quickActions/skills/VaultSkillAggregator.ts` | Walks providers, returns flat `SkillTabEntry[]` | New |
| `src/features/quickActions/skills/runVaultSkill.ts` | Tab routing + pill attach + send | New |
| `src/features/quickActions/ui/QuickActionsModal.ts` | Tab strip, per-tab search, skill rows, provider headers | Modified |
| `src/features/quickActions/openContextMenuQuickAction.ts` | Wire aggregator + `onRunSkill` | Modified |
| `src/i18n/locales/en.json` (and 9 others) | New keys under `quickActions.modal.tabs`, `quickActions.skills` | Modified |
| `src/style/features/quick-actions.css` | Tab strip, provider header, disabled badge styles | Modified |
| `tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts` | Aggregator unit tests | New |
| `tests/unit/features/quickActions/skills/runVaultSkill.test.ts` | Execution helper unit tests | New |
| `tests/unit/features/quickActions/ui/QuickActionsModal.test.ts` | Tab strip + skill rendering tests | New |
| `tests/unit/features/quickActions/openContextMenuQuickAction.test.ts` | Extend with skill-run wiring assertions | Modified |

---

## Task 1: Add `sourceFilePath` to `ProviderCommandEntry`

**Files:**
- Modify: `src/core/providers/commands/ProviderCommandEntry.ts`

- [ ] **Step 1: Add the field**

Edit `src/core/providers/commands/ProviderCommandEntry.ts`. Add the new optional field after `persistenceKey`:

```typescript
export interface ProviderCommandEntry {
  id: string;
  providerId: ProviderId;
  kind: ProviderCommandKind;
  name: string;
  description?: string;
  content: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  context?: 'fork';
  agent?: string;
  hooks?: Record<string, unknown>;
  scope: ProviderCommandScope;
  source: SlashCommandSource;
  isEditable: boolean;
  isDeletable: boolean;
  displayPrefix: string;
  insertPrefix: string;
  /**
   * Opaque provider-owned persistence token used to preserve storage location
   * across edits, renames, and deletes in shared settings UIs.
   */
  persistenceKey?: string;
  /**
   * Absolute or vault-relative path to the file that defines this command/skill.
   * Set for vault-editable entries (e.g. SKILL.md in `.claude/skills/<name>/`).
   * Undefined for runtime-discovered entries (e.g. Opencode skills) and SDK
   * built-ins. Consumers use it to surface an "open file" affordance or jump to
   * provider settings pre-focused on this entry.
   */
  sourceFilePath?: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. Adding an optional field is non-breaking.

- [ ] **Step 3: Commit**

```bash
git add src/core/providers/commands/ProviderCommandEntry.ts
git commit -m "feat(core): add sourceFilePath to ProviderCommandEntry"
```

---

## Task 2: Have `SkillStorage.loadAll` carry the source file path

**Files:**
- Modify: `src/providers/claude/storage/SkillStorage.ts`
- Modify: `src/providers/claude/commands/ClaudeCommandCatalog.ts`

`SkillStorage.loadAll()` already knows the path (`skillPath` local variable), but discards it before returning. Carry it through using an enriched return type so `ClaudeCommandCatalog` can fold it into the entry.

- [ ] **Step 1: Write failing test**

Create `tests/unit/providers/claude/storage/SkillStorage.test.ts` if it doesn't exist; otherwise extend. Check `Glob` first:

```bash
ls tests/unit/providers/claude/storage/SkillStorage.test.ts 2>/dev/null
```

If absent, create it:

```typescript
// tests/unit/providers/claude/storage/SkillStorage.test.ts
import { SkillStorage } from '@/providers/claude/storage/SkillStorage';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

function makeAdapter(overrides: Partial<VaultFileAdapter> = {}): VaultFileAdapter {
  return {
    listFolders: jest.fn().mockResolvedValue([]),
    exists: jest.fn().mockResolvedValue(true),
    read: jest.fn().mockResolvedValue(''),
    ...overrides,
  } as unknown as VaultFileAdapter;
}

describe('SkillStorage.loadAll', () => {
  it('returns the SKILL.md path alongside each skill', async () => {
    const adapter = makeAdapter({
      listFolders: jest.fn().mockResolvedValue([
        '.claude/skills/tdd',
        '.claude/skills/brainstorming',
      ]),
      exists: jest.fn().mockResolvedValue(true),
      read: jest.fn().mockResolvedValue(
        '---\nname: example\ndescription: example skill\n---\nbody'
      ),
    });

    const storage = new SkillStorage(adapter);
    const result = await storage.loadAll();

    expect(result).toHaveLength(2);
    const paths = result.map((entry) => entry.filePath).sort();
    expect(paths).toEqual([
      '.claude/skills/brainstorming/SKILL.md',
      '.claude/skills/tdd/SKILL.md',
    ]);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm run test -- --selectProjects unit -t "SkillStorage.loadAll"`
Expected: FAIL — current `loadAll` returns `SlashCommand[]` without a `filePath` field.

- [ ] **Step 3: Change the return shape**

Edit `src/providers/claude/storage/SkillStorage.ts`. Update the return type to carry the file path:

```typescript
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { SlashCommand } from '../../../core/types';
import { parsedToSlashCommand, parseSlashCommandContent, serializeCommand } from '../../../utils/slashCommand';

export const SKILLS_PATH = '.claude/skills';

export interface LoadedSkill {
  skill: SlashCommand;
  filePath: string;
}

export class SkillStorage {
  constructor(private adapter: VaultFileAdapter) {}

  async loadAll(): Promise<LoadedSkill[]> {
    const skills: LoadedSkill[] = [];

    try {
      const folders = await this.adapter.listFolders(SKILLS_PATH);

      for (const folder of folders) {
        const skillName = folder.split('/').pop()!;
        const skillPath = `${SKILLS_PATH}/${skillName}/SKILL.md`;

        try {
          if (!(await this.adapter.exists(skillPath))) continue;

          const content = await this.adapter.read(skillPath);
          const parsed = parseSlashCommandContent(content);

          skills.push({
            skill: {
              ...parsedToSlashCommand(parsed, {
                id: `skill-${skillName}`,
                name: skillName,
                source: 'user',
              }),
              kind: 'skill',
            },
            filePath: skillPath,
          });
        } catch {
          // Non-critical: skip malformed skill files
        }
      }
    } catch {
      return [];
    }

    return skills;
  }

  async save(skill: SlashCommand): Promise<void> {
    const name = skill.name;
    const dirPath = `${SKILLS_PATH}/${name}`;
    const filePath = `${dirPath}/SKILL.md`;

    await this.adapter.ensureFolder(dirPath);
    await this.adapter.write(filePath, serializeCommand(skill));
  }

  async delete(skillId: string): Promise<void> {
    const name = skillId.replace(/^skill-/, '');
    const dirPath = `${SKILLS_PATH}/${name}`;
    const filePath = `${dirPath}/SKILL.md`;
    await this.adapter.delete(filePath);
    await this.adapter.deleteFolder(dirPath);
  }
}
```

- [ ] **Step 4: Update `ClaudeCommandCatalog` for the new shape**

Edit `src/providers/claude/commands/ClaudeCommandCatalog.ts`. The `listVaultEntries` method currently treats skills as `SlashCommand[]`. Update to handle the `LoadedSkill` shape and attach `sourceFilePath`:

```typescript
function slashCommandToEntry(
  cmd: SlashCommand,
  options: { sourceFilePath?: string } = {},
): ProviderCommandEntry {
  const skill = isSkill(cmd);
  return {
    id: cmd.id,
    providerId: 'claude',
    kind: skill ? 'skill' : 'command',
    name: cmd.name,
    description: cmd.description,
    content: cmd.content,
    argumentHint: cmd.argumentHint,
    allowedTools: cmd.allowedTools,
    model: cmd.model,
    disableModelInvocation: cmd.disableModelInvocation,
    userInvocable: cmd.userInvocable,
    context: cmd.context,
    agent: cmd.agent,
    hooks: cmd.hooks,
    scope: cmd.source === 'sdk' ? 'runtime' : 'vault',
    source: cmd.source ?? 'user',
    isEditable: cmd.source !== 'sdk',
    isDeletable: cmd.source !== 'sdk',
    displayPrefix: '/',
    insertPrefix: '/',
    ...(options.sourceFilePath ? { sourceFilePath: options.sourceFilePath } : {}),
  };
}
```

Update `listVaultEntries`:

```typescript
async listVaultEntries(): Promise<ProviderCommandEntry[]> {
  const commands = await this.commandStorage.loadAll();
  const skills = await this.skillStorage.loadAll();
  return [
    ...commands.map((cmd) => slashCommandToEntry(cmd)),
    ...skills.map((entry) => slashCommandToEntry(entry.skill, { sourceFilePath: entry.filePath })),
  ];
}
```

- [ ] **Step 5: Run test, verify passes**

Run: `npm run test -- --selectProjects unit -t "SkillStorage.loadAll"`
Expected: PASS.

- [ ] **Step 6: Full typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors. If `commandStorage.loadAll()` returns `SlashCommand[]` (no path), the spread above remains type-safe.

- [ ] **Step 7: Commit**

```bash
git add src/providers/claude/storage/SkillStorage.ts \
        src/providers/claude/commands/ClaudeCommandCatalog.ts \
        tests/unit/providers/claude/storage/SkillStorage.test.ts
git commit -m "feat(claude): carry SKILL.md path through SkillStorage and catalog"
```

---

## Task 3: Populate `sourceFilePath` in `CodexSkillCatalog`

**Files:**
- Modify: `src/providers/codex/commands/CodexSkillCatalog.ts`

`CodexSkillCatalog.listedSkillToProviderEntry` already has the path on `skill.path`. Set it on the entry. `listVaultEntries` also has location info — set it on those entries too.

- [ ] **Step 1: Write failing test**

Extend (or create) `tests/unit/providers/codex/commands/CodexSkillCatalog.test.ts`:

```typescript
// tests/unit/providers/codex/commands/CodexSkillCatalog.test.ts
import { CodexSkillCatalog } from '@/providers/codex/commands/CodexSkillCatalog';
import type { CodexSkillStorage } from '@/providers/codex/storage/CodexSkillStorage';
import type { CodexSkillListProvider } from '@/providers/codex/skills/CodexSkillListingService';

describe('CodexSkillCatalog sourceFilePath', () => {
  it('sets sourceFilePath on vault entries returned by listDropdownEntries', async () => {
    const listProvider: CodexSkillListProvider = {
      listSkills: jest.fn().mockResolvedValue([
        {
          name: 'my-skill',
          path: '/abs/vault/.codex/skills/my-skill/SKILL.md',
          scope: 'repo',
          enabled: true,
        },
      ]),
      invalidate: jest.fn(),
    } as unknown as CodexSkillListProvider;

    const storage = {} as CodexSkillStorage;
    const catalog = new CodexSkillCatalog(storage, listProvider, '/abs/vault');

    const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });
    expect(entries[0]?.sourceFilePath).toBe('/abs/vault/.codex/skills/my-skill/SKILL.md');
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm run test -- --selectProjects unit -t "CodexSkillCatalog sourceFilePath"`
Expected: FAIL — entries do not yet carry `sourceFilePath`.

- [ ] **Step 3: Add `sourceFilePath` to both entry mapping paths**

Edit `src/providers/codex/commands/CodexSkillCatalog.ts`. In `listedSkillToProviderEntry`:

```typescript
function listedSkillToProviderEntry(
  skill: SkillMetadata,
  vaultPath: string | null,
): ProviderCommandEntry {
  const location = vaultPath ? resolveCodexSkillLocationFromPath(skill.path, vaultPath) : null;
  const isVault = skill.scope === 'repo' && location !== null;

  return {
    id: buildSkillId(skill, isVault ? location : null),
    providerId: 'codex',
    kind: 'skill',
    name: skill.name,
    description: getCodexSkillDescription(skill),
    content: '',
    scope: isVault ? 'vault' : 'user',
    source: 'user',
    isEditable: isVault,
    isDeletable: isVault,
    displayPrefix: '$',
    insertPrefix: '$',
    sourceFilePath: skill.path,
    ...(isVault
      ? {
          persistenceKey: createCodexSkillPersistenceKey({
            rootId: location.rootId,
            currentName: location.name,
          }),
        }
      : {}),
  };
}
```

In `listVaultEntries`, set `sourceFilePath: listedSkill.path` on each pushed entry:

```typescript
entries.push({
  id: `${CODEX_SKILL_ID_PREFIX}${location.rootId}-${storedSkill.name}`,
  providerId: 'codex',
  kind: 'skill',
  name: storedSkill.name,
  description: storedSkill.description ?? getCodexSkillDescription(listedSkill),
  content: storedSkill.content,
  scope: 'vault',
  source: 'user',
  isEditable: true,
  isDeletable: true,
  displayPrefix: '$',
  insertPrefix: '$',
  sourceFilePath: listedSkill.path,
  persistenceKey: createCodexSkillPersistenceKey({
    rootId: location.rootId,
    currentName: location.name,
  }),
});
```

- [ ] **Step 4: Run test, verify passes**

Run: `npm run test -- --selectProjects unit -t "CodexSkillCatalog sourceFilePath"`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/providers/codex/commands/CodexSkillCatalog.ts \
        tests/unit/providers/codex/commands/CodexSkillCatalog.test.ts
git commit -m "feat(codex): expose sourceFilePath on skill catalog entries"
```

---

## Task 4: Define `SkillTabEntry` and `ProviderRecord` types

**Files:**
- Create: `src/features/quickActions/skills/types.ts`

- [ ] **Step 1: Create the type file**

```typescript
// src/features/quickActions/skills/types.ts
import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderId } from '../../../core/providers/types';

/**
 * A vault-discovered skill surfaced in the Quick Actions modal Skills tab.
 * Aggregated from every registered provider's command catalog.
 */
export interface SkillTabEntry {
  /** Aggregator-assigned ID, unique across providers, e.g. "claude:skill-tdd". */
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
  /** Cached at listing time. Used to gate execution and dim disabled rows. */
  providerEnabled: boolean;
}

/**
 * Aggregator's per-provider view. The factory injected into `VaultSkillAggregator`
 * builds one of these for every registered provider before listing skills.
 */
export interface ProviderRecord {
  providerId: ProviderId;
  displayName: string;
  isEnabled: boolean;
  commandCatalog: ProviderCommandCatalog;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/quickActions/skills/types.ts
git commit -m "feat(quickActions): define SkillTabEntry and ProviderRecord types"
```

---

## Task 5: Write failing tests for `VaultSkillAggregator`

**Files:**
- Create: `tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts
import { VaultSkillAggregator } from '@/features/quickActions/skills/VaultSkillAggregator';
import type { ProviderRecord } from '@/features/quickActions/skills/types';
import type { ProviderCommandEntry } from '@/core/providers/commands/ProviderCommandEntry';

function makeRecord(overrides: Partial<ProviderRecord> & { entries: ProviderCommandEntry[] | (() => Promise<ProviderCommandEntry[]>) }): ProviderRecord {
  const { entries, ...rest } = overrides;
  return {
    providerId: 'claude',
    displayName: 'Claude',
    isEnabled: true,
    commandCatalog: {
      setRuntimeCommands: jest.fn(),
      listDropdownEntries: jest.fn().mockResolvedValue([]),
      listVaultEntries: typeof entries === 'function'
        ? (entries as () => Promise<ProviderCommandEntry[]>)
        : jest.fn().mockResolvedValue(entries),
      saveVaultEntry: jest.fn(),
      deleteVaultEntry: jest.fn(),
      getDropdownConfig: jest.fn().mockReturnValue({
        providerId: rest.providerId ?? 'claude',
        triggerChars: ['/'],
        builtInPrefix: '/',
        skillPrefix: '/',
        commandPrefix: '/',
      }),
      refresh: jest.fn(),
    },
    ...rest,
  };
}

function makeSkillEntry(overrides: Partial<ProviderCommandEntry>): ProviderCommandEntry {
  return {
    id: 'skill-default',
    providerId: 'claude',
    kind: 'skill',
    name: 'default',
    description: 'desc',
    content: '',
    scope: 'vault',
    source: 'user',
    isEditable: true,
    isDeletable: true,
    displayPrefix: '/',
    insertPrefix: '/',
    ...overrides,
  };
}

describe('VaultSkillAggregator', () => {
  it('returns empty array when no providers registered', async () => {
    const agg = new VaultSkillAggregator(() => []);
    expect(await agg.listAll()).toEqual([]);
  });

  it('filters out non-skill entries', async () => {
    const records = [
      makeRecord({
        entries: [
          makeSkillEntry({ id: 'skill-foo', name: 'foo' }),
          makeSkillEntry({ id: 'cmd-bar', name: 'bar', kind: 'command' }),
        ],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records);
    const result = await agg.listAll();
    expect(result.map((e) => e.name)).toEqual(['foo']);
  });

  it('tags entries with providerId and providerDisplayName', async () => {
    const records = [
      makeRecord({
        providerId: 'codex',
        displayName: 'Codex',
        entries: [makeSkillEntry({ id: 'codex-skill-x', name: 'x', providerId: 'codex', insertPrefix: '$' })],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records);
    const [entry] = await agg.listAll();
    expect(entry.providerId).toBe('codex');
    expect(entry.providerDisplayName).toBe('Codex');
    expect(entry.id).toBe('codex:codex-skill-x');
    expect(entry.insertPrefix).toBe('$');
  });

  it('sorts skills alphabetically within each provider', async () => {
    const records = [
      makeRecord({
        entries: [
          makeSkillEntry({ id: 'skill-zebra', name: 'zebra' }),
          makeSkillEntry({ id: 'skill-apple', name: 'apple' }),
          makeSkillEntry({ id: 'skill-mango', name: 'mango' }),
        ],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records);
    const result = await agg.listAll();
    expect(result.map((e) => e.name)).toEqual(['apple', 'mango', 'zebra']);
  });

  it('preserves provider order from factory', async () => {
    const records = [
      makeRecord({ providerId: 'claude', displayName: 'Claude', entries: [makeSkillEntry({ id: 'a', name: 'a' })] }),
      makeRecord({ providerId: 'codex', displayName: 'Codex', entries: [makeSkillEntry({ id: 'b', name: 'b', providerId: 'codex', insertPrefix: '$' })] }),
    ];
    const agg = new VaultSkillAggregator(() => records);
    const result = await agg.listAll();
    expect(result.map((e) => e.providerId)).toEqual(['claude', 'codex']);
  });

  it('swallows a per-provider throw and keeps others', async () => {
    const records = [
      makeRecord({
        providerId: 'claude',
        entries: () => Promise.reject(new Error('boom')),
      }),
      makeRecord({
        providerId: 'codex',
        displayName: 'Codex',
        entries: [makeSkillEntry({ id: 'b', name: 'b', providerId: 'codex', insertPrefix: '$' })],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records);
    const result = await agg.listAll();
    expect(result.map((e) => e.providerId)).toEqual(['codex']);
  });

  it('maps undefined sourceFilePath to null', async () => {
    const records = [
      makeRecord({
        entries: [makeSkillEntry({ id: 'skill-r', name: 'r' })], // no sourceFilePath
      }),
    ];
    const agg = new VaultSkillAggregator(() => records);
    const [entry] = await agg.listAll();
    expect(entry.sourceFilePath).toBeNull();
  });

  it('passes through sourceFilePath when present', async () => {
    const records = [
      makeRecord({
        entries: [makeSkillEntry({ id: 'skill-r', name: 'r', sourceFilePath: '.claude/skills/r/SKILL.md' })],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records);
    const [entry] = await agg.listAll();
    expect(entry.sourceFilePath).toBe('.claude/skills/r/SKILL.md');
  });

  it('reflects providerEnabled flag onto each entry', async () => {
    const records = [
      makeRecord({
        isEnabled: false,
        entries: [makeSkillEntry({ id: 'skill-x', name: 'x' })],
      }),
    ];
    const agg = new VaultSkillAggregator(() => records);
    const [entry] = await agg.listAll();
    expect(entry.providerEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npm run test -- --selectProjects unit -t "VaultSkillAggregator"`
Expected: FAIL — module does not exist yet.

---

## Task 6: Implement `VaultSkillAggregator`

**Files:**
- Create: `src/features/quickActions/skills/VaultSkillAggregator.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/features/quickActions/skills/VaultSkillAggregator.ts
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import type { ProviderRecord, SkillTabEntry } from './types';

export class VaultSkillAggregator {
  constructor(private getProviderRecords: () => ProviderRecord[]) {}

  async listAll(): Promise<SkillTabEntry[]> {
    const records = this.getProviderRecords();
    const buckets = await Promise.all(
      records.map((r) => this.collectFromProvider(r).catch(() => [] as SkillTabEntry[])),
    );
    return buckets.flat();
  }

  private async collectFromProvider(record: ProviderRecord): Promise<SkillTabEntry[]> {
    const entries = await record.commandCatalog.listVaultEntries();
    return entries
      .filter((e) => e.kind === 'skill')
      .map((e) => this.mapEntry(e, record))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private mapEntry(entry: ProviderCommandEntry, record: ProviderRecord): SkillTabEntry {
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

- [ ] **Step 2: Run tests, verify passes**

Run: `npm run test -- --selectProjects unit -t "VaultSkillAggregator"`
Expected: all VaultSkillAggregator tests PASS.

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/quickActions/skills/VaultSkillAggregator.ts \
        tests/unit/features/quickActions/skills/VaultSkillAggregator.test.ts
git commit -m "feat(quickActions): add VaultSkillAggregator across providers"
```

---

## Task 7: Write failing tests for `runVaultSkill`

**Files:**
- Create: `tests/unit/features/quickActions/skills/runVaultSkill.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// tests/unit/features/quickActions/skills/runVaultSkill.test.ts
import { Notice, TFile, TFolder } from 'obsidian';
import { runVaultSkill } from '@/features/quickActions/skills/runVaultSkill';
import type { SkillTabEntry } from '@/features/quickActions/skills/types';

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  TFile: class TFile { path = ''; },
  TFolder: class TFolder { path = ''; },
}));

jest.mock('@/i18n/i18n', () => ({
  t: (key: string, params?: Record<string, string>) => params
    ? `${key}:${JSON.stringify(params)}`
    : key,
}));

jest.mock('@/features/chat/tabs/providerResolution', () => ({
  getTabProviderId: jest.fn((tab: { providerId?: string }) => tab.providerId ?? 'claude'),
}));

function makeEntry(overrides: Partial<SkillTabEntry> = {}): SkillTabEntry {
  return {
    id: 'claude:skill-tdd',
    providerId: 'claude',
    providerDisplayName: 'Claude',
    name: 'tdd',
    description: 'red-green-refactor',
    insertPrefix: '/',
    sourceFilePath: '.claude/skills/tdd/SKILL.md',
    providerEnabled: true,
    ...overrides,
  };
}

function makeTab(opts: { id?: string; providerId?: string; lifecycleState?: string } = {}) {
  return {
    id: opts.id ?? 'tab-1',
    providerId: opts.providerId ?? 'claude',
    lifecycleState: opts.lifecycleState ?? 'blank',
    ui: {
      fileContextManager: {
        attachFileAsPill: jest.fn(),
        attachFolderAsPill: jest.fn(),
      },
    },
    controllers: {
      inputController: {
        sendMessage: jest.fn(),
      },
    },
  };
}

function makePlugin(opts: {
  activeTab?: ReturnType<typeof makeTab> | null;
  newTab?: ReturnType<typeof makeTab> | null;
  canCreate?: boolean;
  allTabs?: ReturnType<typeof makeTab>[];
} = {}) {
  const tabManager = {
    getActiveTab: jest.fn(() => opts.activeTab ?? null),
    getAllTabs: jest.fn(() => opts.allTabs ?? (opts.activeTab ? [opts.activeTab] : [])),
    canCreateTab: jest.fn(() => opts.canCreate ?? true),
    createTab: jest.fn().mockResolvedValue(opts.newTab ?? null),
    switchToTab: jest.fn().mockResolvedValue(undefined),
  };
  const view = { getTabManager: jest.fn(() => tabManager) };
  return {
    plugin: {
      app: {},
      getView: jest.fn(() => view),
      activateView: jest.fn().mockResolvedValue(undefined),
    },
    tabManager,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('runVaultSkill', () => {
  it('shows Notice and aborts when provider is disabled', async () => {
    const { plugin } = makePlugin();
    await runVaultSkill(plugin as any, makeEntry({ providerEnabled: false }), null);
    expect(Notice).toHaveBeenCalled();
    const call = (Notice as unknown as jest.Mock).mock.calls[0][0] as string;
    expect(call).toContain('quickActions.skills.providerDisabled');
  });

  it('reuses blank active tab when provider matches', async () => {
    const activeTab = makeTab({ providerId: 'claude', lifecycleState: 'blank' });
    const { plugin, tabManager } = makePlugin({ activeTab });
    await runVaultSkill(plugin as any, makeEntry(), null);
    expect(tabManager.createTab).not.toHaveBeenCalled();
    expect(tabManager.switchToTab).toHaveBeenCalledWith('tab-1');
  });

  it('creates new tab with defaultProviderId when active tab provider mismatches', async () => {
    const activeTab = makeTab({ providerId: 'codex', lifecycleState: 'blank' });
    const newTab = makeTab({ id: 'tab-2', providerId: 'claude' });
    const { plugin, tabManager } = makePlugin({ activeTab, newTab });

    await runVaultSkill(plugin as any, makeEntry(), null);

    expect(tabManager.createTab).toHaveBeenCalledWith(
      null,
      undefined,
      expect.objectContaining({ activate: false, defaultProviderId: 'claude' }),
    );
    expect(tabManager.switchToTab).toHaveBeenCalledWith('tab-2');
  });

  it('reuses a blank tab on the target provider when active mismatches but blank match exists', async () => {
    const activeTab = makeTab({ id: 'tab-1', providerId: 'codex', lifecycleState: 'active' });
    const blankMatch = makeTab({ id: 'tab-2', providerId: 'claude', lifecycleState: 'blank' });
    const { plugin, tabManager } = makePlugin({
      activeTab,
      allTabs: [activeTab, blankMatch],
    });

    await runVaultSkill(plugin as any, makeEntry(), null);

    expect(tabManager.createTab).not.toHaveBeenCalled();
    expect(tabManager.switchToTab).toHaveBeenCalledWith('tab-2');
  });

  it('creates new tab when active matches but is not blank', async () => {
    const activeTab = makeTab({ providerId: 'claude', lifecycleState: 'active' });
    const newTab = makeTab({ id: 'tab-2', providerId: 'claude' });
    const { plugin, tabManager } = makePlugin({ activeTab, newTab });

    await runVaultSkill(plugin as any, makeEntry(), null);

    expect(tabManager.createTab).toHaveBeenCalled();
    expect(tabManager.switchToTab).toHaveBeenCalledWith('tab-2');
  });

  it('shows tab-limit Notice when canCreateTab is false', async () => {
    const activeTab = makeTab({ providerId: 'codex', lifecycleState: 'active' });
    const { plugin, tabManager } = makePlugin({ activeTab, canCreate: false });

    await runVaultSkill(plugin as any, makeEntry(), null);

    expect(Notice).toHaveBeenCalledWith('quickActions.contextMenu.tabLimitReached');
    expect(tabManager.switchToTab).not.toHaveBeenCalled();
  });

  it('attaches file pill AFTER switchToTab', async () => {
    const activeTab = makeTab({ providerId: 'claude', lifecycleState: 'blank' });
    const { plugin } = makePlugin({ activeTab });
    const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });

    await runVaultSkill(plugin as any, makeEntry(), file as TFile);

    expect(activeTab.ui.fileContextManager.attachFileAsPill).toHaveBeenCalledWith('note.md');
  });

  it('attaches folder pill for TFolder', async () => {
    const activeTab = makeTab({ providerId: 'claude', lifecycleState: 'blank' });
    const { plugin } = makePlugin({ activeTab });
    const folder = Object.assign(Object.create(TFolder.prototype), { path: 'docs' });

    await runVaultSkill(plugin as any, makeEntry(), folder as TFolder);

    expect(activeTab.ui.fileContextManager.attachFolderAsPill).toHaveBeenCalledWith('docs');
  });

  it('sends `${insertPrefix}${name}` to the target tab', async () => {
    const activeTab = makeTab({ providerId: 'claude', lifecycleState: 'blank' });
    const { plugin } = makePlugin({ activeTab });
    await runVaultSkill(plugin as any, makeEntry({ name: 'brainstorming' }), null);
    expect(activeTab.controllers.inputController.sendMessage).toHaveBeenCalledWith({
      content: '/brainstorming',
    });
  });

  it('sends with $ prefix for Codex skills', async () => {
    const activeTab = makeTab({ providerId: 'codex', lifecycleState: 'blank' });
    const { plugin } = makePlugin({ activeTab });
    const entry = makeEntry({
      providerId: 'codex',
      providerDisplayName: 'Codex',
      insertPrefix: '$',
      name: 'my-codex',
    });
    await runVaultSkill(plugin as any, entry, null);
    expect(activeTab.controllers.inputController.sendMessage).toHaveBeenCalledWith({
      content: '$my-codex',
    });
  });

  it('activates the view if no view is open', async () => {
    const activeTab = makeTab({ providerId: 'claude', lifecycleState: 'blank' });
    const tabManager = {
      getActiveTab: jest.fn(() => activeTab),
      getAllTabs: jest.fn(() => [activeTab]),
      canCreateTab: jest.fn(() => true),
      createTab: jest.fn(),
      switchToTab: jest.fn().mockResolvedValue(undefined),
    };
    const view = { getTabManager: jest.fn(() => tabManager) };
    const plugin = {
      app: {},
      getView: jest.fn().mockReturnValueOnce(null).mockReturnValueOnce(view),
      activateView: jest.fn().mockResolvedValue(undefined),
    };

    await runVaultSkill(plugin as any, makeEntry(), null);

    expect(plugin.activateView).toHaveBeenCalledTimes(1);
    expect(activeTab.controllers.inputController.sendMessage).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npm run test -- --selectProjects unit -t "runVaultSkill"`
Expected: FAIL — module does not exist yet.

---

## Task 8: Implement `runVaultSkill`

**Files:**
- Create: `src/features/quickActions/skills/runVaultSkill.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/features/quickActions/skills/runVaultSkill.ts
import { Notice, type TAbstractFile, TFile, TFolder } from 'obsidian';

import { getTabProviderId } from '@/features/chat/tabs/providerResolution';
import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';
import type { SkillTabEntry } from './types';

/**
 * Routes execution of a vault skill to a chat tab matching the skill's
 * provider, attaches the optional file/folder as a context pill, and sends
 * the provider-native skill invocation (`$name` or `/name`).
 *
 * Tab routing order:
 * 1. Active tab matches provider and is blank → reuse.
 * 2. Active tab matches provider but is not blank → create new tab.
 * 3. Active tab provider mismatches:
 *    a. Another blank tab on the target provider exists → reuse it.
 *    b. Else → create new tab with `defaultProviderId`.
 *
 * Pill attach MUST happen AFTER switchToTab — initializeWelcome on a blank
 * tab wipes any pill attached before the switch. See openContextMenuQuickAction
 * for the same ordering rationale.
 */
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

  const target = await resolveTargetTab(tabManager, plugin, entry.providerId);
  if (!target) {
    new Notice(t('quickActions.contextMenu.tabLimitReached'));
    return;
  }

  await tabManager.switchToTab(target.id);

  if (file instanceof TFile) {
    target.ui.fileContextManager?.attachFileAsPill(file.path);
  } else if (file instanceof TFolder) {
    target.ui.fileContextManager?.attachFolderAsPill(file.path);
  }

  const content = `${entry.insertPrefix}${entry.name}`;
  void target.controllers.inputController?.sendMessage({ content });
}

async function resolveTargetTab(
  tabManager: NonNullable<ReturnType<NonNullable<ReturnType<ClaudianPlugin['getView']>>['getTabManager']>>,
  plugin: ClaudianPlugin,
  targetProviderId: string,
): Promise<TabLike | null> {
  const activeTab = tabManager.getActiveTab();

  if (activeTab) {
    const activeProvider = getTabProviderId(activeTab, plugin);
    if (activeProvider === targetProviderId) {
      if (activeTab.lifecycleState === 'blank') {
        return activeTab as unknown as TabLike;
      }
      return createTabForProvider(tabManager, targetProviderId);
    }
  }

  // Active tab provider mismatches (or no active tab). Look for an existing
  // blank tab on the target provider before creating a new one.
  const allTabs = typeof tabManager.getAllTabs === 'function' ? tabManager.getAllTabs() : [];
  const blankMatch = allTabs.find((tab) => {
    if (tab.lifecycleState !== 'blank') return false;
    return getTabProviderId(tab, plugin) === targetProviderId;
  });
  if (blankMatch) {
    return blankMatch as unknown as TabLike;
  }

  return createTabForProvider(tabManager, targetProviderId);
}

async function createTabForProvider(
  tabManager: { canCreateTab: () => boolean; createTab: (...args: unknown[]) => Promise<unknown> },
  providerId: string,
): Promise<TabLike | null> {
  if (!tabManager.canCreateTab()) {
    return null;
  }
  const created = await tabManager.createTab(null, undefined, {
    activate: false,
    defaultProviderId: providerId,
  });
  return (created as TabLike) ?? null;
}

/** Minimal structural type covering the fields runVaultSkill touches on a tab. */
type TabLike = {
  id: string;
  lifecycleState: string;
  ui: {
    fileContextManager?: {
      attachFileAsPill: (path: string) => void;
      attachFolderAsPill: (path: string) => void;
    };
  };
  controllers: {
    inputController?: {
      sendMessage: (input: { content: string }) => void;
    };
  };
};
```

- [ ] **Step 2: Verify `TabManager.getAllTabs` exists**

Run: `grep -n "getAllTabs" src/features/chat/tabs/TabManager.ts`
Expected: at least one match. If absent, add it as a public method returning `Array.from(this.tabs.values())`. Most likely already present — search first, only add if missing.

If missing, edit `src/features/chat/tabs/TabManager.ts`:

```typescript
/** Returns all open tabs in insertion order. */
getAllTabs(): TabData[] {
  return Array.from(this.tabs.values());
}
```

- [ ] **Step 3: Run runVaultSkill tests, verify passes**

Run: `npm run test -- --selectProjects unit -t "runVaultSkill"`
Expected: all runVaultSkill tests PASS.

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/skills/runVaultSkill.ts \
        tests/unit/features/quickActions/skills/runVaultSkill.test.ts \
        src/features/chat/tabs/TabManager.ts
git commit -m "feat(quickActions): runVaultSkill routes execution to provider-matched tab"
```

---

## Task 9: Add i18n keys

**Files:**
- Modify: `src/i18n/locales/en.json` and the other 9 locale files

- [ ] **Step 1: Read the English file**

Run: `cat src/i18n/locales/en.json | python -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('quickActions', {}).get('modal', {}), indent=2))"`

Confirm the existing `quickActions.modal.*` structure so the new keys nest correctly.

- [ ] **Step 2: Add the new English keys**

Open `src/i18n/locales/en.json` and extend `quickActions`:

```json
{
  "quickActions": {
    "modal": {
      "tabs": {
        "quickActions": "Quick actions",
        "skills": "Skills"
      },
      "...": "existing keys preserved unchanged"
    },
    "skills": {
      "emptyAll": "No vault skills found.",
      "emptyHint": "Skills live in .claude/skills/, .codex/skills/, and .agents/skills/.",
      "providerDisabled": "Provider '{provider}' is disabled. Enable it in settings.",
      "editInSettings": "Edit in {provider} settings",
      "disabledBadge": "disabled",
      "searchPlaceholder": "Search skills by name or description…",
      "noResults": "No skills match your search."
    }
  }
}
```

Add `quickActions.modal.tabs` alongside the existing keys; add `quickActions.skills` as a sibling of `quickActions.modal`.

- [ ] **Step 3: Mirror keys in every other locale file**

For each of `de.json, es.json, fr.json, ja.json, ko.json, pt.json, ru.json, zh-CN.json, zh-TW.json`: add the same key shapes with English values as fallback (matching the project convention that non-English locales fall back to English where translations are pending — i18n already has a fallback chain to English, but explicit keys keep type-checker happy).

Per-locale change is identical structure; copy the English values verbatim. Translators can fill in later via a follow-up.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `TranslationKey` is union-typed against the English file shape, the union now includes the new keys.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/*.json
git commit -m "i18n(quickActions): add Skills tab strings to all locales"
```

---

## Task 10: Write failing modal tab tests

**Files:**
- Create: `tests/unit/features/quickActions/ui/QuickActionsModal.test.ts`

The existing modal has no direct tests today (only `openContextMenuQuickAction` is tested). Start a focused spec on the new behavior.

- [ ] **Step 1: Write the test file**

```typescript
// tests/unit/features/quickActions/ui/QuickActionsModal.test.ts
import { QuickActionsModal } from '@/features/quickActions/ui/QuickActionsModal';
import type { SkillTabEntry } from '@/features/quickActions/skills/types';
import type { QuickAction } from '@/features/quickActions/types';

jest.mock('obsidian', () => {
  class Modal {
    app: unknown;
    modalEl: HTMLElement;
    contentEl: HTMLElement;
    constructor(app: unknown) {
      this.app = app;
      this.modalEl = document.createElement('div');
      this.contentEl = document.createElement('div');
    }
    setTitle = jest.fn();
    open = jest.fn(() => this.onOpen?.());
    close = jest.fn();
    onOpen?: () => void;
  }
  return {
    Modal,
    Notice: jest.fn(),
    setIcon: jest.fn(),
  };
});

jest.mock('@/i18n/i18n', () => ({
  t: (key: string) => key,
}));

function makeStorage(actions: QuickAction[] = []) {
  return {
    loadAll: jest.fn().mockResolvedValue(actions),
    save: jest.fn(),
    delete: jest.fn(),
  };
}

function makeAggregator(entries: SkillTabEntry[] = []) {
  return {
    listAll: jest.fn().mockResolvedValue(entries),
  };
}

function makeSkill(overrides: Partial<SkillTabEntry> = {}): SkillTabEntry {
  return {
    id: 'claude:skill-tdd',
    providerId: 'claude',
    providerDisplayName: 'Claude',
    name: 'tdd',
    description: 'red-green-refactor',
    insertPrefix: '/',
    sourceFilePath: '.claude/skills/tdd/SKILL.md',
    providerEnabled: true,
    ...overrides,
  };
}

async function openModal(overrides: Partial<Parameters<typeof QuickActionsModal['prototype']['constructor']>[1]> = {}) {
  const callbacks = {
    onRun: jest.fn(),
    onRunSkill: jest.fn(),
    storage: makeStorage() as any,
    aggregator: makeAggregator() as any,
    ...overrides,
  };
  const modal = new QuickActionsModal({} as any, callbacks);
  await modal.open();
  // Drain microtasks so async refreshList settles.
  await new Promise((r) => setImmediate(r));
  return { modal, callbacks };
}

describe('QuickActionsModal tabs', () => {
  it('renders Quick Actions and Skills tabs with Quick Actions selected by default', async () => {
    const { modal } = await openModal();
    const tabs = modal.contentEl.querySelectorAll('.claudian-quick-actions-tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].classList.contains('is-active')).toBe(true);
    expect(tabs[0].textContent).toBe('quickActions.modal.tabs.quickActions');
    expect(tabs[1].textContent).toBe('quickActions.modal.tabs.skills');
  });

  it('switching to Skills tab triggers aggregator and renders skill rows', async () => {
    const aggregator = makeAggregator([makeSkill({ name: 'brainstorming' })]);
    const { modal } = await openModal({ aggregator: aggregator as any });

    const tabs = modal.contentEl.querySelectorAll('.claudian-quick-actions-tab') as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setImmediate(r));

    expect(aggregator.listAll).toHaveBeenCalled();
    const skillRow = modal.contentEl.querySelector('.claudian-quick-actions-skill-row');
    expect(skillRow).not.toBeNull();
    expect(skillRow?.textContent).toContain('brainstorming');
  });

  it('groups skills by provider with header rows', async () => {
    const aggregator = makeAggregator([
      makeSkill({ id: 'claude:skill-a', providerId: 'claude', name: 'a' }),
      makeSkill({
        id: 'codex:codex-skill-b',
        providerId: 'codex',
        providerDisplayName: 'Codex',
        insertPrefix: '$',
        name: 'b',
      }),
    ]);
    const { modal } = await openModal({ aggregator: aggregator as any });

    const tabs = modal.contentEl.querySelectorAll('.claudian-quick-actions-tab') as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setImmediate(r));

    const headers = modal.contentEl.querySelectorAll('.claudian-quick-actions-provider-header');
    expect(Array.from(headers).map((h) => h.textContent)).toEqual(['Claude', 'Codex']);
  });

  it('clicking a skill row fires onRunSkill and closes the modal', async () => {
    const aggregator = makeAggregator([makeSkill({ name: 'tdd' })]);
    const { modal, callbacks } = await openModal({ aggregator: aggregator as any });
    const tabs = modal.contentEl.querySelectorAll('.claudian-quick-actions-tab') as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setImmediate(r));

    const row = modal.contentEl.querySelector('.claudian-quick-actions-skill-row-main') as HTMLElement;
    row.click();

    expect(callbacks.onRunSkill).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'claude:skill-tdd', name: 'tdd' }),
    );
    expect(modal.close).toHaveBeenCalled();
  });

  it('hides edit button when sourceFilePath is null', async () => {
    const aggregator = makeAggregator([makeSkill({ name: 'runtime', sourceFilePath: null })]);
    const { modal } = await openModal({ aggregator: aggregator as any });
    const tabs = modal.contentEl.querySelectorAll('.claudian-quick-actions-tab') as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setImmediate(r));

    const edit = modal.contentEl.querySelector('.claudian-quick-actions-skill-edit');
    expect(edit).toBeNull();
  });

  it('applies disabled-provider modifier class', async () => {
    const aggregator = makeAggregator([makeSkill({ providerEnabled: false })]);
    const { modal } = await openModal({ aggregator: aggregator as any });
    const tabs = modal.contentEl.querySelectorAll('.claudian-quick-actions-tab') as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setImmediate(r));

    const row = modal.contentEl.querySelector('.claudian-quick-actions-skill-row');
    expect(row?.classList.contains('is-provider-disabled')).toBe(true);
  });

  it('renders the all-empty copy when aggregator returns []', async () => {
    const { modal } = await openModal();
    const tabs = modal.contentEl.querySelectorAll('.claudian-quick-actions-tab') as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setImmediate(r));

    const empty = modal.contentEl.querySelector('.claudian-quick-actions-skills-empty');
    expect(empty?.textContent).toContain('quickActions.skills.emptyAll');
  });

  it('clears the search input when switching tabs', async () => {
    const aggregator = makeAggregator([makeSkill()]);
    const storage = makeStorage([
      { id: 'a', name: 'one', description: 'd', prompt: 'p', filePath: 'qa/a.md' },
    ]);
    const { modal } = await openModal({ aggregator: aggregator as any, storage: storage as any });

    const search = modal.contentEl.querySelector('input[type=search]') as HTMLInputElement;
    search.value = 'foo';
    search.dispatchEvent(new Event('input'));

    const tabs = modal.contentEl.querySelectorAll('.claudian-quick-actions-tab') as NodeListOf<HTMLElement>;
    tabs[1].click();
    await new Promise((r) => setImmediate(r));

    const refreshedSearch = modal.contentEl.querySelector('input[type=search]') as HTMLInputElement;
    expect(refreshedSearch.value).toBe('');
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npm run test -- --selectProjects unit -t "QuickActionsModal tabs"`
Expected: every spec fails (modal does not yet render tabs, aggregator callback shape is rejected, etc.).

---

## Task 11: Extend `QuickActionsModal` with tab strip + skill rendering

**Files:**
- Modify: `src/features/quickActions/ui/QuickActionsModal.ts`

- [ ] **Step 1: Update the callbacks interface**

Edit `src/features/quickActions/ui/QuickActionsModal.ts`. Update the exported callbacks interface and add the skill type import:

```typescript
import type { App } from 'obsidian';
import { Modal, Notice, setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { VaultSkillAggregator } from '../skills/VaultSkillAggregator';
import type { SkillTabEntry } from '../skills/types';
import type { QuickActionStorage } from '../QuickActionStorage';
import type { QuickAction } from '../types';
import { QuickActionEditorModal } from './QuickActionEditorModal';

export interface QuickActionsModalCallbacks {
  onRun: (action: QuickAction) => void;
  onRunSkill: (entry: SkillTabEntry) => void;
  storage: QuickActionStorage;
  aggregator: VaultSkillAggregator;
}

type ActiveTab = 'quickActions' | 'skills';
```

- [ ] **Step 2: Add tab state and rendering**

Add tab state fields to the class and a render helper. Replace the body of `onOpen` to render the tab strip above the existing search + list. Keep the existing Quick Actions code path entirely unchanged inside its own `renderQuickActionsBody()` helper; add a `renderSkillsBody()` helper for the new tab.

Replace the existing `QuickActionsModal` body with the version below (the full class — paste verbatim):

```typescript
export class QuickActionsModal extends Modal {
  private callbacks: QuickActionsModalCallbacks;
  private activeTab: ActiveTab = 'quickActions';
  private tabStripEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;

  // Quick Actions tab state
  private introEl: HTMLElement | null = null;
  private searchWrapEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private actions: QuickAction[] = [];
  private filter = '';

  // Skills tab state
  private skillSearchInputEl: HTMLInputElement | null = null;
  private skillListEl: HTMLElement | null = null;
  private skills: SkillTabEntry[] = [];
  private skillFilter = '';

  constructor(app: App, callbacks: QuickActionsModalCallbacks) {
    super(app);
    this.callbacks = callbacks;
  }

  onOpen(): void {
    this.setTitle(t('quickActions.modal.title'));
    this.modalEl.addClass('claudian-sp-modal', 'claudian-quick-actions-modal');

    this.tabStripEl = this.contentEl.createDiv({ cls: 'claudian-quick-actions-tabs' });
    this.renderTabStrip();

    this.bodyEl = this.contentEl.createDiv({ cls: 'claudian-quick-actions-body' });
    void this.renderActiveTab();
  }

  private renderTabStrip(): void {
    if (!this.tabStripEl) return;
    this.tabStripEl.empty();

    const entries: Array<{ key: ActiveTab; label: string }> = [
      { key: 'quickActions', label: t('quickActions.modal.tabs.quickActions') },
      { key: 'skills', label: t('quickActions.modal.tabs.skills') },
    ];

    for (const entry of entries) {
      const tab = this.tabStripEl.createEl('button', {
        cls: 'claudian-quick-actions-tab',
        text: entry.label,
        attr: { type: 'button' },
      });
      if (this.activeTab === entry.key) {
        tab.addClass('is-active');
      }
      tab.addEventListener('click', () => {
        if (this.activeTab === entry.key) return;
        this.activeTab = entry.key;
        this.renderTabStrip();
        void this.renderActiveTab();
      });
    }
  }

  private async renderActiveTab(): Promise<void> {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    this.introEl = null;
    this.searchWrapEl = null;
    this.searchInputEl = null;
    this.listEl = null;
    this.skillSearchInputEl = null;
    this.skillListEl = null;
    this.filter = '';
    this.skillFilter = '';

    if (this.activeTab === 'quickActions') {
      this.renderQuickActionsBody(this.bodyEl);
      await this.refreshList();
      this.searchInputEl?.focus();
    } else {
      this.renderSkillsBody(this.bodyEl);
      await this.refreshSkills();
      this.skillSearchInputEl?.focus();
    }
  }

  // ============================================================
  // Quick Actions tab (existing behavior, refactored into a helper)
  // ============================================================

  private renderQuickActionsBody(host: HTMLElement): void {
    this.introEl = host.createDiv({ cls: 'claudian-quick-actions-intro' });

    this.searchWrapEl = host.createDiv({ cls: 'claudian-quick-actions-search' });
    const inputContainer = this.searchWrapEl.createDiv({ cls: 'claudian-quick-actions-search-container' });
    const placeholder = t('quickActions.modal.searchPlaceholder');
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

    const resetBtn = inputContainer.createEl('button', {
      cls: 'claudian-quick-actions-search-reset',
      text: '✕',
      attr: { title: 'Clear search', 'aria-label': 'Clear search' },
    });
    resetBtn.addEventListener('click', () => {
      this.setFilter('');
    });

    this.listEl = host.createDiv({ cls: 'claudian-quick-actions-list' });

    const footer = host.createDiv({ cls: 'claudian-quick-actions-footer' });
    footer.createEl('button', {
      cls: 'mod-cta',
      text: t('quickActions.modal.add'),
    }).addEventListener('click', () => {
      this.openEditor(null);
    });
  }

  private runFirstMatch(): void {
    const filtered = this.applyFilter(this.actions);
    const first = filtered[0];
    if (!first) return;
    this.callbacks.onRun(first);
    this.close();
  }

  private async refreshList(): Promise<void> {
    if (!this.listEl || !this.introEl) return;
    this.actions = await this.callbacks.storage.loadAll();
    this.renderIntro();
    this.renderList();
  }

  private renderList(): void {
    if (!this.listEl || !this.searchWrapEl) return;
    this.listEl.empty();

    if (this.actions.length === 0) {
      this.listEl.addClass('claudian-quick-actions-list--empty');
      this.searchWrapEl.addClass('claudian-quick-actions-search--hidden');
      return;
    }

    this.listEl.removeClass('claudian-quick-actions-list--empty');
    this.searchWrapEl.removeClass('claudian-quick-actions-search--hidden');

    const filtered = this.applyFilter(this.actions);
    if (filtered.length === 0) {
      this.listEl.createDiv({
        cls: 'claudian-quick-actions-empty-results',
        text: t('quickActions.modal.noResults'),
      });
      return;
    }

    for (const action of filtered) {
      this.renderRow(action);
    }
  }

  private setFilter(value: string): void {
    this.filter = value;
    if (this.searchInputEl) {
      this.searchInputEl.value = value;
      this.searchInputEl.focus();
    }
    this.renderList();
  }

  private applyFilter(actions: QuickAction[]): QuickAction[] {
    const needle = this.filter.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter((a) => {
      if (a.name.toLowerCase().includes(needle)) return true;
      if (a.description.toLowerCase().includes(needle)) return true;
      if (a.tags?.some((tag) => tag.toLowerCase().includes(needle))) return true;
      return false;
    });
  }

  private renderIntro(): void {
    if (!this.introEl) return;
    this.introEl.empty();

    if (this.actions.length === 0) {
      this.introEl.addClass('claudian-quick-actions-intro--empty');
      this.introEl.createEl('p', {
        cls: 'claudian-quick-actions-intro-lead',
        text: t('quickActions.modal.emptyLead'),
      });
      const hints = this.introEl.createEl('ul', { cls: 'claudian-quick-actions-intro-hints' });
      hints.createEl('li', { text: t('quickActions.modal.emptyHintVault') });
      hints.createEl('li', { text: t('quickActions.modal.emptyHintRun') });
      hints.createEl('li', { text: t('quickActions.modal.emptyHintCreate') });
      return;
    }

    this.introEl.removeClass('claudian-quick-actions-intro--empty');
    this.introEl.createEl('p', { text: t('quickActions.modal.intro') });
  }

  private renderRow(action: QuickAction): void {
    if (!this.listEl) return;

    const row = this.listEl.createDiv({ cls: 'claudian-quick-action-row' });
    const main = row.createDiv({ cls: 'claudian-quick-action-main' });

    if (action.icon) {
      const iconEl = main.createSpan({ cls: 'claudian-quick-action-icon' });
      setIcon(iconEl, action.icon);
    }

    const textCol = main.createDiv({ cls: 'claudian-quick-action-text' });
    textCol.createEl('strong', { text: action.name });
    if (action.description !== action.name) {
      textCol.createDiv({ cls: 'claudian-quick-action-desc', text: action.description });
    }
    if (action.tags && action.tags.length > 0) {
      const tagsEl = textCol.createDiv({ cls: 'claudian-quick-action-tags' });
      for (const tag of action.tags) {
        const chip = tagsEl.createSpan({
          cls: 'claudian-quick-action-tag',
          text: `#${tag}`,
          attr: { role: 'button', tabindex: '0', 'aria-label': t('quickActions.modal.filterByTag', { tag }) },
        });
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setFilter(tag);
        });
        chip.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            this.setFilter(tag);
          }
        });
      }
    }

    main.addEventListener('click', () => {
      this.callbacks.onRun(action);
      this.close();
    });

    const actions = row.createDiv({ cls: 'claudian-quick-action-actions' });
    actions.createEl('button', { text: t('common.edit') }).addEventListener('click', (e) => {
      e.stopPropagation();
      this.openEditor(action);
    });
    actions.createEl('button', { text: t('common.delete') }).addEventListener('click', (e) => {
      e.stopPropagation();
      void this.deleteAction(action);
    });
  }

  private openEditor(existing: QuickAction | null): void {
    new QuickActionEditorModal(this.app, existing, async (action) => {
      const filePath = await this.callbacks.storage.save(action);
      action.filePath = filePath;
      await this.refreshList();
    }).open();
  }

  private async deleteAction(action: QuickAction): Promise<void> {
    if (!action.filePath) return;
    try {
      await this.callbacks.storage.delete(action.filePath);
      await this.refreshList();
    } catch {
      new Notice(t('quickActions.modal.deleteFailed'));
    }
  }

  // ============================================================
  // Skills tab (new)
  // ============================================================

  private renderSkillsBody(host: HTMLElement): void {
    const searchWrap = host.createDiv({ cls: 'claudian-quick-actions-search' });
    const inputContainer = searchWrap.createDiv({ cls: 'claudian-quick-actions-search-container' });
    const placeholder = t('quickActions.skills.searchPlaceholder');
    this.skillSearchInputEl = inputContainer.createEl('input', {
      type: 'search',
      cls: 'claudian-quick-actions-search-input',
      attr: { placeholder, 'aria-label': placeholder },
    });
    this.skillSearchInputEl.addEventListener('input', () => {
      this.skillFilter = this.skillSearchInputEl?.value ?? '';
      this.renderSkillList();
    });
    this.skillSearchInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.runFirstSkillMatch();
      } else if (e.key === 'Escape' && this.skillSearchInputEl?.value) {
        e.preventDefault();
        e.stopPropagation();
        this.skillSearchInputEl.value = '';
        this.skillFilter = '';
        this.renderSkillList();
      }
    });

    this.skillListEl = host.createDiv({ cls: 'claudian-quick-actions-list claudian-quick-actions-skill-list' });
  }

  private async refreshSkills(): Promise<void> {
    if (!this.skillListEl) return;
    try {
      this.skills = await this.callbacks.aggregator.listAll();
    } catch {
      this.skills = [];
    }
    this.renderSkillList();
  }

  private renderSkillList(): void {
    if (!this.skillListEl) return;
    this.skillListEl.empty();

    if (this.skills.length === 0) {
      this.skillListEl.addClass('claudian-quick-actions-skills-empty');
      this.skillListEl.createEl('p', {
        cls: 'claudian-quick-actions-skills-empty-lead',
        text: t('quickActions.skills.emptyAll'),
      });
      this.skillListEl.createEl('p', {
        cls: 'claudian-quick-actions-skills-empty-hint',
        text: t('quickActions.skills.emptyHint'),
      });
      return;
    }
    this.skillListEl.removeClass('claudian-quick-actions-skills-empty');

    const filtered = this.applySkillFilter(this.skills);
    if (filtered.length === 0) {
      this.skillListEl.createDiv({
        cls: 'claudian-quick-actions-empty-results',
        text: t('quickActions.skills.noResults'),
      });
      return;
    }

    let lastProvider: string | null = null;
    for (const skill of filtered) {
      if (skill.providerId !== lastProvider) {
        this.skillListEl.createDiv({
          cls: 'claudian-quick-actions-provider-header',
          text: skill.providerDisplayName,
        });
        lastProvider = skill.providerId;
      }
      this.renderSkillRow(skill);
    }
  }

  private applySkillFilter(skills: SkillTabEntry[]): SkillTabEntry[] {
    const needle = this.skillFilter.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter((s) => {
      if (s.name.toLowerCase().includes(needle)) return true;
      if (s.description.toLowerCase().includes(needle)) return true;
      if (s.providerDisplayName.toLowerCase().includes(needle)) return true;
      return false;
    });
  }

  private runFirstSkillMatch(): void {
    const filtered = this.applySkillFilter(this.skills);
    const first = filtered[0];
    if (!first) return;
    this.callbacks.onRunSkill(first);
    this.close();
  }

  private renderSkillRow(skill: SkillTabEntry): void {
    if (!this.skillListEl) return;

    const row = this.skillListEl.createDiv({ cls: 'claudian-quick-action-row claudian-quick-actions-skill-row' });
    if (!skill.providerEnabled) {
      row.addClass('is-provider-disabled');
    }

    const main = row.createDiv({ cls: 'claudian-quick-action-main claudian-quick-actions-skill-row-main' });

    const iconEl = main.createSpan({ cls: 'claudian-quick-action-icon' });
    setIcon(iconEl, 'book-open');

    const textCol = main.createDiv({ cls: 'claudian-quick-action-text' });
    textCol.createEl('strong', { text: skill.name });
    if (skill.description) {
      textCol.createDiv({ cls: 'claudian-quick-action-desc', text: skill.description });
    }
    if (!skill.providerEnabled) {
      textCol.createSpan({
        cls: 'claudian-quick-actions-skill-disabled-badge',
        text: t('quickActions.skills.disabledBadge'),
      });
    }

    main.addEventListener('click', () => {
      this.callbacks.onRunSkill(skill);
      this.close();
    });

    if (skill.sourceFilePath) {
      const actions = row.createDiv({ cls: 'claudian-quick-action-actions' });
      const editBtn = actions.createEl('button', {
        cls: 'claudian-quick-actions-skill-edit',
        text: t('quickActions.skills.editInSettings', { provider: skill.providerDisplayName }),
      });
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Best-effort: close modal so user lands in plugin settings.
        // Provider-specific deep-link is deferred to a future change.
        this.close();
      });
    }
  }
}
```

- [ ] **Step 3: Run modal tests, verify passes**

Run: `npm run test -- --selectProjects unit -t "QuickActionsModal tabs"`
Expected: all eight specs PASS.

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/ui/QuickActionsModal.ts \
        tests/unit/features/quickActions/ui/QuickActionsModal.test.ts
git commit -m "feat(quickActions): add Skills tab to QuickActionsModal"
```

---

## Task 12: Add CSS for tab strip + skill rendering

**Files:**
- Modify: `src/style/features/quick-actions.css`

- [ ] **Step 1: Append the new selectors**

Open `src/style/features/quick-actions.css` and append (preserve existing rules):

```css
/* Tab strip */
.claudian-quick-actions-tabs {
  display: flex;
  gap: 0.25em;
  margin-bottom: 0.75em;
  border-bottom: 1px solid var(--background-modifier-border);
}

.claudian-quick-actions-tab {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 0.5em 0.9em;
  margin-bottom: -1px;
  font-size: var(--font-ui-small);
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 0;
}

.claudian-quick-actions-tab:hover {
  color: var(--text-normal);
}

.claudian-quick-actions-tab.is-active {
  color: var(--text-normal);
  border-bottom-color: var(--interactive-accent);
}

/* Skill list */
.claudian-quick-actions-skill-list {
  display: flex;
  flex-direction: column;
  gap: 0.4em;
}

.claudian-quick-actions-provider-header {
  margin-top: 0.6em;
  margin-bottom: 0.2em;
  font-size: var(--font-ui-smaller);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.claudian-quick-actions-provider-header:first-child {
  margin-top: 0;
}

.claudian-quick-actions-skill-row.is-provider-disabled {
  opacity: 0.55;
}

.claudian-quick-actions-skill-disabled-badge {
  display: inline-block;
  margin-left: 0.5em;
  padding: 0.05em 0.45em;
  border-radius: 8px;
  background: var(--background-modifier-border);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  text-transform: uppercase;
}

.claudian-quick-actions-skills-empty {
  padding: 1em;
  text-align: center;
  color: var(--text-muted);
}

.claudian-quick-actions-skills-empty-lead {
  font-weight: 600;
  margin-bottom: 0.3em;
}

.claudian-quick-actions-skills-empty-hint {
  font-size: var(--font-ui-small);
}
```

- [ ] **Step 2: Rebuild CSS**

Run: `npm run build:css`
Expected: no errors, `styles.css` regenerated.

- [ ] **Step 3: Commit**

```bash
git add src/style/features/quick-actions.css styles.css
git commit -m "style(quickActions): add tab strip and skill row styles"
```

---

## Task 13: Wire aggregator + `onRunSkill` in `openContextMenuQuickAction`

**Files:**
- Modify: `src/features/quickActions/openContextMenuQuickAction.ts`
- Modify: `tests/unit/features/quickActions/openContextMenuQuickAction.test.ts`

- [ ] **Step 1: Update entry point to construct the aggregator**

Edit `src/features/quickActions/openContextMenuQuickAction.ts`. Build the aggregator from `ProviderRegistry` + `ProviderWorkspaceRegistry`, and pass it (plus an `onRunSkill` handler that calls `runVaultSkill`) into the modal:

```typescript
import { Notice, type TAbstractFile, TFile, TFolder } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';

import { QuickActionStorage } from './QuickActionStorage';
import { VaultSkillAggregator } from './skills/VaultSkillAggregator';
import { runVaultSkill } from './skills/runVaultSkill';
import type { ProviderRecord, SkillTabEntry } from './skills/types';
import { QuickActionsModal } from './ui/QuickActionsModal';

function buildProviderRecords(plugin: ClaudianPlugin): ProviderRecord[] {
  const settings = plugin.settings as unknown as Record<string, unknown>;
  return ProviderRegistry.getRegisteredProviderIds().flatMap((providerId) => {
    const catalog = ProviderWorkspaceRegistry.getCommandCatalog(providerId);
    if (!catalog) return [];
    return [{
      providerId,
      displayName: ProviderRegistry.getProviderDisplayName(providerId),
      isEnabled: ProviderRegistry.isEnabled(providerId, settings),
      commandCatalog: catalog,
    }];
  });
}

export function openContextMenuQuickAction(
  plugin: ClaudianPlugin,
  file: TAbstractFile,
): void {
  const storage = new QuickActionStorage(
    new VaultFileAdapter(plugin.app),
    () => plugin.settings.quickActionsFolder ?? 'Quick Actions',
  );
  const aggregator = new VaultSkillAggregator(() => buildProviderRecords(plugin));

  new QuickActionsModal(plugin.app, {
    storage,
    aggregator,
    onRun: (action) => {
      void runQuickAction(plugin, action, file);
    },
    onRunSkill: (entry: SkillTabEntry) => {
      void runVaultSkill(plugin, entry, file);
    },
  }).open();
}

async function runQuickAction(
  plugin: ClaudianPlugin,
  action: QuickAction,
  file: TAbstractFile,
): Promise<void> {
  // Ensure the chat view is open; open it if not.
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

  if (isBlank && activeTab) {
    targetTab = activeTab;
  } else if (tabManager.canCreateTab()) {
    const newTab = await tabManager.createTab(null, undefined, { activate: false });
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

  void targetTab.controllers.inputController?.sendMessage({ content: action.prompt });
}

import type { QuickAction } from './types';
```

The internal helper `runQuickAction` is a verbatim move of the existing `onRun` body — preserves the comment block about pill-after-switch ordering. Keep the original comment text.

- [ ] **Step 2: Extend existing test to assert aggregator + onRunSkill**

Edit `tests/unit/features/quickActions/openContextMenuQuickAction.test.ts`. Add new mocks and assertions. Insert near the existing mocks:

```typescript
jest.mock('@/features/quickActions/skills/VaultSkillAggregator', () => ({
  VaultSkillAggregator: jest.fn().mockImplementation(() => ({ listAll: jest.fn().mockResolvedValue([]) })),
}));

jest.mock('@/features/quickActions/skills/runVaultSkill', () => ({
  runVaultSkill: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    getRegisteredProviderIds: jest.fn().mockReturnValue(['claude']),
    getProviderDisplayName: jest.fn().mockReturnValue('Claude'),
    isEnabled: jest.fn().mockReturnValue(true),
  },
}));

jest.mock('@/core/providers/ProviderWorkspaceRegistry', () => ({
  ProviderWorkspaceRegistry: {
    getCommandCatalog: jest.fn().mockReturnValue({
      listVaultEntries: jest.fn().mockResolvedValue([]),
    }),
  },
}));
```

Update the mock of `QuickActionsModal` to capture `onRunSkill` and the aggregator:

```typescript
let capturedOnRun: ((action: QuickAction) => void) | null = null;
let capturedOnRunSkill: ((entry: any) => void) | null = null;
let capturedAggregator: unknown = null;

jest.mock('@/features/quickActions/ui/QuickActionsModal', () => ({
  QuickActionsModal: jest.fn().mockImplementation((_app: unknown, callbacks: any) => {
    capturedOnRun = callbacks.onRun;
    capturedOnRunSkill = callbacks.onRunSkill;
    capturedAggregator = callbacks.aggregator;
    return { open: jest.fn() };
  }),
}));
```

Add new test cases in the `describe('openContextMenuQuickAction', () => { ... })` block:

```typescript
describe('skills wiring', () => {
  it('passes a VaultSkillAggregator into the modal', async () => {
    const activeTab = makeMockTab('blank');
    const tabManager = makeMockTabManager({ activeTab, canCreate: true });
    const plugin = makeMockPlugin(tabManager);
    await openContextMenuQuickAction(plugin as any, { path: 'note.md' } as TFile);
    expect(capturedAggregator).not.toBeNull();
  });

  it('routes onRunSkill to runVaultSkill with the same file argument', async () => {
    const { runVaultSkill } = jest.requireMock('@/features/quickActions/skills/runVaultSkill');
    const activeTab = makeMockTab('blank');
    const tabManager = makeMockTabManager({ activeTab, canCreate: true });
    const plugin = makeMockPlugin(tabManager);
    const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });
    await openContextMenuQuickAction(plugin as any, file);
    const entry = { id: 'claude:skill-x', name: 'x', providerId: 'claude' } as any;
    capturedOnRunSkill!(entry);
    expect(runVaultSkill).toHaveBeenCalledWith(plugin, entry, file);
  });
});
```

- [ ] **Step 3: Run tests, verify all pass**

Run: `npm run test -- --selectProjects unit -t "openContextMenuQuickAction"`
Expected: existing specs pass AND the two new skills-wiring specs pass.

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/quickActions/openContextMenuQuickAction.ts \
        tests/unit/features/quickActions/openContextMenuQuickAction.test.ts
git commit -m "feat(quickActions): wire skills aggregator and runVaultSkill into context menu"
```

---

## Task 14: Full verification + build + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the full verification suite**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all four commands succeed with zero failures and zero lint warnings.

If any step fails:
- Typecheck: re-read the error, fix the type, re-run typecheck.
- Lint: run `npm run lint:fix` first for auto-fixable issues.
- Tests: read the failure carefully — the most common cause is a missing mock or a renamed selector class.
- Build: typically a missing CSS `@import` if a new CSS file was added (this plan only edits existing CSS, so should not apply).

- [ ] **Step 2: Manual smoke (post-merge dev build)**

Open Obsidian with the dev build (`npm run dev`). Confirm in order:

1. Open a vault that contains at least one Claude skill under `.claude/skills/<name>/SKILL.md`.
2. Right-click any markdown file in the file tree → "Quick actions". Modal opens. Quick Actions tab is selected by default.
3. Click the Skills tab. Skill list renders, grouped under a "Claude" header. The clicked file is implicitly carried.
4. Click a skill row. The current chat tab (or a newly created Claude tab) opens, the right-clicked file appears as a pill, and the input fires `/skill-name` as a message. The provider's skill loads in the response.
5. With Codex enabled and a `.codex/skills/<name>/SKILL.md` present, the Codex section also renders. Picking a Codex skill from a Claude-active tab creates a new Codex tab and sends `$skill-name`.
6. Disable Codex in settings. Reopen the modal. Codex skills render dimmed with a "disabled" badge. Clicking shows a Notice that Codex is disabled.
7. Search in the Skills tab: type a substring; rows filter live. Switch to Quick Actions; search input is empty. Switch back; search is empty again (per-tab isolation).

If any step misbehaves, file a `bug` issue and resume after fix.

- [ ] **Step 3: Final commit (if any fixes were required)**

If smoke testing revealed an issue, fix it with a new commit. Otherwise no final commit is needed — every task already committed.

- [ ] **Step 4: Confirm clean state**

Run: `git status`
Expected: working tree clean.

Run: `git log --oneline -10`
Expected: the 8 feature commits in order, most recent first:
1. `feat(quickActions): wire skills aggregator and runVaultSkill into context menu`
2. `style(quickActions): add tab strip and skill row styles`
3. `feat(quickActions): add Skills tab to QuickActionsModal`
4. `i18n(quickActions): add Skills tab strings to all locales`
5. `feat(quickActions): runVaultSkill routes execution to provider-matched tab`
6. `feat(quickActions): add VaultSkillAggregator across providers`
7. `feat(quickActions): define SkillTabEntry and ProviderRecord types`
8. `feat(codex): expose sourceFilePath on skill catalog entries`
9. `feat(claude): carry SKILL.md path through SkillStorage and catalog`
10. `feat(core): add sourceFilePath to ProviderCommandEntry`

---

## Self-Review Checklist Applied

**1. Spec coverage:**
- "Skill tab lists all vault skills across providers, grouped by provider" → Task 5/6 (aggregator) + Task 11 (modal grouping render).
- "Execution routes to provider-matched chat tab" → Task 7/8 (runVaultSkill).
- "Read-only listing" → Task 11 (modal renders no Add/Delete on Skills tab; edit button only when sourceFilePath set).
- "Right-click pill attach inherits" → Task 13 (`onRunSkill` receives `file` from context-menu caller; runVaultSkill attaches it).
- "Default Quick Actions tab, per-tab search" → Task 11 (`activeTab = 'quickActions'` initial, search state cleared on switch).
- "`sourceFilePath` extension to `ProviderCommandEntry`" → Task 1 (contract) + Task 2 (Claude population) + Task 3 (Codex population).
- "Provider disabled gating" → Task 7/8 (disabled-provider Notice) + Task 11 (`.is-provider-disabled` class + badge).
- "Runtime-discovered skill (no file path)" → Task 11 (Edit button hidden when `sourceFilePath == null`).
- i18n changes → Task 9.

No spec requirement is unimplemented. The spec mentioned a `ProviderWorkspaceRegistry.listRegisteredProviderIds()` method addition — superseded by using `ProviderRegistry.getRegisteredProviderIds()`, documented at the top of this plan.

**2. Placeholder scan:** none. Every code step contains the actual code. Every test step contains the actual test. Every commit step contains the exact command.

**3. Type consistency:** `SkillTabEntry`, `ProviderRecord`, and `LoadedSkill` are introduced once and reused with identical field names everywhere. Function names (`listAll`, `runVaultSkill`, `getProviderRecords`) match across tasks.

**4. Scope check:** single coherent feature, one plan. No decomposition needed.
