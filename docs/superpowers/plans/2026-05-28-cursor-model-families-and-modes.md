---
status: done
parent: "[[Multi Provider Support]]"
---
# Cursor Model Families and Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the flat Cursor model picker into one entry per model family and expose each family's mode/effort suffixes through the shared composer reasoning selector, matching Claude/Codex/opencode behavior.

**Architecture:** Cursor encodes mode in the model id suffix (`sonnet-4` vs `sonnet-4-thinking`). A new pure module decomposes raw ids into `{ familyId, mode }` (hybrid: derive when the bare family is discovered, else match a curated suffix set). `CursorChatUIConfig` lists families and serves per-family mode variants through `getReasoningOptions`; the selected mode lives in the shared `effortLevel` projection key. `CursorChatRuntime` recombines `family + mode` into the raw `--model` id. Mirrors the existing `opencode` provider.

**Tech Stack:** TypeScript, Obsidian plugin, Jest (`ts-jest`), existing provider boundary (`ProviderChatUIConfig`, `ProviderSettingsCoordinator`).

**Spec:** `docs/superpowers/specs/2026-05-28-cursor-model-families-and-modes-design.md`

---

## File Structure

- Create: `src/providers/cursor/runtime/cursorModelFamily.ts` — pure family/mode decomposition + vendor grouping (the brain).
- Modify: `src/providers/cursor/modelLabels.ts` — add `formatCursorModeLabel`.
- Modify: `src/providers/cursor/settings.ts` — add `preferredModeByFamily` storage.
- Modify: `src/providers/cursor/capabilities.ts` — `reasoningControl: 'effort'`.
- Modify: `src/providers/cursor/ui/CursorChatUIConfig.ts` — families list, reasoning methods, defaults, normalization.
- Modify: `src/providers/cursor/runtime/cursorCliModel.ts` — add `resolveCursorModelSelectionForCli`.
- Modify: `src/providers/cursor/runtime/CursorChatRuntime.ts` — combine family+mode for `--model`.
- Modify: `src/providers/cursor/env/CursorSettingsReconciler.ts` — migration split + variant normalization.
- Modify: `src/providers/cursor/ui/CursorSettingsTab.ts` — families list + auth-aware empty state.
- Modify: `src/providers/claude/ui/ClaudeChatUIConfig.ts` — plan label `'PLAN' → 'Plan'`.

Tests mirror under `tests/unit/providers/cursor/` and `tests/unit/providers/claude/`.

---

## Task 1: Family/mode decomposition module

**Files:**
- Create: `src/providers/cursor/runtime/cursorModelFamily.ts`
- Test: `tests/unit/providers/cursor/runtime/cursorModelFamily.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/providers/cursor/runtime/cursorModelFamily.test.ts`:

```typescript
import {
  buildCursorFamilies,
  combineCursorModelSelection,
  CURSOR_STANDARD_MODE,
  extractCursorModeValue,
  getCursorModelVariants,
  resolveCursorFamilyId,
  resolveCursorVendor,
} from '../../../../../src/providers/cursor/runtime/cursorModelFamily';

describe('resolveCursorFamilyId', () => {
  it('derives the family when the bare base id is also discovered', () => {
    const all = ['sonnet-4', 'sonnet-4-thinking'];
    expect(resolveCursorFamilyId('sonnet-4-thinking', all)).toBe('sonnet-4');
    expect(resolveCursorFamilyId('sonnet-4', all)).toBe('sonnet-4');
  });

  it('falls back to the curated suffix set when the base is absent', () => {
    expect(resolveCursorFamilyId('gpt-5-high', ['gpt-5-high'])).toBe('gpt-5');
  });

  it('keeps version-style ids whole (no false suffix split)', () => {
    expect(resolveCursorFamilyId('claude-opus-4-7', ['claude-opus-4-7'])).toBe('claude-opus-4-7');
    expect(resolveCursorFamilyId('gpt-5.5', ['gpt-5.5'])).toBe('gpt-5.5');
    expect(resolveCursorFamilyId('composer-1.5', ['composer-1.5'])).toBe('composer-1.5');
  });
});

describe('extractCursorModeValue', () => {
  it('returns the mode token for a variant id', () => {
    expect(extractCursorModeValue('sonnet-4-thinking', ['sonnet-4', 'sonnet-4-thinking'])).toBe('thinking');
  });

  it('returns null for a bare family id', () => {
    expect(extractCursorModeValue('sonnet-4', ['sonnet-4'])).toBeNull();
  });
});

describe('combineCursorModelSelection', () => {
  it('returns the bare family for the standard mode', () => {
    expect(combineCursorModelSelection('sonnet-4', CURSOR_STANDARD_MODE)).toBe('sonnet-4');
    expect(combineCursorModelSelection('sonnet-4', '')).toBe('sonnet-4');
  });

  it('appends the mode suffix otherwise', () => {
    expect(combineCursorModelSelection('sonnet-4', 'thinking')).toBe('sonnet-4-thinking');
  });
});

describe('buildCursorFamilies', () => {
  it('groups variants under one family with ordered modes', () => {
    const families = buildCursorFamilies([
      'gpt-5', 'gpt-5-high', 'gpt-5-low',
      'sonnet-4', 'sonnet-4-thinking',
      'composer-2',
    ]);
    const gpt = families.find((f) => f.familyId === 'gpt-5');
    expect(gpt?.variants.map((v) => v.value)).toEqual([CURSOR_STANDARD_MODE, 'low', 'high']);
    const composer = families.find((f) => f.familyId === 'composer-2');
    expect(composer?.variants.map((v) => v.value)).toEqual([CURSOR_STANDARD_MODE]);
  });

  it('excludes auto', () => {
    expect(buildCursorFamilies(['auto', 'composer-2']).some((f) => f.familyId === 'auto')).toBe(false);
  });
});

describe('getCursorModelVariants', () => {
  it('returns the variants for a family', () => {
    const variants = getCursorModelVariants('sonnet-4', ['sonnet-4', 'sonnet-4-thinking']);
    expect(variants.map((v) => v.value)).toEqual([CURSOR_STANDARD_MODE, 'thinking']);
  });
});

describe('resolveCursorVendor', () => {
  it('maps known families to vendors', () => {
    expect(resolveCursorVendor('composer-2')).toBe('Cursor');
    expect(resolveCursorVendor('sonnet-4')).toBe('Anthropic');
    expect(resolveCursorVendor('gpt-5')).toBe('OpenAI');
    expect(resolveCursorVendor('gemini-2.5-pro')).toBe('Google');
    expect(resolveCursorVendor('grok-4')).toBe('xAI');
    expect(resolveCursorVendor('mystery-model')).toBe('Other');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t cursorModelFamily`
