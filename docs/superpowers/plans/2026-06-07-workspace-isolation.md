---
status: open
parent: "[[Workspace Isolation]]"
---
# Workspace Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first useful Workspace Isolation slice: git-agnostic copy workspaces, durable records, change scanning, whole-file apply, settings, and a review surface.

**Architecture:** Add `src/features/workspaces/` as a provider-neutral feature boundary. The core service owns workspace records and delegates path validation, copy allocation, change classification, and whole-file apply to focused modules. Chat, Agent Board, and git-native merge are follow-up plans so this slice proves non-git copy isolation end to end.

**Tech Stack:** TypeScript, Obsidian Vault adapter, Node `fs/promises` for external folders, Jest unit/integration tests, existing settings registry and Modal UI patterns.

---

## Scope check

The approved spec spans a shared foundation, Chat tab isolation, Agent Board run isolation, and git-native enhancements. This plan implements the first foundation PR only:

- core workspace types and settings;
- copy allocator with safe path validation;
- record persistence under `.claudian/workspaces/`;
- file fingerprinting and whole-file change classification;
- whole-file apply for changed and new files;
- settings fields for root/strategy/retention;
- a command and modal to list/review/apply copy workspaces.

Follow-up plans should cover Chat attachment, Agent Board per-run allocation, and git-native worktree/merge actions.

## File structure

| File | Responsibility |
|---|---|
| `src/features/workspaces/model/workspaceTypes.ts` | Shared types, status unions, settings unions, review result shapes. |
| `src/features/workspaces/model/workspaceDefaults.ts` | Default settings values and helper to merge partial settings. |
| `src/features/workspaces/path/workspacePathSafety.ts` | Canonical path validation and source/isolated/root containment checks. |
| `src/features/workspaces/storage/WorkspaceRegistry.ts` | Persist/list/update/delete workspace record JSON files in `.claudian/workspaces/`. |
| `src/features/workspaces/review/workspaceFingerprint.ts` | File stat/hash fingerprint helpers. |
| `src/features/workspaces/review/WorkspaceDiffService.ts` | Classify changed/new/deleted/conflicted/binary files. |
| `src/features/workspaces/review/WorkspaceApplyService.ts` | Apply selected whole-file replacements back to the source. |
| `src/features/workspaces/allocators/CopyWorkspaceAllocator.ts` | Create copy workspaces under the configured isolation root. |
| `src/features/workspaces/WorkspaceIsolationService.ts` | Public orchestration service used by UI and future consumers. |
| `src/features/workspaces/ui/WorkspaceReviewModal.ts` | Modal for listing changed files and applying selected safe changes. |
| `src/features/workspaces/commands/registerWorkspaceIsolationCommands.ts` | Command registration for opening the review modal. |
| `src/features/settings/registry/fields/workspaces.ts` | Settings tab/fields for Workspace Isolation. |

---

## Task 1: Workspace types and settings defaults

**Files:**
- Create: `src/features/workspaces/model/workspaceTypes.ts`
- Create: `src/features/workspaces/model/workspaceDefaults.ts`
- Modify: `src/core/types/settings.ts`
- Modify: `src/app/settings/defaultSettings.ts`
- Test: `tests/unit/features/workspaces/model/workspaceDefaults.test.ts`

- [ ] **Step 1: Write the failing defaults test**

Create `tests/unit/features/workspaces/model/workspaceDefaults.test.ts`:

```ts
import {
  DEFAULT_WORKSPACE_ISOLATION_SETTINGS,
  normalizeWorkspaceIsolationSettings,
} from '@/features/workspaces/model/workspaceDefaults';

describe('workspace isolation settings defaults', () => {
  it('defaults to disabled copy-first isolation outside the project', () => {
    expect(DEFAULT_WORKSPACE_ISOLATION_SETTINGS).toEqual({
      enabled: false,
      defaultRoot: '',
      allowInsideProjectRoot: false,
      allocationStrategy: 'automatic',
      agentBoardDefaultIsolation: false,
      chatDefaultIsolation: 'ask',
      retentionPolicy: 'manual',
    });
  });

  it('normalizes partial settings and rejects invalid enum values', () => {
    expect(normalizeWorkspaceIsolationSettings({
      enabled: true,
      allocationStrategy: 'copy',
      chatDefaultIsolation: 'never',
    })).toMatchObject({ enabled: true, allocationStrategy: 'copy', chatDefaultIsolation: 'never' });

    expect(normalizeWorkspaceIsolationSettings({
      allocationStrategy: 'branch-per-chat',
      chatDefaultIsolation: 'always',
      retentionPolicy: 'delete-on-close',
    } as Record<string, unknown>)).toEqual(DEFAULT_WORKSPACE_ISOLATION_SETTINGS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm run test -- tests/unit/features/workspaces/model/workspaceDefaults.test.ts
```

Expected: FAIL with module-not-found for `workspaceDefaults`.

- [ ] **Step 3: Create workspace model types**

Create `src/features/workspaces/model/workspaceTypes.ts` with these exported types:

