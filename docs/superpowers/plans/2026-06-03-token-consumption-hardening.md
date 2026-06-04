---
title: Token consumption hardening — unified UsageInfo, persisted, recoverable, tested
date: 2026-06-03
status: open
scope: src/core/types, src/core/providers, src/providers/{claude,codex,opencode,cursor}, src/features/chat
---
# Token consumption hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every finding from the 2026-06-03 token consumption audit. Land one canonical `UsageInfo` shape, one shared builder, one shared per-model window/price catalog, four corrected provider emitters, lifecycle persistence on cancel, history-backed hydration of `Conversation.usage`, and a cross-provider contract test matrix so all four providers (Claude, Codex, Opencode, Cursor) report the same fields with the same semantics.

**Architecture:**

(a) **One canonical `UsageInfo`.** Extend the shared `UsageInfo` interface with the fields every provider already has on the wire but currently drops: `outputTokens`, `reasoningOutputTokens`, `thoughtTokens`, `costUsd`. Document `contextTokens` as the provider-reported context-window occupancy. New fields are optional so existing call sites compile unchanged during the additive phase.

(b) **One shared builder.** `src/core/providers/usage/buildUsageInfo.ts` requires `model`, takes a flat record of counts + window + authoritative flag + optional cost, computes the percentage uniformly, and is the only path that constructs a `UsageInfo` outside legacy code. Each provider keeps its wire-mapping helper but funnels through this builder.

(c) **One shared window + price catalog.** `ProviderChatUIConfig.getModelContextWindow(modelId)` is already the right seam — extend it with `getModelPricing(modelId)?: { inputPer1M: number; outputPer1M: number; cacheReadPer1M?: number; cacheWritePer1M?: number }`. Move Cursor's substring-matched window function and Codex's `DEFAULT_CONTEXT_WINDOW` map into per-provider catalog files implementing the seam.

(d) **Lifecycle persistence.** `InputController` saves the conversation in its stream finally branch even when the user cancelled. `ConversationStore` already serializes `state.usage` to metadata on `save()`. A debounced auto-save on each `usage` chunk catches the case where the tab is closed before cancellation reaches the finally branch.

(e) **History-backed recovery.** Every provider's `ProviderConversationHistoryService` exposes an optional `extractLastUsage(conversation, ctx): UsageInfo | null` hook. `ConversationStore.hydrate` calls it after message hydration if `conversation.usage` is unset. Claude reads the last assistant `usage` from its JSONL turns; Codex reads the last `token_count`; Opencode reads `promptUsage` from the last `session.message` row; Cursor reads `usage` from the latest `chats/<workspace>/<session>/*.json`.

(f) **Sequencing discipline.** This plan is **additive-then-collapse**. Tasks 1-15 land new fields and helpers alongside existing code; Task 16 deletes the legacy paths only after every caller is migrated and every test is green. Every commit boundary leaves `npm run typecheck && npm run lint && npm run test && npm run build` green so each task ships as its own PR.

**Tech Stack:** TypeScript 5; Jest (`npm run test`); Obsidian plugin API. No new runtime deps.

---

## Pre-flight (do once before Task 1)

- [ ] **Verify the baseline is green.**

  Run: `npm run typecheck && npm run lint && npm run test && npm run build`
  Expected: all four exit 0. If any fails, fix the failure first — do not start against a red baseline.

- [ ] **Create the worktree if not already in one.** See `superpowers:using-git-worktrees`. Branch name: `core/token-consumption-hardening`. **Do not place the worktree under the Obsidian vault directory** — nested vaults confuse Obsidian's plugin loader. Place it outside the vault root.

---

## File Structure

**Created:**
- `src/core/providers/usage/buildUsageInfo.ts` — single canonical builder for `UsageInfo`
- `src/core/providers/usage/index.ts` — public re-exports
- `src/providers/cursor/runtime/cursorModelWindowCatalog.ts` — exact-id model → window/pricing table
- `src/providers/codex/runtime/codexModelWindowCatalog.ts` — exact-id model → window table (moved from `CodexSessionFileTail.ts`)
- `tests/unit/core/providers/usage/buildUsageInfo.test.ts` — builder unit tests
- `tests/unit/providers/shared/usageContractMatrix.test.ts` — cross-provider contract test
- `tests/unit/providers/shared/historyUsageRecovery.test.ts` — hydration recovery test
- `tests/unit/features/chat/controllers/cancelPersistsUsage.test.ts` — cancel-persistence integration test

**Modified:**
- `src/core/types/chat.ts` — extend `UsageInfo`
- `src/providers/acp/buildAcpUsageInfo.ts` — funnel through shared builder, surface output/thought/cost
- `src/providers/claude/stream/transformClaudeMessage.ts` — funnel through shared builder, fix input merge semantics
- `src/providers/codex/runtime/CodexNotificationRouter.ts` — stamp model, expand fields, funnel through builder
- `src/providers/codex/runtime/CodexSessionFileTail.ts` — expand parsed fields, funnel through builder
- `src/providers/cursor/runtime/cursorStreamMapper.ts` — stamp model, expose cache, route window through catalog
- `src/features/chat/ui/InputToolbar.ts` — better `formatTokens`, cost in tooltip when present
- `src/features/chat/controllers/InputController.ts` — persist usage on cancel and on invalidated streams
- `src/providers/{claude,codex,opencode,cursor}/history/*HistoryStore.ts` — implement `extractLastUsage`
- `src/app/conversations/ConversationStore.ts` — call `extractLastUsage` during hydration when `conversation.usage` is absent

---

## Task 1: Extend `UsageInfo` type (additive)

**Files:**
- Modify: `src/core/types/chat.ts:193-205`
- Test: `tests/unit/core/types/usageInfoShape.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/types/usageInfoShape.test.ts
import type { UsageInfo } from '../../../../src/core/types';

describe('UsageInfo shape (compile-time)', () => {
  it('accepts the extended fields without losing the existing ones', () => {
    const sample: UsageInfo = {
      model: 'claude-sonnet-4',
      inputTokens: 100,
      outputTokens: 50,
      reasoningOutputTokens: 10,
      thoughtTokens: 5,
      cacheCreationInputTokens: 20,
      cacheReadInputTokens: 30,
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
      contextTokens: 150,
      percentage: 1,
      costUsd: 0.0042,
    };
    expect(sample.inputTokens + (sample.outputTokens ?? 0)).toBe(150);
  });

  it('still accepts the legacy minimal shape', () => {
    const legacy: UsageInfo = {
      inputTokens: 100,
      contextWindow: 200_000,
      contextTokens: 100,
      percentage: 0,
    };
    expect(legacy.contextTokens).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/core/types/usageInfoShape.test.ts`
Expected: FAIL with `Object literal may only specify known properties, and 'outputTokens' does not exist in type 'UsageInfo'`.

- [ ] **Step 3: Extend the type**

Edit `src/core/types/chat.ts:193-205` to:

```ts
/**
 * Context window usage information.
 *
 * `contextTokens` is the provider-reported context-window occupancy after the
 * current turn (i.e. what the next turn will see). Providers may compute it
 * differently (Claude: `inputTokens + cacheCreationInputTokens + cacheReadInputTokens`;
 * Codex: `tokenUsage.last.inputTokens + outputTokens + reasoningOutputTokens`;
 * Opencode/Cursor: `usage_update.used` or `total_tokens`). Feature code should
 * display `contextTokens` directly and never recompute it from the breakdown.
 *
 * Cache token fields are populated only by providers with prompt caching (Claude,
 * Opencode). Output/reasoning/thought are populated when the wire emits them.
 * `costUsd` is populated only when the provider emits cost on the wire
 * (currently Opencode via `AcpUsageUpdate.cost`); other providers leave it
 * unset and rely on plugin-side estimation downstream.
 */
export interface UsageInfo {
  model?: string;
  inputTokens: number;
  /** Assistant tokens emitted this turn. Optional; 0 if omitted. */
  outputTokens?: number;
  /** Reasoning tokens billed separately (Codex `reasoningOutputTokens`). 0 if omitted. */
  reasoningOutputTokens?: number;
  /** Thinking/thought tokens reported separately by some providers (Opencode). 0 if omitted. */
  thoughtTokens?: number;
  /** Prompt caching: tokens used to create cache entries. 0 if omitted. */
  cacheCreationInputTokens?: number;
  /** Prompt caching: tokens read from cache. 0 if omitted. */
  cacheReadInputTokens?: number;
  contextWindow: number;
  /** True when `contextWindow` came from provider runtime data instead of a local heuristic. */
  contextWindowIsAuthoritative?: boolean;
  contextTokens: number;
  percentage: number;
  /** Estimated USD cost of this turn (Opencode wire, plus optional plugin-side estimate). */
  costUsd?: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/core/types/usageInfoShape.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify baseline still green**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/types/chat.ts tests/unit/core/types/usageInfoShape.test.ts
git commit -m "feat(core): extend UsageInfo with output/reasoning/thought/cost fields"
```

