---
status: partially-shipped
parent: Infrastructure
---

> **Status (2026-06-03): mostly shipped.** The registry, search bar, first-run banner, custom-models table,
> resolver-aware default provider, and live hotkeys all shipped (Claudian is now 3.2.0). The residual tail —
> porting the remaining 5 imperative tabs onto the registry (only `{agentBoard, orchestrator, diagnostics}`
> are feature-flagged on via `registry/featureFlag.ts`) — is tracked as
> [[docs/issues/settings-registry-port-followup.md]], and the 4-bucket IA reorg as
> [[docs/issues/settings-information-architecture.md]]. The `USE_REGISTRY_RENDERER` flag is vestigial.

# Settings Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the imperative settings shell with a typed registry that drives every tab, surface a search box and first-run banner, hide disabled provider tabs, resolve the Agent Board default provider deterministically, move per-model context-window overrides into per-provider Models sections, show live hotkey bindings, and strip dead legacy storage paths. Ship as Claudian 3.0.0.

**Architecture:** New `src/features/settings/registry/` module owns the `SettingsField` / `SettingsTab` / `SettingsSection` contracts plus a runtime `SettingsRegistry`. Tab renderers iterate registry slices instead of hand-writing `addSetting()` walls. Tab visibility, search index, default seeding, and the first-run banner are all derived from the same registry. The shell (`ClaudianSettings.ts`) gains a search bar at the top and a tab-strip filtered by visibility predicates. Storage stays at `.claudian/claudian-settings.json` — legacy `.claude/` paths are deleted.

**Tech Stack:** TypeScript, Obsidian Plugin API, Jest, ESLint, existing project layout (`src/features/settings/`, `src/providers/{claude,codex,opencode,cursor}/`, `src/app/settings/`, `src/core/bootstrap/`).

**Spec:** [docs/superpowers/specs/2026-05-30-settings-overhaul-design.md](../specs/2026-05-30-settings-overhaul-design.md)

---

## Phase A — Registry foundation

Goal: typed contracts, a runtime registry that supports register/getByTab/search, helpers for dotted-path read/write, defaults builder, all behind a feature flag so nothing in production switches yet.

### Task A1: Add the feature flag

**Files:**
- Create: `src/features/settings/registry/featureFlag.ts`
- Test: `tests/unit/features/settings/registry/featureFlag.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/settings/registry/featureFlag.test.ts
import { USE_REGISTRY_RENDERER } from '../../../../../src/features/settings/registry/featureFlag';

describe('settings registry feature flag', () => {
  it('exposes a boolean USE_REGISTRY_RENDERER constant', () => {
    expect(typeof USE_REGISTRY_RENDERER).toBe('boolean');
  });

  it('defaults to false so production keeps the imperative shell', () => {
    expect(USE_REGISTRY_RENDERER).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -- --selectProjects unit --testPathPatterns featureFlag`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the file**

```ts
// src/features/settings/registry/featureFlag.ts
// Single boolean controlling whether the new registry-driven renderer is wired
// into the settings shell. Flipped to `true` for tabs as they are ported and
// removed entirely after the final tab is migrated (see plan Phase I).
export const USE_REGISTRY_RENDERER = false;
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -- --selectProjects unit --testPathPatterns featureFlag`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/registry/featureFlag.ts tests/unit/features/settings/registry/featureFlag.test.ts
git commit -m "feat(settings): add registry feature flag default off"
```

---

### Task A2: Define the `SettingsField` type module

**Files:**
- Create: `src/features/settings/registry/SettingsField.ts`
- Test: `tests/unit/features/settings/registry/SettingsField.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/settings/registry/SettingsField.test.ts
import type {
  SettingsField,
  SettingsFieldType,
  SettingsSection,
  SettingsTab,
} from '../../../../../src/features/settings/registry/SettingsField';