```ts
export type WorkspaceIsolationStatus =
  | 'creating' | 'ready' | 'running' | 'needs_review' | 'applied' | 'archived' | 'failed';
export type WorkspaceOwnerKind = 'chat' | 'work_order' | 'manual' | 'review';
export type WorkspaceSourceType = 'vault' | 'repo' | 'folder';
export type WorkspaceAllocationStrategy = 'copy' | 'git_worktree';
export type WorkspaceCreatedBy = 'copy' | 'git';
export type WorkspaceSettingsAllocationStrategy = 'automatic' | 'copy' | 'git_worktree';
export type WorkspaceChatDefaultIsolation = 'ask' | 'never';
export type WorkspaceRetentionPolicy = 'manual';

export interface WorkspaceIsolationSettings {
  enabled: boolean;
  defaultRoot: string;
  allowInsideProjectRoot: boolean;
  allocationStrategy: WorkspaceSettingsAllocationStrategy;
  agentBoardDefaultIsolation: boolean;
  chatDefaultIsolation: WorkspaceChatDefaultIsolation;
  retentionPolicy: WorkspaceRetentionPolicy;
}

export interface WorkspaceOwner {
  kind: WorkspaceOwnerKind;
  id: string | null;
  title: string | null;
}

export interface WorkspaceFileFingerprint {
  path: string;
  size: number;
  mtime: number;
  sha256: string;
  binary: boolean;
}

export interface WorkspaceFingerprint {
  files: Record<string, WorkspaceFileFingerprint>;
  createdAt: string;
}

export type WorkspaceFileChangeKind = 'changed' | 'new' | 'deleted' | 'conflicted' | 'binary';

export interface WorkspaceFileChange {
  path: string;
  kind: WorkspaceFileChangeKind;
  safeToApply: boolean;
  sourceFingerprint: WorkspaceFileFingerprint | null;
  isolatedFingerprint: WorkspaceFileFingerprint | null;
  baselineFingerprint: WorkspaceFileFingerprint | null;
}

export interface IsolatedWorkspaceRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: WorkspaceIsolationStatus;
  owner: WorkspaceOwner;
  source: { path: string; type: WorkspaceSourceType; baselineFingerprint: WorkspaceFingerprint };
  isolated: { path: string; strategy: WorkspaceAllocationStrategy; createdBy: WorkspaceCreatedBy };
  reconciliation: {
    changedFiles: WorkspaceFileChange[];
    acceptedFiles: string[];
    rejectedFiles: string[];
    lastScannedAt: string | null;
    appliedAt: string | null;
  };
  git?: { repoPath: string; branch: string; baseRef: string; baseSha: string; headSha: string | null; worktreePath: string | null };
}
```

- [ ] **Step 4: Create defaults normalizer**

Create `src/features/workspaces/model/workspaceDefaults.ts`:

```ts
import type {
  WorkspaceChatDefaultIsolation,
  WorkspaceIsolationSettings,
  WorkspaceRetentionPolicy,
  WorkspaceSettingsAllocationStrategy,
} from './workspaceTypes';

export const DEFAULT_WORKSPACE_ISOLATION_SETTINGS: WorkspaceIsolationSettings = {
  enabled: false,
  defaultRoot: '',
  allowInsideProjectRoot: false,
  allocationStrategy: 'automatic',
  agentBoardDefaultIsolation: false,
  chatDefaultIsolation: 'ask',
  retentionPolicy: 'manual',
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

export function normalizeWorkspaceIsolationSettings(value: unknown): WorkspaceIsolationSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_WORKSPACE_ISOLATION_SETTINGS.enabled,
    defaultRoot: typeof raw.defaultRoot === 'string' ? raw.defaultRoot : DEFAULT_WORKSPACE_ISOLATION_SETTINGS.defaultRoot,
    allowInsideProjectRoot: typeof raw.allowInsideProjectRoot === 'boolean' ? raw.allowInsideProjectRoot : DEFAULT_WORKSPACE_ISOLATION_SETTINGS.allowInsideProjectRoot,
    allocationStrategy: oneOf<WorkspaceSettingsAllocationStrategy>(raw.allocationStrategy, ['automatic', 'copy', 'git_worktree'], DEFAULT_WORKSPACE_ISOLATION_SETTINGS.allocationStrategy),
    agentBoardDefaultIsolation: typeof raw.agentBoardDefaultIsolation === 'boolean' ? raw.agentBoardDefaultIsolation : DEFAULT_WORKSPACE_ISOLATION_SETTINGS.agentBoardDefaultIsolation,
    chatDefaultIsolation: oneOf<WorkspaceChatDefaultIsolation>(raw.chatDefaultIsolation, ['ask', 'never'], DEFAULT_WORKSPACE_ISOLATION_SETTINGS.chatDefaultIsolation),
    retentionPolicy: oneOf<WorkspaceRetentionPolicy>(raw.retentionPolicy, ['manual'], DEFAULT_WORKSPACE_ISOLATION_SETTINGS.retentionPolicy),
  };
}
```

- [ ] **Step 5: Wire settings types and defaults**

Modify `src/core/types/settings.ts`:

```ts
import type { WorkspaceIsolationSettings } from '../../features/workspaces/model/workspaceTypes';
```

Add to `ClaudianSettings` near Agent Board settings:

```ts
  workspaceIsolation: WorkspaceIsolationSettings;
```

Modify `src/app/settings/defaultSettings.ts`:

```ts
import { DEFAULT_WORKSPACE_ISOLATION_SETTINGS } from '../../features/workspaces/model/workspaceDefaults';
```

Add to `DEFAULT_CLAUDIAN_SETTINGS`:

```ts
  workspaceIsolation: DEFAULT_WORKSPACE_ISOLATION_SETTINGS,
```

- [ ] **Step 6: Run tests and commit**

```powershell
npm run test -- tests/unit/features/workspaces/model/workspaceDefaults.test.ts
npm run typecheck
git add src/core/types/settings.ts src/app/settings/defaultSettings.ts src/features/workspaces/model tests/unit/features/workspaces/model
git commit -m "feat(workspaces): add isolation settings model"
```

Expected: tests and typecheck PASS before commit.

---

## Task 2: Path safety

**Files:**
- Create: `src/features/workspaces/path/workspacePathSafety.ts`
- Test: `tests/unit/features/workspaces/path/workspacePathSafety.test.ts`

- [ ] **Step 1: Write failing path-safety tests**

Create `tests/unit/features/workspaces/path/workspacePathSafety.test.ts`:

```ts
import path from 'path';
import { assertSafeWorkspacePaths, canonicalizePath, relativePathInsideRoot } from '@/features/workspaces/path/workspacePathSafety';

const root = path.resolve('D:/isolated-root');
const source = path.resolve('D:/Projects/claudian');
const isolated = path.resolve('D:/isolated-root/workspace-a');

describe('workspacePathSafety', () => {
  it('accepts an isolated path under the configured root', () => {
    expect(canonicalizePath('D:/Projects/claudian/../claudian')).toBe(source);
    expect(() => assertSafeWorkspacePaths({ sourcePath: source, isolatedPath: isolated, rootPath: root, allowInsideProjectRoot: false })).not.toThrow();
  });

  it('rejects unsafe path relationships', () => {
    expect(() => assertSafeWorkspacePaths({ sourcePath: source, isolatedPath: source, rootPath: root, allowInsideProjectRoot: false })).toThrow('Source and isolated workspace paths must be different.');
    expect(() => assertSafeWorkspacePaths({ sourcePath: source, isolatedPath: path.resolve('D:/other/workspace-a'), rootPath: root, allowInsideProjectRoot: false })).toThrow('Isolated workspace path must stay under the configured root.');
    expect(() => assertSafeWorkspacePaths({ sourcePath: source, isolatedPath: path.resolve('D:/Projects/claudian/.worktrees/workspace-a'), rootPath: path.resolve('D:/Projects/claudian/.worktrees'), allowInsideProjectRoot: false })).toThrow('Inside-project workspace roots are disabled.');
  });

  it('maps safe relative paths and rejects traversal', () => {
    expect(relativePathInsideRoot(source, 'docs/a.md')).toBe(path.join(source, 'docs/a.md'));
    expect(() => relativePathInsideRoot(source, '../outside.md')).toThrow('Relative path escapes workspace root.');
  });
});
```

- [ ] **Step 2: Implement path safety**

Create `src/features/workspaces/path/workspacePathSafety.ts`:

```ts
import path from 'path';

export interface WorkspacePathSafetyInput {
  sourcePath: string;
  isolatedPath: string;
  rootPath: string;
  allowInsideProjectRoot: boolean;
}

export function canonicalizePath(value: string): string {
  return path.resolve(value);
}

function isSameOrInside(parent: string, candidate: string): boolean {
  const relative = path.relative(canonicalizePath(parent), canonicalizePath(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function relativePathInsideRoot(rootPath: string, relativePath: string): string {
  const root = canonicalizePath(rootPath);
  const candidate = canonicalizePath(path.join(root, relativePath));
  if (!isSameOrInside(root, candidate)) throw new Error('Relative path escapes workspace root.');
  return candidate;
}

export function assertSafeWorkspacePaths(input: WorkspacePathSafetyInput): void {
  const source = canonicalizePath(input.sourcePath);
  const isolated = canonicalizePath(input.isolatedPath);
  const root = canonicalizePath(input.rootPath);
  if (source === isolated) throw new Error('Source and isolated workspace paths must be different.');
  if (!isSameOrInside(root, isolated)) throw new Error('Isolated workspace path must stay under the configured root.');
  if (isSameOrInside(isolated, source)) throw new Error('Source workspace must not be inside the isolated workspace.');
  if (isSameOrInside(source, isolated) && !input.allowInsideProjectRoot) throw new Error('Inside-project workspace roots are disabled.');
}
```

- [ ] **Step 3: Run tests and commit**

```powershell
npm run test -- tests/unit/features/workspaces/path/workspacePathSafety.test.ts
npm run typecheck
git add src/features/workspaces/path tests/unit/features/workspaces/path
git commit -m "feat(workspaces): validate isolated workspace paths"
```

Expected: tests and typecheck PASS before commit.

---

## Task 3: Registry, fingerprints, diff, and apply

**Files:**
- Create: `src/features/workspaces/storage/WorkspaceRegistry.ts`
- Create: `src/features/workspaces/review/workspaceFingerprint.ts`
- Create: `src/features/workspaces/review/WorkspaceDiffService.ts`
- Create: `src/features/workspaces/review/WorkspaceApplyService.ts`
- Test: `tests/unit/features/workspaces/storage/WorkspaceRegistry.test.ts`
- Test: `tests/unit/features/workspaces/review/WorkspaceDiffService.test.ts`
- Test: `tests/unit/features/workspaces/review/WorkspaceApplyService.test.ts`

- [ ] **Step 1: Write failing tests**

Use these assertions:

```ts
// WorkspaceRegistry.test.ts
await registry.save(record('ws-1'));
await expect(registry.get('ws-1')).resolves.toMatchObject({ id: 'ws-1', status: 'ready' });
await adapter.write('.claudian/workspaces/bad.json', '{not-json');
await expect(registry.list()).resolves.toHaveLength(1);
await registry.update('ws-1', (current) => ({ ...current, status: 'archived' }));
await expect(registry.get('ws-1')).resolves.toMatchObject({ status: 'archived' });

// WorkspaceDiffService.test.ts
expect(changes.map((change) => [change.path, change.kind, change.safeToApply])).toEqual([
  ['binary.png', 'binary', true],
  ['conflict.md', 'conflicted', false],
  ['deleted.md', 'deleted', false],
  ['new.md', 'new', true],
  ['safe.md', 'changed', true],
]);

// WorkspaceApplyService.test.ts
expect(result).toEqual({ applied: ['a.md', 'new.md'], skipped: [] });
expect(conflictedResult.skipped).toEqual([{ path: 'conflict.md', reason: 'File is not safe to apply.' }]);
```

- [ ] **Step 2: Implement `WorkspaceRegistry`**

Create `src/features/workspaces/storage/WorkspaceRegistry.ts`:

```ts
import type { IsolatedWorkspaceRecord } from '../model/workspaceTypes';

export interface WorkspaceRegistryAdapter {
  ensureFolder(path: string): Promise<void>;
  write(path: string, content: string): Promise<void>;
  read(path: string): Promise<string>;
  delete(path: string): Promise<void>;
  listFiles(folder: string): Promise<string[]>;
}

const FOLDER = '.claudian/workspaces';
const recordPath = (id: string): string => `${FOLDER}/${id}.json`;

function parseRecord(content: string): IsolatedWorkspaceRecord | null {
  try {
    const value = JSON.parse(content) as Partial<IsolatedWorkspaceRecord>;
    return typeof value.id === 'string' && typeof value.name === 'string' ? value as IsolatedWorkspaceRecord : null;
  } catch {
    return null;
  }
}

export class WorkspaceRegistry {
  constructor(private readonly adapter: WorkspaceRegistryAdapter) {}
  async save(record: IsolatedWorkspaceRecord): Promise<void> {
    await this.adapter.ensureFolder(FOLDER);
    await this.adapter.write(recordPath(record.id), `${JSON.stringify(record, null, 2)}\n`);
  }
  async get(id: string): Promise<IsolatedWorkspaceRecord | null> {
    try { return parseRecord(await this.adapter.read(recordPath(id))); } catch { return null; }
  }
  async list(): Promise<IsolatedWorkspaceRecord[]> {
    await this.adapter.ensureFolder(FOLDER);
    const records: IsolatedWorkspaceRecord[] = [];
    for (const file of (await this.adapter.listFiles(FOLDER)).filter((path) => path.endsWith('.json'))) {
      try {
        const record = parseRecord(await this.adapter.read(file));
        if (record) records.push(record);
      } catch {
        // Ignore unreadable records so one corrupt file does not hide the list.
      }
    }
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async update(id: string, updater: (record: IsolatedWorkspaceRecord) => IsolatedWorkspaceRecord): Promise<IsolatedWorkspaceRecord | null> {
    const current = await this.get(id);
    if (!current) return null;
    const next = updater(current);
    await this.save(next);
    return next;
  }
  async delete(id: string): Promise<void> {
    await this.adapter.delete(recordPath(id));
  }
}
```

- [ ] **Step 3: Implement fingerprint, diff, and apply services**

Create `workspaceFingerprint.ts`, `WorkspaceDiffService.ts`, and `WorkspaceApplyService.ts` with these core implementations:

```ts
// workspaceFingerprint.ts
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import type { WorkspaceFileFingerprint, WorkspaceFingerprint } from '../model/workspaceTypes';
import { relativePathInsideRoot } from '../path/workspacePathSafety';

const TEXT_SAMPLE_BYTES = 8000;
function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, TEXT_SAMPLE_BYTES).includes(0);
}
export async function fingerprintFile(rootPath: string, relativePath: string): Promise<WorkspaceFileFingerprint> {
  const absolutePath = relativePathInsideRoot(rootPath, relativePath);
  const content = await fs.readFile(absolutePath);
  const stat = await fs.stat(absolutePath);
  return {
    path: relativePath.split(path.sep).join('/'),
    size: stat.size,
    mtime: stat.mtimeMs,
    sha256: createHash('sha256').update(content).digest('hex'),
    binary: isBinaryBuffer(content),
  };
}
export async function fingerprintTree(rootPath: string, now: string, excludes = new Set<string>()): Promise<WorkspaceFingerprint> {
  const files: Record<string, WorkspaceFileFingerprint> = {};
  async function walk(relativeDir: string): Promise<void> {
    const absoluteDir = relativePathInsideRoot(rootPath, relativeDir || '.');
    for (const entry of await fs.readdir(absoluteDir, { withFileTypes: true })) {
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (excludes.has(entry.name) || excludes.has(relative)) continue;
      if (entry.isDirectory()) await walk(relative);
      else if (entry.isFile()) files[relative] = await fingerprintFile(rootPath, relative);
    }
  }
  await walk('');
  return { files, createdAt: now };
}

// WorkspaceDiffService.ts
import type { WorkspaceFileChange, WorkspaceFingerprint } from '../model/workspaceTypes';
export interface FingerprintReader { fingerprintTree(rootPath: string): Promise<WorkspaceFingerprint>; }
function sameSha(left: { sha256: string } | null | undefined, right: { sha256: string } | null | undefined): boolean {
  return Boolean(left && right && left.sha256 === right.sha256);
}
export class WorkspaceDiffService {
  constructor(private readonly sourceReader: FingerprintReader, private readonly isolatedReader: FingerprintReader) {}
  async scan(baseline: WorkspaceFingerprint, sourcePath: string, isolatedPath: string): Promise<WorkspaceFileChange[]> {
    const source = await this.sourceReader.fingerprintTree(sourcePath);
    const isolated = await this.isolatedReader.fingerprintTree(isolatedPath);
    const paths = new Set([...Object.keys(baseline.files), ...Object.keys(source.files), ...Object.keys(isolated.files)]);
    const changes: WorkspaceFileChange[] = [];
    for (const filePath of paths) {
      const base = baseline.files[filePath] ?? null;
      const sourceFile = source.files[filePath] ?? null;
      const isolatedFile = isolated.files[filePath] ?? null;
      const sourceChanged = !sameSha(base, sourceFile);
      const isolatedChanged = !sameSha(base, isolatedFile);
      if (!isolatedFile && base) {
        changes.push({ path: filePath, kind: 'deleted', safeToApply: false, sourceFingerprint: sourceFile, isolatedFingerprint: null, baselineFingerprint: base });
      } else if (!base && isolatedFile) {
        changes.push({ path: filePath, kind: 'new', safeToApply: true, sourceFingerprint: sourceFile, isolatedFingerprint: isolatedFile, baselineFingerprint: null });
      } else if (base && isolatedFile && isolatedChanged && sourceChanged) {
        changes.push({ path: filePath, kind: 'conflicted', safeToApply: false, sourceFingerprint: sourceFile, isolatedFingerprint: isolatedFile, baselineFingerprint: base });
      } else if (base && isolatedFile && isolatedChanged && isolatedFile.binary) {
        changes.push({ path: filePath, kind: 'binary', safeToApply: true, sourceFingerprint: sourceFile, isolatedFingerprint: isolatedFile, baselineFingerprint: base });
      } else if (base && isolatedFile && isolatedChanged) {
        changes.push({ path: filePath, kind: 'changed', safeToApply: true, sourceFingerprint: sourceFile, isolatedFingerprint: isolatedFile, baselineFingerprint: base });
      }
    }
    return changes.sort((a, b) => a.path.localeCompare(b.path));
  }
}

// WorkspaceApplyService.ts
import type { WorkspaceFileChange } from '../model/workspaceTypes';
import { relativePathInsideRoot } from '../path/workspacePathSafety';
export interface WholeFileAdapter { read(path: string): Promise<Buffer>; write(path: string, content: Buffer): Promise<void>; }
export class WorkspaceApplyService {
  constructor(private readonly files: WholeFileAdapter) {}
  async apply(input: { sourcePath: string; isolatedPath: string; selectedPaths: string[]; changes: WorkspaceFileChange[] }): Promise<{ applied: string[]; skipped: Array<{ path: string; reason: string }> }> {
    const changeByPath = new Map(input.changes.map((change) => [change.path, change]));
    const applied: string[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    for (const relativePath of input.selectedPaths) {
      const change = changeByPath.get(relativePath);
      if (!change || !change.safeToApply || change.kind === 'deleted' || change.kind === 'conflicted') {
        skipped.push({ path: relativePath, reason: 'File is not safe to apply.' });
        continue;
      }
      const content = await this.files.read(relativePathInsideRoot(input.isolatedPath, relativePath));
      await this.files.write(relativePathInsideRoot(input.sourcePath, relativePath), content);
      applied.push(relativePath);
    }
    return { applied, skipped };
  }
}
```