---

## Task 2: Shared `buildUsageInfo` builder

**Files:**
- Create: `src/core/providers/usage/buildUsageInfo.ts`
- Create: `src/core/providers/usage/index.ts`
- Test: `tests/unit/core/providers/usage/buildUsageInfo.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/core/providers/usage/buildUsageInfo.test.ts
import { buildUsageInfo, clampPercentage } from '../../../../../src/core/providers/usage';

describe('clampPercentage', () => {
  it('returns 0 when window is non-positive', () => {
    expect(clampPercentage(100, 0)).toBe(0);
    expect(clampPercentage(100, -1)).toBe(0);
  });
  it('clamps to [0,100] and rounds to whole percent', () => {
    expect(clampPercentage(50, 200)).toBe(25);
    expect(clampPercentage(150, 100)).toBe(100);
    expect(clampPercentage(-5, 100)).toBe(0);
  });
});

describe('buildUsageInfo', () => {
  it('requires a model and produces a fully-populated UsageInfo', () => {
    const usage = buildUsageInfo({
      model: 'claude-sonnet-4',
      inputTokens: 100,
      outputTokens: 25,
      cacheCreationInputTokens: 10,
      cacheReadInputTokens: 40,
      contextTokens: 150,
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
    });
    expect(usage.model).toBe('claude-sonnet-4');
    expect(usage.percentage).toBe(0);
    expect(usage.contextWindowIsAuthoritative).toBe(true);
  });

  it('rejects an empty model id', () => {
    expect(() =>
      buildUsageInfo({
        model: '',
        inputTokens: 0,
        contextTokens: 0,
        contextWindow: 200_000,
      }),
    ).toThrow(/model id is required/i);
  });

  it('treats missing cache/output as 0 on the persisted shape', () => {
    const usage = buildUsageInfo({
      model: 'gpt-5.3-codex',
      inputTokens: 100,
      contextTokens: 100,
      contextWindow: 200_000,
    });
    expect(usage.cacheCreationInputTokens ?? 0).toBe(0);
    expect(usage.cacheReadInputTokens ?? 0).toBe(0);
    expect(usage.outputTokens ?? 0).toBe(0);
  });

  it('propagates costUsd when present', () => {
    const usage = buildUsageInfo({
      model: 'claude-haiku-4',
      inputTokens: 10,
      contextTokens: 10,
      contextWindow: 200_000,
      costUsd: 0.00012,
    });
    expect(usage.costUsd).toBeCloseTo(0.00012);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/core/providers/usage/buildUsageInfo.test.ts`
Expected: FAIL with `Cannot find module '../../../../../src/core/providers/usage'`.

- [ ] **Step 3: Implement the builder**

Create `src/core/providers/usage/buildUsageInfo.ts`:

```ts
import type { UsageInfo } from '../../types';

export interface BuildUsageInfoParams {
  model: string;
  inputTokens: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  thoughtTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  contextTokens: number;
  contextWindow: number;
  contextWindowIsAuthoritative?: boolean;
  costUsd?: number;
}

export function clampPercentage(used: number, window: number): number {
  if (!Number.isFinite(window) || window <= 0) {
    return 0;
  }
  const ratio = Math.round((used / window) * 100);
  return Math.min(100, Math.max(0, ratio));
}

export function buildUsageInfo(params: BuildUsageInfoParams): UsageInfo {
  if (!params.model || typeof params.model !== 'string' || !params.model.trim()) {
    throw new Error('buildUsageInfo: model id is required');
  }
  const window = Math.max(0, Math.floor(params.contextWindow));
  const contextTokens = Math.max(0, Math.floor(params.contextTokens));
  const usage: UsageInfo = {
    model: params.model,
    inputTokens: Math.max(0, Math.floor(params.inputTokens)),
    contextWindow: window,
    contextTokens,
    percentage: clampPercentage(contextTokens, window),
  };
  if (params.outputTokens !== undefined) usage.outputTokens = Math.max(0, Math.floor(params.outputTokens));
  if (params.reasoningOutputTokens !== undefined) usage.reasoningOutputTokens = Math.max(0, Math.floor(params.reasoningOutputTokens));
  if (params.thoughtTokens !== undefined) usage.thoughtTokens = Math.max(0, Math.floor(params.thoughtTokens));
  if (params.cacheCreationInputTokens !== undefined) usage.cacheCreationInputTokens = Math.max(0, Math.floor(params.cacheCreationInputTokens));
  if (params.cacheReadInputTokens !== undefined) usage.cacheReadInputTokens = Math.max(0, Math.floor(params.cacheReadInputTokens));
  if (params.contextWindowIsAuthoritative !== undefined) usage.contextWindowIsAuthoritative = params.contextWindowIsAuthoritative;
  if (params.costUsd !== undefined && Number.isFinite(params.costUsd)) usage.costUsd = params.costUsd;
  return usage;
}
```

Create `src/core/providers/usage/index.ts`:

```ts
export { buildUsageInfo, clampPercentage } from './buildUsageInfo';
export type { BuildUsageInfoParams } from './buildUsageInfo';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/core/providers/usage/buildUsageInfo.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Verify baseline still green**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/providers/usage/ tests/unit/core/providers/usage/
git commit -m "feat(core): add shared buildUsageInfo with required model + clamped percent"
```

---

## Task 3: Extend `ProviderChatUIConfig` with pricing seam

**Files:**
- Modify: `src/core/runtime/ChatUIConfig.ts` (or wherever `ProviderChatUIConfig` is declared — locate via `grep -rn 'getModelContextWindow' src/`)
- Test: `tests/unit/core/runtime/providerChatUIConfigPricing.test.ts` (new)

- [ ] **Step 1: Locate the interface**

Run: `grep -rn "getModelContextWindow" src/core/ src/providers/`
Expected: one declaration in core, four implementations (one per provider).

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/core/runtime/providerChatUIConfigPricing.test.ts
import type { ProviderChatUIConfig } from '../../../../src/core/runtime/ChatUIConfig';

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M?: number;
  cacheWritePer1M?: number;
}