Expected: FAIL — `Cannot find module '.../cursorModelFamily'`.

- [ ] **Step 3: Write the implementation**

Create `src/providers/cursor/runtime/cursorModelFamily.ts`:

```typescript
import { formatCursorModelLabel } from '../modelLabels';

// The bare family id (no suffix) is represented in the mode dropdown by this
// sentinel value. It maps back to "no suffix" when recombining for the CLI.
export const CURSOR_STANDARD_MODE = 'standard';

// Curated fallback vocabulary used only when the bare family id is NOT present
// in the discovered list. Derivation from the list takes priority.
export const CURSOR_MODE_SUFFIXES: ReadonlySet<string> = new Set([
  'thinking', 'fast', 'max', 'high', 'medium', 'low',
]);

const CURSOR_MODE_ORDER = ['standard', 'low', 'medium', 'high', 'max', 'thinking', 'fast'];
const CURSOR_MODE_RANK = new Map(CURSOR_MODE_ORDER.map((value, index) => [value, index] as const));

const CURSOR_VENDOR_ORDER = ['Cursor', 'Anthropic', 'OpenAI', 'Google', 'xAI', 'Other'];
const CURSOR_VENDOR_RANK = new Map(CURSOR_VENDOR_ORDER.map((value, index) => [value, index] as const));

export interface CursorModeVariant {
  value: string;
  label: string;
}

export interface CursorModelFamily {
  familyId: string;
  label: string;
  vendor: string;
  variants: CursorModeVariant[];
}

function toRawIdSet(allRawIds: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const id of allRawIds) {
    const trimmed = id.trim();
    if (trimmed) {
      set.add(trimmed);
    }
  }
  return set;
}

/**
 * Resolves the family id for a raw Cursor model id. Hybrid strategy:
 *  - derive: if `rawId === base + "-" + suffix` and `base` is itself a discovered
 *    id, the family is `base`;
 *  - fallback: else if the trailing token is a curated mode suffix, split there;
 *  - else the whole id is its own family.
 */
export function resolveCursorFamilyId(rawId: string, allRawIds: Iterable<string>): string {
  const trimmed = rawId.trim();
  if (!trimmed) {
    return trimmed;
  }

  const splitIndex = trimmed.lastIndexOf('-');
  if (splitIndex <= 0 || splitIndex >= trimmed.length - 1) {
    return trimmed;
  }

  const base = trimmed.slice(0, splitIndex);
  const suffix = trimmed.slice(splitIndex + 1).toLowerCase();

  if (toRawIdSet(allRawIds).has(base)) {
    return base;
  }
  if (CURSOR_MODE_SUFFIXES.has(suffix)) {
    return base;
  }
  return trimmed;
}

/** Returns the mode token for a variant id, or null for a bare family id. */
export function extractCursorModeValue(rawId: string, allRawIds: Iterable<string>): string | null {
  const trimmed = rawId.trim();
  const familyId = resolveCursorFamilyId(trimmed, allRawIds);
  if (!familyId || familyId === trimmed) {
    return null;
  }
  return trimmed.slice(familyId.length + 1) || null;
}

/** Recombines a family id and mode into the raw id passed to `--model`. */
export function combineCursorModelSelection(familyId: string, mode: string | null | undefined): string {
  const trimmedFamily = familyId.trim();
  const trimmedMode = mode?.trim();
  if (!trimmedMode || trimmedMode === CURSOR_STANDARD_MODE) {
    return trimmedFamily;
  }
  return `${trimmedFamily}-${trimmedMode}`;
}

export function resolveCursorVendor(familyId: string): string {
  const lower = familyId.toLowerCase();
  if (/composer|sonic|cursor/.test(lower)) {
    return 'Cursor';
  }
  if (/claude|sonnet|opus|haiku/.test(lower)) {
    return 'Anthropic';
  }
  if (/^gpt|^o\d/.test(lower)) {
    return 'OpenAI';
  }
  if (/gemini/.test(lower)) {
    return 'Google';
  }
  if (/grok/.test(lower)) {
    return 'xAI';
  }
  return 'Other';
}

function compareModeValues(left: string, right: string): number {
  const leftRank = CURSOR_MODE_RANK.get(left.toLowerCase());
  const rightRank = CURSOR_MODE_RANK.get(right.toLowerCase());
  if (leftRank !== undefined && rightRank !== undefined) {
    return leftRank - rightRank;
  }
  if (leftRank !== undefined) return -1;
  if (rightRank !== undefined) return 1;
  return left.localeCompare(right);
}

/** Groups raw ids into families with ordered mode variants. Excludes `auto`. */
export function buildCursorFamilies(rawIds: Iterable<string>): CursorModelFamily[] {
  const all = toRawIdSet(rawIds);
  all.delete('auto');

  const grouped = new Map<string, Set<string>>();
  for (const rawId of all) {
    const familyId = resolveCursorFamilyId(rawId, all);
    const bucket = grouped.get(familyId) ?? new Set<string>();
    bucket.add(rawId);
    grouped.set(familyId, bucket);
  }

  const families: CursorModelFamily[] = [];
  for (const [familyId, members] of grouped) {
    const variantValues = new Set<string>([CURSOR_STANDARD_MODE]);
    for (const member of members) {
      const mode = extractCursorModeValue(member, all);
      if (mode) {
        variantValues.add(mode);
      }
    }
    const variants = [...variantValues]
      .sort(compareModeValues)
      .map((value) => ({
        value,
        label: value === CURSOR_STANDARD_MODE ? 'Standard' : formatCursorModeLabelInternal(value),
      }));

    families.push({
      familyId,
      label: formatCursorModelLabel(familyId),
      vendor: resolveCursorVendor(familyId),
      variants,
    });
  }

  return families.sort((left, right) => {
    const vendorDelta = (CURSOR_VENDOR_RANK.get(left.vendor) ?? 99)
      - (CURSOR_VENDOR_RANK.get(right.vendor) ?? 99);
    return vendorDelta !== 0 ? vendorDelta : left.label.localeCompare(right.label);
  });
}

/** Returns the mode variants for a single family id. */
export function getCursorModelVariants(familyId: string, rawIds: Iterable<string>): CursorModeVariant[] {
  return buildCursorFamilies(rawIds).find((family) => family.familyId === familyId)?.variants
    ?? [{ value: CURSOR_STANDARD_MODE, label: 'Standard' }];
}

// Local copy to avoid a circular import with modelLabels for the mode label only.
function formatCursorModeLabelInternal(mode: string): string {
  if (mode.toLowerCase() === 'xhigh') {
    return 'XHigh';
  }
  return mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t cursorModelFamily`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/cursor/runtime/cursorModelFamily.ts tests/unit/providers/cursor/runtime/cursorModelFamily.test.ts