- [ ] **Step 4: Run tests and commit**

```powershell
npm run test -- tests/unit/features/workspaces/storage/WorkspaceRegistry.test.ts tests/unit/features/workspaces/review/WorkspaceDiffService.test.ts tests/unit/features/workspaces/review/WorkspaceApplyService.test.ts
npm run typecheck
git add src/features/workspaces/storage src/features/workspaces/review tests/unit/features/workspaces/storage tests/unit/features/workspaces/review
git commit -m "feat(workspaces): persist and review workspace changes"
```

Expected: tests and typecheck PASS before commit.

---

## Task 4: Copy allocator

**Files:**
- Create: `src/features/workspaces/allocators/CopyWorkspaceAllocator.ts`
- Test: `tests/unit/features/workspaces/allocators/CopyWorkspaceAllocator.test.ts`

- [ ] **Step 1: Write failing allocator test**

Create `tests/unit/features/workspaces/allocators/CopyWorkspaceAllocator.test.ts`:

```ts
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { CopyWorkspaceAllocator } from '@/features/workspaces/allocators/CopyWorkspaceAllocator';

describe('CopyWorkspaceAllocator', () => {
  it('copies source files under the configured root and records a baseline', async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-workspaces-'));
    const source = path.join(temp, 'source');
    const root = path.join(temp, 'isolated');
    await fs.mkdir(path.join(source, 'docs'), { recursive: true });
    await fs.writeFile(path.join(source, 'docs', 'note.md'), 'hello');
    await fs.mkdir(path.join(source, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(source, 'node_modules', 'ignored.txt'), 'ignored');

    const result = await new CopyWorkspaceAllocator({ now: () => '2026-06-07T10:00:00.000Z' }).allocate({
      id: 'ws-1',
      name: 'Workspace One',
      sourcePath: source,
      sourceType: 'folder',
      owner: { kind: 'manual', id: null, title: null },
      rootPath: root,
      allowInsideProjectRoot: false,
      now: '2026-06-07T10:00:00.000Z',
    });

    await expect(fs.readFile(path.join(result.isolated.path, 'docs', 'note.md'), 'utf8')).resolves.toBe('hello');
    await expect(fs.stat(path.join(result.isolated.path, 'node_modules', 'ignored.txt'))).rejects.toThrow();
    expect(result.source.baselineFingerprint.files['docs/note.md']).toMatchObject({ path: 'docs/note.md', binary: false });
  });
});
```

- [ ] **Step 2: Implement copy allocator**

Create `src/features/workspaces/allocators/CopyWorkspaceAllocator.ts`:

```ts
import { promises as fs } from 'fs';
import path from 'path';
import type { CreateWorkspaceRequest, IsolatedWorkspaceRecord } from '../model/workspaceTypes';
import { assertSafeWorkspacePaths, canonicalizePath } from '../path/workspacePathSafety';
import { fingerprintTree } from '../review/workspaceFingerprint';

const DEFAULT_EXCLUDES = new Set(['.git', 'node_modules', 'dist', '.worktrees']);

export class CopyWorkspaceAllocator {
  constructor(private readonly deps: { now: () => string }) {}

  async allocate(request: CreateWorkspaceRequest & { id: string }): Promise<IsolatedWorkspaceRecord> {
    const sourcePath = canonicalizePath(request.sourcePath);
    const isolatedPath = canonicalizePath(path.join(request.rootPath, request.id));
    assertSafeWorkspacePaths({ sourcePath, isolatedPath, rootPath: request.rootPath, allowInsideProjectRoot: request.allowInsideProjectRoot });
    await fs.mkdir(isolatedPath, { recursive: true });
    await this.copyDirectory(sourcePath, isolatedPath, '');
    const timestamp = this.deps.now();
    return {
      id: request.id,
      name: request.name,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'ready',
      owner: request.owner,
      source: { path: sourcePath, type: request.sourceType, baselineFingerprint: await fingerprintTree(sourcePath, request.now, DEFAULT_EXCLUDES) },
      isolated: { path: isolatedPath, strategy: 'copy', createdBy: 'copy' },
      reconciliation: { changedFiles: [], acceptedFiles: [], rejectedFiles: [], lastScannedAt: null, appliedAt: null },
    };
  }

  private async copyDirectory(sourceRoot: string, targetRoot: string, relativeDir: string): Promise<void> {
    const sourceDir = path.join(sourceRoot, relativeDir);
    const targetDir = path.join(targetRoot, relativeDir);
    await fs.mkdir(targetDir, { recursive: true });
    for (const entry of await fs.readdir(sourceDir, { withFileTypes: true })) {
      if (DEFAULT_EXCLUDES.has(entry.name)) continue;
      const relative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      if (entry.isDirectory()) await this.copyDirectory(sourceRoot, targetRoot, relative);
      else if (entry.isFile()) await fs.copyFile(path.join(sourceRoot, relative), path.join(targetRoot, relative));
    }
  }
}
```