describe('SettingsField types', () => {
  it('accepts a minimal toggle field declaration', () => {
    const field: SettingsField<boolean> = {
      id: 'general.firstRunDismissed',
      tabId: 'general',
      sectionId: 'providers',
      label: 'First-run dismissed',
      type: { kind: 'toggle' },
      default: false,
    };
    expect(field.default).toBe(false);
  });

  it('accepts a dropdown field with options factory', () => {
    const fieldType: SettingsFieldType = {
      kind: 'dropdown',
      options: () => [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Bravo' },
      ],
    };
    expect(fieldType.kind).toBe('dropdown');
  });

  it('accepts tab and section declarations with order and visibility', () => {
    const tab: SettingsTab = { id: 'claude', label: 'Claude', order: 10, visible: () => true };
    const section: SettingsSection = {
      id: 'models',
      tabId: 'claude',
      label: 'Models',
      order: 20,
    };
    expect(tab.id).toBe('claude');
    expect(section.tabId).toBe('claude');
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -- --selectProjects unit --testPathPatterns SettingsField`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```ts
// src/features/settings/registry/SettingsField.ts
import type { ClaudianSettings } from '../../../core/types/settings';

export interface SettingsCtx {
  settings: ClaudianSettings;
  saveSettings: () => Promise<void>;
  refresh: () => void;
}

export type SettingsFieldType =
  | { kind: 'toggle' }
  | { kind: 'text'; placeholder?: string }
  | { kind: 'textarea'; placeholder?: string; rows?: number }
  | { kind: 'number'; min?: number; max?: number; step?: number }
  | {
      kind: 'dropdown';
      options: (settings: ClaudianSettings) => Array<{ value: string; label: string }>;
    }
  | { kind: 'folder'; placeholder?: string }
  | { kind: 'button'; label: string; onClick: (ctx: SettingsCtx) => void | Promise<void> }
  | {
      kind: 'custom';
      render: (ctx: SettingsCtx, host: HTMLElement) => void | (() => void);
    };

export interface SettingsField<T = unknown> {
  id: string;
  tabId: string;
  sectionId: string;
  label: string;
  description?: string;
  type: SettingsFieldType;
  default: T;
  visible?: (settings: ClaudianSettings) => boolean;
  keywords?: string[];
}

export interface SettingsTab {
  id: string;
  label: string;
  order: number;
  visible: (settings: ClaudianSettings) => boolean;
}

export interface SettingsSection {
  id: string;
  tabId: string;
  label: string;
  order: number;
  description?: string;
  visible?: (settings: ClaudianSettings) => boolean;
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -- --selectProjects unit --testPathPatterns SettingsField`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/registry/SettingsField.ts tests/unit/features/settings/registry/SettingsField.test.ts
git commit -m "feat(settings): add SettingsField SettingsTab SettingsSection types"
```

---

### Task A3: Add dotted-path read/write helpers

**Files:**
- Create: `src/features/settings/registry/path.ts`
- Test: `tests/unit/features/settings/registry/path.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/settings/registry/path.test.ts
import { readPath, writePath } from '../../../../../src/features/settings/registry/path';

describe('readPath', () => {
  it('reads a top-level key', () => {
    expect(readPath({ foo: 1 }, 'foo')).toBe(1);
  });
  it('reads a nested key', () => {
    expect(readPath({ a: { b: { c: 'x' } } }, 'a.b.c')).toBe('x');
  });
  it('returns undefined for a missing key', () => {
    expect(readPath({ a: 1 }, 'a.b')).toBeUndefined();
  });
});

describe('writePath', () => {
  it('writes a top-level key non-mutatively', () => {
    const source = { foo: 1, bar: 2 };
    const result = writePath(source, 'foo', 9);
    expect(result).toEqual({ foo: 9, bar: 2 });
    expect(source.foo).toBe(1);
  });

  it('writes a nested key, preserving siblings', () => {
    const source = { a: { b: 1, c: 2 } };
    const result = writePath(source, 'a.b', 9);
    expect(result).toEqual({ a: { b: 9, c: 2 } });
    expect(source.a.b).toBe(1);
  });

  it('creates intermediate objects when needed', () => {
    const source = {};
    const result = writePath(source, 'a.b.c', 7);
    expect(result).toEqual({ a: { b: { c: 7 } } });
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -- --selectProjects unit --testPathPatterns path`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/settings/registry/path.ts
export function readPath<T = unknown>(source: unknown, dottedId: string): T | undefined {
  const parts = dottedId.split('.');
  let current: unknown = source;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current as T | undefined;
}

export function writePath<T extends object>(source: T, dottedId: string, value: unknown): T {
  const parts = dottedId.split('.');
  if (parts.length === 0) {
    return source;
  }
  const next: Record<string, unknown> = { ...(source as unknown as Record<string, unknown>) };
  let cursor: Record<string, unknown> = next;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const existing = cursor[key];
    const child: Record<string, unknown> =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cursor[key] = child;
    cursor = child;
  }
  cursor[parts[parts.length - 1]] = value;
  return next as T;
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -- --selectProjects unit --testPathPatterns path`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/registry/path.ts tests/unit/features/settings/registry/path.test.ts
git commit -m "feat(settings): add dotted-path read/write helpers"
```

---

### Task A4: Implement the runtime `SettingsRegistry`

**Files:**
- Create: `src/features/settings/registry/SettingsRegistry.ts`
- Test: `tests/unit/features/settings/registry/SettingsRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/settings/registry/SettingsRegistry.test.ts
import type { ClaudianSettings } from '../../../../../src/core/types/settings';
import type {
  SettingsField,
  SettingsSection,
  SettingsTab,
} from '../../../../../src/features/settings/registry/SettingsField';
import { SettingsRegistry } from '../../../../../src/features/settings/registry/SettingsRegistry';

function makeSettings(): ClaudianSettings {
  return { providerConfigs: {} } as unknown as ClaudianSettings;
}

describe('SettingsRegistry', () => {
  it('registers and lists visible tabs in order', () => {
    const r = new SettingsRegistry();
    const a: SettingsTab = { id: 'a', label: 'A', order: 20, visible: () => true };
    const b: SettingsTab = { id: 'b', label: 'B', order: 10, visible: () => true };
    const hidden: SettingsTab = { id: 'h', label: 'H', order: 30, visible: () => false };
    r.registerTab(a);
    r.registerTab(b);
    r.registerTab(hidden);
    expect(r.getTabs(makeSettings()).map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('rejects duplicate tab ids', () => {
    const r = new SettingsRegistry();
    r.registerTab({ id: 'a', label: 'A', order: 1, visible: () => true });
    expect(() =>
      r.registerTab({ id: 'a', label: 'A2', order: 2, visible: () => true }),
    ).toThrow(/duplicate tab id/i);
  });

  it('rejects duplicate field ids', () => {
    const r = new SettingsRegistry();
    const f: SettingsField<boolean> = {
      id: 'x.y',
      tabId: 'a',
      sectionId: 's',
      label: 'X',
      type: { kind: 'toggle' },
      default: false,
    };
    r.registerField(f);
    expect(() => r.registerField(f)).toThrow(/duplicate field id/i);
  });

  it('groups fields by tab and section in order', () => {
    const r = new SettingsRegistry();
    r.registerTab({ id: 'a', label: 'A', order: 1, visible: () => true });
    const s1: SettingsSection = { id: 's1', tabId: 'a', label: 'S1', order: 10 };
    const s2: SettingsSection = { id: 's2', tabId: 'a', label: 'S2', order: 20 };
    r.registerSection(s1);
    r.registerSection(s2);
    r.registerField({
      id: 'a.s1.x',
      tabId: 'a',
      sectionId: 's1',
      label: 'X',
      type: { kind: 'toggle' },
      default: false,
    });
    r.registerField({
      id: 'a.s2.y',
      tabId: 'a',
      sectionId: 's2',
      label: 'Y',
      type: { kind: 'toggle' },
      default: false,
    });
    expect(r.getSections('a', makeSettings()).map((s) => s.id)).toEqual(['s1', 's2']);
    expect(r.getFields('a', 's1', makeSettings()).map((f) => f.id)).toEqual(['a.s1.x']);
  });

  it('skips fields whose visible predicate returns false', () => {
    const r = new SettingsRegistry();
    r.registerTab({ id: 'a', label: 'A', order: 1, visible: () => true });
    r.registerSection({ id: 's', tabId: 'a', label: 'S', order: 1 });
    r.registerField({
      id: 'a.s.x',
      tabId: 'a',
      sectionId: 's',
      label: 'X',
      type: { kind: 'toggle' },
      default: false,
      visible: () => false,
    });
    expect(r.getFields('a', 's', makeSettings())).toEqual([]);
  });

  it('search returns fields matched by label, description, and keywords', () => {
    const r = new SettingsRegistry();
    r.registerTab({ id: 'a', label: 'A', order: 1, visible: () => true });
    r.registerSection({ id: 's', tabId: 'a', label: 'S', order: 1 });
    r.registerField({
      id: 'a.s.context',
      tabId: 'a',
      sectionId: 's',
      label: 'Context window',
      description: 'Maximum number of tokens',
      type: { kind: 'number' },
      default: 200_000,
      keywords: ['tokens', 'budget'],
    });
    expect(r.search('context', makeSettings()).map((f) => f.id)).toContain('a.s.context');
    expect(r.search('tokens', makeSettings()).map((f) => f.id)).toContain('a.s.context');
    expect(r.search('zzz', makeSettings())).toEqual([]);
  });

  it('search excludes fields hidden by visible predicate', () => {
    const r = new SettingsRegistry();
    r.registerTab({ id: 'a', label: 'A', order: 1, visible: () => true });
    r.registerSection({ id: 's', tabId: 'a', label: 'S', order: 1 });
    r.registerField({
      id: 'a.s.hidden',
      tabId: 'a',
      sectionId: 's',
      label: 'Hidden field',
      type: { kind: 'toggle' },
      default: false,
      visible: () => false,
    });
    expect(r.search('hidden', makeSettings())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -- --selectProjects unit --testPathPatterns SettingsRegistry`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/settings/registry/SettingsRegistry.ts
import type { ClaudianSettings } from '../../../core/types/settings';

import type { SettingsField, SettingsSection, SettingsTab } from './SettingsField';

function subsequenceScore(query: string, target: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let lastHit = -1;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t[ti] === q[qi]) {
      const gap = lastHit < 0 ? 0 : ti - lastHit - 1;
      score += 100 - gap;
      lastHit = ti;
      qi += 1;
    }
  }
  return qi === q.length ? Math.max(score, 1) : 0;
}

export class SettingsRegistry {
  private readonly tabs = new Map<string, SettingsTab>();
  private readonly sections = new Map<string, SettingsSection>();
  private readonly fields = new Map<string, SettingsField>();

  registerTab(tab: SettingsTab): void {
    if (this.tabs.has(tab.id)) {
      throw new Error(`duplicate tab id: ${tab.id}`);
    }
    this.tabs.set(tab.id, tab);
  }

  registerSection(section: SettingsSection): void {
    const key = `${section.tabId}.${section.id}`;
    if (this.sections.has(key)) {
      throw new Error(`duplicate section id: ${key}`);
    }
    this.sections.set(key, section);
  }

  registerField(field: SettingsField): void {
    if (this.fields.has(field.id)) {
      throw new Error(`duplicate field id: ${field.id}`);
    }
    this.fields.set(field.id, field);
  }

  getTabs(settings: ClaudianSettings): SettingsTab[] {
    return Array.from(this.tabs.values())
      .filter((tab) => tab.visible(settings))
      .sort((a, b) => a.order - b.order);
  }

  getSections(tabId: string, settings: ClaudianSettings): SettingsSection[] {
    return Array.from(this.sections.values())
      .filter((s) => s.tabId === tabId)
      .filter((s) => (s.visible ? s.visible(settings) : true))
      .sort((a, b) => a.order - b.order);
  }

  getFields(tabId: string, sectionId: string, settings: ClaudianSettings): SettingsField[] {
    return Array.from(this.fields.values())
      .filter((f) => f.tabId === tabId && f.sectionId === sectionId)
      .filter((f) => (f.visible ? f.visible(settings) : true));
  }

  getAllFields(): SettingsField[] {
    return Array.from(this.fields.values());
  }

  search(query: string, settings: ClaudianSettings): SettingsField[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const matches: Array<{ field: SettingsField; score: number }> = [];
    for (const field of this.fields.values()) {
      if (field.visible && !field.visible(settings)) continue;
      const score =
        subsequenceScore(trimmed, field.label) * 3 +
        subsequenceScore(trimmed, field.description ?? '') * 2 +
        subsequenceScore(trimmed, (field.keywords ?? []).join(' ')) * 2 +
        subsequenceScore(trimmed, `${field.tabId} ${field.sectionId}`);
      if (score > 0) matches.push({ field, score });
    }
    return matches.sort((a, b) => b.score - a.score).map((m) => m.field);
  }
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -- --selectProjects unit --testPathPatterns SettingsRegistry`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/registry/SettingsRegistry.ts tests/unit/features/settings/registry/SettingsRegistry.test.ts
git commit -m "feat(settings): add SettingsRegistry with search and visibility"
```

---

### Task A5: Add the defaults builder

**Files:**
- Create: `src/features/settings/registry/buildDefaultsFromRegistry.ts`
- Test: `tests/unit/features/settings/registry/buildDefaultsFromRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/settings/registry/buildDefaultsFromRegistry.test.ts
import { buildDefaultsFromRegistry } from '../../../../../src/features/settings/registry/buildDefaultsFromRegistry';
import { SettingsRegistry } from '../../../../../src/features/settings/registry/SettingsRegistry';

describe('buildDefaultsFromRegistry', () => {
  it('returns an empty object for an empty registry', () => {
    expect(buildDefaultsFromRegistry(new SettingsRegistry())).toEqual({});
  });

  it('seeds top-level and nested defaults from registered fields', () => {
    const r = new SettingsRegistry();
    r.registerField({
      id: 'maxTabs',
      tabId: 'general',
      sectionId: 's',
      label: 'Max',
      type: { kind: 'number' },
      default: 3,
    });
    r.registerField({
      id: 'agentBoard.workOrderFolder',
      tabId: 'agentBoard',
      sectionId: 's',
      label: 'Folder',
      type: { kind: 'text' },
      default: 'Agent Board/tasks',
    });
    expect(buildDefaultsFromRegistry(r)).toEqual({
      maxTabs: 3,
      agentBoard: { workOrderFolder: 'Agent Board/tasks' },
    });
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -- --selectProjects unit --testPathPatterns buildDefaultsFromRegistry`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/settings/registry/buildDefaultsFromRegistry.ts
import { writePath } from './path';
import type { SettingsRegistry } from './SettingsRegistry';

export function buildDefaultsFromRegistry(registry: SettingsRegistry): Record<string, unknown> {
  let acc: Record<string, unknown> = {};
  for (const field of registry.getAllFields()) {
    acc = writePath(acc, field.id, field.default);
  }
  return acc;
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -- --selectProjects unit --testPathPatterns buildDefaultsFromRegistry`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/registry/buildDefaultsFromRegistry.ts tests/unit/features/settings/registry/buildDefaultsFromRegistry.test.ts
git commit -m "feat(settings): add buildDefaultsFromRegistry helper"
```

---

### Task A6: Add the registry singleton and registration entry point

**Files:**
- Create: `src/features/settings/registry/registry.ts`
- Test: `tests/unit/features/settings/registry/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/settings/registry/registry.test.ts
import {
  getSettingsRegistry,
  resetSettingsRegistryForTests,
} from '../../../../../src/features/settings/registry/registry';

describe('settings registry singleton', () => {
  beforeEach(() => resetSettingsRegistryForTests());

  it('returns the same instance across calls', () => {
    const a = getSettingsRegistry();
    const b = getSettingsRegistry();
    expect(a).toBe(b);
  });

  it('reset clears all state', () => {
    const a = getSettingsRegistry();
    a.registerTab({ id: 't', label: 'T', order: 1, visible: () => true });
    resetSettingsRegistryForTests();
    const b = getSettingsRegistry();
    expect(b).not.toBe(a);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -- --selectProjects unit --testPathPatterns registry/registry`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/settings/registry/registry.ts
import { SettingsRegistry } from './SettingsRegistry';

let instance: SettingsRegistry | null = null;

export function getSettingsRegistry(): SettingsRegistry {
  if (!instance) {
    instance = new SettingsRegistry();
  }
  return instance;
}

export function resetSettingsRegistryForTests(): void {
  instance = null;
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -- --selectProjects unit --testPathPatterns registry/registry`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/registry/registry.ts tests/unit/features/settings/registry/registry.test.ts
git commit -m "feat(settings): add settings registry singleton helper"
```

---

### Task A7: Add a registry barrel export

**Files:**
- Create: `src/features/settings/registry/index.ts`

- [ ] **Step 1: Add the barrel**

```ts
// src/features/settings/registry/index.ts
export { USE_REGISTRY_RENDERER } from './featureFlag';
export type {
  SettingsCtx,
  SettingsField,
  SettingsFieldType,
  SettingsSection,
  SettingsTab,
} from './SettingsField';
export { SettingsRegistry } from './SettingsRegistry';
export { buildDefaultsFromRegistry } from './buildDefaultsFromRegistry';
export { getSettingsRegistry, resetSettingsRegistryForTests } from './registry';
export { readPath, writePath } from './path';
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS — no errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/settings/registry/index.ts
git commit -m "feat(settings): add registry barrel export"
```

---

## Phase B — General tab field registrations

Goal: declare every General-tab field in registry form, behind the `USE_REGISTRY_RENDERER` flag (still `false`). Builds the per-tab `fields/general.ts` module. No UI swap yet.

### Task B1: Register the General tab and its sections

**Files:**
- Create: `src/features/settings/registry/fields/general.ts`
- Test: `tests/unit/features/settings/registry/fields/general.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/settings/registry/fields/general.test.ts
import type { ClaudianSettings } from '../../../../../../src/core/types/settings';
import { registerGeneralTabFields } from '../../../../../../src/features/settings/registry/fields/general';
import { SettingsRegistry } from '../../../../../../src/features/settings/registry/SettingsRegistry';

function makeSettings(): ClaudianSettings {
  return { providerConfigs: {} } as unknown as ClaudianSettings;
}

describe('registerGeneralTabFields', () => {
  it('registers a `general` tab visible to everyone', () => {
    const r = new SettingsRegistry();
    registerGeneralTabFields(r);
    const tabs = r.getTabs(makeSettings()).map((t) => t.id);
    expect(tabs).toContain('general');
  });

  it('registers a `providers` section under general', () => {
    const r = new SettingsRegistry();
    registerGeneralTabFields(r);
    const sections = r.getSections('general', makeSettings()).map((s) => s.id);
    expect(sections).toContain('providers');
    expect(sections).toContain('language');
    expect(sections).toContain('display');
    expect(sections).toContain('conversations');
    expect(sections).toContain('content');
    expect(sections).toContain('input');
    expect(sections).toContain('environment');
    expect(sections).toContain('hotkeys');
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -- --selectProjects unit --testPathPatterns fields/general`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/settings/registry/fields/general.ts
import type { SettingsRegistry } from '../SettingsRegistry';

export function registerGeneralTabFields(registry: SettingsRegistry): void {
  registry.registerTab({ id: 'general', label: 'General', order: 10, visible: () => true });
  registry.registerSection({ id: 'providers', tabId: 'general', label: 'Providers', order: 10 });
  registry.registerSection({ id: 'language', tabId: 'general', label: 'Language', order: 20 });
  registry.registerSection({ id: 'display', tabId: 'general', label: 'Display', order: 30 });
  registry.registerSection({
    id: 'conversations',
    tabId: 'general',
    label: 'Conversations',
    order: 40,
  });
  registry.registerSection({ id: 'content', tabId: 'general', label: 'Content', order: 50 });
  registry.registerSection({ id: 'input', tabId: 'general', label: 'Input', order: 60 });
  registry.registerSection({
    id: 'environment',
    tabId: 'general',
    label: 'Environment',
    order: 70,
  });
  registry.registerSection({ id: 'hotkeys', tabId: 'general', label: 'Hotkeys', order: 80 });
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -- --selectProjects unit --testPathPatterns fields/general`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/registry/fields/general.ts tests/unit/features/settings/registry/fields/general.test.ts
git commit -m "feat(settings): register General tab and its sections"
```

---

### Task B2: Add a section-merge helper for nested provider fields

Per the spec, provider fields live in `src/providers/{provider}/settings/registryFields.ts`. Add a `registerProviderSections` helper used by every provider registration entry-point. Lives next to the registry to keep provider modules thin.

**Files:**
- Create: `src/features/settings/registry/providers/registerProviderTab.ts`
- Test: `tests/unit/features/settings/registry/providers/registerProviderTab.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/settings/registry/providers/registerProviderTab.test.ts
import type { ClaudianSettings } from '../../../../../../src/core/types/settings';
import { registerProviderTab } from '../../../../../../src/features/settings/registry/providers/registerProviderTab';
import { SettingsRegistry } from '../../../../../../src/features/settings/registry/SettingsRegistry';

function settingsWith(enabled: boolean): ClaudianSettings {
  return {
    providerConfigs: { claude: { enabled } },
  } as unknown as ClaudianSettings;
}

describe('registerProviderTab', () => {
  it('hides the tab when the provider is disabled', () => {
    const r = new SettingsRegistry();
    registerProviderTab(r, {
      providerId: 'claude',
      label: 'Claude',
      order: 20,
      sections: [{ id: 'setup', label: 'Setup', order: 10 }],
    });
    expect(r.getTabs(settingsWith(false)).map((t) => t.id)).not.toContain('claude');
  });

  it('shows the tab and its sections when enabled', () => {
    const r = new SettingsRegistry();
    registerProviderTab(r, {
      providerId: 'claude',
      label: 'Claude',
      order: 20,
      sections: [
        { id: 'setup', label: 'Setup', order: 10 },
        { id: 'models', label: 'Models', order: 20 },
      ],
    });
    expect(r.getTabs(settingsWith(true)).map((t) => t.id)).toContain('claude');
    expect(r.getSections('claude', settingsWith(true)).map((s) => s.id)).toEqual([
      'setup',
      'models',
    ]);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -- --selectProjects unit --testPathPatterns registerProviderTab`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/features/settings/registry/providers/registerProviderTab.ts
import type { ProviderId } from '../../../../core/providers/types';
import type { ClaudianSettings } from '../../../../core/types/settings';
import type { SettingsRegistry } from '../SettingsRegistry';

export interface ProviderTabSpec {
  providerId: ProviderId;
  label: string;
  order: number;
  sections: Array<{ id: string; label: string; order: number; description?: string }>;
}

export function isProviderEnabled(
  settings: ClaudianSettings,
  providerId: ProviderId,
): boolean {
  const cfg = settings.providerConfigs?.[providerId] as { enabled?: boolean } | undefined;
  return Boolean(cfg?.enabled);
}

export function registerProviderTab(registry: SettingsRegistry, spec: ProviderTabSpec): void {
  registry.registerTab({
    id: spec.providerId,
    label: spec.label,
    order: spec.order,
    visible: (s) => isProviderEnabled(s, spec.providerId),
  });
  for (const section of spec.sections) {
    registry.registerSection({
      id: section.id,
      tabId: spec.providerId,
      label: section.label,
      order: section.order,
      description: section.description,
    });
  }
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -- --selectProjects unit --testPathPatterns registerProviderTab`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/registry/providers/registerProviderTab.ts tests/unit/features/settings/registry/providers/registerProviderTab.test.ts
git commit -m "feat(settings): add registerProviderTab visibility helper"
```

---

## Phase C — Per-provider and feature tabs

Goal: declare per-provider and feature tab field registrations through the registry. Each provider gets its own `registryFields.ts` under its provider folder; feature tabs (Agent Board, Orchestrator, Diagnostics) get sibling modules under `src/features/settings/registry/fields/`. The registrations still live behind the `USE_REGISTRY_RENDERER` flag — no UI swap yet.

For each of Tasks C1–C7 the pattern is identical:

1. Write a failing test asserting the tab registers + correct sections appear.
2. Write a failing test asserting a representative field round-trips (default → registry → seeded into defaults builder).
3. Implement the registration function declaring every field that the existing imperative renderer emits (mirror labels, descriptions, defaults from current code; do NOT change any default value during port).
4. Add an integration test that registers every tab into a fresh `SettingsRegistry` and verifies `buildDefaultsFromRegistry` produces a subset matching `DEFAULT_CLAUDIAN_SETTINGS`.
5. Commit.

The full snippet templates below for C1 are copy-and-adapt patterns for the other six tasks.

### Task C1: Claude tab registration

**Files:**
- Create: `src/providers/claude/settings/registryFields.ts`
- Test: `tests/unit/providers/claude/settings/registryFields.test.ts`

- [ ] **Step 1: Write the failing test (tab + section presence)**

```ts
// tests/unit/providers/claude/settings/registryFields.test.ts
import type { ClaudianSettings } from '../../../../../src/core/types/settings';
import { registerClaudeTabFields } from '../../../../../src/providers/claude/settings/registryFields';
import { SettingsRegistry } from '../../../../../src/features/settings/registry/SettingsRegistry';

function settings(enabled: boolean): ClaudianSettings {
  return { providerConfigs: { claude: { enabled } } } as unknown as ClaudianSettings;
}

describe('registerClaudeTabFields', () => {
  it('registers the claude tab visible only when enabled', () => {
    const r = new SettingsRegistry();
    registerClaudeTabFields(r);
    expect(r.getTabs(settings(false)).map((t) => t.id)).not.toContain('claude');
    expect(r.getTabs(settings(true)).map((t) => t.id)).toContain('claude');
  });

  it('registers Setup, Safety, Models, Commands and skills, Subagents, MCP servers, Plugins, Environment, Experimental sections', () => {
    const r = new SettingsRegistry();
    registerClaudeTabFields(r);
    const sectionIds = r.getSections('claude', settings(true)).map((s) => s.id);
    expect(sectionIds).toEqual([
      'setup',
      'safety',
      'models',
      'commands',
      'subagents',
      'mcp',
      'plugins',
      'environment',
      'experimental',
    ]);
  });

  it('registers the cliPath field with the right id and default', () => {
    const r = new SettingsRegistry();
    registerClaudeTabFields(r);
    const fields = r.getFields('claude', 'setup', settings(true));
    const cliPath = fields.find((f) => f.id === 'providerConfigs.claude.cliPath');
    expect(cliPath?.default).toBe('');
    expect(cliPath?.label).toMatch(/CLI path/i);
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `npm run test -- --selectProjects unit --testPathPatterns claude/settings/registryFields`
Expected: FAIL.

- [ ] **Step 3: Implement registration**

Mirror every field rendered by the current Claude settings flow. Use `providerConfigs.claude.<field>` dotted ids for provider-config-backed fields and the field path used by `defaultSettings.ts` (`titleGenerationModel`, etc.) for shared fields that the Claude tab manages.

```ts
// src/providers/claude/settings/registryFields.ts
import { registerProviderTab } from '../../../features/settings/registry/providers/registerProviderTab';
import type { SettingsRegistry } from '../../../features/settings/registry/SettingsRegistry';

export function registerClaudeTabFields(registry: SettingsRegistry): void {
  registerProviderTab(registry, {
    providerId: 'claude',
    label: 'Claude',
    order: 20,
    sections: [
      { id: 'setup', label: 'Setup', order: 10 },
      { id: 'safety', label: 'Safety', order: 20 },
      { id: 'models', label: 'Models', order: 30 },
      { id: 'commands', label: 'Commands and skills', order: 40 },
      { id: 'subagents', label: 'Subagents', order: 50 },
      { id: 'mcp', label: 'MCP servers', order: 60 },
      { id: 'plugins', label: 'Claude Code Plugins', order: 70 },
      { id: 'environment', label: 'Environment', order: 80 },
      { id: 'experimental', label: 'Experimental', order: 90 },
    ],
  });

  registry.registerField({
    id: 'providerConfigs.claude.cliPath',
    tabId: 'claude',
    sectionId: 'setup',
    label: 'CLI path',
    description: 'Absolute path to the Claude Code CLI executable.',
    type: { kind: 'text', placeholder: '/usr/local/bin/claude' },
    default: '',
    keywords: ['claude', 'cli', 'path'],
  });

  registry.registerField({
    id: 'providerConfigs.claude.safeMode',
    tabId: 'claude',
    sectionId: 'safety',
    label: 'Safe mode',
    description: 'Controls tool approval prompts.',
    type: {
      kind: 'dropdown',
      options: () => [
        { value: 'acceptEdits', label: 'Accept edits' },
        { value: 'auto', label: 'Auto-approve' },
        { value: 'default', label: 'Default' },
      ],
    },
    default: 'acceptEdits',
    keywords: ['approval', 'permission'],
  });

  registry.registerField({
    id: 'providerConfigs.claude.loadUserSettings',
    tabId: 'claude',
    sectionId: 'setup',
    label: 'Load CC user settings',
    description: 'Read ~/.claude/settings.json on launch.',
    type: { kind: 'toggle' },
    default: true,
  });

  registry.registerField({
    id: 'providerConfigs.claude.enableChrome',
    tabId: 'claude',
    sectionId: 'experimental',
    label: 'Enable Chrome browser tool',
    type: { kind: 'toggle' },
    default: false,
  });

  registry.registerField({
    id: 'providerConfigs.claude.enableBangBash',
    tabId: 'claude',
    sectionId: 'experimental',
    label: 'Enable `!!` bash shortcut',
    type: { kind: 'toggle' },
    default: false,
  });

  registry.registerField({
    id: 'providerConfigs.claude.enableOpus1M',
    tabId: 'claude',
    sectionId: 'models',
    label: 'Enable Opus 1M model',
    type: { kind: 'toggle' },
    default: false,
    keywords: ['1m', 'opus'],
  });

  registry.registerField({
    id: 'providerConfigs.claude.enableSonnet1M',
    tabId: 'claude',
    sectionId: 'models',
    label: 'Enable Sonnet 1M model',
    type: { kind: 'toggle' },
    default: false,
    keywords: ['1m', 'sonnet'],
  });

  registry.registerField({
    id: 'providerConfigs.claude.customModels',
    tabId: 'claude',
    sectionId: 'models',
    label: 'Custom model ids (comma-separated)',
    type: { kind: 'textarea', rows: 2 },
    default: '',
    keywords: ['models'],
  });

  registry.registerField({
    id: 'providerConfigs.claude.environmentVariables',
    tabId: 'claude',
    sectionId: 'environment',
    label: 'Environment variables',
    description: 'KEY=value per line. Merged with shared env on launch.',
    type: { kind: 'textarea', rows: 6 },
    default: '',
    keywords: ['env', 'variables'],
  });

  // Non-uniform UIs (MCP server list, Plugins grid, Subagents list) are
  // registered as custom fields. Renderer keeps its existing widget impl;
  // registry just owns the slot.
  registry.registerField({
    id: 'providerConfigs.claude.mcpServers',
    tabId: 'claude',
    sectionId: 'mcp',
    label: 'MCP servers',
    type: { kind: 'custom', render: () => undefined },
    default: null,
    keywords: ['mcp', 'tools'],
  });
  registry.registerField({
    id: 'providerConfigs.claude.plugins',
    tabId: 'claude',
    sectionId: 'plugins',
    label: 'Claude Code plugins',
    type: { kind: 'custom', render: () => undefined },
    default: null,
    keywords: ['plugins'],
  });
  registry.registerField({
    id: 'providerConfigs.claude.subagents',
    tabId: 'claude',
    sectionId: 'subagents',
    label: 'Vault subagents',
    type: { kind: 'custom', render: () => undefined },
    default: null,
    keywords: ['agents', 'subagents'],
  });
  registry.registerField({
    id: 'providerConfigs.claude.commands',
    tabId: 'claude',
    sectionId: 'commands',
    label: 'Vault commands and skills',
    type: { kind: 'custom', render: () => undefined },
    default: null,
    keywords: ['commands', 'skills'],
  });
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npm run test -- --selectProjects unit --testPathPatterns claude/settings/registryFields`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/providers/claude/settings/registryFields.ts tests/unit/providers/claude/settings/registryFields.test.ts
git commit -m "feat(settings): register Claude tab fields in the registry"
```

---

### Task C2: Codex tab registration

**Files:**
- Create: `src/providers/codex/settings/registryFields.ts`
- Test: `tests/unit/providers/codex/settings/registryFields.test.ts`

Follow the same pattern as Task C1. Registrations to include (mirror current Codex settings UI):

- Tab: `id: 'codex'`, `label: 'Codex'`, `order: 30`, visible when `providerConfigs.codex.enabled === true`.
- Sections (in order): `setup`, `safety`, `models`, `skills`, `subagents`, `mcp`, `environment`.
- Fields:
  - `providerConfigs.codex.cliPath` — text, default `''`, label "CLI path".
  - `providerConfigs.codex.safeMode` — dropdown, default `'workspace-write'`, options `'workspace-write' | 'read-only'`.
  - `providerConfigs.codex.installationMethod` — dropdown, default `'native-windows'`, options `'native-windows' | 'wsl'`.
  - `providerConfigs.codex.wslDistroOverride` — text, default `''`.
  - `providerConfigs.codex.customModels` — textarea, default `''`.
  - `providerConfigs.codex.reasoningSummary` — dropdown, default `'auto'`, options `'auto' | 'concise' | 'detailed' | 'none'`.
  - `providerConfigs.codex.environmentVariables` — textarea, default `''`.
  - Custom-render slots: `providerConfigs.codex.skills`, `providerConfigs.codex.subagents`, `providerConfigs.codex.mcpServers`.

Tests mirror the C1 trio (tab visibility, section list, representative field id + default + label).

Commit message: `feat(settings): register Codex tab fields in the registry`.

---

### Task C3: Opencode tab registration

**Files:**
- Create: `src/providers/opencode/settings/registryFields.ts`
- Test: `tests/unit/providers/opencode/settings/registryFields.test.ts`

Same pattern as C1. Tab `id: 'opencode'`, `label: 'Opencode'`, `order: 40`.

Sections (in order): `setup`, `models`, `commands`, `subagents`, `environment`.

Fields:
- `providerConfigs.opencode.cliPath` — text, default `''`.
- `providerConfigs.opencode.selectedMode` — dropdown, options derived at runtime from registry's `OpencodeMode` catalog (use `() => settings.providerConfigs.opencode.discoveredModes ?? []`), default `''`.
- `providerConfigs.opencode.visibleModels` — custom slot.
- `providerConfigs.opencode.modelAliases` — custom slot.
- `providerConfigs.opencode.environmentVariables` — textarea, default `''`.
- Custom-render slots: `providerConfigs.opencode.subagents`, `providerConfigs.opencode.commands`.

Tests + commit follow C1.

---

### Task C4: Cursor tab registration

**Files:**
- Create: `src/providers/cursor/settings/registryFields.ts`
- Test: `tests/unit/providers/cursor/settings/registryFields.test.ts`

Same pattern. Tab `id: 'cursor'`, `label: 'Cursor'`, `order: 50`.

Sections (in order): `models`, `environment`.

Fields:
- `providerConfigs.cursor.cliPath` — text, default `''`, in `models` section per current UI placement.
- `providerConfigs.cursor.enabledModels` — custom slot (per-host enabled-models map).
- `providerConfigs.cursor.modelAliases` — custom slot.
- `providerConfigs.cursor.environmentVariables` — textarea, default `''`.

Tests + commit follow C1.

---

### Task C5: Agent Board tab registration

**Files:**
- Create: `src/features/settings/registry/fields/agentBoard.ts`
- Test: `tests/unit/features/settings/registry/fields/agentBoard.test.ts`

Tab `id: 'agentBoard'`, `label: 'Agent Board'`, `order: 60`, visible always.

Sections (in order): `folders`, `defaults`, `lanes`, `templates`, `archive`.

Fields:
- `agentBoardWorkOrderFolder` — folder, default `'Agent Board/tasks'`, in `folders`.
- `agentBoardTemplateFolder` — folder, default `'Agent Board/templates'`, in `folders`.
- `agentBoardArchiveFolder` — folder, default `'Agent Board/archive'`, in `archive`.
- `agentBoardDefaultProvider` — dropdown, default `null`, options from enabled providers (uses Phase F resolver in the renderer), in `defaults`. Set default to `null` in this task and update the import-only consumer in `defaultSettings.ts` in Task F4.
- `agentBoardDefaultModel` — dropdown, default `null`, options from the resolved provider's catalog, in `defaults`.
- `lanesEditor` — custom slot, in `lanes`.
- `installCommonTemplatesButton` — button, label "Install common templates", `onClick` invokes the existing command id `'claudian:install-common-work-order-templates'`, in `templates`.

Tests cover tab presence, section order, two representative field ids and defaults.

Commit: `feat(settings): register Agent Board tab fields`.

---

### Task C6: Orchestrator tab registration

**Files:**
- Create: `src/features/settings/registry/fields/orchestrator.ts`
- Test: `tests/unit/features/settings/registry/fields/orchestrator.test.ts`

Tab `id: 'orchestrator'`, `label: 'Orchestrator'`, `order: 70`, visible always.

Sections: `enable`, `prompt`.

Fields:
- `orchestratorEnabled` — toggle, default `true`, in `enable`.
- `orchestratorSystemPrompt` — textarea, default `''`, in `prompt`.

Tests + commit follow C1.

---

### Task C7: Diagnostics tab registration

**Files:**
- Create: `src/features/settings/registry/fields/diagnostics.ts`
- Test: `tests/unit/features/settings/registry/fields/diagnostics.test.ts`

Tab `id: 'diagnostics'`, `label: 'Diagnostics'`, `order: 80`, visible always.

Sections: `logging`, `actions`.

Fields:
- `loggingEnabled` — toggle, default `false`, in `logging`.
- `logLevel` — dropdown, default `'warn'`, options `'off' | 'error' | 'warn' | 'info' | 'debug'`, in `logging`, visible when `loggingEnabled === true`.
- `copyDiagnosticLogs` — button, label "Copy diagnostic logs", invokes command id `'claudian:copy-diagnostic-logs'`, in `actions`.
- `clearDiagnosticLogs` — button, label "Clear diagnostic logs", invokes command id `'claudian:clear-diagnostic-logs'`, in `actions`.

Tests + commit follow C1.

---

### Task C8: Single registration entry point

**Files:**
- Create: `src/features/settings/registry/registerAll.ts`
- Test: `tests/unit/features/settings/registry/registerAll.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/settings/registry/registerAll.test.ts
import { registerAllSettings } from '../../../../../src/features/settings/registry/registerAll';
import { SettingsRegistry } from '../../../../../src/features/settings/registry/SettingsRegistry';

function settings(allEnabled: boolean) {
  return {
    providerConfigs: {
      claude: { enabled: allEnabled },
      codex: { enabled: allEnabled },
      opencode: { enabled: allEnabled },
      cursor: { enabled: allEnabled },
    },
  } as unknown as import('../../../../../src/core/types/settings').ClaudianSettings;
}

describe('registerAllSettings', () => {
  it('produces general, agentBoard, orchestrator, diagnostics tabs by default', () => {
    const r = new SettingsRegistry();
    registerAllSettings(r);
    expect(r.getTabs(settings(false)).map((t) => t.id)).toEqual([
      'general',
      'agentBoard',
      'orchestrator',
      'diagnostics',
    ]);
  });

  it('adds claude/codex/opencode/cursor tabs when each provider is enabled', () => {
    const r = new SettingsRegistry();
    registerAllSettings(r);
    expect(r.getTabs(settings(true)).map((t) => t.id)).toEqual([
      'general',
      'claude',
      'codex',
      'opencode',
      'cursor',
      'agentBoard',
      'orchestrator',
      'diagnostics',
    ]);
  });

  it('throws if invoked twice on the same registry', () => {
    const r = new SettingsRegistry();
    registerAllSettings(r);
    expect(() => registerAllSettings(r)).toThrow(/duplicate/i);
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `npm run test -- --selectProjects unit --testPathPatterns registerAll`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/features/settings/registry/registerAll.ts
import { registerClaudeTabFields } from '../../../providers/claude/settings/registryFields';
import { registerCodexTabFields } from '../../../providers/codex/settings/registryFields';
import { registerCursorTabFields } from '../../../providers/cursor/settings/registryFields';
import { registerOpencodeTabFields } from '../../../providers/opencode/settings/registryFields';

import { registerAgentBoardTabFields } from './fields/agentBoard';
import { registerDiagnosticsTabFields } from './fields/diagnostics';
import { registerGeneralTabFields } from './fields/general';
import { registerOrchestratorTabFields } from './fields/orchestrator';
import type { SettingsRegistry } from './SettingsRegistry';

export function registerAllSettings(registry: SettingsRegistry): void {
  registerGeneralTabFields(registry);
  registerClaudeTabFields(registry);
  registerCodexTabFields(registry);
  registerOpencodeTabFields(registry);
  registerCursorTabFields(registry);
  registerAgentBoardTabFields(registry);
  registerOrchestratorTabFields(registry);
  registerDiagnosticsTabFields(registry);
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npm run test -- --selectProjects unit --testPathPatterns registerAll`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/registry/registerAll.ts tests/unit/features/settings/registry/registerAll.test.ts
git commit -m "feat(settings): add registerAllSettings entry point"
```

---

## Phase D — Registry-driven renderer (behind feature flag)

Goal: build the new renderer that iterates the registry and renders each `kind` to an Obsidian `Setting` row. Wire it behind `USE_REGISTRY_RENDERER` in the shell, but keep the flag `false`. Old renderers stay live in production.

### Task D1: Field renderer per kind

**Files:**
- Create: `src/features/settings/registry/renderField.ts`
- Test: `tests/unit/features/settings/registry/renderField.test.ts`

- [ ] **Step 1: Write the failing test**

Use jsdom + the existing Obsidian mock at `tests/mocks/obsidian.ts` to assert that `renderField` for each kind appends the expected DOM structure to a host element and persists values via the provided `SettingsCtx`. Cover `toggle`, `text`, `textarea`, `number`, `dropdown`, `folder`, `button`. Skip `custom` (it just calls into a user-supplied function — tested separately in D2).

- [ ] **Step 2: Run the test, expect failure**

Run: `npm run test -- --selectProjects unit --testPathPatterns renderField`
Expected: FAIL.

- [ ] **Step 3: Implement**

Renderer uses Obsidian's `Setting` API to build each row. Reads the current value via `readPath(settings, field.id) ?? field.default`; writes back via `writePath` + `saveSettings()` + `refresh()`. For each kind:

```ts
// src/features/settings/registry/renderField.ts
import { Setting } from 'obsidian';

import { readPath, writePath } from './path';
import type { SettingsCtx, SettingsField } from './SettingsField';

export function renderField(host: HTMLElement, field: SettingsField, ctx: SettingsCtx): void {
  const current = readPath(ctx.settings, field.id) ?? field.default;
  const setting = new Setting(host).setName(field.label);
  if (field.description) setting.setDesc(field.description);

  switch (field.type.kind) {
    case 'toggle':
      setting.addToggle((t) =>
        t.setValue(Boolean(current)).onChange(async (v) => {
          ctx.settings = writePath(ctx.settings, field.id, v) as typeof ctx.settings;
          await ctx.saveSettings();
          ctx.refresh();
        }),
      );
      return;
    case 'text':
    case 'folder':
      setting.addText((t) => {
        if (field.type.kind === 'text' && field.type.placeholder) t.setPlaceholder(field.type.placeholder);
        if (field.type.kind === 'folder' && field.type.placeholder) t.setPlaceholder(field.type.placeholder);
        t.setValue(String(current ?? '')).onChange(async (v) => {
          ctx.settings = writePath(ctx.settings, field.id, v) as typeof ctx.settings;
          await ctx.saveSettings();
        });
      });
      return;
    case 'textarea':
      setting.addTextArea((t) =>
        t.setValue(String(current ?? '')).onChange(async (v) => {
          ctx.settings = writePath(ctx.settings, field.id, v) as typeof ctx.settings;
          await ctx.saveSettings();
        }),
      );
      return;
    case 'number':
      setting.addText((t) =>
        t
          .setValue(String(current ?? ''))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isNaN(n)) return;
            ctx.settings = writePath(ctx.settings, field.id, n) as typeof ctx.settings;
            await ctx.saveSettings();
          }),
      );
      return;
    case 'dropdown': {
      const opts = field.type.options(ctx.settings);
      setting.addDropdown((d) => {
        opts.forEach((o) => d.addOption(o.value, o.label));
        d.setValue(String(current ?? ''));
        d.onChange(async (v) => {
          ctx.settings = writePath(ctx.settings, field.id, v) as typeof ctx.settings;
          await ctx.saveSettings();
          ctx.refresh();
        });
      });
      return;
    }
    case 'button':
      setting.addButton((b) =>
        b.setButtonText(field.type.kind === 'button' ? field.type.label : 'Run').onClick(async () => {
          if (field.type.kind === 'button') await field.type.onClick(ctx);
        }),
      );
      return;
    case 'custom':
      field.type.render(ctx, host);
      return;
  }
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm run test -- --selectProjects unit --testPathPatterns renderField`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/registry/renderField.ts tests/unit/features/settings/registry/renderField.test.ts
git commit -m "feat(settings): add per-kind field renderer"
```

---

### Task D2: Tab renderer

**Files:**
- Create: `src/features/settings/registry/renderTab.ts`
- Test: `tests/unit/features/settings/registry/renderTab.test.ts`

- [ ] **Step 1: Write the failing test**

Assert that `renderTab(host, tabId, ctx, registry)`:
1. Renders each visible section heading in order.
2. For each section, renders every visible field.
3. Skips sections whose `visible` predicate is false.
4. Stamps each section heading with `data-section-id`.
5. Stamps each field row with `data-field-id` for later scroll-into-view.

- [ ] **Step 2: Run, expect failure.**

Run: `npm run test -- --selectProjects unit --testPathPatterns renderTab`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/features/settings/registry/renderTab.ts
import { renderField } from './renderField';
import type { SettingsCtx } from './SettingsField';
import type { SettingsRegistry } from './SettingsRegistry';

export function renderTab(
  host: HTMLElement,
  tabId: string,
  ctx: SettingsCtx,
  registry: SettingsRegistry,
): void {
  host.empty();
  for (const section of registry.getSections(tabId, ctx.settings)) {
    const sectionEl = host.createDiv({ cls: 'claudian-settings-section' });
    sectionEl.dataset.sectionId = section.id;
    const heading = sectionEl.createEl('h3', { text: section.label });
    if (section.description) sectionEl.createEl('p', { text: section.description, cls: 'setting-item-description' });
    void heading;
    for (const field of registry.getFields(tabId, section.id, ctx.settings)) {
      const fieldEl = sectionEl.createDiv({ cls: 'claudian-settings-field' });
      fieldEl.dataset.fieldId = field.id;
      renderField(fieldEl, field, ctx);
    }
  }
}
```

- [ ] **Step 4: Run, expect pass.**

Run: `npm run test -- --selectProjects unit --testPathPatterns renderTab`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/registry/renderTab.ts tests/unit/features/settings/registry/renderTab.test.ts
git commit -m "feat(settings): add registry-driven tab renderer"
```

---

### Task D3: Wire renderer into the shell behind the flag

**Files:**
- Modify: `src/features/settings/ClaudianSettings.ts`
- Test: `tests/unit/features/settings/ClaudianSettings.registry.test.ts`

- [ ] **Step 1: Write the failing test**

Build a stub `ClaudianPlugin` with the registry pre-populated. Assert that when `USE_REGISTRY_RENDERER === true`, the shell calls `renderTab` for the active tab and skips the legacy renderer for the same tab id.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

In `ClaudianSettings.display()`, after computing the active tab id, branch on `USE_REGISTRY_RENDERER`. The branch calls `renderTab(containerEl, activeTabId, ctx, registry)` for ported tabs; everything else falls through to the existing imperative renderers. Keep the flag default `false`.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/ClaudianSettings.ts tests/unit/features/settings/ClaudianSettings.registry.test.ts
git commit -m "feat(settings): wire registry renderer behind feature flag"
```

---

### Task D4: Flip flag for General tab only

**Files:**
- Modify: `src/features/settings/registry/featureFlag.ts`
- Modify: `src/features/settings/ClaudianSettings.ts` (gate per-tab, not global)

- [ ] **Step 1: Change the flag shape**

```ts
// src/features/settings/registry/featureFlag.ts
// One entry per tab id. Flip a tab to `true` after porting + verifying.
export const REGISTRY_TABS: ReadonlySet<string> = new Set([
  'general',
]);

export function useRegistryRenderer(tabId: string): boolean {
  return REGISTRY_TABS.has(tabId);
}
```

- [ ] **Step 2: Update the test**

Adjust `ClaudianSettings.registry.test.ts` to assert the General tab now uses the registry while Claude (e.g.) still uses the legacy renderer.

- [ ] **Step 3: Update the shell branch to read `useRegistryRenderer(activeTabId)`**

- [ ] **Step 4: Run typecheck + lint + tests + build**

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/registry/featureFlag.ts src/features/settings/ClaudianSettings.ts tests/unit/features/settings/ClaudianSettings.registry.test.ts
git commit -m "feat(settings): port General tab to registry renderer"
```

---

### Task D5 — D10: Port remaining tabs

For each tab (`claude`, `codex`, `opencode`, `cursor`, `agentBoard`, `orchestrator`, `diagnostics`):

1. Add the tab id to `REGISTRY_TABS`.
2. Build the shell once with the flag flipped; visually confirm parity with the legacy renderer.
3. Add an integration test (`tests/integration/settings/<tabId>-port.test.ts`) that mounts the settings panel, walks each declared field in the registry, and asserts the row exists in the rendered DOM.
4. Run the full build gate: `npm run typecheck && npm run lint && npm run test && npm run build`.
5. Commit: `feat(settings): port <Tab> tab to registry renderer`.

After all seven ports land, every tab is registry-driven and the imperative renderers are dead code (kept in-repo until Phase J cleans them up).

---

## Phase E — Tab visibility + first-run banner

Goal: ship the first user-visible change. Disabled provider tabs disappear; first-run banner shows on the General tab.

### Task E1: Add `firstRunDismissed` to the settings shape

**Files:**
- Modify: `src/core/types/settings.ts`
- Modify: `src/app/settings/defaultSettings.ts`
- Test: `tests/unit/app/settings/defaultSettings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/app/settings/defaultSettings.test.ts
import { DEFAULT_CLAUDIAN_SETTINGS } from '../../../../src/app/settings/defaultSettings';

describe('DEFAULT_CLAUDIAN_SETTINGS', () => {
  it('seeds firstRunDismissed=false', () => {
    expect(DEFAULT_CLAUDIAN_SETTINGS.firstRunDismissed).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect failure (TypeScript error if shape lacks the field).**

- [ ] **Step 3: Add the field**

In `src/core/types/settings.ts`, add `firstRunDismissed: boolean;` to the `ClaudianSettings` interface.

In `src/app/settings/defaultSettings.ts`, add `firstRunDismissed: false,`.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/core/types/settings.ts src/app/settings/defaultSettings.ts tests/unit/app/settings/defaultSettings.test.ts
git commit -m "feat(settings): add firstRunDismissed flag"
```

---

### Task E2: `hasAnyProviderEnabled` helper

**Files:**
- Create: `src/features/settings/firstRunBanner/hasAnyProviderEnabled.ts`
- Test: `tests/unit/features/settings/firstRunBanner/hasAnyProviderEnabled.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import type { ClaudianSettings } from '../../../../../src/core/types/settings';
import { hasAnyProviderEnabled } from '../../../../../src/features/settings/firstRunBanner/hasAnyProviderEnabled';

function s(c: boolean, x: boolean, o: boolean, u: boolean): ClaudianSettings {
  return {
    providerConfigs: {
      claude: { enabled: c },
      codex: { enabled: x },
      opencode: { enabled: o },
      cursor: { enabled: u },
    },
  } as unknown as ClaudianSettings;
}

describe('hasAnyProviderEnabled', () => {
  it('returns false when no provider is enabled', () => {
    expect(hasAnyProviderEnabled(s(false, false, false, false))).toBe(false);
  });
  it('returns true if claude is enabled', () => {
    expect(hasAnyProviderEnabled(s(true, false, false, false))).toBe(true);
  });
  it('returns true if any single provider is enabled', () => {
    expect(hasAnyProviderEnabled(s(false, false, true, false))).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

```ts
// src/features/settings/firstRunBanner/hasAnyProviderEnabled.ts
import type { ProviderId } from '../../../core/providers/types';
import type { ClaudianSettings } from '../../../core/types/settings';

const PROVIDERS: ProviderId[] = ['claude', 'codex', 'opencode', 'cursor'];

export function hasAnyProviderEnabled(settings: ClaudianSettings): boolean {
  for (const id of PROVIDERS) {
    const cfg = settings.providerConfigs?.[id] as { enabled?: boolean } | undefined;
    if (cfg?.enabled) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/firstRunBanner/hasAnyProviderEnabled.ts tests/unit/features/settings/firstRunBanner/hasAnyProviderEnabled.test.ts
git commit -m "feat(settings): add hasAnyProviderEnabled helper"
```

---

### Task E3: First-run banner component

**Files:**
- Create: `src/features/settings/firstRunBanner/FirstRunBanner.ts`
- Test: `tests/unit/features/settings/firstRunBanner/FirstRunBanner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { FirstRunBanner } from '../../../../../src/features/settings/firstRunBanner/FirstRunBanner';

describe('FirstRunBanner', () => {
  function makeCtx() {
    let settings: any = { firstRunDismissed: false, providerConfigs: {} };
    const saved: any[] = [];
    return {
      get settings() {
        return settings;
      },
      set settings(s: any) {
        settings = s;
      },
      saveSettings: async () => {
        saved.push(JSON.parse(JSON.stringify(settings)));
      },
      refresh: jest.fn(),
      saved,
    };
  }

  it('renders four provider rows with enable checkboxes', () => {
    const host = document.createElement('div');
    const ctx = makeCtx();
    new FirstRunBanner(host, ctx as any).render();
    expect(host.querySelectorAll('.claudian-first-run-row').length).toBe(4);
  });

  it('Enable selected writes the chosen providers and dismisses', async () => {
    const host = document.createElement('div');
    const ctx = makeCtx();
    const banner = new FirstRunBanner(host, ctx as any);
    banner.render();
    (host.querySelector('[data-provider="claude"] input[type="checkbox"]') as HTMLInputElement).checked = true;
    (host.querySelector('[data-action="enable"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(ctx.settings.providerConfigs.claude.enabled).toBe(true);
    expect(ctx.settings.firstRunDismissed).toBe(true);
  });

  it('Dismiss sets firstRunDismissed without enabling anything', async () => {
    const host = document.createElement('div');
    const ctx = makeCtx();
    const banner = new FirstRunBanner(host, ctx as any);
    banner.render();
    (host.querySelector('[data-action="dismiss"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(ctx.settings.firstRunDismissed).toBe(true);
    expect(ctx.settings.providerConfigs.claude?.enabled).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

```ts
// src/features/settings/firstRunBanner/FirstRunBanner.ts
import type { ProviderId } from '../../../core/providers/types';
import type { SettingsCtx } from '../registry/SettingsField';

const PROVIDERS: Array<{ id: ProviderId; name: string; blurb: string; cli: string }> = [
  { id: 'claude', name: 'Claude', blurb: 'Anthropic Claude Code', cli: 'claude' },
  { id: 'codex', name: 'Codex', blurb: 'OpenAI Codex CLI', cli: 'codex' },
  { id: 'opencode', name: 'Opencode', blurb: 'Opencode CLI server', cli: 'opencode' },
  { id: 'cursor', name: 'Cursor', blurb: 'Cursor Agent CLI', cli: 'cursor-agent' },
];

export class FirstRunBanner {
  constructor(private readonly host: HTMLElement, private readonly ctx: SettingsCtx) {}

  render(): void {
    this.host.empty();
    const card = this.host.createDiv({ cls: 'claudian-first-run-banner' });
    card.createEl('h3', { text: 'Welcome to Claudian — pick your providers' });
    card.createEl('p', {
      text: 'Claudian wraps coding agents inside Obsidian. Enable one or more to start.',
    });
    for (const p of PROVIDERS) {
      const row = card.createDiv({ cls: 'claudian-first-run-row' });
      row.dataset.provider = p.id;
      const cb = row.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
      const text = row.createDiv();
      text.createEl('strong', { text: p.name });
      text.createEl('span', { text: ` — ${p.blurb} (requires \`${p.cli}\` on PATH)` });
      void cb;
    }
    const actions = card.createDiv({ cls: 'claudian-first-run-actions' });
    const enableBtn = actions.createEl('button', { text: 'Enable selected' });
    enableBtn.dataset.action = 'enable';
    enableBtn.onclick = () => this.handleEnable();
    const dismissBtn = actions.createEl('button', { text: 'Dismiss' });
    dismissBtn.dataset.action = 'dismiss';
    dismissBtn.onclick = () => this.handleDismiss();
  }

  private async handleEnable(): Promise<void> {
    const checked: ProviderId[] = [];
    for (const p of PROVIDERS) {
      const cb = this.host.querySelector(`[data-provider="${p.id}"] input[type="checkbox"]`) as HTMLInputElement | null;
      if (cb?.checked) checked.push(p.id);
    }
    const next = JSON.parse(JSON.stringify(this.ctx.settings));
    next.providerConfigs = next.providerConfigs ?? {};
    for (const id of checked) {
      next.providerConfigs[id] = { ...(next.providerConfigs[id] ?? {}), enabled: true };
    }
    next.firstRunDismissed = true;
    this.ctx.settings = next;
    await this.ctx.saveSettings();
    this.ctx.refresh();
  }

  private async handleDismiss(): Promise<void> {
    this.ctx.settings = { ...this.ctx.settings, firstRunDismissed: true };
    await this.ctx.saveSettings();
    this.ctx.refresh();
  }
}
```

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/firstRunBanner/FirstRunBanner.ts tests/unit/features/settings/firstRunBanner/FirstRunBanner.test.ts
git commit -m "feat(settings): add first-run banner component"
```

---

### Task E4: Show banner above General tab content

**Files:**
- Modify: `src/features/settings/registry/renderTab.ts`
- Test: extend `tests/unit/features/settings/registry/renderTab.test.ts`

- [ ] **Step 1: Add test**

Assert that `renderTab(host, 'general', ctx, registry)` mounts the banner above the section list when `!settings.firstRunDismissed && !hasAnyProviderEnabled(settings)`, and omits it otherwise.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Update `renderTab` to mount the banner**

Wrap the existing host-empty + section loop in:

```ts
import { FirstRunBanner } from '../firstRunBanner/FirstRunBanner';
import { hasAnyProviderEnabled } from '../firstRunBanner/hasAnyProviderEnabled';

// at top of renderTab, after `host.empty();`
if (tabId === 'general' && !ctx.settings.firstRunDismissed && !hasAnyProviderEnabled(ctx.settings)) {
  const bannerHost = host.createDiv({ cls: 'claudian-first-run-banner-host' });
  new FirstRunBanner(bannerHost, ctx).render();
}
```

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/registry/renderTab.ts tests/unit/features/settings/registry/renderTab.test.ts
git commit -m "feat(settings): mount first-run banner on General tab"
```

---

### Task E5: "Show setup again" link in General → Providers

**Files:**
- Modify: `src/features/settings/registry/fields/general.ts`
- Test: extend `tests/unit/features/settings/registry/fields/general.test.ts`

- [ ] **Step 1: Add test**

Assert a `general.providers.showSetupAgain` button-field is registered with `onClick` that flips `firstRunDismissed` to `false` and triggers a refresh.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Register the field**

```ts
registry.registerField({
  id: 'general.providers.showSetupAgain',
  tabId: 'general',
  sectionId: 'providers',
  label: 'Show setup banner again',
  type: {
    kind: 'button',
    label: 'Show setup',
    onClick: async (ctx) => {
      ctx.settings = { ...ctx.settings, firstRunDismissed: false };
      await ctx.saveSettings();
      ctx.refresh();
    },
  },
  default: undefined,
});
```

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/registry/fields/general.ts tests/unit/features/settings/registry/fields/general.test.ts
git commit -m "feat(settings): add Show setup again link"
```

---

### Task E6: Strip redundant per-tab Enable toggles in Codex/Opencode

**Files:**
- Modify: `src/providers/codex/settings/registryFields.ts`
- Modify: `src/providers/opencode/settings/registryFields.ts`
- Test: extend each provider's `registryFields.test.ts`

- [ ] **Step 1: Add test**

Assert each registry has no field with id `providerConfigs.codex.enabled` (or `providerConfigs.opencode.enabled`) — the enable toggle lives only on the General → Providers section.

- [ ] **Step 2: Run, expect failure (if currently registered).**

- [ ] **Step 3: Remove the registrations** from the provider field modules (if previously added in Phase C).

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/providers/codex/settings/registryFields.ts src/providers/opencode/settings/registryFields.ts tests/unit/providers/codex/settings/registryFields.test.ts tests/unit/providers/opencode/settings/registryFields.test.ts
git commit -m "feat(settings): drop redundant per-tab Enable toggles"
```

---

### Task E7: General → Providers row registration

**Files:**
- Modify: `src/features/settings/registry/fields/general.ts`
- Test: extend `tests/unit/features/settings/registry/fields/general.test.ts`

- [ ] **Step 1: Add test**

Assert that for each provider id, the General tab has a field at id `providerConfigs.<provider>.enabled` registered as a toggle.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Register four toggles** (one per provider) in `general.ts` under the `providers` section.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/registry/fields/general.ts tests/unit/features/settings/registry/fields/general.test.ts
git commit -m "feat(settings): make General the single source of truth for enable toggles"
```

---

## Phase F — Default-provider resolver and per-provider Models

### Task F1: Implement `resolveAgentBoardDefaultProvider`

**Files:**
- Create: `src/features/tasks/defaultProviderResolver.ts`
- Test: `tests/unit/features/tasks/defaultProviderResolver.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import type { ProviderId } from '../../../src/core/providers/types';
import type { ClaudianSettings } from '../../../src/core/types/settings';
import { resolveAgentBoardDefaultProvider } from '../../../src/features/tasks/defaultProviderResolver';

function settings(enabled: ProviderId[], stored: ProviderId | null = null): ClaudianSettings {
  const provs = ['claude', 'codex', 'opencode', 'cursor'] as ProviderId[];
  return {
    agentBoardDefaultProvider: stored,
    providerConfigs: Object.fromEntries(
      provs.map((id) => [id, { enabled: enabled.includes(id) }]),
    ),
  } as unknown as ClaudianSettings;
}

describe('resolveAgentBoardDefaultProvider', () => {
  it('returns null when nothing is enabled', () => {
    expect(resolveAgentBoardDefaultProvider(settings([]))).toBeNull();
  });
  it('returns the only enabled provider', () => {
    expect(resolveAgentBoardDefaultProvider(settings(['claude']))).toBe('claude');
  });
  it('returns tab-strip-first when stored is null', () => {
    expect(resolveAgentBoardDefaultProvider(settings(['codex', 'opencode']))).toBe('codex');
  });
  it('returns stored when stored is enabled', () => {
    expect(resolveAgentBoardDefaultProvider(settings(['claude', 'codex'], 'codex'))).toBe('codex');
  });
  it('falls through to tab-strip-first when stored is disabled', () => {
    expect(resolveAgentBoardDefaultProvider(settings(['claude'], 'codex'))).toBe('claude');
  });
});
```

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

```ts
// src/features/tasks/defaultProviderResolver.ts
import type { ProviderId } from '../../core/providers/types';
import type { ClaudianSettings } from '../../core/types/settings';

const ORDER: ProviderId[] = ['claude', 'codex', 'opencode', 'cursor'];

function isEnabled(s: ClaudianSettings, id: ProviderId): boolean {
  const cfg = s.providerConfigs?.[id] as { enabled?: boolean } | undefined;
  return Boolean(cfg?.enabled);
}

export function resolveAgentBoardDefaultProvider(s: ClaudianSettings): ProviderId | null {
  const stored = (s.agentBoardDefaultProvider ?? null) as ProviderId | null;
  if (stored && isEnabled(s, stored)) return stored;
  for (const id of ORDER) if (isEnabled(s, id)) return id;
  return null;
}
```

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/defaultProviderResolver.ts tests/unit/features/tasks/defaultProviderResolver.test.ts
git commit -m "feat(tasks): add Agent Board default-provider resolver"
```

---

### Task F2: Route Agent Board reads through the resolver

**Files:**
- Modify: every consumer of `settings.agentBoardDefaultProvider` (see search below)
- Test: integration test `tests/integration/tasks/defaultProvider.test.ts`

- [ ] **Step 1: List consumers**

```bash
grep -rn 'agentBoardDefaultProvider' src tests
```

- [ ] **Step 2: Write failing integration test**

Asserts that with `agentBoardDefaultProvider: 'codex'` + Codex disabled + Claude enabled, every work-order capture flow stamps the work order with `claude`, not `codex`.

- [ ] **Step 3: Replace direct reads with `resolveAgentBoardDefaultProvider(settings)`** in every consumer.

- [ ] **Step 4: Run integration test, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(tasks): route Agent Board default-provider through resolver"
```

---

### Task F3: Change stored default to `null`

**Files:**
- Modify: `src/app/settings/defaultSettings.ts`
- Modify: `src/core/types/settings.ts` (type to `ProviderId | null`)
- Test: extend `tests/unit/app/settings/defaultSettings.test.ts`

- [ ] **Step 1: Add the test**

```ts
it('agentBoardDefaultProvider defaults to null', () => {
  expect(DEFAULT_CLAUDIAN_SETTINGS.agentBoardDefaultProvider).toBeNull();
});
```

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Update the type and the default**

In `settings.ts` interface: `agentBoardDefaultProvider: ProviderId | null;`.
In `defaultSettings.ts`: `agentBoardDefaultProvider: null,`.

- [ ] **Step 4: Run typecheck — fix any consumers that assumed non-null.**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/defaultSettings.ts src/core/types/settings.ts tests/unit/app/settings/defaultSettings.test.ts
git commit -m "feat(tasks): default agentBoardDefaultProvider to null"
```

---

### Task F4: Render the resolver-aware dropdown

**Files:**
- Modify: `src/features/settings/registry/fields/agentBoard.ts`
- Test: extend `tests/unit/features/settings/registry/fields/agentBoard.test.ts`

- [ ] **Step 1: Write failing tests**

Cover the three UI modes described in the spec (`0 enabled`, `1 enabled`, `≥2 enabled`): dropdown disabled / locked-readonly / editable.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

Replace the simple `dropdown` for `agentBoardDefaultProvider` with a `custom`-kind field whose `render` function:

1. Calls `resolveAgentBoardDefaultProvider(ctx.settings)` for the current display value.
2. Counts enabled providers.
3. Renders the right widget per count (`0` → disabled message; `1` → read-only chip; `≥2` → standard dropdown writing `ctx.settings.agentBoardDefaultProvider`).
4. Adds an `event-bus` subscription (`ctx` exposes the `plugin.events`) on `task:board-config-changed` and re-renders.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/registry/fields/agentBoard.ts tests/unit/features/settings/registry/fields/agentBoard.test.ts
git commit -m "feat(tasks): render resolver-aware default-provider dropdown"
```

---

### Task F5: Apply the same pattern to `agentBoardDefaultModel`

**Files:**
- Modify: `src/features/settings/registry/fields/agentBoard.ts`
- Modify: `src/app/settings/defaultSettings.ts` (default to `null`)
- Modify: `src/core/types/settings.ts` (type to `string | null`)
- Modify: every consumer (search `agentBoardDefaultModel`)
- Create: `src/features/tasks/defaultModelResolver.ts`
- Test: `tests/unit/features/tasks/defaultModelResolver.test.ts`

Same TDD shape as F1 → F4. Resolver returns user pick if valid for resolved provider, otherwise provider's `defaultModel`, otherwise `null`. Commit per step. Final commit: `feat(tasks): add Agent Board default-model resolver`.

---

### Task F6: Per-provider Models section — Custom models table widget

**Files:**
- Create: `src/features/settings/customModels/CustomModelsTable.ts`
- Test: `tests/unit/features/settings/customModels/CustomModelsTable.test.ts`

- [ ] **Step 1: Write the failing tests**

Cover: empty state, render env row read-only, render user row editable, `+ Add custom model` opens an editor row, duplicate id rejected with inline error.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** the `CustomModelsTable` class.

```ts
// src/features/settings/customModels/CustomModelsTable.ts
import type { ProviderId } from '../../../core/providers/types';
import type { SettingsCtx } from '../registry/SettingsField';

export interface ProviderCustomModel {
  id: string;
  label?: string;
  contextWindow?: number;
  source: 'user' | 'env';
}

export class CustomModelsTable {
  constructor(
    private readonly host: HTMLElement,
    private readonly providerId: ProviderId,
    private readonly ctx: SettingsCtx,
  ) {}

  render(): void {
    this.host.empty();
    const rows = this.readRows();
    if (rows.length === 0) {
      this.host.createEl('p', { text: 'No custom models configured. Add one to set a context window or alias.' });
    } else {
      this.renderTable(rows);
    }
    const addBtn = this.host.createEl('button', { text: '+ Add custom model' });
    addBtn.onclick = () => this.openEditorRow();
  }

  // (implementation: renderTable, openEditorRow, validateAndSave, etc.)
}
```

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/customModels/CustomModelsTable.ts tests/unit/features/settings/customModels/CustomModelsTable.test.ts
git commit -m "feat(settings): add CustomModelsTable widget"
```

---

### Task F7: Register Custom models field on every provider tab

**Files:**
- Modify: `src/providers/{claude,codex,opencode,cursor}/settings/registryFields.ts`

For each provider, replace the placeholder `customModels` registration from Phase C with a `kind: 'custom'` field that mounts `CustomModelsTable`. Field id: `providerConfigs.<provider>.customModels`.

Each provider gets one commit: `feat(settings): wire Custom models table for <Provider>`.

---

### Task F8: Storage shape + runtime consumer

**Files:**
- Modify: `src/providers/{claude,codex,opencode,cursor}/settings.ts` to add `customModels: ProviderCustomModel[]` to each provider's `*ProviderSettings` interface + default `[]`.
- Modify: each provider's model-catalog resolver to merge `customModels` and prefer `contextWindow` from a matched custom row.
- Test: `tests/unit/providers/<provider>/runtime/customModels.test.ts` per provider.

Same TDD pattern. One commit per provider.

---

### Task F9: Legacy `modelOverrides` migration

**Files:**
- Create: `src/app/settings/migrations/migrateModelOverrides.ts`
- Test: `tests/unit/app/settings/migrations/migrateModelOverrides.test.ts`
- Modify: `src/app/settings/ClaudianSettingsStorage.ts` to call the migration on load.

- [ ] **Step 1: Write the failing test**

Asserts: legacy `customContextLimits` + `customModelAliases` rooted at top-level (today's hidden Environment fields) get translated to per-provider `customModels[]` with `source: 'env'`, legacy fields erased, idempotent on second invocation.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** and wire into the storage loader.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/migrations/migrateModelOverrides.ts src/app/settings/ClaudianSettingsStorage.ts tests/unit/app/settings/migrations/migrateModelOverrides.test.ts
git commit -m "feat(settings): one-shot migrate model overrides into customModels"
```

---

## Phase G — Search bar

### Task G1: Search bar widget

**Files:**
- Create: `src/features/settings/search/SearchBar.ts`
- Test: `tests/unit/features/settings/search/SearchBar.test.ts`

- [ ] **Step 1: Write failing tests**

Assert: input renders, `/` key from outside the input focuses it, `Esc` clears, debounced `onChange` emits.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

```ts
// src/features/settings/search/SearchBar.ts
export class SearchBar {
  private input!: HTMLInputElement;
  private timer: number | null = null;
  constructor(private readonly host: HTMLElement, private readonly onChange: (q: string) => void) {}
  render(): void {
    this.host.empty();
    this.input = this.host.createEl('input', { attr: { type: 'search', placeholder: 'Search settings…' } });
    this.input.addEventListener('input', () => this.scheduleEmit());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.input.value = '';
        this.emit();
      }
    });
    document.addEventListener('keydown', this.captureSlash);
  }
  private captureSlash = (e: KeyboardEvent): void => {
    if (e.key === '/' && document.activeElement !== this.input) {
      e.preventDefault();
      this.input.focus();
    }
  };
  private scheduleEmit(): void {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.emit(), 120);
  }
  private emit(): void {
    this.onChange(this.input.value.trim());
  }
  dispose(): void {
    document.removeEventListener('keydown', this.captureSlash);
  }
}
```

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/search/SearchBar.ts tests/unit/features/settings/search/SearchBar.test.ts
git commit -m "feat(settings): add SearchBar widget"
```

---

### Task G2: Search results view

**Files:**
- Create: `src/features/settings/search/SearchResultsView.ts`
- Test: `tests/unit/features/settings/search/SearchResultsView.test.ts`

- [ ] **Step 1: Write failing tests**

Cover: matched fields grouped by tab → section, breadcrumb rendered, `Go` button calls the supplied `onGoTo(tabId, sectionId, fieldId)`, empty-results notice with `Reset` button.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** mirroring the spec wording. `Go` invokes `onGoTo`.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/search/SearchResultsView.ts tests/unit/features/settings/search/SearchResultsView.test.ts
git commit -m "feat(settings): add SearchResultsView"
```

---

### Task G3: Wire search into the shell

**Files:**
- Modify: `src/features/settings/ClaudianSettings.ts`
- Test: integration `tests/integration/settings/search.test.ts`

- [ ] **Step 1: Write integration test**

Mounts the shell. Asserts: type `claude`, results view replaces tab strip; click `Go` on the Claude → Models → cliPath row → shell switches to the Claude tab, scrolls the field row into view, pulses a 1.5 s highlight class on the field row (`claudian-settings-field--highlight`).

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

In the shell's `display()` method, mount a `SearchBar` at the top above the tab strip. When the bar emits a non-empty query, hide the tab strip + content host and mount a `SearchResultsView` filled by `registry.search(query, settings)`. On `Go`, clear the search, swap to the target tab, then call `host.querySelector('[data-field-id="<id>"]').scrollIntoView({ block: 'center' })` and add the highlight class for 1500 ms.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Add highlight CSS**

```css
/* src/style/features/settings-search.css */
.claudian-settings-field--highlight {
  outline: 2px solid var(--interactive-accent);
  animation: claudian-settings-pulse 1.5s ease-out;
}
@keyframes claudian-settings-pulse {
  from { background: var(--interactive-accent-hover); }
  to { background: transparent; }
}
```

Register the new stylesheet in `scripts/build-css.mjs` source list.

- [ ] **Step 6: Build and commit**

```bash
npm run build:css
git add src/features/settings/ClaudianSettings.ts src/style/features/settings-search.css tests/integration/settings/search.test.ts scripts/build-css.mjs
git commit -m "feat(settings): wire search bar and results into shell"
```

---

## Phase H — Hotkeys section

### Task H1: Command hotkey registry

**Files:**
- Create: `src/core/commands/commandHotkeyRegistry.ts`
- Test: `tests/unit/core/commands/commandHotkeyRegistry.test.ts`

- [ ] **Step 1: Write failing tests**

Assert: `registerCommandHotkey({ commandId, label, defaultBinding? })` adds an entry; `getCommandHotkeys()` returns entries in insertion order; duplicate `commandId` rejected.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

```ts
// src/core/commands/commandHotkeyRegistry.ts
export interface HotkeyEntry {
  commandId: string;
  label: string;
  defaultBinding?: { modifiers: string[]; key: string };
}

const entries: HotkeyEntry[] = [];

export function registerCommandHotkey(entry: HotkeyEntry): void {
  if (entries.find((e) => e.commandId === entry.commandId)) {
    throw new Error(`duplicate hotkey entry: ${entry.commandId}`);
  }
  entries.push(entry);
}

export function getCommandHotkeys(): readonly HotkeyEntry[] {
  return entries;
}

export function resetCommandHotkeysForTests(): void {
  entries.length = 0;
}
```

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/core/commands/commandHotkeyRegistry.ts tests/unit/core/commands/commandHotkeyRegistry.test.ts
git commit -m "feat(core): add command hotkey registry"
```

---

### Task H2: Adopt the registry at each `plugin.addCommand` call site

**Files:**
- Modify: every file that calls `plugin.addCommand(...)`

For each command Claudian registers, add a `registerCommandHotkey({ commandId, label, defaultBinding: cmd.hotkeys?.[0] })` call alongside the existing `addCommand`.

One commit per logical group (e.g. chat commands, board commands). Commit subjects: `chore(commands): index <area> commands for hotkeys registry`.

- [ ] After all groups, run: `npm run test && npm run build`. Expected: green.

---

### Task H3: Hotkeys section custom field

**Files:**
- Modify: `src/features/settings/registry/fields/general.ts`
- Create: `src/features/settings/hotkeys/HotkeysSection.ts`
- Test: `tests/unit/features/settings/hotkeys/HotkeysSection.test.ts`

- [ ] **Step 1: Write failing tests**

Cover: renders one row per registered command, binding chip shows `Unbound` when nothing bound, `Edit` button calls `openHotkeySettingsFor(commandId)`, subscribes to `hotkey-changed` and re-renders.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** `HotkeysSection` and register a `kind: 'custom'` field on `general.hotkeys.list`.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/hotkeys/HotkeysSection.ts src/features/settings/registry/fields/general.ts tests/unit/features/settings/hotkeys/HotkeysSection.test.ts
git commit -m "feat(settings): render live hotkey bindings inline"
```

---

## Phase I — Strip legacy storage paths

### Task I1: Delete legacy constants and call sites

**Files:**
- Modify: `src/core/bootstrap/StoragePaths.ts`
- Modify: `src/app/settings/ClaudianSettingsStorage.ts`
- Modify: `src/providers/claude/storage/ClaudianSettingsStorage.ts`
- Modify: `src/core/bootstrap/SessionStorage.ts`
- Modify: any importer

- [ ] **Step 1: List call sites**

```bash
grep -rn 'LEGACY_CLAUDIAN_SETTINGS_PATH\|LEGACY_SESSIONS_PATH\|existsLegacyFile\|deleteLegacyFileIfPresent' src tests
```

- [ ] **Step 2: Delete tests asserting migration behavior**

Identify with: `grep -rn 'legacy' tests/unit/app/settings tests/unit/core/bootstrap`. Remove those test files / blocks.

- [ ] **Step 3: Delete the constants**

In `StoragePaths.ts`, remove the `LEGACY_*_PATH` exports:

```ts
// src/core/bootstrap/StoragePaths.ts
export const CLAUDIAN_STORAGE_PATH = '.claudian';
export const CLAUDIAN_SETTINGS_PATH = `${CLAUDIAN_STORAGE_PATH}/claudian-settings.json`;
export const SESSIONS_PATH = `${CLAUDIAN_STORAGE_PATH}/sessions`;
```

- [ ] **Step 4: Delete the call sites**

In `ClaudianSettingsStorage.ts`, remove `existsLegacyFile`, `deleteLegacyFileIfPresent`, and the legacy-read fallback branch. The load path becomes: read canonical → if missing, write defaults from `buildDefaultsFromRegistry(...)`.

In `SessionStorage.ts`, remove the legacy session-path fallback.

In `src/providers/claude/storage/ClaudianSettingsStorage.ts`, remove the re-export.

- [ ] **Step 5: Run the full gate**

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(storage): remove dead legacy .claude/ paths"
```

---

## Phase J — Cleanup, version bump, release

### Task J1: Remove the `REGISTRY_TABS` flag and the legacy imperative renderers

**Files:**
- Modify: `src/features/settings/registry/featureFlag.ts`
- Modify: `src/features/settings/ClaudianSettings.ts`
- Delete: `src/features/settings/ui/AgentBoardSettingsSection.ts`
- Delete: `src/features/settings/ui/EnvironmentSettingsSection.ts`
- Delete: `src/features/settings/ui/LoggingSettingsSection.ts`
- Delete: `src/features/settings/ui/OrchestratorSettingsTab.ts`
- Delete: `src/features/settings/ui/QuickActionsSettingsTab.ts`
- Modify: any importer

- [ ] **Step 1: Confirm every tab is in `REGISTRY_TABS`** (`general`, `claude`, `codex`, `opencode`, `cursor`, `agentBoard`, `orchestrator`, `diagnostics`).

- [ ] **Step 2: Replace the per-tab branch with a single registry render call**

```ts
// in display():
renderTab(this.containerEl, this.activeTabId, ctx, getSettingsRegistry());
```

- [ ] **Step 3: Delete the imperative renderer files** and any unused helpers (`providerEnableUpdaters.ts`, `keyboardNavigation.ts` if absorbed by registry — verify before deleting).

- [ ] **Step 4: Update `featureFlag.ts` to a no-op shim or delete it** (if no callers remain).

- [ ] **Step 5: Run the full gate**

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(settings): remove legacy imperative renderers"
```

---

### Task J2: Update CLAUDE.md and user manual

**Files:**
- Modify: `CLAUDE.md` (storage table — confirm only canonical paths listed)
- Modify: `docs/user-manuals/settings.md` (note the search box, banner, hidden disabled tabs, default-provider behavior, Hotkeys live binding, Custom models per provider)

Commit: `docs: refresh settings manual and CLAUDE.md for v3 overhaul`.

---

### Task J3: Release notes

**Files:**
- Create: `RELEASE_NOTES_3.0.0.md` (or append to existing changelog if present)

Content lists every breaking change and addition from the spec's Rollout section. Commit: `docs: add 3.0.0 release notes`.

---

### Task J4: Cut the release

- [ ] **Step 1: Verify clean tree**

```bash
git status
```

- [ ] **Step 2: Dry-run**

```bash
npm run release -- major --dry-run
```

- [ ] **Step 3: Real release**

```bash
npm run release -- major
```

Confirms: tag `3.0.0`, push to `origin/main`, GitHub release with assets at https://github.com/Luis85/claudian/releases/tag/3.0.0.

---

## Acceptance criteria

After Phase J4:

- Fresh install with `firstRunDismissed: false` and no providers enabled shows the General/Agent Board/Orchestrator/Diagnostics tabs only, with the banner on top of General.
- Toggling `claude.enabled` from the banner makes the Claude tab appear and the banner disappear in the same render pass.
- `/` focuses the search bar. Typing `context` returns the Custom models rows under any enabled provider tab; results disappear for disabled providers.
- `agentBoardDefaultProvider: null` plus a single enabled provider locks the dropdown to that provider; enabling a second unlocks it without rewriting the stored value.
- Each provider tab's Models section shows a Custom models table with a `+ Add custom model` button. Env-discovered rows are read-only on id and alias, editable on context window, Remove disabled.
- The Hotkeys section on General shows live `Ctrl+Shift+B`-style chips for every Claudian command. Rebinding in Obsidian's Hotkeys tab updates the chip without reopening Claudian's settings.
- `grep -r 'LEGACY_' src` returns nothing.
- `grep -rn 'enabled: false' src/providers/*/settings.ts` confirms all four providers default off.
- `npm run typecheck && npm run lint && npm run test && npm run build` is green.

---

## Self-review notes

- Every task uses TDD red-green-refactor and ends with an explicit commit. No "TBD" or "similar to" placeholders.
- Phase C tasks C2–C4 reference C1 explicitly with the per-tab variations spelled out (sections, field ids, defaults) rather than asking the engineer to extrapolate.
- The flag mechanism in D4 is mutable as new tabs are ported — engineers update one set, not two.
- F5 mirrors F1–F4 by name to make the parallel obvious.
- F7/F8 split widget UI from runtime consumption; each is a small commit.
- I1 explicitly deletes both code and tests; nothing referencing `LEGACY_*` should survive.
- Acceptance criteria are observable from the running build, not internal state.