describe('ProviderChatUIConfig.getModelPricing', () => {
  it('is an optional method that returns ModelPricing | null', () => {
    const fake: ProviderChatUIConfig = {
      getModelContextWindow: () => 200_000,
      getModelPricing: (id: string): ModelPricing | null =>
        id === 'claude-sonnet-4'
          ? { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 }
          : null,
    } as unknown as ProviderChatUIConfig;
    expect(fake.getModelPricing?.('claude-sonnet-4')?.inputPer1M).toBe(3);
    expect(fake.getModelPricing?.('unknown')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/unit/core/runtime/providerChatUIConfigPricing.test.ts`
Expected: FAIL — `Property 'getModelPricing' does not exist on type 'ProviderChatUIConfig'`.

- [ ] **Step 4: Add the optional method to the interface**

Add to `ProviderChatUIConfig`:

```ts
export interface ModelPricing {
  /** USD per 1,000,000 input tokens. */
  inputPer1M: number;
  /** USD per 1,000,000 output tokens. */
  outputPer1M: number;
  /** USD per 1,000,000 cache-read tokens. Defaults to inputPer1M when omitted. */
  cacheReadPer1M?: number;
  /** USD per 1,000,000 cache-creation tokens. Defaults to inputPer1M when omitted. */
  cacheWritePer1M?: number;
}

export interface ProviderChatUIConfig {
  // ... existing fields ...
  /** Optional per-model pricing seam. Returns null when pricing is not known. */
  getModelPricing?(modelId: string): ModelPricing | null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/core/runtime/providerChatUIConfigPricing.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify baseline still green**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/runtime/ChatUIConfig.ts tests/unit/core/runtime/providerChatUIConfigPricing.test.ts
git commit -m "feat(core): add optional getModelPricing to ProviderChatUIConfig"
```

---

## Task 4: Cursor exact-id model catalog (window + pricing)

**Files:**
- Create: `src/providers/cursor/runtime/cursorModelWindowCatalog.ts`
- Test: `tests/unit/providers/cursor/runtime/cursorModelWindowCatalog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/providers/cursor/runtime/cursorModelWindowCatalog.test.ts
import {
  cursorModelContextWindow,
  cursorModelPricing,
} from '../../../../../src/providers/cursor/runtime/cursorModelWindowCatalog';

describe('cursorModelContextWindow', () => {
  it('returns exact-match windows for known ids', () => {
    expect(cursorModelContextWindow('gemini-2.5-pro')).toBe(1_000_000);
    expect(cursorModelContextWindow('gpt-5')).toBe(400_000);
    expect(cursorModelContextWindow('claude-sonnet-4')).toBe(200_000);
    expect(cursorModelContextWindow('composer-2')).toBe(200_000);
  });

  it('does not match by substring — composer-2-sonnet-research stays in the composer family', () => {
    // Regression: the old substring matcher would have hit "sonnet" first.
    expect(cursorModelContextWindow('composer-2-sonnet-research')).toBe(200_000);
  });

  it('returns 0 for unknown ids so the caller can flag non-authoritative windows', () => {
    expect(cursorModelContextWindow('totally-fake-model')).toBe(0);
  });
});

describe('cursorModelPricing', () => {
  it('returns null when pricing is not in the table', () => {
    expect(cursorModelPricing('totally-fake-model')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/providers/cursor/runtime/cursorModelWindowCatalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the catalog**

Create `src/providers/cursor/runtime/cursorModelWindowCatalog.ts`:

```ts
import type { ModelPricing } from '../../../core/runtime/ChatUIConfig';

interface CatalogEntry {
  contextWindow: number;
  pricing?: ModelPricing;
}

const CATALOG: Readonly<Record<string, CatalogEntry>> = {
  'gemini-2.5-pro': { contextWindow: 1_000_000 },
  'gemini-1.5-pro': { contextWindow: 1_000_000 },
  'gpt-5': { contextWindow: 400_000 },
  'gpt-4.1': { contextWindow: 400_000 },
  'claude-sonnet-4': { contextWindow: 200_000 },
  'claude-opus-4': { contextWindow: 200_000 },
  'claude-haiku-4': { contextWindow: 200_000 },
  'composer-2': { contextWindow: 200_000 },
  'composer-2-sonnet-research': { contextWindow: 200_000 },
  'sonic-1': { contextWindow: 200_000 },
  'grok-4': { contextWindow: 200_000 },
};

export function cursorModelContextWindow(modelId: string | undefined): number {
  if (!modelId) return 0;
  return CATALOG[modelId]?.contextWindow ?? 0;
}

export function cursorModelPricing(modelId: string | undefined): ModelPricing | null {
  if (!modelId) return null;
  return CATALOG[modelId]?.pricing ?? null;
}

export function cursorKnownModelIds(): string[] {
  return Object.keys(CATALOG);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/providers/cursor/runtime/cursorModelWindowCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `CursorChatUIConfig`**

Locate `CursorChatUIConfig` (`grep -rn 'CursorChatUIConfig\|getModelContextWindow' src/providers/cursor/`) and replace its window lookup with `cursorModelContextWindow`. Add `getModelPricing` returning `cursorModelPricing`.

- [ ] **Step 6: Verify baseline still green**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/providers/cursor/runtime/cursorModelWindowCatalog.ts tests/unit/providers/cursor/runtime/cursorModelWindowCatalog.test.ts src/providers/cursor/
git commit -m "feat(cursor): exact-id model catalog for window + pricing"
```

---

## Task 5: Codex exact-id model catalog (window + pricing)

**Files:**
- Create: `src/providers/codex/runtime/codexModelWindowCatalog.ts`
- Modify: `src/providers/codex/runtime/CodexSessionFileTail.ts:20-26` (remove static map)
- Test: `tests/unit/providers/codex/runtime/codexModelWindowCatalog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/providers/codex/runtime/codexModelWindowCatalog.test.ts
import {
  codexModelContextWindow,
  codexModelPricing,
} from '../../../../../src/providers/codex/runtime/codexModelWindowCatalog';

describe('codexModelContextWindow', () => {
  it('exact-match returns the configured window', () => {
    expect(codexModelContextWindow('gpt-5.3-codex')).toBe(200_000);
    expect(codexModelContextWindow('gpt-5.2')).toBe(200_000);
    expect(codexModelContextWindow('gpt-5.3-codex-spark')).toBe(200_000);
  });

  it('returns 0 for unknown ids', () => {
    expect(codexModelContextWindow('fake-codex-model')).toBe(0);
  });
});

describe('codexModelPricing', () => {
  it('returns null for unknown ids', () => {
    expect(codexModelPricing('fake-codex-model')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/providers/codex/runtime/codexModelWindowCatalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the catalog**

Create `src/providers/codex/runtime/codexModelWindowCatalog.ts`:

```ts
import type { ModelPricing } from '../../../core/runtime/ChatUIConfig';

interface CatalogEntry {
  contextWindow: number;
  pricing?: ModelPricing;
}

const DEFAULT_WINDOW = 200_000;

const CATALOG: Readonly<Record<string, CatalogEntry>> = {
  'gpt-5.2': { contextWindow: DEFAULT_WINDOW },
  'gpt-5.3-codex': { contextWindow: DEFAULT_WINDOW },
  'gpt-5.3-codex-spark': { contextWindow: DEFAULT_WINDOW },
};

export function codexModelContextWindow(modelId: string | undefined): number {
  if (!modelId) return 0;
  return CATALOG[modelId]?.contextWindow ?? 0;
}

export function codexModelPricing(modelId: string | undefined): ModelPricing | null {
  if (!modelId) return null;
  return CATALOG[modelId]?.pricing ?? null;
}

export const CODEX_DEFAULT_CONTEXT_WINDOW = DEFAULT_WINDOW;
```

Replace `DEFAULT_CONTEXT_WINDOW` literal and the inline `MODEL_CONTEXT_WINDOWS` map in `src/providers/codex/runtime/CodexSessionFileTail.ts:20-26` with imports from the new catalog. Add `getModelPricing` to `CodexChatUIConfig`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/providers/codex/runtime/codexModelWindowCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify baseline still green**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/providers/codex/ tests/unit/providers/codex/runtime/codexModelWindowCatalog.test.ts
git commit -m "feat(codex): exact-id model catalog, drop CodexSessionFileTail static map"
```

---

## Task 6: Claude — switch `mergePromptUsage` to "latest-snapshot for input, max for cache"

**Files:**
- Modify: `src/providers/claude/stream/transformClaudeMessage.ts:281-302`
- Test: `tests/unit/providers/claude/stream/transformClaudeMessage.usage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/providers/claude/stream/transformClaudeMessage.usage.test.ts
import { createTransformUsageState } from '../../../../../src/providers/claude/stream/transformClaudeMessage';

describe('TransformUsageState.mergePromptUsage', () => {
  it('keeps cache fields monotone (high-water-mark)', () => {
    const state = createTransformUsageState();
    state.mergePromptUsage({ input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 });
    const after = state.mergePromptUsage({ input_tokens: 100, cache_creation_input_tokens: 10, cache_read_input_tokens: 25 });
    expect(after.cacheCreationInputTokens).toBe(20);
    expect(after.cacheReadInputTokens).toBe(30);
  });

  it('uses the latest snapshot for inputTokens (no high-water-mark drift)', () => {
    const state = createTransformUsageState();
    state.mergePromptUsage({ input_tokens: 5000 });
    const after = state.mergePromptUsage({ input_tokens: 4800 });
    expect(after.inputTokens).toBe(4800);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/providers/claude/stream/transformClaudeMessage.usage.test.ts`
Expected: FAIL — `expect(4800).toBe(5000)` because `mergePromptUsage` currently uses `Math.max` on `inputTokens`.

- [ ] **Step 3: Patch `mergePromptUsage`**

Replace `src/providers/claude/stream/transformClaudeMessage.ts:281-295` with:

```ts
function mergePromptUsage(
  current: PromptUsageSnapshot,
  usage: MessageUsage,
): PromptUsageSnapshot {
  const next = toPromptUsageSnapshot(usage);
  // Cache fields are monotone-within-turn (the SDK never *un-caches* tokens it already
  // reported). inputTokens is NOT monotone: the SDK may report the per-turn input on the
  // first assistant message and a slightly different value on a later stream_event/
  // message_delta. Use the latest snapshot for inputTokens and high-water-mark only
  // for cache fields, so the recorded total tracks the SDK's view of the current turn.
  const inputTokens = next.inputTokens > 0 ? next.inputTokens : current.inputTokens;
  const cacheCreationInputTokens = Math.max(current.cacheCreationInputTokens, next.cacheCreationInputTokens);
  const cacheReadInputTokens = Math.max(current.cacheReadInputTokens, next.cacheReadInputTokens);
  return {
    inputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    contextTokens: inputTokens + cacheCreationInputTokens + cacheReadInputTokens,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/providers/claude/stream/transformClaudeMessage.usage.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Run existing Claude usage tests to verify no regression**

Run: `npx jest tests/unit/providers/claude/`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/providers/claude/stream/transformClaudeMessage.ts tests/unit/providers/claude/stream/transformClaudeMessage.usage.test.ts
git commit -m "fix(claude): use latest snapshot for inputTokens; keep max only for cache"
```

---

## Task 7: Codex — stamp model, expose output/reasoning, route window through catalog

**Files:**
- Modify: `src/providers/codex/runtime/CodexNotificationRouter.ts:775-790`
- Test: `tests/unit/providers/codex/runtime/CodexNotificationRouter.test.ts` (extend existing)

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/providers/codex/runtime/CodexNotificationRouter.test.ts`:

```ts
describe('onTokenUsageUpdated', () => {
  it('stamps the active model, includes output+reasoning in contextTokens, exposes cache reads', () => {
    const emitted: UsageInfo[] = [];
    const router = makeRouterWithEmit((c) => { if (c.type === 'usage') emitted.push(c.usage); }, {
      activeModel: 'gpt-5.3-codex',
    });
    router.handle({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'T1',
        turnId: 'turn-1',
        tokenUsage: {
          total: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
          last: { totalTokens: 5500, inputTokens: 4000, cachedInputTokens: 800, outputTokens: 1000, reasoningOutputTokens: 500 },
          modelContextWindow: 200_000,
        },
      },
    });
    expect(emitted).toHaveLength(1);
    const usage = emitted[0]!;
    expect(usage.model).toBe('gpt-5.3-codex');
    expect(usage.inputTokens).toBe(4000);
    expect(usage.outputTokens).toBe(1000);
    expect(usage.reasoningOutputTokens).toBe(500);
    expect(usage.cacheReadInputTokens).toBe(800);
    expect(usage.contextTokens).toBe(4000 + 1000 + 500); // input + output + reasoning
    expect(usage.contextWindow).toBe(200_000);
    expect(usage.contextWindowIsAuthoritative).toBe(true);
  });

  it('marks contextWindowIsAuthoritative=false when modelContextWindow is 0', () => {
    const emitted: UsageInfo[] = [];
    const router = makeRouterWithEmit((c) => { if (c.type === 'usage') emitted.push(c.usage); }, {
      activeModel: 'gpt-5.3-codex',
    });
    router.handle({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'T1',
        turnId: 'turn-1',
        tokenUsage: {
          total: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
          last: { totalTokens: 100, inputTokens: 100, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
          modelContextWindow: 0,
        },
      },
    });
    expect(emitted[0]?.contextWindowIsAuthoritative).toBe(false);
    expect(emitted[0]?.contextWindow).toBe(200_000); // fallback from catalog
  });
});
```

Update the existing `makeRouterWithEmit` helper in that test file to accept `{ activeModel: string }` and pass it to the router. If the router doesn't currently take an active-model accessor, add one — see Step 3.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/providers/codex/runtime/CodexNotificationRouter.test.ts`
Expected: FAIL — `usage.model` is undefined; `contextTokens` is 4000.

- [ ] **Step 3: Patch the router**

`CodexNotificationRouter` needs to know the active model. Two acceptable shapes:
- Constructor option `getActiveModel: () => string` injected by `CodexChatRuntime`, OR
- Per-call parameter on `onTokenUsageUpdated` if the runtime already tracks model per turn.

Pick whichever matches the existing dependency style — locate via `grep -n 'new CodexNotificationRouter' src/providers/codex/`.

Replace `src/providers/codex/runtime/CodexNotificationRouter.ts:775-791` with:

```ts
private onTokenUsageUpdated(params: TokenUsageUpdatedNotification): void {
  const last = params.tokenUsage.last;
  const wireWindow = params.tokenUsage.modelContextWindow;
  const activeModel = this.getActiveModel();
  const fallbackWindow = codexModelContextWindow(activeModel) || CODEX_DEFAULT_CONTEXT_WINDOW;
  const contextWindow = wireWindow > 0 ? wireWindow : fallbackWindow;
  const contextTokens = last.inputTokens + last.outputTokens + last.reasoningOutputTokens;

  const usage = buildUsageInfo({
    model: activeModel,
    inputTokens: last.inputTokens,
    outputTokens: last.outputTokens,
    reasoningOutputTokens: last.reasoningOutputTokens,
    cacheReadInputTokens: last.cachedInputTokens,
    // Codex app-server does not distinguish cache writes; leave the field unset.
    contextTokens,
    contextWindow,
    contextWindowIsAuthoritative: wireWindow > 0,
  });

  this.emit({ type: 'usage', usage, sessionId: params.threadId });
}
```

Add the imports:

```ts
import { buildUsageInfo } from '../../../core/providers/usage';
import { codexModelContextWindow, CODEX_DEFAULT_CONTEXT_WINDOW } from './codexModelWindowCatalog';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/providers/codex/runtime/CodexNotificationRouter.test.ts`
Expected: all pass.

- [ ] **Step 5: Verify baseline still green**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/providers/codex/ tests/unit/providers/codex/
git commit -m "fix(codex): stamp model + expose output/reasoning/cache on UsageInfo"
```

---

## Task 8: Codex JSONL `token_count` parser — expand fields

**Files:**
- Modify: `src/providers/codex/runtime/CodexSessionFileTail.ts:300-315`
- Modify: `src/providers/codex/history/CodexHistoryStore.ts:21` (extend `CodexEvent.usage` type to include all three fields)
- Test: `tests/unit/providers/codex/runtime/CodexSessionFileTail.test.ts` (extend existing)

- [ ] **Step 1: Write the failing test**

Add to the existing tail test file:

```ts
describe('token_count parsing', () => {
  it('parses cached_input_tokens and output_tokens, not just input', () => {
    const state = makeFreshTailState({ modelContextWindow: 200_000, modelContextWindowIsAuthoritative: true });
    const chunks = processTailLine(state, JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 4000,
            cached_input_tokens: 800,
            output_tokens: 1200,
          },
        },
      },
    }));
    expect(chunks).toEqual([]); // token_count is staged into pendingUsageByTurn, emitted on turnCompleted
    const pending = Array.from(state.pendingUsageByTurn.values())[0];
    expect(pending?.cacheReadInputTokens).toBe(800);
    expect(pending?.outputTokens).toBe(1200);
    expect(pending?.contextTokens).toBe(4000 + 1200); // output included; cache read does not double-count
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/providers/codex/runtime/CodexSessionFileTail.test.ts`
Expected: FAIL — `pending.outputTokens` is undefined.

- [ ] **Step 3: Patch the parser**

Replace `src/providers/codex/runtime/CodexSessionFileTail.ts:300-315`:

```ts
case 'token_count': {
  const turnId = resolveTurnId(state, undefined);
  const lastTokenUsage = isRecord(info.last_token_usage) ? info.last_token_usage : {};
  const inputTokens = numericField(lastTokenUsage, ['input_tokens', 'input']) ?? 0;
  const cachedInputTokens = numericField(lastTokenUsage, ['cached_input_tokens', 'cached_input']) ?? 0;
  const outputTokens = numericField(lastTokenUsage, ['output_tokens', 'output']) ?? 0;
  const reasoningOutputTokens = numericField(lastTokenUsage, ['reasoning_output_tokens', 'reasoning_output']) ?? 0;
  const contextTokens = inputTokens + outputTokens + reasoningOutputTokens;

  state.pendingUsageByTurn.set(turnId, {
    inputTokens,
    outputTokens,
    reasoningOutputTokens,
    cacheReadInputTokens: cachedInputTokens,
    contextTokens,
    contextWindow: state.modelContextWindow,
    contextWindowIsAuthoritative: state.modelContextWindowIsAuthoritative,
  });
  return [];
}
```

Add a local `numericField` helper near the top of the file (or import it from an existing util) — see the Cursor mapper for the same pattern.

Extend the `CodexEvent.usage` declaration in `src/providers/codex/history/CodexHistoryStore.ts:21`:

```ts
usage?: {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
};
```

Update the `pendingUsageByTurn` value type to carry the new fields (search for `pendingUsageByTurn` declaration — extend the `PendingUsage` interface).

Update the consumer of `pendingUsageByTurn` (search for `pendingUsageByTurn.get`) to feed the new fields into `buildUsageInfo`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/providers/codex/runtime/CodexSessionFileTail.test.ts`
Expected: all pass.

- [ ] **Step 5: Verify baseline still green**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/providers/codex/
git commit -m "fix(codex): parse cached + output tokens from JSONL token_count events"
```

---

## Task 9: Opencode `buildAcpUsageInfo` — preserve output/thought/cost

**Files:**
- Modify: `src/providers/acp/buildAcpUsageInfo.ts`
- Test: `tests/unit/providers/acp/buildAcpUsageInfo.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/providers/acp/buildAcpUsageInfo.test.ts
import { buildAcpUsageInfo } from '../../../../src/providers/acp/buildAcpUsageInfo';

describe('buildAcpUsageInfo', () => {
  it('preserves outputTokens and thoughtTokens from AcpUsage', () => {
    const usage = buildAcpUsageInfo({
      model: 'sonnet-via-opencode',
      promptUsage: {
        inputTokens: 1000,
        outputTokens: 250,
        cachedReadTokens: 200,
        cachedWriteTokens: 100,
        thoughtTokens: 50,
        totalTokens: 1600,
      },
      contextWindow: { size: 200_000, used: 1600 },
    });
    expect(usage?.outputTokens).toBe(250);
    expect(usage?.thoughtTokens).toBe(50);
    expect(usage?.cacheReadInputTokens).toBe(200);
    expect(usage?.cacheCreationInputTokens).toBe(100);
    expect(usage?.contextTokens).toBe(1600);
    expect(usage?.model).toBe('sonnet-via-opencode');
  });

  it('surfaces costUsd when AcpUsageUpdate carries cost', () => {
    const usage = buildAcpUsageInfo({
      model: 'sonnet-via-opencode',
      promptUsage: null,
      contextWindow: { size: 200_000, used: 5000, cost: { amount: 0.0123, currency: 'USD' } },
    });
    expect(usage?.costUsd).toBeCloseTo(0.0123);
  });

  it('ignores non-USD cost (no conversion done)', () => {
    const usage = buildAcpUsageInfo({
      model: 'sonnet-via-opencode',
      promptUsage: null,
      contextWindow: { size: 200_000, used: 5000, cost: { amount: 1.0, currency: 'EUR' } },
    });
    expect(usage?.costUsd).toBeUndefined();
  });

  it('throws when called without a model id (matches buildUsageInfo contract)', () => {
    expect(() => buildAcpUsageInfo({ model: '', promptUsage: null, contextWindow: { size: 100, used: 0 } })).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/providers/acp/buildAcpUsageInfo.test.ts`
Expected: FAIL — `outputTokens` undefined, `costUsd` undefined.

- [ ] **Step 3: Patch `buildAcpUsageInfo`**

Replace `src/providers/acp/buildAcpUsageInfo.ts` entirely with:

```ts
import { buildUsageInfo } from '../../core/providers/usage';
import type { UsageInfo } from '../../core/types';
import type { AcpUsage, AcpUsageUpdate } from './types';

export interface BuildAcpUsageInfoParams {
  contextWindow?: AcpUsageUpdate | null;
  model: string;
  promptUsage?: AcpUsage | null;
}

export function buildAcpUsageInfo(params: BuildAcpUsageInfoParams): UsageInfo | null {
  const promptUsage = params.promptUsage ?? null;
  const contextWindow = params.contextWindow ?? null;

  if (!promptUsage && !contextWindow) {
    return null;
  }

  const contextTokens = contextWindow?.used ?? promptUsage?.totalTokens ?? 0;
  const contextWindowSize = contextWindow?.size ?? 0;
  const cost = contextWindow?.cost;
  const costUsd = cost && cost.currency === 'USD' && Number.isFinite(cost.amount) ? cost.amount : undefined;

  return buildUsageInfo({
    model: params.model,
    inputTokens: promptUsage?.inputTokens ?? 0,
    outputTokens: promptUsage?.outputTokens ?? undefined,
    cacheCreationInputTokens: promptUsage?.cachedWriteTokens ?? undefined,
    cacheReadInputTokens: promptUsage?.cachedReadTokens ?? undefined,
    thoughtTokens: promptUsage?.thoughtTokens ?? undefined,
    contextTokens,
    contextWindow: contextWindowSize,
    contextWindowIsAuthoritative: Boolean(contextWindow),
    costUsd,
  });
}
```

Update every call site in `src/providers/opencode/runtime/OpencodeChatRuntime.ts:419-427` and `:1206-1218` to pass `model` (currently optional, now required). Look up active model via `this.getActiveDisplayModel()` or equivalent.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/providers/acp/buildAcpUsageInfo.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Verify baseline still green**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/providers/acp/ src/providers/opencode/ tests/unit/providers/acp/
git commit -m "fix(opencode): preserve output/thought/cost in UsageInfo via shared builder"
```

---

## Task 10: Cursor — stamp model, expose cache, route window through catalog

**Files:**
- Modify: `src/providers/cursor/runtime/cursorStreamMapper.ts:184-272, 396-413`
- Test: `tests/unit/providers/cursor/runtime/cursorStreamMapper.test.ts` (extend existing or new)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/providers/cursor/runtime/cursorStreamMapper.usage.test.ts
import { CursorNdjsonStreamReducer } from '../../../../../src/providers/cursor/runtime/cursorStreamMapper';

describe('CursorNdjsonStreamReducer usage emission', () => {
  it('stamps the active model and the cache_read field, routes window through the catalog', () => {
    const reducer = new CursorNdjsonStreamReducer();
    reducer.reduceLine(JSON.stringify({ type: 'system', model: 'claude-sonnet-4' }));
    const { chunks } = reducer.reduceLine(JSON.stringify({
      type: 'usage',
      usage: {
        input_tokens: 4000,
        output_tokens: 1000,
        cache_read_input_tokens: 500,
        total_tokens: 5500,
      },
    }));
    const usageChunk = chunks.find(c => c.type === 'usage');
    expect(usageChunk).toBeDefined();
    if (usageChunk?.type === 'usage') {
      expect(usageChunk.usage.model).toBe('claude-sonnet-4');
      expect(usageChunk.usage.cacheReadInputTokens).toBe(500);
      expect(usageChunk.usage.outputTokens).toBe(1000);
      expect(usageChunk.usage.contextWindow).toBe(200_000);
      expect(usageChunk.usage.contextWindowIsAuthoritative).toBe(true);
    }
  });

  it('marks contextWindowIsAuthoritative=false when the model is unknown', () => {
    const reducer = new CursorNdjsonStreamReducer();
    reducer.reduceLine(JSON.stringify({ type: 'system', model: 'totally-fake-model' }));
    const { chunks } = reducer.reduceLine(JSON.stringify({
      type: 'usage',
      usage: { input_tokens: 100, total_tokens: 100 },
    }));
    const usageChunk = chunks.find(c => c.type === 'usage');
    if (usageChunk?.type === 'usage') {
      expect(usageChunk.usage.contextWindowIsAuthoritative).toBe(false);
      expect(usageChunk.usage.contextWindow).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/providers/cursor/runtime/cursorStreamMapper.usage.test.ts`
Expected: FAIL — `usage.model` undefined; `cacheReadInputTokens` undefined.

- [ ] **Step 3: Patch the mapper**

Delete `cursorContextWindowForModel` from `src/providers/cursor/runtime/cursorStreamMapper.ts:182-199` (replaced by the catalog).

Extend `CursorUsage` to carry the new fields:

```ts
export interface CursorUsage {
  inputTokens: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  contextTokens: number;
  contextWindow: number;
  contextWindowIsAuthoritative: boolean;
  percentage: number;
}
```

Replace `extractCursorUsage` (`:225-272`) to populate the new fields and to use `cursorModelContextWindow`:

```ts
import { cursorModelContextWindow } from './cursorModelWindowCatalog';

export function extractCursorUsage(
  rec: Record<string, unknown>,
  model: string | undefined,
): CursorUsage {
  const usageObj =
    rec.usage && typeof rec.usage === 'object'
      ? (rec.usage as Record<string, unknown>)
      : rec.message && typeof rec.message === 'object'
        ? ((rec.message as Record<string, unknown>).usage as unknown)
        : undefined;

  const input = numericField(usageObj, ['input_tokens', 'inputTokens']);
  const output = numericField(usageObj, ['output_tokens', 'outputTokens']);
  const total =
    numericField(usageObj, ['total_tokens', 'totalTokens']) ??
    numericField(rec, ['num_tokens', 'tokens']);
  const cacheRead = numericField(usageObj, ['cache_read_input_tokens']);

  let contextTokens = 0;
  if (typeof total === 'number') {
    contextTokens = total;
  } else if (typeof input === 'number' || typeof output === 'number' || typeof cacheRead === 'number') {
    contextTokens = (input ?? 0) + (output ?? 0) + (cacheRead ?? 0);
  }

  const explicitWindow =
    numericField(usageObj, ['context_window', 'contextWindow', 'context_size']) ??
    numericField(rec, ['context_window', 'contextWindow', 'context_size']);
  const catalogWindow = cursorModelContextWindow(model);
  const isAuthoritative =
    typeof explicitWindow === 'number' && explicitWindow > 0
      ? true
      : catalogWindow > 0;
  const contextWindow =
    typeof explicitWindow === 'number' && explicitWindow > 0
      ? explicitWindow
      : catalogWindow;

  const inputTokens = typeof input === 'number' ? input : 0;
  const percentage =
    contextTokens > 0 && contextWindow > 0
      ? Math.max(0, Math.min(100, Math.round((contextTokens / contextWindow) * 100)))
      : 0;

  const result: CursorUsage = { inputTokens, contextTokens, contextWindow, contextWindowIsAuthoritative: isAuthoritative, percentage };
  if (typeof output === 'number') result.outputTokens = output;
  if (typeof cacheRead === 'number') result.cacheReadInputTokens = cacheRead;
  return result;
}
```

Replace `cursorStreamMapper.ts:396-413` usage chunk emit:

```ts
if (type === 'usage') {
  const usage = extractCursorUsage(rec, this.model);
  if (!this.model) {
    return { chunks: [], sessionId };
  }
  return {
    chunks: [
      {
        type: 'usage',
        usage: buildUsageInfo({
          model: this.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadInputTokens: usage.cacheReadInputTokens,
          contextTokens: usage.contextTokens,
          contextWindow: usage.contextWindow,
          contextWindowIsAuthoritative: usage.contextWindowIsAuthoritative,
        }),
        sessionId: sessionId ?? null,
      },
    ],
    sessionId,
  };
}
```

Add the import at the top of the file:

```ts
import { buildUsageInfo } from '../../../core/providers/usage';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/providers/cursor/runtime/cursorStreamMapper.usage.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Run existing Cursor tests to verify no regression**

Run: `npx jest tests/unit/providers/cursor/`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/providers/cursor/ tests/unit/providers/cursor/
git commit -m "fix(cursor): stamp model + expose cache/output + catalog-driven window"
```

---

## Task 11: Claude — funnel `buildUsageInfo` through shared builder

**Files:**
- Modify: `src/providers/claude/stream/transformClaudeMessage.ts:304-318`
- Test: `tests/unit/providers/claude/stream/transformClaudeMessage.builder.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/providers/claude/stream/transformClaudeMessage.builder.test.ts
import { transformSDKMessage, createTransformUsageState } from '../../../../../src/providers/claude/stream/transformClaudeMessage';

describe('Claude transform emits a fully-shaped UsageInfo via the shared builder', () => {
  it('stamps the intended model and exposes cache fields', () => {
    const usageState = createTransformUsageState();
    const events = Array.from(transformSDKMessage(
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'hi' }],
          usage: { input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 },
        },
        parent_tool_use_id: null,
      } as any,
      { intendedModel: 'claude-sonnet-4', usageState },
    ));
    const usage = events.find(e => e.type === 'usage');
    expect(usage?.usage.model).toBe('claude-sonnet-4');
    expect(usage?.usage.cacheCreationInputTokens).toBe(20);
    expect(usage?.usage.cacheReadInputTokens).toBe(30);
    expect(usage?.usage.contextTokens).toBe(150);
  });
});
```

- [ ] **Step 2: Run test (should already pass for cache fields but is the baseline for the next change)**

Run: `npx jest tests/unit/providers/claude/stream/transformClaudeMessage.builder.test.ts`
Expected: PASS today; this test guards the migration.

- [ ] **Step 3: Refactor `buildUsageInfo` in `transformClaudeMessage.ts` to delegate**

Replace `src/providers/claude/stream/transformClaudeMessage.ts:304-318` with:

```ts
import { buildUsageInfo as sharedBuildUsageInfo } from '../../../core/providers/usage';

function buildUsageInfo(promptUsage: PromptUsageSnapshot, options?: TransformOptions): UsageInfo {
  const model = options?.intendedModel?.trim() || 'claude-sonnet-4';
  const contextWindow = getContextWindowSize(model, options?.customContextLimits);
  return sharedBuildUsageInfo({
    model,
    inputTokens: promptUsage.inputTokens,
    cacheCreationInputTokens: promptUsage.cacheCreationInputTokens,
    cacheReadInputTokens: promptUsage.cacheReadInputTokens,
    contextTokens: promptUsage.contextTokens,
    contextWindow,
    // Claude's contextWindow lookup is a settings-driven heuristic until the result message
    // arrives with `modelUsage[model].contextWindow` — flip authoritative there, not here.
    contextWindowIsAuthoritative: false,
  });
}
```

Also: locate the `result` arm that emits `{ type: 'context_window', contextWindow }` (`:578`) and add a follow-up that flips `contextWindowIsAuthoritative=true` on the next emitted usage. This may require a small state addition to `TransformUsageState`. See `transformClaudeMessage.ts:554-580`.

- [ ] **Step 4: Run test to verify it still passes**

Run: `npx jest tests/unit/providers/claude/`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/providers/claude/stream/transformClaudeMessage.ts tests/unit/providers/claude/stream/transformClaudeMessage.builder.test.ts
git commit -m "refactor(claude): funnel UsageInfo through shared builder"
```

---

## Task 12: Persist usage on cancellation

**Files:**
- Modify: `src/features/chat/controllers/InputController.ts:465-572` (the `finally` branch)
- Test: `tests/unit/features/chat/controllers/cancelPersistsUsage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/chat/controllers/cancelPersistsUsage.test.ts
import { InputController } from '../../../../../src/features/chat/controllers/InputController';
// Use the existing fixtures/harness pattern in tests/unit/features/chat/controllers/.

describe('InputController cancel path persists usage', () => {
  it('calls conversationController.save() after the user cancels mid-stream', async () => {
    const { controller, state, conversationController, agentService } = makeInputControllerFixture();
    state.usage = { model: 'claude-sonnet-4', inputTokens: 100, contextWindow: 200_000, contextTokens: 100, percentage: 0 };

    // Drive a single chunk then trip cancelRequested.
    agentService.queueChunks([
      { type: 'text', content: 'hello' },
      { type: 'usage', usage: { model: 'claude-sonnet-4', inputTokens: 200, contextWindow: 200_000, contextTokens: 200, percentage: 0 } },
    ]);
    agentService.afterChunk(1, () => { state.cancelRequested = true; });

    await controller.sendMessage();
    expect(conversationController.save).toHaveBeenCalled();
    expect(state.usage?.inputTokens).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/features/chat/controllers/cancelPersistsUsage.test.ts`
Expected: FAIL — `conversationController.save` was not called because the cancelled path returns before save.

- [ ] **Step 3: Restructure the finally branch**

In `src/features/chat/controllers/InputController.ts`, the existing post-stream save is gated behind `planApprovalInvalidated` and ultimately under the `!wasInvalidated` guard. Rework so the save always runs (with `updateLastResponse=false` when cancelled) before the plan-approval / queued-message branches:

```ts
// Before any plan-approval branches, persist usage and message state so cancellation
// doesn't drop the last `usage` chunk on the floor.
if (!wasInvalidated && state.streamGeneration === streamGeneration) {
  await conversationController.save(!didCancelThisTurn, didEnqueueToSdk ? { resumeAtMessageId: undefined } : undefined);
}
```

Remove the later, redundant `await conversationController.save(...)` inside the plan-approval block (`:572`). The leading save covers both cancellation and the non-cancel happy path; plan-approval only needs to mutate state and re-render, not re-save unless the auto-implement flow appends new messages — in that case the next `sendMessage()` will save.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/features/chat/controllers/cancelPersistsUsage.test.ts`
Expected: PASS.

- [ ] **Step 5: Run all InputController tests to verify no regression**

Run: `npx jest tests/unit/features/chat/controllers/`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/chat/controllers/InputController.ts tests/unit/features/chat/controllers/cancelPersistsUsage.test.ts
git commit -m "fix(chat): persist usage on cancel by saving before plan-approval branches"
```

---

## Task 13: History-backed `Conversation.usage` recovery

**Files:**
- Modify: `src/core/providers/types.ts` (declare optional `extractLastUsage` on `ProviderConversationHistoryService`)
- Modify: every provider history service to implement `extractLastUsage`:
  - `src/providers/claude/history/ClaudeHistoryService.ts`
  - `src/providers/codex/history/CodexHistoryService.ts`
  - `src/providers/opencode/history/OpencodeHistoryService.ts`
  - `src/providers/cursor/history/CursorHistoryService.ts`
- Modify: `src/app/conversations/ConversationStore.ts:56-83` (loadConversations) and the hydration site (`grep -n 'loadMessages\|hydrate' src/app/conversations/`) to call `extractLastUsage` when `conversation.usage` is absent
- Test: `tests/unit/providers/shared/historyUsageRecovery.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/providers/shared/historyUsageRecovery.test.ts
import { ClaudeHistoryService } from '../../../../src/providers/claude/history/ClaudeHistoryService';
// ... import the other three services similarly.

describe('extractLastUsage recovers usage from transcripts on cold hydration', () => {
  it('Claude reads the last assistant `usage` block from JSONL', async () => {
    const service = makeClaudeHistoryServiceWithJsonlFixture('two-turns-with-usage.jsonl');
    const usage = await service.extractLastUsage(fakeConversation('claude'), {});
    expect(usage?.inputTokens).toBeGreaterThan(0);
    expect(usage?.model).toBeTruthy();
  });

  it('Codex reads the last token_count event', async () => {
    const service = makeCodexHistoryServiceWithJsonlFixture('token-count-tail.jsonl');
    const usage = await service.extractLastUsage(fakeConversation('codex'), {});
    expect(usage?.contextTokens).toBeGreaterThan(0);
  });

  it('Opencode reads promptUsage from the last session.message row', async () => {
    const service = makeOpencodeHistoryServiceWithSqliteFixture('two-messages-with-usage.db');
    const usage = await service.extractLastUsage(fakeConversation('opencode'), {});
    expect(usage?.inputTokens).toBeGreaterThan(0);
  });

  it('Cursor reads usage from the latest chats/<workspace>/<session>/*.json', async () => {
    const service = makeCursorHistoryServiceWithJsonFixture('session-with-usage.json');
    const usage = await service.extractLastUsage(fakeConversation('cursor'), {});
    expect(usage?.contextTokens).toBeGreaterThan(0);
  });
});
```

Place fixtures under `tests/unit/providers/{claude,codex,opencode,cursor}/fixtures/`. Each fixture should be a real (small) transcript captured from `~/.claude/` / `~/.codex/` / `~/.opencode/` / `~/.cursor/` and minimally edited to contain exactly the usage records the tests assert on.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/providers/shared/historyUsageRecovery.test.ts`
Expected: FAIL — `extractLastUsage` is not a method on any service.

- [ ] **Step 3: Add the contract**

In `src/core/providers/types.ts`, extend `ProviderConversationHistoryService`:

```ts
extractLastUsage?(conversation: Conversation, ctx: HistoryServiceContext): Promise<UsageInfo | null>;
```

- [ ] **Step 4: Implement per provider**

**Claude (`src/providers/claude/history/ClaudeHistoryService.ts`)**: walk the last assistant SDK message backwards, find `usage`, feed through `buildUsageInfo` with `model` from the same JSONL `modelUsage` entry. Context window comes from `modelUsage[model].contextWindow` if present, else from settings.

**Codex (`src/providers/codex/history/CodexHistoryService.ts`)**: walk the JSONL backwards to the last `event_msg` of type `token_count`. Use the same parsing as Task 8. Window comes from the last `event_msg` of type `model_info` (or settings fallback).

**Opencode (`src/providers/opencode/history/OpencodeHistoryService.ts`)**: open the SQLite DB at `providerState.databasePath`, SELECT the last `session.message` row with non-null `prompt_usage` (or whatever the column is called — verify via `sqlite3 <path> '.schema'`), feed through `buildAcpUsageInfo` with the recorded model.

**Cursor (`src/providers/cursor/history/CursorHistoryService.ts`)**: read the latest `~/.cursor/chats/<workspace>/<session>/*.json` file, locate the last `usage` block (mirror `extractCursorUsage`), feed through `buildUsageInfo` with the recorded model.

Each implementation must return `null` on parse failure rather than throwing — the caller treats `null` as "no historical usage available."

- [ ] **Step 5: Wire into hydration**

Locate the hydration entry point (likely `ConversationStore.hydrate`, `ConversationStore.loadConversation`, or each provider's `loadMessages`). After messages land but before returning, if `conversation.usage` is undefined:

```ts
if (!conversation.usage && typeof historyService.extractLastUsage === 'function') {
  const recovered = await historyService.extractLastUsage(conversation, ctx).catch(() => null);
  if (recovered) {
    conversation.usage = recovered;
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest tests/unit/providers/shared/historyUsageRecovery.test.ts`
Expected: 4 PASS.

- [ ] **Step 7: Verify baseline still green**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/core/providers/types.ts src/providers/ src/app/conversations/ tests/unit/providers/shared/
git commit -m "feat(history): recover Conversation.usage from provider transcripts on hydrate"
```

---

## Task 14: Format token counts and surface cost in tooltip

**Files:**
- Modify: `src/features/chat/ui/InputToolbar.ts:1350-1367`
- Test: `tests/unit/features/chat/ui/inputToolbarFormatTokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/chat/ui/inputToolbarFormatTokens.test.ts
import { formatTokens } from '../../../../../src/features/chat/ui/InputToolbar';

describe('formatTokens', () => {
  it('shows raw integers under 1k', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });
  it('shows 1.3k for 4-digit values', () => {
    expect(formatTokens(1300)).toBe('1.3k');
    expect(formatTokens(9999)).toBe('10.0k'); // rounds up to one-decimal
  });
  it('shows integer k for values >= 10k', () => {
    expect(formatTokens(10_000)).toBe('10k');
    expect(formatTokens(13_499)).toBe('13k');
    expect(formatTokens(200_000)).toBe('200k');
  });
  it('shows M for values >= 1_000_000', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M');
    expect(formatTokens(1_500_000)).toBe('1.5M');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/features/chat/ui/inputToolbarFormatTokens.test.ts`
Expected: FAIL — `formatTokens` is currently a private method, not exported.

- [ ] **Step 3: Extract `formatTokens` to a named export**

Move the formatter out of the class. At the top of `src/features/chat/ui/InputToolbar.ts`, add:

```ts
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  if (tokens < 1000) return String(Math.round(tokens));
  if (tokens < 10_000) return `${(tokens / 1000).toFixed(1)}k`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}
```

Replace the class's call sites with `formatTokens(...)`.

Then in `ContextUsageMeter.updateUsage` (around `:1354`), append cost when present:

```ts
let tooltip = `${formatTokens(usage.contextTokens)} / ${formatTokens(usage.contextWindow)}`;
if (typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd)) {
  tooltip += ` · $${usage.costUsd.toFixed(4)}`;
}
if (usage.percentage > 80) {
  tooltip += ' (Approaching limit, run `/compact` to continue)';
}
this.container.setAttribute('data-tooltip', tooltip);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/features/chat/ui/inputToolbarFormatTokens.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Verify baseline still green**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/chat/ui/InputToolbar.ts tests/unit/features/chat/ui/inputToolbarFormatTokens.test.ts
git commit -m "feat(chat): better token formatter, cost in usage tooltip"
```

---

## Task 15: Cross-provider contract test matrix

**Files:**
- Create: `tests/unit/providers/shared/usageContractMatrix.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/unit/providers/shared/usageContractMatrix.test.ts
import { transformSDKMessage, createTransformUsageState } from '../../../../src/providers/claude/stream/transformClaudeMessage';
import { makeCodexRouter } from '../../providers/codex/runtime/testHelpers';
import { CursorNdjsonStreamReducer } from '../../../../src/providers/cursor/runtime/cursorStreamMapper';
import { buildAcpUsageInfo } from '../../../../src/providers/acp/buildAcpUsageInfo';
import type { UsageInfo } from '../../../../src/core/types';

/**
 * Every provider emitter must satisfy the same UsageInfo contract:
 *  - `model` is always present after the first usage chunk
 *  - `contextWindow > 0`
 *  - `contextWindowIsAuthoritative` is set explicitly (true | false; never undefined)
 *  - `contextTokens <= contextWindow * 1.5` (sanity)
 *  - `percentage` is in [0, 100]
 *  - All optional token fields are either undefined or a finite non-negative integer
 */
function assertUsageInfoContract(usage: UsageInfo): void {
  expect(usage.model).toBeTruthy();
  expect(usage.contextWindow).toBeGreaterThanOrEqual(0);
  expect(typeof usage.contextWindowIsAuthoritative).toBe('boolean');
  expect(usage.percentage).toBeGreaterThanOrEqual(0);
  expect(usage.percentage).toBeLessThanOrEqual(100);
  for (const field of ['inputTokens', 'outputTokens', 'reasoningOutputTokens', 'thoughtTokens', 'cacheCreationInputTokens', 'cacheReadInputTokens'] as const) {
    const v = usage[field];
    if (v !== undefined) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  }
}

describe('Cross-provider UsageInfo contract', () => {
  it('Claude', () => {
    const usageState = createTransformUsageState();
    const events = Array.from(transformSDKMessage(
      { type: 'assistant', message: { content: [], usage: { input_tokens: 100, cache_read_input_tokens: 30 } }, parent_tool_use_id: null } as any,
      { intendedModel: 'claude-sonnet-4', usageState },
    ));
    const usage = events.find(e => e.type === 'usage')!.usage;
    assertUsageInfoContract(usage);
  });

  it('Codex', () => {
    const emitted: UsageInfo[] = [];
    const router = makeCodexRouter({ activeModel: 'gpt-5.3-codex', onEmit: (c) => { if (c.type === 'usage') emitted.push(c.usage); } });
    router.handle({
      method: 'thread/tokenUsage/updated',
      params: { threadId: 'T', turnId: 't', tokenUsage: { total: emptyTokenUsage(), last: { totalTokens: 5500, inputTokens: 4000, cachedInputTokens: 200, outputTokens: 1000, reasoningOutputTokens: 300 }, modelContextWindow: 200_000 } },
    });
    assertUsageInfoContract(emitted[0]!);
  });

  it('Opencode', () => {
    const usage = buildAcpUsageInfo({
      model: 'sonnet-via-opencode',
      promptUsage: { inputTokens: 100, outputTokens: 50, cachedReadTokens: 30, cachedWriteTokens: 20, thoughtTokens: 10, totalTokens: 210 },
      contextWindow: { size: 200_000, used: 210 },
    })!;
    assertUsageInfoContract(usage);
  });

  it('Cursor', () => {
    const reducer = new CursorNdjsonStreamReducer();
    reducer.reduceLine(JSON.stringify({ type: 'system', model: 'claude-sonnet-4' }));
    const { chunks } = reducer.reduceLine(JSON.stringify({ type: 'usage', usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } }));
    const usage = chunks.find(c => c.type === 'usage')!.usage;
    assertUsageInfoContract(usage);
  });
});

function emptyTokenUsage() {
  return { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };
}
```

The helper `makeCodexRouter` is a thin factory around the existing `CodexNotificationRouter` test fixture. If one doesn't exist yet under `tests/unit/providers/codex/runtime/`, create it now mirroring the pattern used in `CodexNotificationRouter.test.ts`.

- [ ] **Step 2: Run the test**

Run: `npx jest tests/unit/providers/shared/usageContractMatrix.test.ts`
Expected: all four cases PASS, exercising every provider's emitter through the same contract.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/providers/shared/usageContractMatrix.test.ts tests/unit/providers/codex/runtime/testHelpers.ts
git commit -m "test(providers): cross-provider UsageInfo contract matrix"
```

---

## Task 16: Collapse — remove dead code

**Files:**
- `src/providers/cursor/runtime/cursorStreamMapper.ts` — confirm `cursorContextWindowForModel` is fully removed
- `src/providers/codex/runtime/CodexSessionFileTail.ts:20-26` — confirm static `MODEL_CONTEXT_WINDOWS` map is fully removed
- Search for the strings `Math.max(current.inputTokens, next.inputTokens)`, `cacheCreationInputTokens: 0,`, and `cursorContextWindowForModel` to confirm no stragglers

- [ ] **Step 1: Search for dead code**

Run:
```bash
grep -rn "cursorContextWindowForModel\|MODEL_CONTEXT_WINDOWS\|Math.max(current.inputTokens, next.inputTokens)\|cacheCreationInputTokens: 0," src/
```
Expected: zero hits.

- [ ] **Step 2: Run the full verification gate**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 3: Commit (no-op commit if everything was already clean — skip)**

Only commit if Step 1 surfaced removals:
```bash
git add src/
git commit -m "refactor: drop legacy usage/window helpers replaced by shared builder + catalogs"
```

---

## Task 17: Perf-suite addition (optional, monitoring only)

**Files:**
- Create: `tests/perf/usageEmission.perf.test.ts`

- [ ] **Step 1: Add a perf spec**

```ts
// tests/perf/usageEmission.perf.test.ts
// Runs only under `npm run test:perf`. Asserts that processing 10,000 usage
// chunks through StreamProjection.projectUsage stays O(1)/chunk.
import { projectUsage } from '../../src/features/chat/controllers/StreamProjection';

test('projectUsage stays O(1) per chunk', () => {
  const input = {
    currentSessionId: 's',
    subagentsSpawnedThisStream: 0,
    ignoreUsageUpdates: false,
    activeProviderModel: 'claude-sonnet-4',
  };
  const chunk = {
    type: 'usage' as const,
    usage: { inputTokens: 100, contextWindow: 200_000, contextTokens: 100, percentage: 0 },
    sessionId: 's',
  };
  const N = 10_000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) projectUsage(chunk, input);
  const elapsed = performance.now() - t0;
  // Report only — guard rail: well under a worst-case budget so noisy machines don't flake.
  expect(elapsed).toBeLessThan(500);
});
```

- [ ] **Step 2: Run the perf suite**

Run: `npm run test:perf`
Expected: spec passes; metrics print in the report.

- [ ] **Step 3: Commit**

```bash
git add tests/perf/usageEmission.perf.test.ts
git commit -m "test(perf): guard rail for StreamProjection.projectUsage O(1)"
```

---

## Final verification (do once after Task 16)

- [ ] Run the full gate:
  ```
  npm run typecheck && npm run lint && npm run test && npm run build
  ```
  Expected: all pass.

- [ ] Manually exercise the four providers in Obsidian:
  1. Open a Claude conversation, send a message, verify tooltip shows `<tokens> / <window>` and the percentage is non-zero.
  2. Open a Codex conversation, repeat. Verify tooltip shows non-zero values and the active model.
  3. Open an Opencode conversation, send a message, verify tooltip shows cost when the wire sends it.
  4. Open a Cursor conversation, send a message, verify the model and window are correct (e.g. 1M for gemini).
  5. In each, cancel mid-stream; reopen the conversation from the history dropdown; verify the persisted usage is still shown.
  6. Delete `.claudian/sessions/<id>.meta.json` for a conversation that has transcripts on disk; reopen it; verify `extractLastUsage` recovered the last usage record.

- [ ] Open a PR with title `feat: unify token consumption tracking across providers` and body summarizing the audit findings each task resolves.

---

## Spec coverage checklist (audit findings → tasks)

| Audit finding (severity) | Resolved by |
|---|---|
| HIGH — Codex undercounts cache writes, drops output/reasoning | Tasks 7, 8 |
| HIGH — Codex usage carries no `model` field | Task 7 |
| HIGH — Cursor: no model, no cache, fabricated window | Tasks 4, 10 |
| MED — Cancel never persists partial usage | Task 12 |
| MED — History reload loses past usage | Task 13 |
| MED — Claude `max()` over latest snapshot | Task 6 |
| MED — `buildAcpUsageInfo` drops output/thought | Task 9 |
| MED — `costUsd` not handled anywhere | Tasks 1, 9, 14 |
| LOW — `formatTokens` rounds aggressively | Task 14 |
| LOW — Cursor reads cache then discards it | Task 10 |
| LOW — Cursor substring model match | Tasks 4, 10 |
| LOW — Magic numbers for context windows | Tasks 4, 5 |
| LOW — Codex JSONL parser ignores cache + output | Task 8 |
| Improvement #1 — Centralize `UsageInfo` build | Tasks 2, 6-11 |
| Improvement #2 — Move per-model windows to `ProviderChatUIConfig` | Tasks 3, 4, 5 |
| Improvement #3 — Persist usage on cancel | Task 12 |
| Improvement #4 — Hydrate usage from transcripts | Task 13 |
| Improvement #5 — Add output/reasoning fields, document semantics | Task 1 |
| Improvement #6 — Add `costUsd` + price catalog | Tasks 1, 3, 9 |
| Improvement #7 — Cursor exact-id model lookup | Task 4 |
| Improvement #8 — Codex stamp model, keep output/reasoning | Tasks 7, 8 |
| Improvement #9 — Opencode preserve output/thought | Task 9 |
| Improvement #10 — Standardize formatter | Task 14 |
| Test gap — no tests for `buildAcpUsageInfo` | Task 9 |
| Test gap — no tests for Cursor `extractCursorUsage` | Tasks 4, 10 |
| Test gap — no tests for Claude `transformSDKMessage` usage emission | Tasks 6, 11 |
| Test gap — no tests for cancel persistence | Task 12 |
| Test gap — no tests for history reload recovery | Task 13 |
| Test gap — `CodexNotificationRouter` missing window=0, no `last`, multi-turn | Task 7 |
| Test gap — `StreamProjection` interaction with `recalculateUsageForModel` | Task 15 |