- [ ] **Step 3: Run tests and commit**

```powershell
npm run test -- tests/unit/features/workspaces/allocators/CopyWorkspaceAllocator.test.ts
npm run typecheck
git add src/features/workspaces/allocators tests/unit/features/workspaces/allocators
git commit -m "feat(workspaces): allocate copy workspaces"
```

Expected: tests and typecheck PASS before commit.

---

## Task 5: Workspace isolation service

**Files:**
- Create: `src/features/workspaces/WorkspaceIsolationService.ts`
- Test: `tests/unit/features/workspaces/WorkspaceIsolationService.test.ts`

- [ ] **Step 1: Write failing orchestration tests**

Create `tests/unit/features/workspaces/WorkspaceIsolationService.test.ts` with assertions for:

```ts
await expect(service.createWorkspace(createRequest)).resolves.toMatchObject({ id: 'ws-1', status: 'ready' });
expect(registry.save).toHaveBeenCalledTimes(1);
await expect(service.scanChanges('ws-1')).resolves.toMatchObject({ changes: [safeChange] });
await expect(service.applyFiles('ws-1', ['a.md'])).resolves.toMatchObject({ applied: ['a.md'] });
await service.archiveWorkspace('ws-1');
expect(registry.update).toHaveBeenCalledWith('ws-1', expect.any(Function));
```

- [ ] **Step 2: Implement service**

Create `src/features/workspaces/WorkspaceIsolationService.ts`:

```ts
import type { ApplyResult, CreateWorkspaceRequest, IsolatedWorkspaceRecord, WorkspaceOwner, WorkspaceReview } from './model/workspaceTypes';
import type { WorkspaceRegistry } from './storage/WorkspaceRegistry';

export interface WorkspaceAllocatorLike {
  allocate(request: CreateWorkspaceRequest & { id: string }): Promise<IsolatedWorkspaceRecord>;
}
export interface WorkspaceDiffServiceLike {
  scan(baseline: IsolatedWorkspaceRecord['source']['baselineFingerprint'], sourcePath: string, isolatedPath: string): Promise<IsolatedWorkspaceRecord['reconciliation']['changedFiles']>;
}
export interface WorkspaceApplyServiceLike {
  apply(input: { sourcePath: string; isolatedPath: string; selectedPaths: string[]; changes: IsolatedWorkspaceRecord['reconciliation']['changedFiles'] }): Promise<{ applied: string[]; skipped: Array<{ path: string; reason: string }> }>;
}

export class WorkspaceIsolationService {
  constructor(private readonly deps: {
    now: () => string;
    idFactory: () => string;
    allocator: WorkspaceAllocatorLike;
    registry: Pick<WorkspaceRegistry, 'save' | 'list' | 'get' | 'update' | 'delete'>;
    diffServiceFactory: (workspace: IsolatedWorkspaceRecord) => WorkspaceDiffServiceLike;
    applyService: WorkspaceApplyServiceLike;
  }) {}

  async createWorkspace(request: CreateWorkspaceRequest): Promise<IsolatedWorkspaceRecord> {
    const workspace = await this.deps.allocator.allocate({ ...request, id: this.deps.idFactory() });
    await this.deps.registry.save(workspace);
    return workspace;
  }
  listWorkspaces(): Promise<IsolatedWorkspaceRecord[]> { return this.deps.registry.list(); }
  async attachToOwner(workspaceId: string, owner: WorkspaceOwner): Promise<void> {
    await this.deps.registry.update(workspaceId, (record) => ({ ...record, owner, updatedAt: this.deps.now() }));
  }
  async scanChanges(workspaceId: string): Promise<WorkspaceReview> {
    const workspace = await this.requireWorkspace(workspaceId);
    const changes = await this.deps.diffServiceFactory(workspace).scan(workspace.source.baselineFingerprint, workspace.source.path, workspace.isolated.path);
    const next = await this.deps.registry.update(workspaceId, (record) => ({
      ...record,
      status: changes.length > 0 ? 'needs_review' : 'ready',
      updatedAt: this.deps.now(),
      reconciliation: { ...record.reconciliation, changedFiles: changes, lastScannedAt: this.deps.now() },
    }));
    return { workspace: next ?? workspace, changes };
  }
  async applyFiles(workspaceId: string, relativePaths: string[]): Promise<ApplyResult> {
    const workspace = await this.requireWorkspace(workspaceId);
    const result = await this.deps.applyService.apply({ sourcePath: workspace.source.path, isolatedPath: workspace.isolated.path, selectedPaths: relativePaths, changes: workspace.reconciliation.changedFiles });
    const next = await this.deps.registry.update(workspaceId, (record) => ({
      ...record,
      status: 'applied',
      updatedAt: this.deps.now(),
      reconciliation: { ...record.reconciliation, acceptedFiles: Array.from(new Set([...record.reconciliation.acceptedFiles, ...result.applied])), appliedAt: this.deps.now() },
    }));
    return { applied: result.applied, skipped: result.skipped, workspace: next ?? workspace };
  }
  async archiveWorkspace(workspaceId: string): Promise<void> {
    await this.deps.registry.update(workspaceId, (record) => ({ ...record, status: 'archived', updatedAt: this.deps.now() }));
  }
  deleteWorkspace(workspaceId: string): Promise<void> { return this.deps.registry.delete(workspaceId); }
  private async requireWorkspace(workspaceId: string): Promise<IsolatedWorkspaceRecord> {
    const workspace = await this.deps.registry.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} was not found.`);
    return workspace;
  }
}
```

- [ ] **Step 3: Run tests and commit**

```powershell
npm run test -- tests/unit/features/workspaces/WorkspaceIsolationService.test.ts
npm run typecheck
git add src/features/workspaces/WorkspaceIsolationService.ts tests/unit/features/workspaces/WorkspaceIsolationService.test.ts
git commit -m "feat(workspaces): orchestrate isolated workspace lifecycle"
```

Expected: tests and typecheck PASS before commit.

---

## Task 6: Settings tab and command shell

**Files:**
- Create: `src/features/settings/registry/fields/workspaces.ts`
- Create: `src/features/workspaces/commands/registerWorkspaceIsolationCommands.ts`
- Modify: `src/features/settings/registry/registerAll.ts`
- Modify: `src/features/settings/ClaudianSettings.ts`
- Modify: `src/main.ts`
- Test: `tests/unit/features/settings/registry/workspacesFields.test.ts`

- [ ] **Step 1: Write failing settings registry test**

Create `tests/unit/features/settings/registry/workspacesFields.test.ts`:

```ts
import { getSettingsRegistry } from '@/features/settings/registry';
import { registerWorkspaceIsolationTabFields } from '@/features/settings/registry/fields/workspaces';