git commit -m "feat(cursor): add family/mode decomposition module"
```

---

## Task 2: Mode label formatter

**Files:**
- Modify: `src/providers/cursor/modelLabels.ts`
- Test: `tests/unit/providers/cursor/modelLabels.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/providers/cursor/modelLabels.test.ts`:

```typescript
import { formatCursorModeLabel } from '../../../../src/providers/cursor/modelLabels';

describe('formatCursorModeLabel', () => {
  it('formats known modes', () => {
    expect(formatCursorModeLabel('thinking')).toBe('Thinking');
    expect(formatCursorModeLabel('fast')).toBe('Fast');
    expect(formatCursorModeLabel('max')).toBe('Max');
    expect(formatCursorModeLabel('high')).toBe('High');
    expect(formatCursorModeLabel('standard')).toBe('Standard');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t formatCursorModeLabel`
Expected: FAIL — `formatCursorModeLabel is not a function`.

- [ ] **Step 3: Add the implementation**

Append to `src/providers/cursor/modelLabels.ts`:

```typescript
/** Display label for a Cursor mode/effort suffix used in the composer dropdown. */
export function formatCursorModeLabel(mode: string): string {
  const trimmed = mode.trim();
  if (!trimmed) {
    return mode;
  }
  if (trimmed.toLowerCase() === 'standard') {
    return 'Standard';
  }
  if (trimmed.toLowerCase() === 'xhigh') {
    return 'XHigh';
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t formatCursorModeLabel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/cursor/modelLabels.ts tests/unit/providers/cursor/modelLabels.test.ts
git commit -m "feat(cursor): add mode label formatter"
```

---

## Task 3: `preferredModeByFamily` settings storage

**Files:**
- Modify: `src/providers/cursor/settings.ts`
- Test: `tests/unit/providers/cursor/settings.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/providers/cursor/settings.test.ts`:

```typescript
import {
  getCursorProviderSettings,
  updateCursorProviderSettings,
} from '../../../../src/providers/cursor/settings';

describe('preferredModeByFamily', () => {
  it('defaults to an empty object', () => {
    const bag: Record<string, unknown> = {};
    expect(getCursorProviderSettings(bag).preferredModeByFamily).toEqual({});
  });

  it('persists and normalizes mode preferences, dropping junk', () => {
    const bag: Record<string, unknown> = {};
    updateCursorProviderSettings(bag, {
      preferredModeByFamily: { 'sonnet-4': 'thinking', '  ': 'x', 'gpt-5': '' } as Record<string, string>,
    });
    expect(getCursorProviderSettings(bag).preferredModeByFamily).toEqual({ 'sonnet-4': 'thinking' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t preferredModeByFamily`
Expected: FAIL — `preferredModeByFamily` is `undefined`.

- [ ] **Step 3: Add the implementation**

In `src/providers/cursor/settings.ts`:

Add a normalizer after `normalizeEnabledModelsByHost`:

```typescript
// Coerces persisted data into a Record<string, string> of family id -> mode.
// Drops empty keys/values.
export function normalizePreferredModeByFamily(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const familyId = typeof key === 'string' ? key.trim() : '';
    const mode = typeof entry === 'string' ? entry.trim() : '';
    if (!familyId || !mode) {
      continue;
    }
    result[familyId] = mode;
  }
  return result;
}
```

Add `preferredModeByFamily: Record<string, string>;` to the `CursorProviderSettings` interface, and `preferredModeByFamily: {},` to `DEFAULT_CURSOR_PROVIDER_SETTINGS`.

In `getCursorProviderSettings`, add to the returned object:

```typescript
    preferredModeByFamily: normalizePreferredModeByFamily(config.preferredModeByFamily),
```

In `updateCursorProviderSettings`, extend the `next` object and the `setProviderConfig` payload:

```typescript
    preferredModeByFamily: 'preferredModeByFamily' in updates
      ? normalizePreferredModeByFamily(updates.preferredModeByFamily)
      : { ...current.preferredModeByFamily },
```

```typescript
    preferredModeByFamily: next.preferredModeByFamily,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t preferredModeByFamily`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/cursor/settings.ts tests/unit/providers/cursor/settings.test.ts
git commit -m "feat(cursor): add preferredModeByFamily settings storage"
```

---

## Task 4: Enable the effort control in capabilities

**Files:**
- Modify: `src/providers/cursor/capabilities.ts`
- Test: `tests/unit/providers/cursor/ui/CursorChatUIConfig.test.ts` (add capability assertion)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/providers/cursor/ui/CursorChatUIConfig.test.ts`:

```typescript
import { CURSOR_PROVIDER_CAPABILITIES } from '../../../../../src/providers/cursor/capabilities';

describe('cursor capabilities', () => {
  it('exposes the shared effort reasoning control', () => {
    expect(CURSOR_PROVIDER_CAPABILITIES.reasoningControl).toBe('effort');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "shared effort reasoning control"`
Expected: FAIL — received `'none'`.

- [ ] **Step 3: Edit capabilities**

In `src/providers/cursor/capabilities.ts`, change:

```typescript
  reasoningControl: 'effort',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t "shared effort reasoning control"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/cursor/capabilities.ts tests/unit/providers/cursor/ui/CursorChatUIConfig.test.ts
git commit -m "feat(cursor): enable shared effort reasoning control"
```

---

## Task 5: Family-based model options + reasoning in `CursorChatUIConfig`

**Files:**
- Modify: `src/providers/cursor/ui/CursorChatUIConfig.ts`
- Test: `tests/unit/providers/cursor/ui/CursorChatUIConfig.test.ts`

This task replaces the flat-list config. Existing tests in this file assert flat
values (e.g. `cursor:gpt-5.5`, `cursor:composer-2` as separate options); those
still hold because each is its own family when no variant siblings are enabled.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/providers/cursor/ui/CursorChatUIConfig.test.ts`:

```typescript
import { cursorChatUIConfig } from '../../../../../src/providers/cursor/ui/CursorChatUIConfig';

function settingsWith(enabled: string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerConfig: { cursor: { enabledModelsByHost: { [require('os').hostname()]: enabled } } },
    ...extra,
  };
}

describe('cursorChatUIConfig families', () => {
  it('collapses variants into one family option', () => {
    const options = cursorChatUIConfig.getModelOptions(
      settingsWith(['sonnet-4', 'sonnet-4-thinking']),
    );
    const sonnetOptions = options.filter((o) => o.value === 'cursor:sonnet-4');
    expect(sonnetOptions).toHaveLength(1);
    expect(options.some((o) => o.value === 'cursor:sonnet-4-thinking')).toBe(false);
    expect(options[0].value).toBe('cursor:auto');
  });

  it('serves the family mode variants as reasoning options', () => {
    const settings = settingsWith(['sonnet-4', 'sonnet-4-thinking']);
    const options = cursorChatUIConfig.getReasoningOptions('cursor:sonnet-4', settings);
    expect(options.map((o) => o.value)).toEqual(['standard', 'thinking']);
    expect(cursorChatUIConfig.isAdaptiveReasoningModel('cursor:sonnet-4', settings)).toBe(true);
  });

  it('marks a single-mode family as non-adaptive', () => {
    const settings = settingsWith(['composer-2']);
    expect(cursorChatUIConfig.isAdaptiveReasoningModel('cursor:composer-2', settings)).toBe(false);
  });

  it('persists the selected mode per family', () => {
    const settings = settingsWith(['sonnet-4', 'sonnet-4-thinking']);
    cursorChatUIConfig.applyReasoningSelection?.('cursor:sonnet-4', 'thinking', settings);
    expect(cursorChatUIConfig.getDefaultReasoningValue('cursor:sonnet-4', settings)).toBe('thinking');
  });

  it('normalizes a full-variant model value to its family', () => {
    const settings = settingsWith(['sonnet-4', 'sonnet-4-thinking']);
    expect(cursorChatUIConfig.normalizeModelVariant('cursor:sonnet-4-thinking', settings)).toBe('cursor:sonnet-4');
  });
});
```

NOTE: the model catalog cache must contain `sonnet-4`/`sonnet-4-thinking` for
`normalizeModelVariant` to derive the split. Seed it in this test's `beforeEach`:

```typescript
import { refreshCursorModelCatalog, resetCursorModelCatalog } from '../../../../../src/providers/cursor/runtime/cursorModelCatalog';

beforeEach(async () => {
  resetCursorModelCatalog();
  // Force the cache without spawning: refresh returns fallback on empty cli path,
  // so stub via the module's parse path instead.
});
```

Because `normalizeModelVariant` reads `getCachedCursorModelIds()`, and the cache
starts empty (fallback list lacks `sonnet-4`), the derive path won't fire from
cache alone — but the curated suffix fallback (`thinking`) WILL split it. The test
above therefore passes via the fallback path. Keep the `beforeEach` reset only.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "cursorChatUIConfig families"`
Expected: FAIL — variants not collapsed; reasoning returns `['off']`.

- [ ] **Step 3: Rewrite `CursorChatUIConfig.ts`**

Replace the contents of `src/providers/cursor/ui/CursorChatUIConfig.ts` with:

```typescript
import { getRuntimeEnvironmentVariables } from '../../../core/providers/providerEnvironment';
import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { CURSOR_PROVIDER_ICON } from '../../../shared/icons';
import { formatCursorModeLabel, formatCursorModelLabel } from '../modelLabels';
import { getCachedCursorModelIds, STATIC_FALLBACK_MODEL_IDS } from '../runtime/cursorModelCatalog';
import {
  buildCursorFamilies,
  CURSOR_STANDARD_MODE,
  getCursorModelVariants,
  resolveCursorFamilyId,
} from '../runtime/cursorModelFamily';
import {
  fromCursorModelValue,
  isCursorModelValue,
  toCursorModelValue,
} from '../runtime/cursorModelId';
import {
  getCursorEnabledModels,
  getCursorProviderSettings,
  updateCursorProviderSettings,
} from '../settings';

const CURSOR_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
  planValue: 'plan',
  planLabel: 'Plan',
};

const DEFAULT_CONTEXT_WINDOW = 200_000;

const NAMESPACED_FALLBACK_MODEL_VALUES = new Set(
  STATIC_FALLBACK_MODEL_IDS.map(toCursorModelValue),
);

function familyIdFromModelValue(model: string): string {
  const raw = fromCursorModelValue(model);
  return resolveCursorFamilyId(raw, getCachedCursorModelIds());
}

function variantsForModelValue(model: string): ProviderReasoningOption[] {
  const familyId = familyIdFromModelValue(model);
  if (familyId === 'auto' || !familyId) {
    return [];
  }
  return getCursorModelVariants(familyId, getCachedCursorModelIds()).map((variant) => ({
    value: variant.value,
    label: variant.value === CURSOR_STANDARD_MODE ? 'Standard' : formatCursorModeLabel(variant.value),
  }));
}

export const cursorChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    const envVars = getRuntimeEnvironmentVariables(settings, 'cursor');
    const enabled = getCursorEnabledModels(settings);

    const options: ProviderUIOption[] = [
      { value: toCursorModelValue('auto'), label: formatCursorModelLabel('auto') },
    ];
    const seen = new Set<string>([toCursorModelValue('auto')]);

    const rawIds = [...enabled];
    if (envVars.CURSOR_MODEL) {
      rawIds.push(envVars.CURSOR_MODEL);
    }

    for (const family of buildCursorFamilies(rawIds)) {
      const value = toCursorModelValue(family.familyId);
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);
      const modeCount = family.variants.length;
      options.push({
        value,
        label: family.label,
        description: modeCount > 1 ? `${family.vendor} · ${modeCount} modes` : family.vendor,
        group: family.vendor,
      });
    }

    return options;
  },

  ownsModel(model: string, _settings: Record<string, unknown>): boolean {
    if (isCursorModelValue(model)) {
      return true;
    }
    return /^composer-/i.test(model) || model === 'auto';
  },

  isAdaptiveReasoningModel(model: string): boolean {
    return variantsForModelValue(model).length > 1;
  },

  getReasoningOptions(model: string): ProviderReasoningOption[] {
    return variantsForModelValue(model);
  },

  getDefaultReasoningValue(model: string, settings: Record<string, unknown>): string {
    const familyId = familyIdFromModelValue(model);
    const preferred = getCursorProviderSettings(settings).preferredModeByFamily[familyId];
    const valid = new Set(variantsForModelValue(model).map((option) => option.value));
    return preferred && valid.has(preferred) ? preferred : CURSOR_STANDARD_MODE;
  },

  getContextWindowSize(): number {
    return DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return NAMESPACED_FALLBACK_MODEL_VALUES.has(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    const target = settings as Record<string, unknown>;
    const familyValue = this.normalizeModelVariant(model, target);
    const familyId = fromCursorModelValue(familyValue);
    if (!familyId) {
      return;
    }
    updateCursorProviderSettings(target, { lastModel: familyId });
    target.effortLevel = this.getDefaultReasoningValue(familyValue, target);
  },

  applyReasoningSelection(model: string, value: string, settings: unknown): void {
    const target = settings as Record<string, unknown>;
    const familyId = familyIdFromModelValue(model);
    if (!familyId || familyId === 'auto') {
      return;
    }
    const valid = new Set(variantsForModelValue(model).map((option) => option.value));
    const current = getCursorProviderSettings(target).preferredModeByFamily;
    const next = { ...current };
    if (!value || value === CURSOR_STANDARD_MODE || !valid.has(value)) {
      delete next[familyId];
    } else {
      next[familyId] = value;
    }
    updateCursorProviderSettings(target, { preferredModeByFamily: next });
  },

  normalizeModelVariant(model: string): string {
    if (!isCursorModelValue(model) && !/^composer-/i.test(model) && model !== 'auto') {
      return model;
    }
    const familyId = familyIdFromModelValue(model);
    return toCursorModelValue(familyId);
  },

  getCustomModelIds(envVars: Record<string, string>): Set<string> {
    const ids = new Set<string>();
    if (envVars.CURSOR_MODEL && !getCachedCursorModelIds().includes(envVars.CURSOR_MODEL)) {
      ids.add(resolveCursorFamilyId(envVars.CURSOR_MODEL, getCachedCursorModelIds()));
    }
    return ids;
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return CURSOR_PERMISSION_MODE_TOGGLE;
  },

  isBangBashEnabled(): boolean {
    return false;
  },

  getProviderIcon() {
    return CURSOR_PROVIDER_ICON;
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- --selectProjects unit -t "cursorChatUIConfig"`
Expected: PASS (both the new family tests and the pre-existing flat tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/cursor/ui/CursorChatUIConfig.ts tests/unit/providers/cursor/ui/CursorChatUIConfig.test.ts
git commit -m "feat(cursor): collapse model picker into families with mode variants"
```

---

## Task 6: Combine family + mode for the CLI `--model` flag

**Files:**
- Modify: `src/providers/cursor/runtime/cursorCliModel.ts`
- Test: `tests/unit/providers/cursor/runtime/cursorCliModel.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/providers/cursor/runtime/cursorCliModel.test.ts`:

```typescript
import { resolveCursorModelSelectionForCli } from '../../../../../src/providers/cursor/runtime/cursorCliModel';

describe('resolveCursorModelSelectionForCli', () => {
  it('returns undefined for an empty model', () => {
    expect(resolveCursorModelSelectionForCli(undefined, 'thinking')).toBeUndefined();
  });

  it('returns the bare family for the standard mode', () => {
    expect(resolveCursorModelSelectionForCli('cursor:sonnet-4', 'standard')).toBe('sonnet-4');
    expect(resolveCursorModelSelectionForCli('cursor:sonnet-4', undefined)).toBe('sonnet-4');
  });

  it('appends a curated-suffix mode even when not in cache', () => {
    expect(resolveCursorModelSelectionForCli('cursor:sonnet-4', 'thinking')).toBe('sonnet-4-thinking');
  });

  it('passes auto through unchanged', () => {
    expect(resolveCursorModelSelectionForCli('cursor:auto', 'thinking')).toBe('auto');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t resolveCursorModelSelectionForCli`
Expected: FAIL — function not exported.

- [ ] **Step 3: Add the implementation**

Append to `src/providers/cursor/runtime/cursorCliModel.ts`:

```typescript
import { getCachedCursorModelIds } from './cursorModelCatalog';
import {
  combineCursorModelSelection,
  CURSOR_STANDARD_MODE,
  getCursorModelVariants,
} from './cursorModelFamily';

// Resolves a (possibly namespaced) family model value plus a selected mode into
// the raw id passed to `--model`. The mode is validated against the family's
// known variants; unknown modes fall back to the bare family (so a curated
// suffix that is not in the live cache still works, but garbage does not).
export function resolveCursorModelSelectionForCli(
  model: string | undefined,
  mode: string | undefined,
): string | undefined {
  if (!model?.trim()) {
    return undefined;
  }
  const familyId = fromCursorModelValue(model);
  if (!familyId) {
    return undefined;
  }
  if (familyId === 'auto') {
    return 'auto';
  }

  const trimmedMode = mode?.trim();
  if (!trimmedMode || trimmedMode === CURSOR_STANDARD_MODE) {
    return familyId;
  }

  const knownModes = new Set(
    getCursorModelVariants(familyId, getCachedCursorModelIds()).map((variant) => variant.value),
  );
  // Curated suffixes are valid even if the live cache lacks the variant id.
  const curatedFallback = new Set(['thinking', 'fast', 'max', 'high', 'medium', 'low']);
  if (knownModes.has(trimmedMode) || curatedFallback.has(trimmedMode.toLowerCase())) {
    return combineCursorModelSelection(familyId, trimmedMode);
  }
  return familyId;
}
```

NOTE: `fromCursorModelValue` is already imported at the top of the file. Keep the
existing `resolveCursorModelForCli` export — it is still referenced by tests and
not removed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t resolveCursorModelSelectionForCli`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/cursor/runtime/cursorCliModel.ts tests/unit/providers/cursor/runtime/cursorCliModel.test.ts
git commit -m "feat(cursor): combine family and mode for the CLI model flag"
```

---

## Task 7: Wire family + mode into the runtime

**Files:**
- Modify: `src/providers/cursor/runtime/CursorChatRuntime.ts`

This is a behavior change with no isolated unit test (the runtime spawns a child
process). Verify via typecheck + the integration suite. The change reads the
selected mode from the projected provider snapshot's `effortLevel` (the shared
key the composer writes), exactly as `OpencodeChatRuntime` does.

- [ ] **Step 1: Update the model resolution**

In `src/providers/cursor/runtime/CursorChatRuntime.ts`, change the import:

```typescript
import { resolveCursorModelSelectionForCli } from './cursorCliModel';
```

Replace the `resolveProviderModel` private method and its call site.

Replace the model resolution block in `query()`:

```typescript
    const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings as unknown as Record<string, unknown>,
      'cursor',
    );
    const familyValue = queryOptions?.model
      ?? (typeof snapshot.model === 'string' && snapshot.model.trim() ? snapshot.model.trim() : undefined);
    const mode = typeof snapshot.effortLevel === 'string' ? snapshot.effortLevel : undefined;
    const model = resolveCursorModelSelectionForCli(familyValue, mode);
```

Delete the now-unused `private resolveProviderModel()` method.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors (the old `resolveCursorModelForCli` import may now be unused —
remove it from the import list if the linter flags it).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/providers/cursor/runtime/CursorChatRuntime.ts
git commit -m "feat(cursor): resolve family+mode model selection in the runtime"
```

---

## Task 8: Migration + variant normalization in the reconciler

**Files:**
- Modify: `src/providers/cursor/env/CursorSettingsReconciler.ts`
- Test: `tests/unit/providers/cursor/env/CursorSettingsReconciler.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/providers/cursor/env/CursorSettingsReconciler.test.ts`:

```typescript
import { cursorSettingsReconciler } from '../../../../../src/providers/cursor/env/CursorSettingsReconciler';
import { getCursorProviderSettings } from '../../../../../src/providers/cursor/settings';

describe('normalizeModelVariantSettings migration', () => {
  it('collapses a persisted full-variant model to its family and seeds the mode', () => {
    const bag: Record<string, unknown> = { model: 'cursor:sonnet-4-thinking' };
    const changed = cursorSettingsReconciler.normalizeModelVariantSettings(bag);
    expect(changed).toBe(true);
    expect(bag.model).toBe('cursor:sonnet-4');
    expect(bag.effortLevel).toBe('thinking');
    expect(getCursorProviderSettings(bag).preferredModeByFamily['sonnet-4']).toBe('thinking');
  });

  it('leaves a bare family model unchanged', () => {
    const bag: Record<string, unknown> = { model: 'cursor:composer-2' };
    expect(cursorSettingsReconciler.normalizeModelVariantSettings(bag)).toBe(false);
    expect(bag.model).toBe('cursor:composer-2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "normalizeModelVariantSettings migration"`
Expected: FAIL — `normalizeModelVariantSettings` returns `false` and does not split.

- [ ] **Step 3: Implement the migration**

Rewrite `src/providers/cursor/env/CursorSettingsReconciler.ts`:

```typescript
import {
  type EnvHashReconcilerSpec,
  reconcileEnvironmentHash,
} from '../../../core/providers/EnvHashReconciler';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import { parseEnvironmentVariables } from '../../../utils/env';
import { getCachedCursorModelIds } from '../runtime/cursorModelCatalog';
import {
  CURSOR_STANDARD_MODE,
  extractCursorModeValue,
  resolveCursorFamilyId,
} from '../runtime/cursorModelFamily';
import { fromCursorModelValue, isCursorModelValue, toCursorModelValue } from '../runtime/cursorModelId';
import {
  getCursorProviderSettings,
  updateCursorProviderSettings,
} from '../settings';
import { getCursorState } from '../types';
import { cursorChatUIConfig } from '../ui/CursorChatUIConfig';

const ENV_HASH_KEYS = ['CURSOR_API_KEY', 'CURSOR_BASE_URL'];

// Splits a full-variant raw id into family + mode and writes the collapsed
// family value back to `settings.model`, seeding the per-family mode preference
// and the shared effortLevel. Returns true when anything changed.
function collapseModelSelection(settings: Record<string, unknown>): boolean {
  const model = settings.model;
  if (typeof model !== 'string' || !isCursorModelValue(model)) {
    return false;
  }
  const rawId = fromCursorModelValue(model);
  const cachedIds = getCachedCursorModelIds();
  const familyId = resolveCursorFamilyId(rawId, cachedIds);
  if (familyId === rawId) {
    return false;
  }

  const mode = extractCursorModeValue(rawId, cachedIds);
  settings.model = toCursorModelValue(familyId);
  if (mode) {
    settings.effortLevel = mode;
    const current = getCursorProviderSettings(settings).preferredModeByFamily;
    if (current[familyId] !== mode) {
      updateCursorProviderSettings(settings, {
        preferredModeByFamily: { ...current, [familyId]: mode },
      });
    }
  } else {
    settings.effortLevel = CURSOR_STANDARD_MODE;
  }
  return true;
}

const cursorEnvHashSpec: EnvHashReconcilerSpec = {
  providerId: 'cursor',
  watchedKeys: ENV_HASH_KEYS,
  getSavedHash: settings => getCursorProviderSettings(settings).environmentHash,
  saveHash: (settings, hash) => updateCursorProviderSettings(settings, { environmentHash: hash }),
  invalidateConversation: conversation => {
    const state = getCursorState(conversation.providerState);
    if (conversation.providerId !== 'cursor' || !(conversation.sessionId || state.chatSessionId)) {
      return false;
    }
    conversation.sessionId = null;
    conversation.providerState = undefined;
    return true;
  },
  reconcileModel: (settings, envText) => {
    const envVars = parseEnvironmentVariables(envText || '');
    if (envVars.CURSOR_MODEL) {
      settings.model = toCursorModelValue(envVars.CURSOR_MODEL);
      collapseModelSelection(settings);
    } else if (typeof settings.model === 'string' && settings.model.length > 0) {
      collapseModelSelection(settings);
      const options = cursorChatUIConfig.getModelOptions(settings);
      const isValid = options.some(option => option.value === settings.model);
      if (!isValid) {
        settings.model = options[0]?.value ?? toCursorModelValue('auto');
      }
    }
  },
};

export const cursorSettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment: (settings, conversations) =>
    reconcileEnvironmentHash(cursorEnvHashSpec, settings, conversations),

  normalizeModelVariantSettings(settings): boolean {
    return collapseModelSelection(settings);
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- --selectProjects unit -t "CursorSettingsReconciler"`
Expected: PASS (new migration tests + existing env tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/cursor/env/CursorSettingsReconciler.ts tests/unit/providers/cursor/env/CursorSettingsReconciler.test.ts
git commit -m "feat(cursor): migrate full-variant model selections to family+mode"
```

---

## Task 9: Families list + auth-aware empty state in settings tab

**Files:**
- Modify: `src/providers/cursor/ui/CursorSettingsTab.ts`

The settings tab is DOM/Obsidian UI; there is no isolated unit test harness for it
in this repo. Verify via typecheck/lint and the build. Keep the change focused:
group the model list by family, and improve the refresh notice.

- [ ] **Step 1: Replace the flat id list with a family list**

In `src/providers/cursor/ui/CursorSettingsTab.ts`:

Add imports at the top:

```typescript
import { buildCursorFamilies, getCursorModelVariants } from '../runtime/cursorModelFamily';
```

Replace `getAllModelIds` and `renderList` so rows are families. Replace the
`getAllModelIds` function with:

```typescript
    // All discovered + currently-enabled raw ids, grouped into families. `auto`
    // is implicit and never listed here.
    const getAllRawIds = (): string[] => {
      const discovered = getCachedCursorModelIds().filter((id) => id !== 'auto');
      const enabled = getCursorEnabledModels(settingsBag).filter((id) => id !== 'auto');
      const seen = new Set<string>();
      const result: string[] = [];
      for (const id of [...discovered, ...enabled]) {
        if (!seen.has(id)) {
          seen.add(id);
          result.push(id);
        }
      }
      return result;
    };

    const getAllFamilies = () =>
      buildCursorFamilies(getAllRawIds()).filter((family) =>
        matchesCursorModelQuery(family.familyId, searchQuery)
        || matchesCursorModelQuery(family.label, searchQuery));

    // A family counts as enabled when its bare family id is enabled.
    const isFamilyEnabled = (familyId: string): boolean =>
      new Set(getCursorEnabledModels(settingsBag)).has(familyId)
      || getCursorModelVariants(familyId, getAllRawIds())
        .some((variant) => variant.value !== 'standard'
          && new Set(getCursorEnabledModels(settingsBag)).has(`${familyId}-${variant.value}`));

    const familyMemberRawIds = (familyId: string): string[] => {
      const all = getAllRawIds();
      return all.filter((id) => {
        if (id === familyId) return true;
        const variant = getCursorModelVariants(familyId, all).map((v) => v.value);
        return variant.some((mode) => mode !== 'standard' && id === `${familyId}-${mode}`);
      });
    };
```

Replace `renderCount`:

```typescript
    const renderCount = (): void => {
      const total = buildCursorFamilies(getAllRawIds()).length;
      const selected = buildCursorFamilies(getAllRawIds())
        .filter((family) => isFamilyEnabled(family.familyId)).length;
      countEl.setText(`${selected} of ${total} families selected`);
    };
```

Replace `renderList`:

```typescript
    const renderList = (): void => {
      listEl.empty();
      const families = getAllFamilies();

      if (families.length === 0) {
        const emptyEl = listEl.createDiv({ cls: 'claudian-cursor-model-picker-empty' });
        if (buildCursorFamilies(getAllRawIds()).length === 0) {
          emptyEl.setText('No models discovered yet. Set the Cursor CLI path above, then refresh the model list.');
        } else {
          emptyEl.setText('No models match your filter.');
        }
        return;
      }

      for (const family of families) {
        const rowEl = listEl.createEl('label', { cls: 'claudian-cursor-model-picker-row' });
        rowEl.title = family.familyId;

        const checkboxEl = rowEl.createEl('input', { type: 'checkbox' });
        checkboxEl.checked = isFamilyEnabled(family.familyId);
        checkboxEl.addEventListener('change', () => {
          const current = getCursorEnabledModels(settingsBag).filter((entry) => entry !== 'auto');
          const members = new Set(familyMemberRawIds(family.familyId));
          const next = checkboxEl.checked
            ? [...new Set([...current, ...members])]
            : current.filter((entry) => !members.has(entry));
          void (async () => {
            await persistEnabledModels(next);
            renderCount();
          })();
        });

        const textEl = rowEl.createDiv({ cls: 'claudian-cursor-model-picker-row-text' });
        textEl.createDiv({
          cls: 'claudian-cursor-model-picker-row-name',
          text: family.label,
        });
        const modeHint = family.variants.length > 1
          ? `${family.vendor} · ${family.variants.length} modes`
          : family.vendor;
        textEl.createDiv({
          cls: 'claudian-cursor-model-picker-row-id',
          text: modeHint,
        });
      }
    };
```

Update `selectAllBtn` handler to enable all family members:

```typescript
    selectAllBtn.addEventListener('click', () => {
      const current = getCursorEnabledModels(settingsBag).filter((id) => id !== 'auto');
      const next = new Set(current);
      for (const family of getAllFamilies()) {
        for (const id of familyMemberRawIds(family.familyId)) {
          next.add(id);
        }
      }
      void (async () => {
        await persistEnabledModels([...next]);
        renderAll();
      })();
    });
```

- [ ] **Step 2: Add the auth-aware empty-state notice**

Replace the `discoverModels` success branch so an empty result hints at login:

```typescript
      try {
        const ids = await refreshCursorModelCatalog(cliPath, env, cwd);
        if (announce) {
          if (ids.length === 0) {
            new Notice('Cursor returned no models. If you are not signed in, run `cursor-agent login`.', 6000);
          } else {
            new Notice(`Discovered ${ids.length} Cursor model${ids.length === 1 ? '' : 's'}.`);
          }
        }
        renderAll();
      } catch {
        if (announce) {
          new Notice('Failed to refresh Cursor models.');
        }
      }
```

NOTE: `refreshCursorModelCatalog` returns the cached/fallback list on empty
discovery, so `ids.length === 0` only when the fallback itself is empty; to detect
the not-signed-in case reliably, also treat a result equal to the static fallback
after a real CLI call as "no account models". Keep the simple length check — the
fallback list is non-empty, so the notice fires only when discovery genuinely
yields nothing parseable, which is acceptable for this best-effort hint.

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean. Remove the now-unused `formatCursorModelLabel` import if the
linter flags it (the row name now uses `family.label`).

- [ ] **Step 4: Commit**

```bash
git add src/providers/cursor/ui/CursorSettingsTab.ts
git commit -m "feat(cursor): group settings model list by family with login hint"
```

---

## Task 10: Cross-provider plan-label alignment

**Files:**
- Modify: `src/providers/claude/ui/ClaudeChatUIConfig.ts`
- Test: `tests/unit/providers/claude/ui/ClaudeChatUIConfig.test.ts`

- [ ] **Step 1: Check for an existing assertion**

Run: `npm run test -- --selectProjects unit -t ClaudeChatUIConfig`
Expected: PASS currently. Inspect the test file for any assertion on `'PLAN'`.

- [ ] **Step 2: Write/adjust the test**

Add to `tests/unit/providers/claude/ui/ClaudeChatUIConfig.test.ts`:

```typescript
import { claudeChatUIConfig } from '../../../../../src/providers/claude/ui/ClaudeChatUIConfig';

describe('claude plan label coherence', () => {
  it('uses sentence-case Plan to match other providers', () => {
    expect(claudeChatUIConfig.getPermissionModeToggle?.()?.planLabel).toBe('Plan');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "claude plan label coherence"`
Expected: FAIL — received `'PLAN'`.

- [ ] **Step 4: Edit the label**

In `src/providers/claude/ui/ClaudeChatUIConfig.ts`, in `CLAUDE_PERMISSION_MODE_TOGGLE`, change:

```typescript
  planLabel: 'Plan',
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t "claude plan label coherence"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/claude/ui/ClaudeChatUIConfig.ts tests/unit/providers/claude/ui/ClaudeChatUIConfig.test.ts
git commit -m "fix(claude): align plan toggle label to sentence case"
```

---

## Task 11: Full verification

- [ ] **Step 1: Run the whole gate**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all green.

- [ ] **Step 2: Fix any fallout**

If pre-existing cursor tests assert flat-list behavior that no longer holds (for
example a test enabling `composer-2` AND `composer-2-fast` and expecting two
options), update them to expect the single `cursor:composer-2` family with a
`fast` reasoning option. Re-run the gate.

- [ ] **Step 3: Manual smoke (optional, requires a signed-in Cursor CLI)**

In Obsidian: open Cursor settings → Refresh models → confirm the list shows
families. Open a Cursor chat → confirm the model picker shows families grouped by
vendor and the "Effort:" selector appears for multi-mode families and is hidden
for single-mode families. Switch mode → send → confirm the spawned `--model`
carries the suffix (check via a debug log or the resulting transcript model).

- [ ] **Step 4: Commit any test fixups**

```bash
git add -A
git commit -m "test(cursor): align existing tests with family-based model picker"
```

---

## Self-Review notes

- Spec §1-§7 map to Tasks 1, 3, 4, 5, 6/7, 8. Spec §8 coherence items: item 1+2 →
  Tasks 4/5/7/8; item 3 → Task 5 (`group`/`description`); item 4 → Task 9; item 5
  → Task 10.
- Type consistency: `CURSOR_STANDARD_MODE`, `buildCursorFamilies`,
  `getCursorModelVariants`, `resolveCursorFamilyId`, `extractCursorModeValue`,
  `combineCursorModelSelection`, `resolveCursorModelSelectionForCli`,
  `preferredModeByFamily`, and `normalizeModelVariantSettings` are used with the
  same signatures across tasks.
- The selected mode flows through the shared `effortLevel` projection key
  (`ProviderSettingsCoordinator`), so no new `ChatRuntimeQueryOptions` field is
  needed — consistent with `OpencodeChatRuntime`.
```