describe('workspace isolation settings fields', () => {
  it('registers workspace settings tab and key fields', () => {
    registerWorkspaceIsolationTabFields();
    const ids = getSettingsRegistry().getAllFields().map((field) => field.id);
    expect(ids).toEqual(expect.arrayContaining([
      'workspaceIsolation.enabled',
      'workspaceIsolation.defaultRoot',
      'workspaceIsolation.allowInsideProjectRoot',
      'workspaceIsolation.allocationStrategy',
      'workspaceIsolation.agentBoardDefaultIsolation',
      'workspaceIsolation.chatDefaultIsolation',
      'workspaceIsolation.retentionPolicy',
    ]));
  });
});
```

- [ ] **Step 2: Add settings fields and settings shell tab**

Create `src/features/settings/registry/fields/workspaces.ts` registering tab `workspaces`, section `workspaceIsolationCore`, section `workspaceIsolationDefaults`, and fields listed in the test. Use field descriptions from [[docs/superpowers/specs/2026-06-07-workspace-isolation-design.md]] settings section.

Modify `src/features/settings/registry/registerAll.ts`:

```ts
import { registerWorkspaceIsolationTabFields } from './fields/workspaces';
```

Call:

```ts
  registerWorkspaceIsolationTabFields();
```

Modify `src/features/settings/ClaudianSettings.ts` to include the tab:

```ts
    const tabIds: SettingsTabId[] = ['general', 'agentBoard', 'workspaces', 'diagnostics', ...providerTabs];
```

Add label handling:

```ts
      } else if (id === 'workspaces') {
        label = 'Workspace Isolation';
```

- [ ] **Step 3: Add command registration shell**

Create `src/features/workspaces/commands/registerWorkspaceIsolationCommands.ts`:

```ts
import type { Plugin } from 'obsidian';
import { Notice } from 'obsidian';

export interface WorkspaceIsolationCommandDeps {
  openWorkspaceReview(): void;
}

export function registerWorkspaceIsolationCommands(plugin: Plugin, deps: WorkspaceIsolationCommandDeps): void {
  plugin.addCommand({
    id: 'open-workspace-isolation-review',
    name: 'Open Workspace Isolation review',
    callback: () => {
      try { deps.openWorkspaceReview(); }
      catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
    },
  });
}
```

Modify `src/main.ts` to register the command with an interim Notice until Task 7 wires the modal:

```ts
registerWorkspaceIsolationCommands(this, {
  openWorkspaceReview: () => new Notice('Workspace Isolation review is not ready yet.'),
});
```

- [ ] **Step 4: Run tests and commit**

```powershell
npm run test -- tests/unit/features/settings/registry/workspacesFields.test.ts
npm run typecheck
git add src/features/settings/registry src/features/settings/ClaudianSettings.ts src/features/workspaces/commands src/main.ts tests/unit/features/settings/registry/workspacesFields.test.ts
git commit -m "feat(workspaces): add isolation settings and command shell"
```

Expected: tests and typecheck PASS before commit.

---

## Task 7: Review modal and real service wiring

**Files:**
- Create: `src/features/workspaces/ui/WorkspaceReviewModal.ts`
- Modify: `src/main.ts`
- Modify: relevant CSS module under `src/style/`
- Test: `tests/integration/features/workspaces/workspaceIsolation.copyFlow.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `tests/integration/features/workspaces/workspaceIsolation.copyFlow.test.ts` that:

```ts
const workspace = await service.createWorkspace({ name: 'Copy flow', sourcePath: source, sourceType: 'folder', owner: { kind: 'manual', id: null, title: null }, rootPath: root, allowInsideProjectRoot: false, now: iso });
await fs.writeFile(path.join(workspace.isolated.path, 'note.md'), 'after');
const review = await service.scanChanges(workspace.id);
expect(review.changes.map((change) => [change.path, change.kind, change.safeToApply])).toEqual([['note.md', 'changed', true]]);
const result = await service.applyFiles(workspace.id, ['note.md']);
expect(result.applied).toEqual(['note.md']);
await expect(fs.readFile(path.join(source, 'note.md'), 'utf8')).resolves.toBe('after');
```

- [ ] **Step 2: Implement review modal**

Create `src/features/workspaces/ui/WorkspaceReviewModal.ts`:

```ts
import { Modal, Notice, Setting } from 'obsidian';
import type ClaudianPlugin from '../../../main';
import type { WorkspaceIsolationService } from '../WorkspaceIsolationService';
import type { IsolatedWorkspaceRecord, WorkspaceFileChange } from '../model/workspaceTypes';

export class WorkspaceReviewModal extends Modal {
  private selected = new Set<string>();
  constructor(private readonly plugin: ClaudianPlugin, private readonly service: WorkspaceIsolationService) { super(plugin.app); }
  async onOpen(): Promise<void> {
    this.titleEl.setText('Workspace Isolation');
    await this.renderList();
  }
  private async renderList(): Promise<void> {
    this.contentEl.empty();
    const workspaces = await this.service.listWorkspaces();
    if (workspaces.length === 0) {
      this.contentEl.createEl('p', { text: 'No isolated workspaces yet.' });
      return;
    }
    for (const workspace of workspaces) this.renderWorkspaceRow(workspace);
  }
  private renderWorkspaceRow(workspace: IsolatedWorkspaceRecord): void {
    const row = this.contentEl.createDiv({ cls: 'claudian-workspace-review-row' });
    row.createEl('h3', { text: workspace.name });
    row.createEl('p', { text: `${workspace.status} · ${workspace.isolated.path}` });
    new Setting(row).addButton((button) => button.setButtonText('Scan changes').onClick(async () => this.renderReview(workspace)));
  }
  private async renderReview(workspace: IsolatedWorkspaceRecord): Promise<void> {
    const review = await this.service.scanChanges(workspace.id);
    this.selected.clear();
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: workspace.name });
    for (const change of review.changes) this.renderChange(change);
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText('Back').onClick(() => void this.renderList()))
      .addButton((button) => button.setCta().setButtonText('Apply selected files').onClick(async () => {
        const result = await this.service.applyFiles(workspace.id, Array.from(this.selected));
        new Notice(`Applied ${result.applied.length} file(s); skipped ${result.skipped.length}.`);
        await this.renderList();
      }));
  }
  private renderChange(change: WorkspaceFileChange): void {
    new Setting(this.contentEl)
      .setName(`${change.path} · ${change.kind}`)
      .setDesc(change.safeToApply ? 'Safe whole-file apply.' : 'Review manually before applying.')
      .addToggle((toggle) => toggle.setDisabled(!change.safeToApply).onChange((enabled) => {
        if (enabled) this.selected.add(change.path);
        else this.selected.delete(change.path);
      }));
  }
}
```

- [ ] **Step 3: Wire real service in `src/main.ts`**

Use `VaultFileAdapter`, `WorkspaceRegistry`, `CopyWorkspaceAllocator`, `WorkspaceDiffService`, `WorkspaceApplyService`, `fingerprintTree`, and `WorkspaceReviewModal`. Add a plugin field:

```ts
private workspaceIsolationService: WorkspaceIsolationService | null = null;
```

Construct it during `onload`:

```ts
this.workspaceIsolationService = new WorkspaceIsolationService({
  now: () => new Date().toISOString(),
  idFactory: () => `workspace-${randomUUID()}`,
  allocator: new CopyWorkspaceAllocator({ now: () => new Date().toISOString() }),
  registry: new WorkspaceRegistry(new VaultFileAdapter(this.app)),
  diffServiceFactory: () => new WorkspaceDiffService(new NodeFingerprintReader(), new NodeFingerprintReader()),
  applyService: new WorkspaceApplyService(new NodeWholeFileAdapter()),
});
```

Replace the command shell callback:

```ts
openWorkspaceReview: () => {
  if (!this.workspaceIsolationService) {
    new Notice('Workspace Isolation is not initialized.');
    return;
  }
  new WorkspaceReviewModal(this, this.workspaceIsolationService).open();
},
```

- [ ] **Step 4: Add CSS**

Add safe DOM classes to the relevant style module:

```css
.claudian-workspace-review-row {
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  margin: 8px 0;
  padding: 8px;
}

.claudian-workspace-review-row h3 {
  margin: 0 0 4px 0;
}

.claudian-workspace-review-row p {
  color: var(--text-muted);
  margin: 0 0 8px 0;
}
```

- [ ] **Step 5: Run integration tests and commit**

```powershell
npm run test -- tests/integration/features/workspaces/workspaceIsolation.copyFlow.test.ts
npm run test -- tests/unit/features/workspaces tests/unit/features/settings/registry/workspacesFields.test.ts
npm run typecheck
npm run lint
git add src/main.ts src/features/workspaces src/features/settings tests/integration/features/workspaces tests/unit/features/workspaces tests/unit/features/settings src/style
git commit -m "feat(workspaces): add copy workspace review surface"
```

Expected: targeted tests, typecheck, and lint PASS before commit.

---

## Task 8: Documentation and final verification

**Files:**
- Modify: `docs/product/features/Workspace Isolation.md`
- Modify: `docs/superpowers/specs/2026-06-07-workspace-isolation-design.md` only if implementation changes a documented decision

- [ ] **Step 1: Update docs status paragraph**

If the foundation is user-visible, add this to [[docs/product/features/Workspace Isolation.md]]:

```md
### Current status

The first slice supports manual copy workspaces: create an isolated copy, review changed files, and apply selected whole-file replacements. Chat tab isolation, Agent Board automatic isolation, and git-native branch merge are follow-up slices.
```

- [ ] **Step 2: Run full verification**

```powershell
npm run test -- tests/unit/features/workspaces tests/unit/features/settings/registry/workspacesFields.test.ts
npm run test -- tests/integration/features/workspaces/workspaceIsolation.copyFlow.test.ts
npm run typecheck
npm run lint
npm run build
```

Expected: all PASS.

- [ ] **Step 3: Manual smoke**

1. Enable **Settings → Specorator → Workspace Isolation → Enable Workspace Isolation**.
2. Run **Open Workspace Isolation review** with no records and confirm the modal says `No isolated workspaces yet.`
3. Create a small test workspace through a dev harness using `WorkspaceIsolationService.createWorkspace`.
4. Edit one file in the isolated copy.
5. Open the review modal, scan changes, select the changed file, and apply it.
6. Confirm the source file content changed.
7. Change the source and isolated copy of another file, scan, and confirm it appears as conflicted and cannot be selected by default.

- [ ] **Step 4: Commit docs if changed**

```powershell
git add docs/product/features/Workspace\ Isolation.md docs/superpowers/specs/2026-06-07-workspace-isolation-design.md
git commit -m "docs(workspaces): document workspace isolation foundation status"
```

Skip this commit when no documentation changed.

---

## Final PR checklist

- [ ] Branch was created from `origin/main` in a fresh implementation worktree.
- [ ] Every task commit is present and scoped.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` passes.
- [ ] Workspace unit tests pass.
- [ ] Workspace integration copy-flow test passes.
- [ ] `npm run build` passes.
- [ ] Manual smoke notes are in the PR body.
- [ ] PR summary calls out follow-up plans for Chat isolation, Agent Board isolation, and git-native merge.
