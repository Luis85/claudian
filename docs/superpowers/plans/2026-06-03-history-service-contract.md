---
title: History service contract — outcome-typed hydration
date: 2026-06-03
status: shipped
parent: Core/Providers
scope: src/core/providers, src/providers/*/history, src/app/conversations
---
# History service contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the silent `Promise<void>` `ProviderConversationHistoryService` contract with an outcome-typed seam, fold the three divergent error-signalling patterns (Cursor side-channel, Opencode sentinel message, Claude/Codex silent return) into one `HistoryLoadOutcome` discriminated union, lift the duplicated hydration cache into a shared `BaseHistoryService`, and gate fork helpers behind `capabilities.supportsFork` so providers that do not support fork stop shipping no-op stubs.

**Sequencing discipline (read first):** This plan is **additive-then-collapse**. Tasks 1-12 land the new v2 methods alongside the existing v1 methods, with v1 marked `@deprecated`. Every commit boundary leaves `npm run typecheck && npm run lint && npm run test && npm run build` green so each task can ship as its own PR. Task 13 collapses v1 only after every caller and every test is on v2. Do not skip ahead to Task 13.

---

## Status: shipped

Merged to `main` via **PR #26** (merge commit `71d1f05`). All 13 tasks landed; the full plan body below is preserved as the implementation record.

**Review-driven fixes applied after the initial implementation** (Codex review on the PR):

- `523356b` — `MessageRenderer` holds the hydration-failure banner in state and re-renders it from `renderMessages`, so it survives the `restoreConversation → renderMessages` (`messagesEl.empty()`) that runs right after the failure is emitted; and Cursor's `node:sqlite` open failure is classified by Node's structured error `code` (`MODULE_NOT_FOUND` / `ERR_UNKNOWN_BUILTIN_MODULE`) rather than a brittle message regex, so the Node-20 "No such built-in module" case maps to `sqlite-unavailable`.
- `17d7dab` — `BaseHistoryService` recomputes the cache key **after** `loadMessages`, so a source resolved mid-load (Codex backfilling `sessionFilePath` from a bare `threadId`) seeds the cache instead of forcing the next hydration to reparse.
- `a56240c` — the hydration-failure banner is stashed by conversation id and rendered in `restoreConversation` once the tab is **bound** (the emit-time `tab.conversationId` lookup missed for current-tab switches and freshly created tabs).
- `4587693` — `CodexConversationHistoryService.computeCacheKey` returns `null` for forks (pending or established), so forks never serve a stale `fork::<threadId>`-keyed merge from the generic cache; the merge re-runs on every open.

**Non-blocking followups still open** (tracked here, not done in this PR):

1. Rename `hydrateConversationHistoryV2` → `hydrateConversationHistory` (the `V2` suffix is post-migration debt now that v1 is gone).
2. Update the stale comment at `src/features/chat/tabs/TabManager.ts:713` to reflect the new `inflight` dedupe.
3. Add an `assertNever`-style exhaustiveness guard on the `loadSdkMessagesForConversation` outcome switch.
4. Drop the `as unknown as ProviderConversationHistoryService` casts at registration sites once the `TPersistedState` generic-variance is resolved.

**Architecture:**

(a) **Outcome value.** Every `hydrate*V2` and `delete*V2` call returns a discriminated union (`loaded` | `cached` | `empty` | `error` for hydration; `deleted` | `no-op` | `error` for deletion) carrying a typed `HistoryLoadErrorCode`, a redacted user-safe `message`, and a debug-only `detail`. Callers (`ConversationStore`, `TabManager`) branch on `kind` rather than reaching past the interface or probing `conversation.messages.length`. This kills three things in one move: Cursor's out-of-band `getLastHistoryLoadError(conversationId)` getter (currently dead in production but exported from the class), Opencode's `createOpencodeHydrationDiagnosticMessage` sentinel-as-message pattern that pollutes the rendered transcript, and Claude/Codex's silent bail on partial-load failure that leaves users staring at an empty pane.

(b) **`BaseHistoryService` abstract.** Lifts the three near-identical `Map<convId, hydrationKey>` caches (Cursor `hydratedConversationKeys`, Opencode `hydratedKeys`, Codex `hydratedConversationPaths`) and the one `Set<convId>` variant (Claude `hydratedConversationIds`) into a single `private hydrationCache = new Map<string, string>()` owned by the base. The base also dedupes concurrent hydrations through an `inflight` map so a rapid tab-switch storm cannot race two `loadMessages` calls into one `conversation.messages` assignment. Subclasses implement `computeCacheKey(c, ctx)` and `loadMessages(c, ctx)`; the base handles abort-signal checks, `forceRefresh` bypass, cache invalidation on `empty`/`error`, and the `cached` short-circuit. **The base never writes `conversation.messages` — the outcome is returned and the caller (`ConversationStore`) owns the assignment** so the loaded/error asymmetry that would otherwise stale-render an error pane never exists. Provider-specific hydration logic (Claude's previous-session walk, Codex's fork-source merge, Opencode's SQLite read, Cursor's two-hash candidate sweep) stays in `loadMessages`.

(c) **Capability-aligned fork split.** `isPendingForkConversation` and `buildForkProviderState` move off the base contract into an optional `forkSupport?: ProviderForkSupport` slot. Claude and Codex implement it; Opencode and Cursor omit it. A registry invariant test asserts `capabilities.supportsFork === !!service.forkSupport` so the boolean cannot drift from the runtime shape. A `hasForkSupport(service)` type guard narrows the optional slot at every call site so the `TabManager.ts:642` fork-state assembly compiles only inside the guard — no runtime "Provider does not support fork" throw is reachable. `buildPersistedProviderState` is generic in `TPersistedState` so each provider pins its concrete state type (`ClaudeProviderState`, `CodexProviderState`, `OpencodeProviderState`, `CursorProviderState`) instead of returning `Record<string, unknown>`.

**Tech Stack:** TypeScript 5; Jest (`npm run test`); Node `node:sqlite` (externalized — current handle-close pattern in `cursorHistoryStore.ts:269` is the reference); Obsidian plugin API. No new runtime deps.

---

## Pre-flight (do once before Task 1)

- [ ] **Verify the baseline is green.**

  Run: `npm run typecheck && npm run lint && npm run test && npm run build`
  Expected: all four exit 0. If any fails, fix the failure first — do not start against a red baseline.

- [ ] **Create the worktree if not already in one.** See `superpowers:using-git-worktrees`. Branch name: `core/history-service-contract`. **Do not place the worktree under the Obsidian vault directory** — nested vaults confuse Obsidian's plugin loader. Place it outside the vault root.

---

## File Structure

**Created:**
- `src/core/providers/BaseHistoryService.ts` — abstract base implementing cache, abort, force-refresh, and concurrent-hydration dedupe
- `src/features/chat/hydration/hydrationFailedSubscriber.ts` — subscribes to `conversation:hydration-failed`, renders an Obsidian `Notice` plus an inline banner in the conversation pane
- `tests/unit/core/providers/historyServiceTypes.test.ts` — type-only test asserting the new types compile and narrow on `kind`
- `tests/unit/core/providers/BaseHistoryService.test.ts` — base-class behavior under fakes (cache, abort, refresh, dedupe, never-mutates-messages)
- `tests/unit/providers/shared/historyServiceContract.test.ts` — parameterized contract matrix across all 4 providers
- `tests/unit/core/providers/forkSupportInvariant.test.ts` — `capabilities.supportsFork === !!service.forkSupport`
- `tests/unit/features/chat/hydration/hydrationFailedSubscriber.test.ts` — asserts Notice + banner render on the event
- `tests/unit/core/providers/historyServiceStateTyping.test.ts` — type-only test that each impl pins its concrete `TPersistedState`

**Modified:**
- `src/core/providers/types.ts:461-480` — add `HydrationContext`, `HistoryLoadError`, `HistoryLoadErrorCode`, `HistoryLoadOutcome`, `DeleteHistoryOutcome`, `ProviderForkSupport`, generic `<TPersistedState>` parameter, and the v2 methods alongside v1
- `src/providers/claude/history/ClaudeConversationHistoryService.ts:313-446` — extend `BaseHistoryService<ClaudeProviderState>`; implement v2; bridge v1 to v2; move fork helpers into `forkSupport`
- `src/providers/codex/history/CodexConversationHistoryService.ts:25-212` — extend `BaseHistoryService<CodexProviderState>`; implement v2; bridge v1 to v2; move fork helpers into `forkSupport`; wire `fork-checkpoint-not-found`
- `src/providers/cursor/history/CursorConversationHistoryService.ts:16-127` — extend `BaseHistoryService<CursorProviderState>`; implement v2; bridge v1 to v2; remove `getLastHistoryLoadError`; remove stub fork helpers; convert two-hash delete sweep to `DeleteHistoryOutcome.paths`
- `src/providers/opencode/history/OpencodeConversationHistoryService.ts:9-84` — extend `BaseHistoryService<OpencodeProviderState>`; implement v2; bridge v1 to v2; replace sentinel-message diagnostic with `HistoryLoadOutcome.error`; remove stub fork helpers
- `src/providers/opencode/history/OpencodeHistoryStore.ts:42-64` — change `loadOpencodeSessionMessages` return type to `{ messages: ChatMessage[]; error?: HistoryLoadError }`; drop sentinel injection in the rows-null path; wire `sqlite-unavailable` at the `node:sqlite` failure path (lines 482-488)
- `src/providers/cursor/history/cursorHistoryStore.ts:159-167` — surface `sqlite-unavailable` at `openCursorSqliteReadonly` failure path
- `src/app/conversations/ConversationStore.ts:144-158` — branch on `DeleteHistoryOutcome`; passes `HydrationContext`
- `src/app/conversations/ConversationStore.ts:204` — call `service.forkSupport?.isPendingForkConversation(c) ?? false` via the `hasForkSupport` guard
- `src/app/conversations/ConversationStore.ts:247-251` — pass `HydrationContext`, branch on `HistoryLoadOutcome`, own `conversation.messages = outcome.messages` assignment on the `loaded` arm, emit `conversation:hydration-failed` on the `error` arm
- `src/features/chat/tabs/TabManager.ts:642` — gate `buildForkProviderState` behind `hasForkSupport(service)` type guard (no runtime throw)
- `tests/unit/providers/cursor/history/CursorConversationHistoryService.test.ts` — drop `getLastHistoryLoadError` describe block; pass `HydrationContext` to delete-session tests

**Deleted (Task 13 only — after v1 collapse):**
- `src/providers/opencode/history/OpencodeHistoryStore.ts:301-303` — `export function isOpencodeSessionHydrationDiagnosticMessage` (internal-only after Task 4)
- `src/providers/opencode/history/OpencodeHistoryStore.ts:265-289` — `createOpencodeHydrationDiagnosticMessage`
- v1 methods (`hydrateConversationHistory(c, vaultPath)`, `deleteConversationSession(c, vaultPath)`, `isPendingForkConversation`, `buildForkProviderState`) on the interface and all four impl bridges

**NOT touched (verified):**
- `src/core/bootstrap/SessionStorage.ts:97-99` — calls `buildPersistedProviderState?(conv)`; remains optional with the same shape after generic-param erasure at the registry boundary; no change required.
- `src/features/chat/tabs/tabControllers.ts:84-87` — calls `resolveSessionIdForConversation(conv)`; unchanged across v1/v2; no change required.

**NOT touched (deferred):**
- `listNativeSessions` capability for "show provider-native sessions outside any conversation" (deferred — different read path, not the per-conversation hydration seam)
- Codex live-tail subscribe hook on top of `BaseHistoryService` (deferred — Codex already streams via raw JSON-RPC; tailing the JSONL file is a separate concern from the snapshot hydration this plan covers)
- Telemetry hookup for `HistoryLoadError.code` (deferred — once the outcome value exists, telemetry plumbing is a one-line subscriber and belongs in a follow-up that owns the metric naming/redaction policy)
- `~/.codex` transcript deletion (out of scope; current `deleteConversationSession` no-op stays — Codex transcripts are provider-owned by design, see `src/providers/codex/CLAUDE.md`)

---

## Task 1: Add additive types to `src/core/providers/types.ts`

This task lands the type vocabulary only. The existing `ProviderConversationHistoryService` interface is **not modified yet** — v1 methods stay intact so the build stays green. Task 2 adds v2 methods alongside v1.

**Files:**
- Modify: `src/core/providers/types.ts` (additive — append the new type aliases above the existing interface)
- Test: `tests/unit/core/providers/historyServiceTypes.test.ts` *(create)*

- [ ] **Step 1: Write the failing test.**

  Create `tests/unit/core/providers/historyServiceTypes.test.ts`:

  ```ts
  import type {
    DeleteHistoryOutcome,
    HistoryLoadError,
    HistoryLoadErrorCode,
    HistoryLoadOutcome,
    HydrationContext,
    ProviderForkSupport,
  } from '@/core/providers/types';
  import type { ChatMessage, Conversation } from '@/core/types';

  describe('history service types', () => {
    it('HydrationContext requires vaultPath and reason; signal and forceRefresh are optional', () => {
      const minimal: HydrationContext = { vaultPath: null, reason: 'open' };
      const full: HydrationContext = {
        vaultPath: '/vault',
        signal: new AbortController().signal,
        forceRefresh: true,
        reason: 'reload',
      };
      expect(minimal.reason).toBe('open');
      expect(full.forceRefresh).toBe(true);
    });

    it('HistoryLoadErrorCode includes fork-checkpoint-not-found and sqlite-unavailable', () => {
      const codes: HistoryLoadErrorCode[] = [
        'store-missing',
        'store-unreadable',
        'sqlite-unavailable',
        'parse-failed',
        'invalid-session-id',
        'fork-checkpoint-not-found',
        'cancelled',
      ];
      expect(codes).toHaveLength(7);
    });

    it('HistoryLoadOutcome narrows on kind; sourceRef present on every variant', () => {
      const messages: ChatMessage[] = [];
      const loaded: HistoryLoadOutcome = { kind: 'loaded', messages, sourceRef: 'k1' };
      const cached: HistoryLoadOutcome = { kind: 'cached', sourceRef: 'k1' };
      const empty: HistoryLoadOutcome = { kind: 'empty', reason: 'no-session', sourceRef: null };
      const err: HistoryLoadOutcome = {
        kind: 'error',
        error: { code: 'store-missing', message: 'No store' },
        sourceRef: null,
      };

      function describeOutcome(o: HistoryLoadOutcome): string {
        switch (o.kind) {
          case 'loaded': return `loaded:${o.messages.length}:${o.sourceRef}`;
          case 'cached': return `cached:${o.sourceRef}`;
          case 'empty': return `empty:${o.reason}:${o.sourceRef ?? 'null'}`;
          case 'error': return `error:${o.error.code}:${o.sourceRef ?? 'null'}`;
        }
      }
      expect(describeOutcome(loaded)).toBe('loaded:0:k1');
      expect(describeOutcome(cached)).toBe('cached:k1');
      expect(describeOutcome(empty)).toBe('empty:no-session:null');
      expect(describeOutcome(err)).toBe('error:store-missing:null');
    });

    it('DeleteHistoryOutcome narrows on kind', () => {
      const ok: DeleteHistoryOutcome = { kind: 'deleted', paths: ['/a', '/b'] };
      const noop: DeleteHistoryOutcome = { kind: 'no-op', reason: 'provider-owned' };
      const err: DeleteHistoryOutcome = {
        kind: 'error',
        error: { code: 'invalid-session-id', message: 'bad id' },
      };
      function describeDelete(o: DeleteHistoryOutcome): string {
        switch (o.kind) {
          case 'deleted': return `deleted:${o.paths.length}`;
          case 'no-op': return `no-op:${o.reason}`;
          case 'error': return `error:${o.error.code}`;
        }
      }
      expect(describeDelete(ok)).toBe('deleted:2');
      expect(describeDelete(noop)).toBe('no-op:provider-owned');
      expect(describeDelete(err)).toBe('error:invalid-session-id');
    });

    it('HistoryLoadError shape includes code, user-safe message, optional detail (no recoverable field)', () => {
      const e: HistoryLoadError = {
        code: 'parse-failed',
        message: 'Could not parse session file',
        detail: 'JSON.parse threw at offset 412',
      };
      expect(typeof e.detail).toBe('string');
      // Type-level: 'recoverable' is NOT on HistoryLoadError. Confirm by structural check.
      expect(Object.keys(e)).not.toContain('recoverable');
    });

    it('ProviderForkSupport shape', () => {
      const fork: ProviderForkSupport = {
        isPendingForkConversation(_c: Conversation): boolean { return false; },
        buildForkProviderState(): Record<string, unknown> { return {}; },
      };
      expect(typeof fork.isPendingForkConversation).toBe('function');
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `npm run test -- tests/unit/core/providers/historyServiceTypes.test.ts`
  Expected: FAIL — `HydrationContext`, `HistoryLoadOutcome`, `DeleteHistoryOutcome`, `HistoryLoadError`, `HistoryLoadErrorCode`, `ProviderForkSupport` are not exported from `@/core/providers/types`.

- [ ] **Step 3: Add the additive types to `src/core/providers/types.ts`.**

  Open `src/core/providers/types.ts`. **Append** these declarations immediately above the existing `ProviderConversationHistoryService` block at lines 461-480 (do not modify the interface in this task):

  ```ts
  export interface HydrationContext {
    vaultPath: string | null;
    signal?: AbortSignal;
    forceRefresh?: boolean;
    reason: 'open' | 'reload' | 'tail' | 'fork-resume';
  }

  export type HistoryLoadErrorCode =
    | 'store-missing'
    | 'store-unreadable'
    | 'sqlite-unavailable'
    | 'parse-failed'
    | 'invalid-session-id'
    | 'fork-checkpoint-not-found'
    | 'cancelled';

  export interface HistoryLoadError {
    code: HistoryLoadErrorCode;
    /** Redacted, user-safe summary. Must never embed `os.homedir()` literally. */
    message: string;
    /** Debug-only detail. Logged through the leveled logger, never rendered. */
    detail?: string;
  }

  export type HistoryLoadOutcome =
    | { kind: 'loaded'; messages: ChatMessage[]; sourceRef: string }
    | { kind: 'cached'; sourceRef: string }
    | { kind: 'empty'; reason: 'no-session' | 'no-store' | 'no-rows'; sourceRef: string | null }
    | { kind: 'error'; error: HistoryLoadError; sourceRef: string | null };

  export type DeleteHistoryOutcome =
    | { kind: 'deleted'; paths: string[] }
    | { kind: 'no-op'; reason: 'provider-owned' | 'no-session' }
    | { kind: 'error'; error: HistoryLoadError };

  export interface ProviderForkSupport {
    isPendingForkConversation(conversation: Conversation): boolean;
    buildForkProviderState(
      sourceSessionId: string,
      resumeAt: string,
      sourceProviderState?: Record<string, unknown>,
    ): Record<string, unknown>;
  }
  ```

  Make sure `ChatMessage` is already imported at the top of `types.ts` (it is — see the existing import block at line 7-17).

- [ ] **Step 4: Run the test to verify it passes.**

  Run: `npm run test -- tests/unit/core/providers/historyServiceTypes.test.ts`
  Expected: PASS — all type-level assertions narrow correctly.

- [ ] **Verification gate: `npm run typecheck && npm run lint && npm run test` exits 0 before the commit step.**

  Run: `npm run typecheck && npm run lint && npm run test`
  Expected: PASS. Nothing in production code touches the new types yet, so the build is unaffected.

- [ ] **Step 5: Commit.**

  ```bash
  git add src/core/providers/types.ts tests/unit/core/providers/historyServiceTypes.test.ts
  git commit -m "feat(core): add additive outcome + context types for history service"
  ```

---

## Task 2: Add v2 methods alongside v1 on `ProviderConversationHistoryService`

This task extends the interface with `hydrateConversationHistoryV2`, `deleteConversationSessionV2`, optional `forkSupport`, and the generic `<TPersistedState>` parameter. **v1 methods stay** with `@deprecated` JSDoc. Tasks 4-7 add a bridge in each impl so v1 keeps working.

**Files:**
- Modify: `src/core/providers/types.ts` (the existing `ProviderConversationHistoryService` interface block)
- Test: extend `tests/unit/core/providers/historyServiceTypes.test.ts`

- [ ] **Step 1: Extend the failing test.**

  Append to `tests/unit/core/providers/historyServiceTypes.test.ts`:

  ```ts
  import type {
    ProviderConversationHistoryService,
  } from '@/core/providers/types';

  describe('ProviderConversationHistoryService v2 surface', () => {
    it('accepts generic TPersistedState; v1 and v2 coexist; forkSupport is optional', () => {
      type PinnedState = { databasePath: string };
      const service: ProviderConversationHistoryService<PinnedState> = {
        // v1 (deprecated, kept until Task 13)
        async hydrateConversationHistory(_c, _v) { /* legacy */ },
        async deleteConversationSession(_c, _v) { /* legacy */ },
        isPendingForkConversation(_c) { return false; },
        buildForkProviderState() { return {}; },
        // v2
        async hydrateConversationHistoryV2(_c, _ctx) {
          return { kind: 'empty', reason: 'no-store', sourceRef: null };
        },
        async deleteConversationSessionV2(_c, _ctx) {
          return { kind: 'no-op', reason: 'provider-owned' };
        },
        resolveSessionIdForConversation(_c) { return null; },
        buildPersistedProviderState(_c) { return { databasePath: '/tmp/db' }; },
      };
      expect(service.forkSupport).toBeUndefined();
      expect(typeof service.hydrateConversationHistoryV2).toBe('function');
      expect(typeof service.deleteConversationSessionV2).toBe('function');
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `npm run test -- tests/unit/core/providers/historyServiceTypes.test.ts`
  Expected: FAIL — `hydrateConversationHistoryV2`, `deleteConversationSessionV2`, `forkSupport`, and the generic parameter are not on the interface yet.

- [ ] **Step 3: Extend the interface.**

  Open `src/core/providers/types.ts`. Replace the existing `ProviderConversationHistoryService` block at lines 461-480 with:

  ```ts
  export interface ProviderConversationHistoryService<
    TPersistedState = Record<string, unknown>,
  > {
    /**
     * @deprecated Use {@link hydrateConversationHistoryV2}. v1 will be removed in Task 13
     * after every caller migrates.
     */
    hydrateConversationHistory(
      conversation: Conversation,
      vaultPath: string | null,
    ): Promise<void>;
    /**
     * @deprecated Use {@link deleteConversationSessionV2}.
     */
    deleteConversationSession(
      conversation: Conversation,
      vaultPath: string | null,
    ): Promise<void>;
    /**
     * @deprecated Moved under `forkSupport.isPendingForkConversation`. v1 stays until Task 13.
     */
    isPendingForkConversation?(conversation: Conversation): boolean;
    /**
     * @deprecated Moved under `forkSupport.buildForkProviderState`.
     */
    buildForkProviderState?(
      sourceSessionId: string,
      resumeAt: string,
      sourceProviderState?: Record<string, unknown>,
    ): Record<string, unknown>;

    /** Outcome-typed hydration. Returns the outcome; never mutates `conversation.messages`. */
    hydrateConversationHistoryV2(
      conversation: Conversation,
      ctx: HydrationContext,
    ): Promise<HistoryLoadOutcome>;

    /** Outcome-typed delete. */
    deleteConversationSessionV2(
      conversation: Conversation,
      ctx: HydrationContext,
    ): Promise<DeleteHistoryOutcome>;

    resolveSessionIdForConversation(conversation: Conversation | null): string | null;

    /** Present only when `capabilities.supportsFork === true`. Enforced by the registry invariant test (Task 8). */
    forkSupport?: ProviderForkSupport;

    /** Provider-owned persisted metadata added to `Conversation.providerState` before session save. */
    buildPersistedProviderState?(conversation: Conversation): TPersistedState | undefined;
  }
  ```

- [ ] **Step 4: Run the test to verify it passes.**

  Run: `npm run test -- tests/unit/core/providers/historyServiceTypes.test.ts`
  Expected: PASS.

- [ ] **Verification gate: `npm run typecheck && npm run lint && npm run test` exits 0 before the commit step.**

  Run: `npm run typecheck && npm run lint && npm run test`
  Expected: PASS — every existing impl already satisfies v1; v2 is optional in the sense that Tasks 4-7 add it. Wait — v2 is required on the interface. **Therefore Task 2 must also stub v2 on each impl with `throw new Error('not implemented — added in Task 4-7')` so the interface contract is satisfied at the type level.** Add to the four impl files a one-line method declaration:

  ```ts
  async hydrateConversationHistoryV2(_c: Conversation, _ctx: HydrationContext): Promise<HistoryLoadOutcome> {
    throw new Error('History v2 not yet implemented for this provider');
  }
  async deleteConversationSessionV2(_c: Conversation, _ctx: HydrationContext): Promise<DeleteHistoryOutcome> {
    throw new Error('History v2 delete not yet implemented for this provider');
  }
  ```

  No production caller invokes v2 until Task 10, so the stubs are dead until then. Typecheck stays green.

- [ ] **Step 5: Commit.**

  ```bash
  git add src/core/providers/types.ts src/providers/claude/history/ClaudeConversationHistoryService.ts src/providers/codex/history/CodexConversationHistoryService.ts src/providers/cursor/history/CursorConversationHistoryService.ts src/providers/opencode/history/OpencodeConversationHistoryService.ts tests/unit/core/providers/historyServiceTypes.test.ts
  git commit -m "feat(core): extend ProviderConversationHistoryService with v2 methods alongside deprecated v1"
  ```

---

## Task 3: Land `BaseHistoryService` abstract (caller owns messages assignment)

The base implements the v2 methods, handles cache + abort + force-refresh + concurrent-hydration dedupe, and **never writes to `conversation.messages`**. It also provides a default v1→v2 bridge that subclasses can opt into so impls migrated to v2 also satisfy v1 without duplication.

**Convention check:** `src/core/CLAUDE.md` says `types/ <- all modules` — type-only imports of `ChatMessage`/`Conversation` are allowed in `src/core/providers/BaseHistoryService.ts`.

**Files:**
- Create: `src/core/providers/BaseHistoryService.ts`
- Test: `tests/unit/core/providers/BaseHistoryService.test.ts`

- [ ] **Step 1: Write the failing test.**

  Create `tests/unit/core/providers/BaseHistoryService.test.ts`:

  ```ts
  import { BaseHistoryService } from '@/core/providers/BaseHistoryService';
  import type {
    DeleteHistoryOutcome,
    HistoryLoadOutcome,
    HydrationContext,
  } from '@/core/providers/types';
  import type { ChatMessage, Conversation } from '@/core/types';

  function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
    return {
      id: 'conv-1',
      title: 'Test',
      messages: [],
      providerId: 'claude',
      sessionId: null,
      providerState: {},
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    } as unknown as Conversation;
  }

  class FakeHistoryService extends BaseHistoryService {
    loadCalls = 0;
    nextOutcome: HistoryLoadOutcome = { kind: 'empty', reason: 'no-session', sourceRef: null };
    loadDelayMs = 0;

    protected computeCacheKey(c: Conversation): string | null {
      return c.sessionId ? `${c.id}:${c.sessionId}` : null;
    }

    protected async loadMessages(): Promise<HistoryLoadOutcome> {
      this.loadCalls++;
      if (this.loadDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.loadDelayMs));
      }
      return this.nextOutcome;
    }

    resolveSessionIdForConversation(c: Conversation | null): string | null {
      return c?.sessionId ?? null;
    }

    async deleteConversationSessionV2(): Promise<DeleteHistoryOutcome> {
      return { kind: 'no-op', reason: 'no-session' };
    }

    // v1 bridge inherited from BaseHistoryService — no override needed.
    async hydrateConversationHistory(): Promise<void> { /* v1 bridge handled by base */ }
    async deleteConversationSession(): Promise<void> { /* v1 bridge handled by base */ }
  }

  const ctx: HydrationContext = { vaultPath: '/vault', reason: 'open' };

  describe('BaseHistoryService.hydrateConversationHistoryV2', () => {
    it('returns loaded WITHOUT mutating conversation.messages (caller is responsible)', async () => {
      const svc = new FakeHistoryService();
      const messages: ChatMessage[] = [
        { id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as ChatMessage,
      ];
      svc.nextOutcome = { kind: 'loaded', messages, sourceRef: 'conv-1:sess-a' };

      const conv = makeConversation({ sessionId: 'sess-a' });
      const outcome = await svc.hydrateConversationHistoryV2(conv, ctx);

      expect(outcome.kind).toBe('loaded');
      // Caller responsibility: messages array is unchanged by the base on loaded.
      expect(conv.messages).toEqual([]);
    });

    it('short-circuits as cached when key matches and sourceRef tracked by the cache', async () => {
      const svc = new FakeHistoryService();
      const messages: ChatMessage[] = [
        { id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as ChatMessage,
      ];
      svc.nextOutcome = { kind: 'loaded', messages, sourceRef: 'conv-1:sess-a' };

      const conv = makeConversation({ sessionId: 'sess-a' });
      // Caller assignment is simulated here so the second call sees a non-empty messages array.
      const first = await svc.hydrateConversationHistoryV2(conv, ctx);
      if (first.kind === 'loaded') conv.messages = first.messages;
      expect(svc.loadCalls).toBe(1);

      const second = await svc.hydrateConversationHistoryV2(conv, ctx);
      expect(second).toEqual({ kind: 'cached', sourceRef: 'conv-1:sess-a' });
      expect(svc.loadCalls).toBe(1);
    });

    it('forceRefresh bypasses the cache short-circuit', async () => {
      const svc = new FakeHistoryService();
      const messages: ChatMessage[] = [
        { id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as ChatMessage,
      ];
      svc.nextOutcome = { kind: 'loaded', messages, sourceRef: 'conv-1:sess-a' };

      const conv = makeConversation({ sessionId: 'sess-a' });
      const first = await svc.hydrateConversationHistoryV2(conv, ctx);
      if (first.kind === 'loaded') conv.messages = first.messages;
      await svc.hydrateConversationHistoryV2(conv, { ...ctx, forceRefresh: true });

      expect(svc.loadCalls).toBe(2);
    });

    it('returns cancelled error when the signal is already aborted', async () => {
      const svc = new FakeHistoryService();
      const controller = new AbortController();
      controller.abort();

      const conv = makeConversation({ sessionId: 'sess-a' });
      const outcome = await svc.hydrateConversationHistoryV2(conv, {
        ...ctx,
        signal: controller.signal,
      });

      expect(outcome.kind).toBe('error');
      if (outcome.kind === 'error') expect(outcome.error.code).toBe('cancelled');
      expect(svc.loadCalls).toBe(0);
    });

    it('clears the cache entry on empty outcome', async () => {
      const svc = new FakeHistoryService();
      const messages: ChatMessage[] = [
        { id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as ChatMessage,
      ];
      svc.nextOutcome = { kind: 'loaded', messages, sourceRef: 'conv-1:sess-a' };

      const conv = makeConversation({ sessionId: 'sess-a' });
      const first = await svc.hydrateConversationHistoryV2(conv, ctx);
      if (first.kind === 'loaded') conv.messages = first.messages;

      svc.nextOutcome = { kind: 'empty', reason: 'no-rows', sourceRef: 'conv-1:sess-a' };
      conv.messages = [];
      const outcome = await svc.hydrateConversationHistoryV2(conv, { ...ctx, forceRefresh: true });

      expect(outcome.kind).toBe('empty');
      svc.nextOutcome = { kind: 'loaded', messages, sourceRef: 'conv-1:sess-a' };
      await svc.hydrateConversationHistoryV2(conv, ctx);
      expect(svc.loadCalls).toBe(3);
    });

    it('clears the cache entry on error outcome and never overwrites conversation.messages', async () => {
      const svc = new FakeHistoryService();
      svc.nextOutcome = {
        kind: 'error',
        error: { code: 'store-unreadable', message: 'broken' },
        sourceRef: null,
      };

      const conv = makeConversation({ sessionId: 'sess-a' });
      conv.messages = [
        { id: 'pre', role: 'user', content: 'pre', timestamp: 1 } as ChatMessage,
      ];
      const outcome = await svc.hydrateConversationHistoryV2(conv, ctx);
      expect(outcome.kind).toBe('error');
      expect(conv.messages.length).toBe(1);
    });

    it('does not short-circuit when computeCacheKey returns null', async () => {
      const svc = new FakeHistoryService();
      svc.nextOutcome = { kind: 'empty', reason: 'no-session', sourceRef: null };

      const conv = makeConversation({ sessionId: null });
      await svc.hydrateConversationHistoryV2(conv, ctx);
      await svc.hydrateConversationHistoryV2(conv, ctx);
      expect(svc.loadCalls).toBe(2);
    });

    it('dedupes concurrent hydrations of the same conversation through inflight map', async () => {
      const svc = new FakeHistoryService();
      svc.loadDelayMs = 10;
      svc.nextOutcome = {
        kind: 'loaded',
        messages: [{ id: 'm', role: 'user', content: 'hi', timestamp: 1 } as ChatMessage],
        sourceRef: 'conv-1:sess-a',
      };

      const conv = makeConversation({ sessionId: 'sess-a' });
      const [a, b] = await Promise.all([
        svc.hydrateConversationHistoryV2(conv, ctx),
        svc.hydrateConversationHistoryV2(conv, ctx),
      ]);

      expect(svc.loadCalls).toBe(1);
      expect(a).toEqual(b);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `npm run test -- tests/unit/core/providers/BaseHistoryService.test.ts`
  Expected: FAIL — `Cannot find module '@/core/providers/BaseHistoryService'`.

- [ ] **Step 3: Implement `BaseHistoryService`.**

  Create `src/core/providers/BaseHistoryService.ts`:

  ```ts
  import type { Conversation } from '../types';
  import type {
    DeleteHistoryOutcome,
    HistoryLoadOutcome,
    HydrationContext,
    ProviderConversationHistoryService,
    ProviderForkSupport,
  } from './types';

  /**
   * Shared base for provider conversation history services.
   *
   * Centralizes:
   *   - the `Map<convId, sourceRef>` cache that every provider duplicated
   *   - the `AbortSignal` short-circuit (so SQLite reads can be cancelled on tab switch)
   *   - the `forceRefresh` bypass
   *   - cache invalidation on `empty` / `error` outcomes
   *   - concurrent-hydration dedupe (inflight map keyed by conversation id)
   *   - a default v1 -> v2 bridge so subclasses that have only migrated v2 still satisfy v1
   *
   * The base **never** mutates `conversation.messages`. Callers (`ConversationStore`)
   * branch on the outcome and own the assignment so the loaded/error asymmetry that
   * would otherwise stale-render an error pane never exists.
   *
   * Subclasses MAY check `ctx.signal?.aborted` at iteration boundaries inside
   * `loadMessages` (Claude's multi-session walk relies on this).
   */
  export abstract class BaseHistoryService<
    TPersistedState = Record<string, unknown>,
  > implements ProviderConversationHistoryService<TPersistedState> {
    private hydrationCache = new Map<string, string>();
    private inflight = new Map<string, Promise<HistoryLoadOutcome>>();

    forkSupport?: ProviderForkSupport;

    protected abstract computeCacheKey(
      conversation: Conversation,
      ctx: HydrationContext,
    ): string | null;

    protected abstract loadMessages(
      conversation: Conversation,
      ctx: HydrationContext,
    ): Promise<HistoryLoadOutcome>;

    abstract resolveSessionIdForConversation(
      conversation: Conversation | null,
    ): string | null;

    abstract deleteConversationSessionV2(
      conversation: Conversation,
      ctx: HydrationContext,
    ): Promise<DeleteHistoryOutcome>;

    buildPersistedProviderState?(
      conversation: Conversation,
    ): TPersistedState | undefined;

    async hydrateConversationHistoryV2(
      conversation: Conversation,
      ctx: HydrationContext,
    ): Promise<HistoryLoadOutcome> {
      if (ctx.signal?.aborted) {
        return {
          kind: 'error',
          error: { code: 'cancelled', message: 'Hydration cancelled' },
          sourceRef: null,
        };
      }

      const key = this.computeCacheKey(conversation, ctx);
      if (
        !ctx.forceRefresh
        && key
        && this.hydrationCache.get(conversation.id) === key
        && conversation.messages.length > 0
      ) {
        return { kind: 'cached', sourceRef: key };
      }

      const inflight = this.inflight.get(conversation.id);
      if (inflight) return inflight;

      const pending = (async (): Promise<HistoryLoadOutcome> => {
        const outcome = await this.loadMessages(conversation, ctx);

        if (outcome.kind === 'loaded' && key) {
          this.hydrationCache.set(conversation.id, key);
        } else if (outcome.kind === 'empty' || outcome.kind === 'error') {
          this.hydrationCache.delete(conversation.id);
        }

        return outcome;
      })();

      this.inflight.set(conversation.id, pending);
      try {
        return await pending;
      } finally {
        this.inflight.delete(conversation.id);
      }
    }

    /**
     * Default v1 bridge: delegate to v2, perform the messages assignment that v1
     * callers expect. Subclasses MAY override to short-circuit v1 paths (Tasks 4-7
     * use this default).
     *
     * @deprecated Use {@link hydrateConversationHistoryV2}.
     */
    async hydrateConversationHistory(
      conversation: Conversation,
      vaultPath: string | null,
    ): Promise<void> {
      const outcome = await this.hydrateConversationHistoryV2(conversation, {
        vaultPath,
        reason: 'open',
      });
      if (outcome.kind === 'loaded') {
        conversation.messages = outcome.messages;
      }
    }

    /**
     * Default v1 bridge: delegate to v2, ignore the outcome.
     *
     * @deprecated Use {@link deleteConversationSessionV2}.
     */
    async deleteConversationSession(
      conversation: Conversation,
      vaultPath: string | null,
    ): Promise<void> {
      await this.deleteConversationSessionV2(conversation, {
        vaultPath,
        reason: 'open',
      });
    }

    /** Test-only: clears the cache. Subclasses may expose this for white-box tests. */
    protected clearHydrationCache(): void {
      this.hydrationCache.clear();
      this.inflight.clear();
    }
  }
  ```

- [ ] **Step 4: Run the test to verify it passes.**

  Run: `npm run test -- tests/unit/core/providers/BaseHistoryService.test.ts`
  Expected: PASS — all eight describe-block assertions hold, including the inflight-dedupe test.

- [ ] **Verification gate: `npm run typecheck && npm run lint && npm run test` exits 0 before the commit step.**

  Run: `npm run typecheck && npm run lint && npm run test`
  Expected: PASS. The four impls still have their v2 throw-stubs from Task 2; nothing has migrated yet but the build stays green.

- [ ] **Step 5: Commit.**

  ```bash
  git add src/core/providers/BaseHistoryService.ts tests/unit/core/providers/BaseHistoryService.test.ts
  git commit -m "feat(core): add BaseHistoryService with cache, abort, refresh, inflight dedupe"
  ```

---

## Task 4: Migrate Opencode impl onto `BaseHistoryService` (v2 + bridge)

The current impl injects a sentinel "diagnostic" `ChatMessage` into the rendered transcript when SQLite reads fail. Task 4 replaces the sentinel with `HistoryLoadOutcome.error`, wires `sqlite-unavailable` at the `node:sqlite` import-failure path, and extends `BaseHistoryService` so v1 keeps working through the base bridge.

**Files:**
- Modify: `src/providers/opencode/history/OpencodeHistoryStore.ts:42-64` (`loadOpencodeSessionMessages` signature) and `:482-488` (wire `sqlite-unavailable`)
- Modify: `src/providers/opencode/history/OpencodeConversationHistoryService.ts:1-84` (extend base; implement v2)
- Test: `tests/unit/providers/opencode/history/OpencodeConversationHistoryService.test.ts` *(create if missing)*

- [ ] **Step 1: Write the failing test.**

  Create `tests/unit/providers/opencode/history/OpencodeConversationHistoryService.test.ts`:

  ```ts
  import { OpencodeConversationHistoryService } from '@/providers/opencode/history/OpencodeConversationHistoryService';
  import * as Store from '@/providers/opencode/history/OpencodeHistoryStore';
  import type { Conversation } from '@/core/types';
  import type { HydrationContext } from '@/core/providers/types';

  function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
    return {
      id: 'conv-1',
      title: 't',
      messages: [],
      providerId: 'opencode',
      sessionId: 'sess-a',
      providerState: { databasePath: '/tmp/oc.db' },
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    } as unknown as Conversation;
  }

  const ctx: HydrationContext = { vaultPath: null, reason: 'open' };

  describe('OpencodeConversationHistoryService.hydrateConversationHistoryV2', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('returns empty:no-session when conversation.sessionId is null', async () => {
      const svc = new OpencodeConversationHistoryService();
      const conv = makeConversation({ sessionId: null });
      const out = await svc.hydrateConversationHistoryV2(conv, ctx);
      expect(out.kind).toBe('empty');
      if (out.kind === 'empty') expect(out.reason).toBe('no-session');
    });

    it('returns loaded with messages and a stable sourceRef on success', async () => {
      jest.spyOn(Store, 'loadOpencodeSessionMessages').mockResolvedValue({
        messages: [
          { id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as never,
        ],
      });
      const svc = new OpencodeConversationHistoryService();
      const conv = makeConversation();
      const out = await svc.hydrateConversationHistoryV2(conv, ctx);
      expect(out.kind).toBe('loaded');
      if (out.kind === 'loaded') {
        expect(out.messages.length).toBe(1);
        expect(out.sourceRef).toBe('sess-a::/tmp/oc.db');
      }
      // Base does NOT mutate conv.messages — caller owns the assignment.
      expect(conv.messages.length).toBe(0);
    });

    it('returns error:store-unreadable when the loader reports a generic error', async () => {
      jest.spyOn(Store, 'loadOpencodeSessionMessages').mockResolvedValue({
        messages: [],
        error: {
          code: 'store-unreadable',
          message: 'Could not read OpenCode session rows from SQLite.',
          detail: 'detail-debug-only',
        },
      });
      const svc = new OpencodeConversationHistoryService();
      const conv = makeConversation();
      const out = await svc.hydrateConversationHistoryV2(conv, ctx);
      expect(out.kind).toBe('error');
      if (out.kind === 'error') {
        expect(out.error.code).toBe('store-unreadable');
        expect(out.error.message).not.toContain('/tmp/oc.db');
      }
      expect(conv.messages.length).toBe(0);
    });

    it('returns error:sqlite-unavailable when node:sqlite cannot load', async () => {
      jest.spyOn(Store, 'loadOpencodeSessionMessages').mockResolvedValue({
        messages: [],
        error: {
          code: 'sqlite-unavailable',
          message: 'OpenCode history requires node:sqlite or the sqlite3 CLI.',
        },
      });
      const svc = new OpencodeConversationHistoryService();
      const out = await svc.hydrateConversationHistoryV2(makeConversation(), ctx);
      expect(out.kind).toBe('error');
      if (out.kind === 'error') expect(out.error.code).toBe('sqlite-unavailable');
    });

    it('returns empty:no-rows when the loader returns zero messages and no error', async () => {
      jest.spyOn(Store, 'loadOpencodeSessionMessages').mockResolvedValue({ messages: [] });
      const svc = new OpencodeConversationHistoryService();
      const conv = makeConversation();
      const out = await svc.hydrateConversationHistoryV2(conv, ctx);
      expect(out.kind).toBe('empty');
      if (out.kind === 'empty') expect(out.reason).toBe('no-rows');
    });
  });

  describe('OpencodeConversationHistoryService.deleteConversationSessionV2', () => {
    it('returns no-op:provider-owned because OpenCode native history is never mutated', async () => {
      const svc = new OpencodeConversationHistoryService();
      const conv = makeConversation();
      const out = await svc.deleteConversationSessionV2(conv, ctx);
      expect(out).toEqual({ kind: 'no-op', reason: 'provider-owned' });
    });
  });

  describe('OpencodeConversationHistoryService.forkSupport', () => {
    it('is undefined because Opencode does not support fork', () => {
      const svc = new OpencodeConversationHistoryService();
      expect(svc.forkSupport).toBeUndefined();
    });
  });

  describe('OpencodeConversationHistoryService.hydrateConversationHistory (v1 bridge)', () => {
    it('writes to conversation.messages via the BaseHistoryService bridge', async () => {
      jest.spyOn(Store, 'loadOpencodeSessionMessages').mockResolvedValue({
        messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as never],
      });
      const svc = new OpencodeConversationHistoryService();
      const conv = makeConversation();
      await svc.hydrateConversationHistory(conv, null);
      expect(conv.messages.length).toBe(1);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `npm run test -- tests/unit/providers/opencode/history/OpencodeConversationHistoryService.test.ts`
  Expected: FAIL — `loadOpencodeSessionMessages` still returns `ChatMessage[]` (no `error?`), the impl still ships the sentinel, the v2 stub still throws.

- [ ] **Step 3: Change the store loader return shape and wire `sqlite-unavailable`.**

  Edit `src/providers/opencode/history/OpencodeHistoryStore.ts`. Add the result type and replace `loadOpencodeSessionMessages` (lines 42-64) with:

  ```ts
  import type { HistoryLoadError } from '../../../core/providers/types';

  export interface OpencodeSessionLoadResult {
    messages: ChatMessage[];
    error?: HistoryLoadError;
  }

  export async function loadOpencodeSessionMessages(
    sessionId: string,
    providerState?: OpencodeProviderState,
  ): Promise<OpencodeSessionLoadResult> {
    const databasePath = resolveExistingOpencodeDatabasePath(providerState?.databasePath);
    if (!databasePath || databasePath === ':memory:' || !fs.existsSync(databasePath)) {
      return { messages: [] };
    }

    const rows = await loadOpencodeSessionRows(databasePath, sessionId);
    if (!rows) {
      // `loadOpencodeSessionRows` already attempted node:sqlite and the sqlite3 CLI
      // fallback. Determine which failure path we are on by re-asking the loader
      // helper for the available transport (it never throws). When neither
      // transport is present, surface `sqlite-unavailable` so the UI can suggest
      // installing Node 22+ or the sqlite3 CLI; otherwise it is a runtime read
      // failure and the generic `store-unreadable` is correct.
      const transportAvailable = await isSqliteTransportAvailable();
      const error: HistoryLoadError = transportAvailable
        ? {
            code: 'store-unreadable',
            message: 'Could not read OpenCode session rows from SQLite.',
            detail: `databasePath=${databasePath} sessionId=${sessionId}`,
          }
        : {
            code: 'sqlite-unavailable',
            message: 'OpenCode history requires node:sqlite or the sqlite3 CLI.',
            detail: `databasePath=${databasePath} sessionId=${sessionId}`,
          };
      return { messages: [], error };
    }

    return {
      messages: mapOpencodeMessages(
        hydrateStoredMessages(rows.messageRows, rows.partRows),
        { databasePath, sessionId },
      ),
    };
  }
  ```

  Add the `isSqliteTransportAvailable` helper next to `loadSqliteModule` at line 482:

  ```ts
  async function isSqliteTransportAvailable(): Promise<boolean> {
    const sqliteModule = await loadSqliteModule();
    if (sqliteModule) return true;
    // The existing sqlite3 CLI probe is private to the store; re-use it.
    return isSqlite3CliAvailable();
  }
  ```

  (If `isSqlite3CliAvailable` does not already exist as a helper, extract it from `loadSessionRowsWithSqliteCli` — it is the existence-check that runs before the spawn.)

  Then in the same file, drop the `export` keyword on `isOpencodeSessionHydrationDiagnosticMessage` at line 301 — it becomes module-private. Task 13 deletes it entirely.

- [ ] **Step 4: Rewrite the service.**

  Replace the entire contents of `src/providers/opencode/history/OpencodeConversationHistoryService.ts`:

  ```ts
  import { BaseHistoryService } from '../../../core/providers/BaseHistoryService';
  import type {
    DeleteHistoryOutcome,
    HistoryLoadOutcome,
    HydrationContext,
  } from '../../../core/providers/types';
  import type { Conversation } from '../../../core/types';
  import { getOpencodeState, type OpencodeProviderState } from '../types';
  import { loadOpencodeSessionMessages } from './OpencodeHistoryStore';

  export class OpencodeConversationHistoryService extends BaseHistoryService<OpencodeProviderState> {
    // forkSupport intentionally omitted — Opencode capabilities.supportsFork === false.

    protected computeCacheKey(conversation: Conversation): string | null {
      if (!conversation.sessionId) return null;
      const state = getOpencodeState(conversation.providerState);
      return `${conversation.sessionId}::${state.databasePath ?? ''}`;
    }

    protected async loadMessages(
      conversation: Conversation,
      _ctx: HydrationContext,
    ): Promise<HistoryLoadOutcome> {
      const sessionId = conversation.sessionId;
      if (!sessionId) return { kind: 'empty', reason: 'no-session', sourceRef: null };

      const state = getOpencodeState(conversation.providerState);
      const sourceRef = `${sessionId}::${state.databasePath ?? ''}`;
      const result = await loadOpencodeSessionMessages(sessionId, state);

      if (result.error) {
        return { kind: 'error', error: result.error, sourceRef };
      }
      if (result.messages.length === 0) {
        return { kind: 'empty', reason: 'no-rows', sourceRef };
      }
      return { kind: 'loaded', messages: result.messages, sourceRef };
    }

    resolveSessionIdForConversation(conversation: Conversation | null): string | null {
      return conversation?.sessionId ?? null;
    }

    async deleteConversationSessionV2(): Promise<DeleteHistoryOutcome> {
      // Never mutate OpenCode native history (it is provider-owned by design).
      return { kind: 'no-op', reason: 'provider-owned' };
    }

    buildPersistedProviderState(conversation: Conversation): OpencodeProviderState | undefined {
      const state = getOpencodeState(conversation.providerState);
      const providerState: OpencodeProviderState = {
        ...(state.databasePath ? { databasePath: state.databasePath } : {}),
      };
      return Object.keys(providerState).length > 0 ? providerState : undefined;
    }
  }
  ```

  v1 bridges are inherited from `BaseHistoryService`. The Task 2 throw-stubs for v2 are replaced by the real implementations above.

- [ ] **Step 5: Run the test to verify it passes.**

  Run: `npm run test -- tests/unit/providers/opencode/history/OpencodeConversationHistoryService.test.ts`
  Expected: PASS — all five describe blocks.

- [ ] **Verification gate: `npm run typecheck && npm run lint && npm run test` exits 0 before the commit step.**

  Run: `npm run typecheck && npm run lint && npm run test`
  Expected: PASS. The other three providers still use Task 2's throw-stub for v2, but nothing calls v2 outside this provider's tests yet.

- [ ] **Step 6: Commit.**

  ```bash
  git add src/providers/opencode/history/OpencodeHistoryStore.ts src/providers/opencode/history/OpencodeConversationHistoryService.ts tests/unit/providers/opencode/history/OpencodeConversationHistoryService.test.ts
  git commit -m "refactor(opencode): migrate history service onto BaseHistoryService; replace sentinel with HistoryLoadOutcome"
  ```

---

## Task 5: Migrate Cursor impl onto `BaseHistoryService` (v2 + bridge)

The current impl maintains a side-channel `Map<string, string>` keyed by conversation id and exposes `getLastHistoryLoadError(conversationId)` — a method that is **not on the interface** and that production code never reads (only the file's own test does). Task 5 deletes the side channel, returns the error through the outcome, wires `sqlite-unavailable` at the `openCursorSqliteReadonly` failure path (lines 159-167), and collects the two-hash delete sweep into `DeleteHistoryOutcome.paths`.

**Files:**
- Modify: `src/providers/cursor/history/CursorConversationHistoryService.ts:1-127`
- Modify: `src/providers/cursor/history/cursorHistoryStore.ts:159-167` (surface `sqlite-unavailable` when `require('node:sqlite')` throws)
- Modify: `tests/unit/providers/cursor/history/CursorConversationHistoryService.test.ts:12-25` (drop the `getLastHistoryLoadError` describe block) and `:69, :84, :99` (pass `HydrationContext` to v2 calls)

- [ ] **Step 1: Write the failing test.**

  Replace the contents of `tests/unit/providers/cursor/history/CursorConversationHistoryService.test.ts` with:

  ```ts
  import * as fs from 'fs';
  import type * as osTypes from 'os';
  import * as path from 'path';

  import type { Conversation } from '@/core/types';
  import type { HydrationContext } from '@/core/providers/types';
  import { CursorConversationHistoryService } from '@/providers/cursor/history/CursorConversationHistoryService';
  import {
    cursorWorkspaceHash,
    cursorWorkspaceHashLegacy,
  } from '@/providers/cursor/history/cursorHistoryStore';
  import * as Store from '@/providers/cursor/history/cursorHistoryStore';

  function makeConversation(sessionId: string): Conversation {
    return {
      id: 'conv-1',
      title: 'Test',
      messages: [],
      createdAt: 0,
      lastActiveAt: 0,
      sessionId: null,
      providerId: 'cursor',
      providerState: { chatSessionId: sessionId },
    } as unknown as Conversation;
  }

  describe('CursorConversationHistoryService — no out-of-band error getter', () => {
    it('does not expose getLastHistoryLoadError', () => {
      const svc = new CursorConversationHistoryService();
      expect((svc as unknown as { getLastHistoryLoadError?: unknown }).getLastHistoryLoadError).toBeUndefined();
    });

    it('does not expose forkSupport (Cursor capabilities.supportsFork === false)', () => {
      const svc = new CursorConversationHistoryService();
      expect(svc.forkSupport).toBeUndefined();
    });
  });

  describe('CursorConversationHistoryService.hydrateConversationHistoryV2', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('returns error:sqlite-unavailable when node:sqlite cannot be required', async () => {
      jest.spyOn(Store, 'resolveCursorStoreDbPath').mockReturnValue('/tmp/cursor.db');
      jest.spyOn(Store, 'loadCursorChatMessagesFromStoreResult').mockReturnValue({
        messages: [],
        error: { code: 'sqlite-unavailable', message: 'Cursor history requires node:sqlite.' },
      });
      const svc = new CursorConversationHistoryService();
      const out = await svc.hydrateConversationHistoryV2(makeConversation('s'), {
        vaultPath: '/vault',
        reason: 'open',
      });
      expect(out.kind).toBe('error');
      if (out.kind === 'error') expect(out.error.code).toBe('sqlite-unavailable');
    });
  });

  describe('CursorConversationHistoryService.deleteConversationSessionV2', () => {
    const realOs = jest.requireActual<typeof osTypes>('os');
    let tmpHome: string;
    let homedirSpy: jest.SpyInstance;

    beforeEach(() => {
      tmpHome = fs.mkdtempSync(path.join(realOs.tmpdir(), 'claudian-cursor-delete-'));
      homedirSpy = jest.spyOn(realOs, 'homedir').mockReturnValue(tmpHome);
    });
    afterEach(() => {
      homedirSpy.mockRestore();
      fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    function plantChatDir(hash: string, sessionId: string): string {
      const dir = path.join(tmpHome, '.cursor', 'chats', hash, sessionId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'store.db'), '');
      return dir;
    }

    function ctxFor(vaultPath: string): HydrationContext {
      return { vaultPath, reason: 'open' };
    }

    it('returns deleted with the normalized-hash directory in paths', async () => {
      const vault = '/vault/Test';
      const sessionId = 'sess-normalized';
      const dir = plantChatDir(cursorWorkspaceHash(vault), sessionId);

      const svc = new CursorConversationHistoryService();
      const out = await svc.deleteConversationSessionV2(makeConversation(sessionId), ctxFor(vault));

      expect(out.kind).toBe('deleted');
      if (out.kind === 'deleted') expect(out.paths).toContain(dir);
      expect(fs.existsSync(dir)).toBe(false);
    });

    it('also removes the legacy-hash directory and reports both paths', async () => {
      const vault = 'D:\\Projects\\Test';
      const sessionId = 'sess-legacy';
      const legacyDir = plantChatDir(cursorWorkspaceHashLegacy(vault), sessionId);

      const svc = new CursorConversationHistoryService();
      const out = await svc.deleteConversationSessionV2(makeConversation(sessionId), ctxFor(vault));

      expect(out.kind).toBe('deleted');
      if (out.kind === 'deleted') expect(out.paths).toContain(legacyDir);
      expect(fs.existsSync(legacyDir)).toBe(false);
    });

    it('returns error:invalid-session-id when sessionId fails validation', async () => {
      const vault = '/vault/Test';
      const chatsRoot = path.join(tmpHome, '.cursor', 'chats');
      fs.mkdirSync(chatsRoot, { recursive: true });
      fs.writeFileSync(path.join(chatsRoot, 'sentinel'), '');

      const svc = new CursorConversationHistoryService();
      const out = await svc.deleteConversationSessionV2(makeConversation('.'), ctxFor(vault));

      expect(out.kind).toBe('error');
      if (out.kind === 'error') expect(out.error.code).toBe('invalid-session-id');
      expect(fs.existsSync(path.join(chatsRoot, 'sentinel'))).toBe(true);
    });

    it('returns no-op:no-session when sessionId is null or vaultPath is null', async () => {
      const svc = new CursorConversationHistoryService();
      const conv = { ...makeConversation('s'), providerState: {} } as Conversation;
      const out = await svc.deleteConversationSessionV2(conv, { vaultPath: null, reason: 'open' });
      expect(out).toEqual({ kind: 'no-op', reason: 'no-session' });
    });
  });
  ```

- [ ] **Step 2: Wire `sqlite-unavailable` in the store.**

  Open `src/providers/cursor/history/cursorHistoryStore.ts`. Replace `openCursorSqliteReadonly` at lines 159-167 with a tagged failure path:

  ```ts
  interface CursorSqliteOpenResult {
    handle?: CursorSqliteHandle;
    error?: HistoryLoadError;
  }

  function openCursorSqliteReadonly(dbPath: string): CursorSqliteOpenResult {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
      const handle = new DatabaseSync(dbPath, { readOnly: true }) as unknown as CursorSqliteHandle;
      return { handle };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // node:sqlite was added in Node 22.5. Older runtimes throw MODULE_NOT_FOUND
      // or similar; surface sqlite-unavailable so the UI can suggest upgrading.
      if (/Cannot find module 'node:sqlite'|MODULE_NOT_FOUND/.test(message)) {
        return {
          error: { code: 'sqlite-unavailable', message: 'Cursor history requires Node 22.5+ (node:sqlite).' },
        };
      }
      return {
        error: { code: 'store-unreadable', message: 'Could not open Cursor SQLite store.', detail: message },
      };
    }
  }
  ```

  Update `loadCursorChatMessagesFromStoreResult` (the function returned to the service) to propagate `result.error?` from the open-call into its return shape.

- [ ] **Step 3: Rewrite the service.**

  Replace the entire contents of `src/providers/cursor/history/CursorConversationHistoryService.ts`:

  ```ts
  import * as fs from 'fs';
  import * as os from 'os';
  import * as path from 'path';

  import { BaseHistoryService } from '../../../core/providers/BaseHistoryService';
  import { isValidCursorSessionId } from '../../../core/providers/cursorSessionIdValidation';
  import type {
    DeleteHistoryOutcome,
    HistoryLoadOutcome,
    HydrationContext,
  } from '../../../core/providers/types';
  import type { Conversation } from '../../../core/types';
  import { getCursorState, resolveCursorSessionId, type CursorProviderState } from '../types';
  import {
    cursorWorkspaceHash,
    cursorWorkspaceHashLegacy,
    loadCursorChatMessagesFromStoreResult,
    resolveCursorStoreDbPath,
  } from './cursorHistoryStore';

  export class CursorConversationHistoryService extends BaseHistoryService<CursorProviderState> {
    // forkSupport intentionally omitted — Cursor capabilities.supportsFork === false.

    protected computeCacheKey(
      conversation: Conversation,
      ctx: HydrationContext,
    ): string | null {
      const sessionId = resolveCursorSessionId(conversation);
      if (!sessionId || !ctx.vaultPath) return null;
      const dbPath = resolveCursorStoreDbPath(ctx.vaultPath, sessionId);
      return dbPath ? `${sessionId}::${dbPath}` : null;
    }

    protected async loadMessages(
      conversation: Conversation,
      ctx: HydrationContext,
    ): Promise<HistoryLoadOutcome> {
      const sessionId = resolveCursorSessionId(conversation);
      if (!sessionId || !ctx.vaultPath) {
        return { kind: 'empty', reason: 'no-session', sourceRef: null };
      }
      const dbPath = resolveCursorStoreDbPath(ctx.vaultPath, sessionId);
      if (!dbPath) {
        return { kind: 'empty', reason: 'no-store', sourceRef: null };
      }

      const sourceRef = `${sessionId}::${dbPath}`;
      const result = loadCursorChatMessagesFromStoreResult(dbPath);
      if (result.error) {
        // result.error may be the structured `HistoryLoadError` from the sqlite open
        // (`sqlite-unavailable`), or a legacy redacted string from older paths.
        const error = typeof result.error === 'string'
          ? { code: 'store-unreadable' as const, message: result.error }
          : result.error;
        return { kind: 'error', error, sourceRef };
      }
      if (result.messages.length === 0) {
        return { kind: 'empty', reason: 'no-rows', sourceRef };
      }
      return { kind: 'loaded', messages: result.messages, sourceRef };
    }

    resolveSessionIdForConversation(conversation: Conversation | null): string | null {
      return resolveCursorSessionId(conversation);
    }

    async deleteConversationSessionV2(
      conversation: Conversation,
      ctx: HydrationContext,
    ): Promise<DeleteHistoryOutcome> {
      const sessionId = resolveCursorSessionId(conversation);
      if (!sessionId || !ctx.vaultPath) {
        return { kind: 'no-op', reason: 'no-session' };
      }
      if (!isValidCursorSessionId(sessionId)) {
        return {
          kind: 'error',
          error: {
            code: 'invalid-session-id',
            message: 'Cursor session id failed validation; refusing to delete.',
          },
        };
      }

      // Mirror resolveCursorStoreDbPath's two-hash fallback: hydration can surface
      // conversations keyed under either the normalized hash or the legacy hash.
      // Deleting only the normalized path would leave the legacy-hash transcript on disk.
      const chatsRoot = path.join(os.homedir(), '.cursor', 'chats');
      const candidateHashes = [
        cursorWorkspaceHash(ctx.vaultPath),
        cursorWorkspaceHashLegacy(ctx.vaultPath),
      ];
      const removedPaths: string[] = [];
      const seenDirs = new Set<string>();
      for (const hash of candidateHashes) {
        const chatDir = path.join(chatsRoot, hash, sessionId);
        if (!chatDir.startsWith(chatsRoot)) continue;
        if (seenDirs.has(chatDir)) continue;
        seenDirs.add(chatDir);
        try {
          if (fs.existsSync(chatDir)) {
            fs.rmSync(chatDir, { recursive: true, force: true });
            removedPaths.push(chatDir);
          }
        } catch {
          // best-effort; absence of the path from `removedPaths` already signals it
        }
      }

      return { kind: 'deleted', paths: removedPaths };
    }

    buildPersistedProviderState(conversation: Conversation): CursorProviderState | undefined {
      const state = getCursorState(conversation.providerState);
      const sid = state.chatSessionId ?? conversation.sessionId ?? undefined;
      const merged: CursorProviderState = { ...state };
      if (sid) merged.chatSessionId = sid;
      const entries = Object.entries(merged).filter(([, value]) => value !== undefined);
      return entries.length > 0 ? Object.fromEntries(entries) as CursorProviderState : undefined;
    }
  }
  ```

- [ ] **Step 4: Run the test to verify it passes.**

  Run: `npm run test -- tests/unit/providers/cursor/history/CursorConversationHistoryService.test.ts`
  Expected: PASS — `getLastHistoryLoadError` absent, `forkSupport` undefined, `sqlite-unavailable` surfaced, delete returns the three outcome variants.

- [ ] **Verification gate: `npm run typecheck && npm run lint && npm run test` exits 0 before the commit step.**

  Run: `npm run typecheck && npm run lint && npm run test`
  Expected: PASS.

- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/cursor/history/CursorConversationHistoryService.ts src/providers/cursor/history/cursorHistoryStore.ts tests/unit/providers/cursor/history/CursorConversationHistoryService.test.ts
  git commit -m "refactor(cursor): migrate history onto BaseHistoryService; wire sqlite-unavailable; collect deleted paths"
  ```

---

## Task 6: Migrate Codex impl onto `BaseHistoryService` (with fork-checkpoint-not-found)

Codex hydration has four branches: pending fork with existing messages (keep), pending fork without messages (truncate at checkpoint), established fork (source-prefix + fork-only merge), and normal hydration. The fork branches need the new `fork-checkpoint-not-found` error code when `resumeAt` cannot be located. `deleteConversationSession` is a permanent no-op (`~/.codex` transcripts are provider-owned).

**Files:**
- Modify: `src/providers/codex/history/CodexConversationHistoryService.ts:1-212`
- Test: `tests/unit/providers/codex/history/CodexConversationHistoryService.test.ts` *(create if missing)*

- [ ] **Step 1: Write the failing test.**

  Create `tests/unit/providers/codex/history/CodexConversationHistoryService.test.ts`:

  ```ts
  import { CodexConversationHistoryService } from '@/providers/codex/history/CodexConversationHistoryService';
  import * as Store from '@/providers/codex/history/CodexHistoryStore';
  import type { Conversation } from '@/core/types';
  import type { HydrationContext } from '@/core/providers/types';

  function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
    return {
      id: 'conv-1',
      title: 't',
      messages: [],
      providerId: 'codex',
      sessionId: 'thread-a',
      providerState: { threadId: 'thread-a', sessionFilePath: '/codex/sess-a.jsonl' },
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    } as unknown as Conversation;
  }
  const ctx: HydrationContext = { vaultPath: null, reason: 'open' };

  describe('CodexConversationHistoryService.hydrateConversationHistoryV2', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('returns empty:no-session when there is no thread id and no session file path', async () => {
      const svc = new CodexConversationHistoryService();
      const conv = makeConversation({ sessionId: null, providerState: {} });
      const out = await svc.hydrateConversationHistoryV2(conv, ctx);
      expect(out.kind).toBe('empty');
      if (out.kind === 'empty') expect(out.reason).toBe('no-session');
    });

    it('returns loaded with a stable sourceRef and the parsed messages on normal hydration', async () => {
      jest.spyOn(Store, 'parseCodexSessionFile').mockReturnValue([
        { id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as never,
      ]);
      const svc = new CodexConversationHistoryService();
      const conv = makeConversation();
      const out = await svc.hydrateConversationHistoryV2(conv, ctx);
      expect(out.kind).toBe('loaded');
      if (out.kind === 'loaded') {
        expect(out.sourceRef).toBe('thread-a::/codex/sess-a.jsonl');
        expect(out.messages.length).toBe(1);
      }
    });

    it('returns empty:no-rows when the session file parses to zero messages', async () => {
      jest.spyOn(Store, 'parseCodexSessionFile').mockReturnValue([]);
      const svc = new CodexConversationHistoryService();
      const conv = makeConversation();
      const out = await svc.hydrateConversationHistoryV2(conv, ctx);
      expect(out.kind).toBe('empty');
      if (out.kind === 'empty') expect(out.reason).toBe('no-rows');
    });

    it('returns error:fork-checkpoint-not-found when resumeAt is missing in the source transcript', async () => {
      jest.spyOn(Store, 'parseCodexSessionTurns').mockReturnValue([
        { turnId: 't0', messages: [{ id: 'm0', role: 'user', content: 'hi', timestamp: 1 } as never] },
      ]);
      // Pending fork pointing at a turn id that does not exist in the source.
      const conv = makeConversation({
        sessionId: null,
        providerState: {
          forkSource: { sessionId: 'src', resumeAt: 'NEVER' },
          forkSourceSessionFilePath: '/codex/src.jsonl',
        },
      });
      const svc = new CodexConversationHistoryService();
      const out = await svc.hydrateConversationHistoryV2(conv, ctx);
      expect(out.kind).toBe('error');
      if (out.kind === 'error') expect(out.error.code).toBe('fork-checkpoint-not-found');
    });
  });

  describe('CodexConversationHistoryService.deleteConversationSessionV2', () => {
    it('returns no-op:provider-owned (codex native transcripts are never deleted)', async () => {
      const svc = new CodexConversationHistoryService();
      const conv = makeConversation();
      const out = await svc.deleteConversationSessionV2(conv, ctx);
      expect(out).toEqual({ kind: 'no-op', reason: 'provider-owned' });
    });
  });

  describe('CodexConversationHistoryService.forkSupport', () => {
    it('is defined because Codex supports fork', () => {
      const svc = new CodexConversationHistoryService();
      expect(svc.forkSupport).toBeDefined();
      expect(typeof svc.forkSupport?.isPendingForkConversation).toBe('function');
      expect(typeof svc.forkSupport?.buildForkProviderState).toBe('function');
    });

    it('isPendingForkConversation returns true when forkSource is set and threadId/sessionId are absent', () => {
      const svc = new CodexConversationHistoryService();
      const conv = makeConversation({
        sessionId: null,
        providerState: { forkSource: { sessionId: 'src', resumeAt: 't1' } },
      });
      expect(svc.forkSupport?.isPendingForkConversation(conv)).toBe(true);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `npm run test -- tests/unit/providers/codex/history/CodexConversationHistoryService.test.ts`
  Expected: FAIL — Task 2's throw-stub trips, fork helpers still live on the class root, `fork-checkpoint-not-found` is not emitted.

- [ ] **Step 3: Rewrite the service.**

  Replace `src/providers/codex/history/CodexConversationHistoryService.ts` with:

  ```ts
  import * as fs from 'fs';

  import { BaseHistoryService } from '../../../core/providers/BaseHistoryService';
  import type {
    DeleteHistoryOutcome,
    HistoryLoadOutcome,
    HydrationContext,
    ProviderForkSupport,
  } from '../../../core/providers/types';
  import type { Conversation } from '../../../core/types';
  import type { CodexProviderState } from '../types';
  import { getCodexState } from '../types';
  import {
    type CodexParsedTurn,
    deriveCodexSessionsRootFromSessionPath,
    findCodexSessionFile,
    parseCodexSessionFile,
    parseCodexSessionTurns,
  } from './CodexHistoryStore';

  function readSessionTurns(sessionFilePath: string): CodexParsedTurn[] {
    let content: string;
    try {
      content = fs.readFileSync(sessionFilePath, 'utf-8');
    } catch {
      return [];
    }
    return parseCodexSessionTurns(content);
  }

  export class CodexConversationHistoryService extends BaseHistoryService<CodexProviderState> {
    forkSupport: ProviderForkSupport = {
      isPendingForkConversation: (conversation: Conversation): boolean => {
        const state = getCodexState(conversation.providerState);
        return !!state.forkSource && !state.threadId && !conversation.sessionId;
      },
      buildForkProviderState: (
        sourceSessionId: string,
        resumeAt: string,
        sourceProviderState?: Record<string, unknown>,
      ): Record<string, unknown> => {
        const sourceState = getCodexState(sourceProviderState);
        const sourceTranscriptRootPath = sourceState.transcriptRootPath
          ?? deriveCodexSessionsRootFromSessionPath(sourceState.sessionFilePath);
        const providerState: CodexProviderState = {
          forkSource: { sessionId: sourceSessionId, resumeAt },
          ...(sourceState.sessionFilePath ? { forkSourceSessionFilePath: sourceState.sessionFilePath } : {}),
          ...(sourceTranscriptRootPath ? { forkSourceTranscriptRootPath: sourceTranscriptRootPath } : {}),
        };
        return providerState as Record<string, unknown>;
      },
    };

    protected computeCacheKey(conversation: Conversation): string | null {
      const state = getCodexState(conversation.providerState);
      const transcriptRootPath = state.transcriptRootPath
        ?? deriveCodexSessionsRootFromSessionPath(state.sessionFilePath);
      const threadId = state.threadId ?? conversation.sessionId ?? null;
      const sessionFilePath = state.sessionFilePath ?? (
        threadId ? findCodexSessionFile(threadId, transcriptRootPath ?? undefined) : null
      );
      if (!sessionFilePath) return null;
      if (state.forkSource && state.threadId) return `fork::${state.threadId}`;
      return `${threadId ?? ''}::${sessionFilePath}`;
    }

    protected async loadMessages(
      conversation: Conversation,
      _ctx: HydrationContext,
    ): Promise<HistoryLoadOutcome> {
      const state = getCodexState(conversation.providerState);
      const transcriptRootPath = state.transcriptRootPath
        ?? deriveCodexSessionsRootFromSessionPath(state.sessionFilePath);

      // Pending fork with existing in-memory messages: keep them.
      if (this.forkSupport!.isPendingForkConversation(conversation) && conversation.messages.length > 0) {
        return { kind: 'cached', sourceRef: `pending-fork::${state.forkSource?.sessionId ?? ''}` };
      }

      // Pending fork without messages: hydrate from source transcript truncated at resumeAt.
      if (this.forkSupport!.isPendingForkConversation(conversation)) {
        const sourceSessionFile = this.resolveSourceSessionFile(state);
        if (!sourceSessionFile) return { kind: 'empty', reason: 'no-session', sourceRef: null };
        const turns = readSessionTurns(sourceSessionFile);
        const resumeAt = state.forkSource!.resumeAt;
        const truncated = this.truncateTurnsAtCheckpoint(turns, resumeAt);
        if (!truncated) {
          return {
            kind: 'error',
            error: {
              code: 'fork-checkpoint-not-found',
              message: 'Fork resumeAt checkpoint not found in source transcript.',
              detail: `resumeAt=${resumeAt}`,
            },
            sourceRef: `pending-fork::${state.forkSource!.sessionId}::${resumeAt}`,
          };
        }
        return {
          kind: 'loaded',
          messages: truncated.flatMap(t => t.messages),
          sourceRef: `pending-fork::${state.forkSource!.sessionId}::${resumeAt}`,
        };
      }

      // Established fork: source prefix + fork-only turns.
      if (state.forkSource && state.threadId) {
        const sourceSessionFile = this.resolveSourceSessionFile(state);
        const forkSessionFile = state.sessionFilePath ?? (
          state.threadId ? findCodexSessionFile(state.threadId, transcriptRootPath ?? undefined) : null
        );
        if (sourceSessionFile && forkSessionFile) {
          const sourceTurns = readSessionTurns(sourceSessionFile);
          const forkTurns = readSessionTurns(forkSessionFile);
          const resumeAt = state.forkSource.resumeAt;
          const sourcePrefix = this.truncateTurnsAtCheckpoint(sourceTurns, resumeAt);
          if (!sourcePrefix) {
            return {
              kind: 'error',
              error: {
                code: 'fork-checkpoint-not-found',
                message: 'Fork resumeAt checkpoint not found in source transcript.',
                detail: `resumeAt=${resumeAt}`,
              },
              sourceRef: `fork::${state.threadId}`,
            };
          }
          const sourceTurnIds = new Set(sourceTurns.map(t => t.turnId).filter(Boolean));
          const forkOnlyTurns = forkTurns.filter(t => !t.turnId || !sourceTurnIds.has(t.turnId));
          const messages = [
            ...sourcePrefix.flatMap(t => t.messages),
            ...forkOnlyTurns.flatMap(t => t.messages),
          ];
          if (messages.length === 0) return { kind: 'empty', reason: 'no-rows', sourceRef: `fork::${state.threadId}` };
          return { kind: 'loaded', messages, sourceRef: `fork::${state.threadId}` };
        }
      }

      // Normal hydration.
      const threadId = state.threadId ?? conversation.sessionId ?? null;
      const sessionFilePath = state.sessionFilePath ?? (
        threadId ? findCodexSessionFile(threadId, transcriptRootPath ?? undefined) : null
      );
      const resolvedTranscriptRootPath = transcriptRootPath
        ?? deriveCodexSessionsRootFromSessionPath(sessionFilePath);

      if (!sessionFilePath) return { kind: 'empty', reason: 'no-session', sourceRef: null };

      // Side-effect: backfill the provider state with the resolved paths so the
      // next call can short-circuit through computeCacheKey without re-walking
      // the sessions root. Behavior preserved from pre-refactor implementation.
      if (sessionFilePath !== state.sessionFilePath) {
        conversation.providerState = {
          ...(conversation.providerState ?? {}),
          ...(threadId ? { threadId } : {}),
          sessionFilePath,
          ...(resolvedTranscriptRootPath ? { transcriptRootPath: resolvedTranscriptRootPath } : {}),
        };
      } else if (resolvedTranscriptRootPath && resolvedTranscriptRootPath !== state.transcriptRootPath) {
        conversation.providerState = {
          ...(conversation.providerState ?? {}),
          ...(threadId ? { threadId } : {}),
          transcriptRootPath: resolvedTranscriptRootPath,
        };
      }

      const sourceRef = `${threadId ?? ''}::${sessionFilePath}`;
      const sdkMessages = parseCodexSessionFile(sessionFilePath);
      if (sdkMessages.length === 0) return { kind: 'empty', reason: 'no-rows', sourceRef };
      return { kind: 'loaded', messages: sdkMessages, sourceRef };
    }

    resolveSessionIdForConversation(conversation: Conversation | null): string | null {
      if (!conversation) return null;
      const state = getCodexState(conversation.providerState);
      return state.threadId ?? conversation.sessionId ?? state.forkSource?.sessionId ?? null;
    }

    async deleteConversationSessionV2(): Promise<DeleteHistoryOutcome> {
      // Never delete ~/.codex transcripts (provider-owned by design).
      return { kind: 'no-op', reason: 'provider-owned' };
    }

    buildPersistedProviderState(conversation: Conversation): CodexProviderState | undefined {
      const entries = Object.entries(getCodexState(conversation.providerState))
        .filter(([, value]) => value !== undefined);
      return entries.length > 0 ? Object.fromEntries(entries) as CodexProviderState : undefined;
    }

    private resolveSourceSessionFile(state: CodexProviderState): string | null {
      if (!state.forkSource) return null;
      const sourceTranscriptRootPath = state.forkSourceTranscriptRootPath
        ?? deriveCodexSessionsRootFromSessionPath(state.forkSourceSessionFilePath);
      return state.forkSourceSessionFilePath
        ?? findCodexSessionFile(state.forkSource.sessionId, sourceTranscriptRootPath ?? undefined);
    }

    private truncateTurnsAtCheckpoint(
      turns: CodexParsedTurn[],
      resumeAt: string,
    ): CodexParsedTurn[] | null {
      const checkpointIndex = turns.findIndex(turn => turn.turnId === resumeAt);
      if (checkpointIndex < 0) return null;
      return turns.slice(0, checkpointIndex + 1);
    }
  }
  ```

- [ ] **Step 4: Run the test to verify it passes.**

  Run: `npm run test -- tests/unit/providers/codex/history/CodexConversationHistoryService.test.ts`
  Expected: PASS — all four describe blocks including `fork-checkpoint-not-found`.

- [ ] **Verification gate: `npm run typecheck && npm run lint && npm run test` exits 0 before the commit step.**

  Run: `npm run typecheck && npm run lint && npm run test`
  Expected: PASS.

- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/codex/history/CodexConversationHistoryService.ts tests/unit/providers/codex/history/CodexConversationHistoryService.test.ts
  git commit -m "refactor(codex): migrate history onto BaseHistoryService; lift fork helpers; wire fork-checkpoint-not-found"
  ```

---

## Task 7: Migrate Claude impl onto `BaseHistoryService` (resumeAt-aware cache, mid-load abort)

Claude's hydration is the most involved: it walks `previousProviderSessionIds` for forked conversations, merges SDK messages with in-memory, enriches async-subagent tool calls, applies `subagentData`, and dedupes. The cache key must include `conversation.resumeAtMessageId` because rewind truncates the session at that anchor — two hydrations with different `resumeAtMessageId` would otherwise both return `cached` after the first. The multi-session walk must check `ctx.signal?.aborted` between sessions so tab-switch cancellation propagates mid-flight.

**Files:**
- Modify: `src/providers/claude/history/ClaudeConversationHistoryService.ts:313-446`
- Test: `tests/unit/providers/claude/history/ClaudeConversationHistoryService.test.ts` *(create or extend)*

- [ ] **Step 1: Write the failing test.**

  Create `tests/unit/providers/claude/history/ClaudeConversationHistoryService.test.ts`:

  ```ts
  import { ClaudeConversationHistoryService } from '@/providers/claude/history/ClaudeConversationHistoryService';
  import * as Store from '@/providers/claude/history/ClaudeHistoryStore';
  import type { Conversation } from '@/core/types';
  import type { HydrationContext } from '@/core/providers/types';

  function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
    return {
      id: 'conv-1',
      title: 't',
      messages: [],
      providerId: 'claude',
      sessionId: 'sdk-sess-a',
      providerState: { providerSessionId: 'sdk-sess-a' },
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    } as unknown as Conversation;
  }
  const ctx: HydrationContext = { vaultPath: '/vault', reason: 'open' };

  describe('ClaudeConversationHistoryService.hydrateConversationHistoryV2', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('returns empty:no-session when vaultPath is null', async () => {
      const svc = new ClaudeConversationHistoryService();
      const out = await svc.hydrateConversationHistoryV2(makeConversation(), { vaultPath: null, reason: 'open' });
      expect(out.kind).toBe('empty');
      if (out.kind === 'empty') expect(out.reason).toBe('no-session');
    });

    it('returns loaded with a composite sourceRef covering previous + current sessions', async () => {
      jest.spyOn(Store, 'sdkSessionExists').mockReturnValue(true);
      jest.spyOn(Store, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as never],
      });
      const svc = new ClaudeConversationHistoryService();
      const conv = makeConversation({
        providerState: {
          providerSessionId: 'sdk-sess-current',
          previousProviderSessionIds: ['sdk-sess-prev-1', 'sdk-sess-prev-2'],
        },
      });
      const out = await svc.hydrateConversationHistoryV2(conv, ctx);
      expect(out.kind).toBe('loaded');
      if (out.kind === 'loaded') {
        expect(out.sourceRef).toContain('sdk-sess-current');
        expect(out.sourceRef).toContain('sdk-sess-prev-1');
        expect(out.sourceRef).toContain('sdk-sess-prev-2');
      }
    });

    it('cache key includes resumeAtMessageId so rewind invalidates the cache', async () => {
      jest.spyOn(Store, 'sdkSessionExists').mockReturnValue(true);
      const loadSpy = jest.spyOn(Store, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 } as never],
      });
      const svc = new ClaudeConversationHistoryService();
      const conv = makeConversation();

      const first = await svc.hydrateConversationHistoryV2(conv, ctx);
      if (first.kind === 'loaded') conv.messages = first.messages;

      // Rewind: caller sets resumeAtMessageId on the conversation. Same sessionId,
      // different cache key => loadMessages must run again.
      (conv as unknown as { resumeAtMessageId: string }).resumeAtMessageId = 'm-prior';
      const second = await svc.hydrateConversationHistoryV2(conv, ctx);

      expect(second.kind).toBe('loaded');
      expect(loadSpy).toHaveBeenCalledTimes(2);
    });

    it('propagates ctx.signal.aborted mid-load between previous-session reads', async () => {
      jest.spyOn(Store, 'sdkSessionExists').mockReturnValue(true);
      const controller = new AbortController();
      let callCount = 0;
      jest.spyOn(Store, 'loadSDKSessionMessages').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) controller.abort();
        return { messages: [{ id: 'm', role: 'user', content: 'hi', timestamp: 1 } as never] };
      });

      const svc = new ClaudeConversationHistoryService();
      const conv = makeConversation({
        providerState: {
          providerSessionId: 'sdk-sess-current',
          previousProviderSessionIds: ['sdk-sess-prev-1', 'sdk-sess-prev-2'],
        },
      });
      const out = await svc.hydrateConversationHistoryV2(conv, { ...ctx, signal: controller.signal });

      expect(out.kind).toBe('error');
      if (out.kind === 'error') expect(out.error.code).toBe('cancelled');
      // Loader ran exactly once (the first previous session) before abort propagated.
      expect(callCount).toBe(1);
    });

    it('returns error:store-unreadable when every load reports an error', async () => {
      jest.spyOn(Store, 'sdkSessionExists').mockReturnValue(true);
      jest.spyOn(Store, 'loadSDKSessionMessages').mockResolvedValue({
        messages: [],
        error: 'simulated SDK load failure',
      });
      const svc = new ClaudeConversationHistoryService();
      const out = await svc.hydrateConversationHistoryV2(makeConversation(), ctx);
      expect(out.kind).toBe('error');
      if (out.kind === 'error') expect(out.error.code).toBe('store-unreadable');
    });

    it('returns empty:no-session when every previousSessionId is missing on disk', async () => {
      jest.spyOn(Store, 'sdkSessionExists').mockReturnValue(false);
      const svc = new ClaudeConversationHistoryService();
      const out = await svc.hydrateConversationHistoryV2(makeConversation(), ctx);
      expect(out.kind).toBe('empty');
    });
  });

  describe('ClaudeConversationHistoryService.deleteConversationSessionV2', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('returns deleted with the SDK session path when deletion succeeds', async () => {
      const deleteSpy = jest.spyOn(Store, 'deleteSDKSession').mockResolvedValue(undefined);
      const svc = new ClaudeConversationHistoryService();
      const out = await svc.deleteConversationSessionV2(makeConversation(), ctx);
      expect(deleteSpy).toHaveBeenCalledWith('/vault', 'sdk-sess-a');
      expect(out.kind).toBe('deleted');
    });

    it('returns no-op:no-session when sessionId is unresolved or vaultPath is null', async () => {
      const svc = new ClaudeConversationHistoryService();
      const out = await svc.deleteConversationSessionV2(
        makeConversation({ sessionId: null, providerState: {} }),
        ctx,
      );
      expect(out).toEqual({ kind: 'no-op', reason: 'no-session' });
    });
  });

  describe('ClaudeConversationHistoryService.forkSupport', () => {
    it('is defined because Claude supports fork', () => {
      const svc = new ClaudeConversationHistoryService();
      expect(svc.forkSupport).toBeDefined();
      expect(typeof svc.forkSupport?.isPendingForkConversation).toBe('function');
      expect(typeof svc.forkSupport?.buildForkProviderState).toBe('function');
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `npm run test -- tests/unit/providers/claude/history/ClaudeConversationHistoryService.test.ts`
  Expected: FAIL — Task 2 throw-stub, fork helpers live on the class root, cache key does not include `resumeAtMessageId`, abort signal is not checked mid-walk.

- [ ] **Step 3: Rewrite the service class.** (Preserve the four module-level helpers `chooseRicherResult`, `chooseRicherToolCalls`, `mergeSubagentInfo`, etc., at lines 19-310 unchanged.) In `src/providers/claude/history/ClaudeConversationHistoryService.ts`, replace the entire class block (lines 313-446) with:

  ```ts
  export class ClaudeConversationHistoryService extends BaseHistoryService<ClaudeProviderState> {
    forkSupport: ProviderForkSupport = {
      isPendingForkConversation: (conversation: Conversation): boolean => {
        const state = getClaudeState(conversation.providerState);
        return !!state.forkSource && !state.providerSessionId && !conversation.sessionId;
      },
      buildForkProviderState: (
        sourceSessionId: string,
        resumeAt: string,
        _sourceProviderState?: Record<string, unknown>,
      ): Record<string, unknown> => {
        const state: ClaudeProviderState = {
          forkSource: { sessionId: sourceSessionId, resumeAt } satisfies ForkSource,
        };
        return state as Record<string, unknown>;
      },
    };

    resolveSessionIdForConversation(conversation: Conversation | null): string | null {
      if (!conversation) return null;
      const state = getClaudeState(conversation.providerState);
      return state.providerSessionId ?? conversation.sessionId ?? state.forkSource?.sessionId ?? null;
    }

    buildPersistedProviderState(conversation: Conversation): ClaudeProviderState | undefined {
      const providerState: ClaudeProviderState = {
        ...getClaudeState(conversation.providerState),
      };
      const subagentData = buildPersistedSubagentData(conversation.messages);
      if (Object.keys(subagentData).length > 0) {
        providerState.subagentData = subagentData;
      } else {
        delete providerState.subagentData;
      }
      return sanitizeProviderState(providerState) as ClaudeProviderState | undefined;
    }

    protected computeCacheKey(
      conversation: Conversation,
      ctx: HydrationContext,
    ): string | null {
      if (!ctx.vaultPath) return null;
      const state = getClaudeState(conversation.providerState);
      const isPendingFork = this.forkSupport!.isPendingForkConversation(conversation);
      const ids: string[] = isPendingFork
        ? [state.forkSource!.sessionId]
        : [
            ...(state.previousProviderSessionIds ?? []),
            state.providerSessionId ?? conversation.sessionId ?? '',
          ].filter((id): id is string => !!id);
      if (ids.length === 0) return null;
      // Rewind invariant: include resumeAtMessageId so a rewind on the same set of
      // session ids produces a different cache key and forces re-hydration.
      const resumeAt = conversation.resumeAtMessageId ?? '';
      return `${ids.join('|')}|resume:${resumeAt}`;
    }

    protected async loadMessages(
      conversation: Conversation,
      ctx: HydrationContext,
    ): Promise<HistoryLoadOutcome> {
      if (!ctx.vaultPath) return { kind: 'empty', reason: 'no-session', sourceRef: null };

      const state = getClaudeState(conversation.providerState);
      const isPendingFork = this.forkSupport!.isPendingForkConversation(conversation);
      const allSessionIds: string[] = isPendingFork
        ? [state.forkSource!.sessionId]
        : [
            ...(state.previousProviderSessionIds || []),
            state.providerSessionId ?? conversation.sessionId,
          ].filter((id): id is string => !!id);
      if (allSessionIds.length === 0) return { kind: 'empty', reason: 'no-session', sourceRef: null };

      const sourceRef = `${allSessionIds.join('|')}|resume:${conversation.resumeAtMessageId ?? ''}`;
      const currentSessionId = isPendingFork
        ? state.forkSource!.sessionId
        : (state.providerSessionId ?? conversation.sessionId);

      const allSdkMessages: ChatMessage[] = [];
      let missingSessionCount = 0;
      let errorCount = 0;
      let successCount = 0;

      for (const sessionId of allSessionIds) {
        // Mid-load abort: check at each iteration so a tab switch during a long
        // multi-session read can cancel without finishing every previous-session
        // load. Returning `cancelled` here drops the cache entry via the base.
        if (ctx.signal?.aborted) {
          return {
            kind: 'error',
            error: { code: 'cancelled', message: 'Hydration cancelled' },
            sourceRef: null,
          };
        }
        if (!sdkSessionExists(ctx.vaultPath, sessionId)) { missingSessionCount++; continue; }
        const isCurrentSession = sessionId === currentSessionId;
        const truncateAt = isCurrentSession
          ? (isPendingFork ? state.forkSource!.resumeAt : conversation.resumeAtMessageId)
          : undefined;
        const result = await loadSDKSessionMessages(ctx.vaultPath, sessionId, truncateAt);
        if (result.error) { errorCount++; continue; }
        successCount++;
        allSdkMessages.push(...result.messages);
      }

      const allSessionsMissing = missingSessionCount === allSessionIds.length;
      if (allSessionsMissing) return { kind: 'empty', reason: 'no-session', sourceRef };
      if (errorCount > 0 && successCount === 0) {
        return {
          kind: 'error',
          error: {
            code: 'store-unreadable',
            message: 'Failed to read Claude SDK session(s).',
            detail: `errors=${errorCount} missing=${missingSessionCount} total=${allSessionIds.length}`,
          },
          sourceRef,
        };
      }

      const filteredSdkMessages = allSdkMessages.filter(msg => !msg.isRebuiltContext);
      const merged = dedupeMessages([
        ...conversation.messages,
        ...filteredSdkMessages,
      ]).sort((a, b) => a.timestamp - b.timestamp);

      if (state.subagentData) {
        await enrichAsyncSubagentToolCalls(state.subagentData, ctx.vaultPath, allSessionIds);
        applySubagentData(merged, state.subagentData);
      }

      if (merged.length === 0) return { kind: 'empty', reason: 'no-rows', sourceRef };

      return { kind: 'loaded', messages: merged, sourceRef };
    }

    async deleteConversationSessionV2(
      conversation: Conversation,
      ctx: HydrationContext,
    ): Promise<DeleteHistoryOutcome> {
      const state = getClaudeState(conversation.providerState);
      const sessionId = state.providerSessionId ?? conversation.sessionId;
      if (!ctx.vaultPath || !sessionId) {
        return { kind: 'no-op', reason: 'no-session' };
      }
      try {
        await deleteSDKSession(ctx.vaultPath, sessionId);
        return { kind: 'deleted', paths: [`${ctx.vaultPath}/.claude/sdk-sessions/${sessionId}`] };
      } catch (err) {
        return {
          kind: 'error',
          error: {
            code: 'store-unreadable',
            message: 'Failed to delete Claude SDK session.',
            detail: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }
  }
  ```

  Replace the top-of-file import block (lines 1-17) with:

  ```ts
  import { BaseHistoryService } from '../../../core/providers/BaseHistoryService';
  import type {
    DeleteHistoryOutcome,
    HistoryLoadOutcome,
    HydrationContext,
    ProviderForkSupport,
  } from '../../../core/providers/types';
  import { isSubagentToolName, TOOL_TASK } from '../../../core/tools/toolNames';
  import type {
    AsyncSubagentStatus,
    ChatMessage,
    Conversation,
    ForkSource,
    SubagentInfo,
    ToolCallInfo,
  } from '../../../core/types';
  import { type ClaudeProviderState, getClaudeState } from '../types/providerState';
  import {
    deleteSDKSession,
    loadSDKSessionMessages,
    loadSubagentToolCalls,
    sdkSessionExists,
  } from './ClaudeHistoryStore';
  ```

- [ ] **Step 4: Run the test to verify it passes.**

  Run: `npm run test -- tests/unit/providers/claude/history/ClaudeConversationHistoryService.test.ts`
  Expected: PASS — composite sourceRef, resumeAt-aware cache, mid-load abort, and delete outcomes all assert.

- [ ] **Verification gate: `npm run typecheck && npm run lint && npm run test` exits 0 before the commit step.**

  Run: `npm run typecheck && npm run lint && npm run test`
  Expected: PASS.

- [ ] **Step 5: Commit.**

  ```bash
  git add src/providers/claude/history/ClaudeConversationHistoryService.ts tests/unit/providers/claude/history/ClaudeConversationHistoryService.test.ts
  git commit -m "refactor(claude): migrate history onto BaseHistoryService; resumeAt-aware cache; mid-load abort"
  ```

---

## Task 8: Fork-split invariant + type-guard at the `TabManager` call site

The capability flag `capabilities.supportsFork` must agree with the runtime presence of `service.forkSupport`. After Tasks 4-7, Claude and Codex expose `forkSupport`; Opencode and Cursor do not. A `hasForkSupport(service)` type guard narrows the optional slot at the `TabManager.ts:642` call site so the buildForkProviderState assembly compiles only inside the guard — no runtime "Provider does not support fork" throw is reachable.

**Files:**
- Create: `tests/unit/core/providers/forkSupportInvariant.test.ts`
- Modify: `src/core/providers/typeGuards.ts` (or wherever provider-side helpers live — adjacent to `ProviderRegistry.ts`)
- Modify: `src/features/chat/tabs/TabManager.ts:642`

- [ ] **Step 1: Write the invariant test.**

  Create `tests/unit/core/providers/forkSupportInvariant.test.ts`:

  ```ts
  import '@/providers';
  import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
  import { hasForkSupport } from '@/core/providers/typeGuards';
  import type { ProviderId } from '@/core/providers/types';

  describe('history service fork-support invariant', () => {
    const providers: ProviderId[] = ['claude', 'codex', 'opencode', 'cursor'];

    it.each(providers)('%s: capabilities.supportsFork agrees with !!service.forkSupport', (id) => {
      const reg = ProviderRegistry.getRegistration(id);
      const service = ProviderRegistry.getConversationHistoryService(id);
      expect(reg.capabilities.supportsFork).toBe(!!service.forkSupport);
    });

    it.each(providers)('%s: hasForkSupport guard narrows the slot when capability is true', (id) => {
      const reg = ProviderRegistry.getRegistration(id);
      const service = ProviderRegistry.getConversationHistoryService(id);
      if (!reg.capabilities.supportsFork) return;
      expect(hasForkSupport(service)).toBe(true);
      if (hasForkSupport(service)) {
        // Inside the guard, forkSupport is non-null at the type level.
        expect(typeof service.forkSupport.isPendingForkConversation).toBe('function');
        expect(typeof service.forkSupport.buildForkProviderState).toBe('function');
      }
    });
  });
  ```

- [ ] **Step 2: Add the type guard.**

  Create or extend `src/core/providers/typeGuards.ts`:

  ```ts
  import type {
    ProviderConversationHistoryService,
    ProviderForkSupport,
  } from './types';

  /**
   * Narrows a history service to one that owns a `forkSupport` slot. Use this at
   * every call site that needs to read `service.forkSupport.*` so the optional
   * slot is type-level non-null inside the guard — no runtime throw needed.
   *
   * Registry invariant (forkSupportInvariant.test.ts): the guard returns true if
   * and only if `capabilities.supportsFork === true`. Code paths that already
   * gated on the capability flag can swap the runtime check for this guard.
   */
  export function hasForkSupport(
    service: ProviderConversationHistoryService,
  ): service is ProviderConversationHistoryService & { forkSupport: ProviderForkSupport } {
    return !!service.forkSupport;
  }
  ```

- [ ] **Step 3: Update the `TabManager` fork call site.**

  Open `src/features/chat/tabs/TabManager.ts` around `:642`. Replace the existing `service.buildForkProviderState(...)` or `service.forkSupport!.buildForkProviderState(...)` block with the guard:

  ```ts
  const service = ProviderRegistry.getConversationHistoryService(providerId);
  if (!hasForkSupport(service)) {
    // Capability invariant: capabilities.supportsFork === !!service.forkSupport
    // (enforced by forkSupportInvariant.test.ts). The fork affordance is hidden
    // upstream when supportsFork is false, so this branch is unreachable for
    // user-facing flows. Bail without throwing to keep this site type-safe.
    return;
  }
  const forkProviderState = service.forkSupport.buildForkProviderState(
    sourceSessionId,
    resumeAt,
    sourceProviderState,
  );
  ```

  Match the local variable names already in scope at `:642` — the snippet above is the shape, not the exact arg list. Read the file around `:642` first so the substitution preserves the original arguments.

- [ ] **Step 4: Run the test.**

  Run: `npm run test -- tests/unit/core/providers/forkSupportInvariant.test.ts`
  Expected: PASS — Claude (`supportsFork: true` + `forkSupport: defined`), Codex (true + defined), Opencode (false + undefined), Cursor (false + undefined). If the test fails for Opencode or Cursor with `expected false, received true`, the registration is leaking a no-op fork stub — find the offending file and delete the stub method block. Do not weaken the test.

- [ ] **Verification gate: `npm run typecheck && npm run lint && npm run test` exits 0 before the commit step.**

  Run: `npm run typecheck && npm run lint && npm run test`
  Expected: PASS.

- [ ] **Step 5: Commit.**

  ```bash
  git add tests/unit/core/providers/forkSupportInvariant.test.ts src/core/providers/typeGuards.ts src/features/chat/tabs/TabManager.ts
  git commit -m "feat(core): hasForkSupport type guard + invariant test; TabManager uses guard not throw"
  ```

---

## Task 9: Pin concrete `TPersistedState` per provider (type-only verification)

The interface accepts a generic in Task 2. Tasks 4-7 pin the concrete state type (`OpencodeProviderState`, `CursorProviderState`, `CodexProviderState`, `ClaudeProviderState`) in each `extends BaseHistoryService<...>` line. Task 9 verifies the pin holds end-to-end.

The registry erases the generic at the lookup boundary (`ProviderRegistry.getConversationHistoryService(id)` returns the non-generic interface — it cannot know the concrete state type from a runtime `id`). The cast at this boundary is documented; concrete typing is enforced at the impl site.

**Files:**
- Create: `tests/unit/core/providers/historyServiceStateTyping.test.ts`

- [ ] **Step 1: Write the test.**

  Create `tests/unit/core/providers/historyServiceStateTyping.test.ts`:

  ```ts
  import '@/providers';
  import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
  import type { ClaudeProviderState } from '@/providers/claude/types/providerState';
  import type { CodexProviderState } from '@/providers/codex/types';
  import type { CursorProviderState } from '@/providers/cursor/types';
  import type { OpencodeProviderState } from '@/providers/opencode/types';

  describe('history service buildPersistedProviderState typing', () => {
    // Note on registry erasure: ProviderRegistry.getConversationHistoryService(id)
    // returns the non-generic interface because the registry is id-keyed at
    // runtime and cannot infer the concrete TPersistedState from a string id.
    // Concrete typing is enforced at each impl site through
    // `class X extends BaseHistoryService<XProviderState>`. The casts here
    // confirm structural compatibility — they do not weaken the impl-side pin.

    it('claude returns ClaudeProviderState | undefined', () => {
      const svc = ProviderRegistry.getConversationHistoryService('claude');
      const result = svc.buildPersistedProviderState?.({ id: 'x', messages: [], providerState: {} } as never);
      const _typed: ClaudeProviderState | undefined = result as ClaudeProviderState | undefined;
      expect(_typed === undefined || typeof _typed === 'object').toBe(true);
    });

    it('codex returns CodexProviderState | undefined', () => {
      const svc = ProviderRegistry.getConversationHistoryService('codex');
      const result = svc.buildPersistedProviderState?.({ id: 'x', messages: [], providerState: {} } as never);
      const _typed: CodexProviderState | undefined = result as CodexProviderState | undefined;
      expect(_typed === undefined || typeof _typed === 'object').toBe(true);
    });

    it('opencode returns OpencodeProviderState | undefined', () => {
      const svc = ProviderRegistry.getConversationHistoryService('opencode');
      const result = svc.buildPersistedProviderState?.({
        id: 'x',
        messages: [],
        providerState: { databasePath: '/tmp/db' },
      } as never);
      const _typed: OpencodeProviderState | undefined = result as OpencodeProviderState | undefined;
      expect(_typed === undefined || typeof _typed === 'object').toBe(true);
    });

    it('cursor returns CursorProviderState | undefined', () => {
      const svc = ProviderRegistry.getConversationHistoryService('cursor');
      const result = svc.buildPersistedProviderState?.({
        id: 'x',
        messages: [],
        sessionId: 'sess',
        providerState: { chatSessionId: 'sess' },
      } as never);
      const _typed: CursorProviderState | undefined = result as CursorProviderState | undefined;
      expect(_typed === undefined || typeof _typed === 'object').toBe(true);
    });
  });
  ```

- [ ] **Step 2: Run the test.**

  Run: `npm run test -- tests/unit/core/providers/historyServiceStateTyping.test.ts`
  Expected: PASS.

- [ ] **Verification gate: `npm run typecheck && npm run lint && npm run test` exits 0 before the commit step.**

  Run: `npm run typecheck && npm run lint && npm run test`
  Expected: PASS. If typecheck fails on a `class X extends BaseHistoryService<Record<string, unknown>>` somewhere, go fix the impl, not the test.

- [ ] **Step 3: Commit.**

  ```bash
  git add tests/unit/core/providers/historyServiceStateTyping.test.ts
  git commit -m "test(core): assert concrete TPersistedState pins per provider"
  ```

---

## Task 10: Migrate callers to v2 (caller owns `conversation.messages` assignment)

The two consumer sites need to:
1. Call `hydrateConversationHistoryV2` / `deleteConversationSessionV2` with a `HydrationContext`.
2. Branch on `HistoryLoadOutcome`. On `loaded`, the caller assigns `conversation.messages = outcome.messages`. On `error`, emit `conversation:hydration-failed`. On `cached` / `empty`, no mutation.
3. Branch on `DeleteHistoryOutcome` (log error, log no-op reason, otherwise proceed).
4. Route fork helpers through `service.forkSupport?.` with the `hasForkSupport` guard.

**Files:**
- Modify: `src/app/conversations/ConversationStore.ts:144-158` (delete) and `:204` (isPendingForkConversation) and `:247-251` (hydrate)
- Test: `tests/unit/app/conversations/ConversationStore.test.ts` *(extend)*

- [ ] **Step 1: Write the failing parameterized caller-branching test.**

  Extend `tests/unit/app/conversations/ConversationStore.test.ts` with `it.each` covering all four outcome kinds:

  ```ts
  import { ConversationStore } from '@/app/conversations/ConversationStore';
  import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
  import type { HistoryLoadOutcome } from '@/core/providers/types';

  function makeMsg(): never {
    return { id: 'm', role: 'user', content: 'hi', timestamp: 1 } as never;
  }

  describe('ConversationStore — caller branches on HistoryLoadOutcome', () => {
    it.each<[string, HistoryLoadOutcome, { mutates: boolean; emits: string | null }]>([
      ['loaded', { kind: 'loaded', messages: [makeMsg()], sourceRef: 'k' }, { mutates: true, emits: null }],
      ['cached', { kind: 'cached', sourceRef: 'k' }, { mutates: false, emits: null }],
      ['empty',  { kind: 'empty', reason: 'no-rows', sourceRef: 'k' }, { mutates: false, emits: null }],
      ['error',  { kind: 'error', error: { code: 'store-unreadable', message: 'x' }, sourceRef: null }, { mutates: false, emits: 'conversation:hydration-failed' }],
    ])('branches correctly on %s outcome', async (_label, outcome, expected) => {
      const hydrateSpy = jest.fn().mockResolvedValue(outcome);
      const emitSpy = jest.fn();
      jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
        hydrateConversationHistoryV2: hydrateSpy,
        deleteConversationSessionV2: jest.fn().mockResolvedValue({ kind: 'no-op', reason: 'no-session' }),
        resolveSessionIdForConversation: () => null,
      } as never);

      const deps = {
        getVaultPath: () => '/vault',
        storage: { sessions: { saveMetadata: jest.fn(), deleteMetadata: jest.fn(), toSessionMetadata: jest.fn() } },
        events: { emit: emitSpy },
        repairViewsAfterDelete: jest.fn(),
      };
      const store = new ConversationStore(deps as never);
      // Seed one conversation via the existing test harness helper.
      // ...

      const conv = (store as unknown as { conversations: Array<{ id: string; messages: unknown[] }> }).conversations[0];
      const before = conv.messages.length;

      await store.switchConversation(conv.id);

      const after = conv.messages.length;
      if (expected.mutates) {
        expect(after).toBe(1);
      } else {
        expect(after).toBe(before);
      }
      if (expected.emits) {
        expect(emitSpy).toHaveBeenCalledWith(expected.emits, expect.objectContaining({ conversationId: conv.id }));
      } else {
        expect(emitSpy).not.toHaveBeenCalledWith('conversation:hydration-failed', expect.anything());
      }
    });

    it('passes HydrationContext with vaultPath and reason to v2', async () => {
      const hydrateSpy = jest.fn().mockResolvedValue({ kind: 'empty', reason: 'no-session', sourceRef: null });
      jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
        hydrateConversationHistoryV2: hydrateSpy,
        deleteConversationSessionV2: jest.fn().mockResolvedValue({ kind: 'no-op', reason: 'no-session' }),
        resolveSessionIdForConversation: () => null,
      } as never);
      const deps = {
        getVaultPath: () => '/vault',
        storage: { sessions: { saveMetadata: jest.fn(), deleteMetadata: jest.fn(), toSessionMetadata: jest.fn() } },
        events: { emit: jest.fn() },
        repairViewsAfterDelete: jest.fn(),
      };
      const store = new ConversationStore(deps as never);
      await store.switchConversation('seed-id');
      expect(hydrateSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ vaultPath: '/vault', reason: expect.any(String) }),
      );
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `npm run test -- tests/unit/app/conversations/ConversationStore.test.ts`
  Expected: FAIL — caller still calls v1 with `'/vault'` as the second arg; outcome-branching does not exist.

- [ ] **Step 3: Update the `ConversationStore` call sites.**

  Open `src/app/conversations/ConversationStore.ts`. Add at the top:

  ```ts
  import type { HydrationContext } from '../../core/providers/types';
  import { hasForkSupport } from '../../core/providers/typeGuards';
  ```

  Replace `loadSdkMessagesForConversation` at `:247-251`:

  ```ts
    private async loadSdkMessagesForConversation(
      conversation: Conversation,
      reason: HydrationContext['reason'] = 'open',
    ): Promise<void> {
      const ctx: HydrationContext = { vaultPath: this.deps.getVaultPath(), reason };
      const service = ProviderRegistry.getConversationHistoryService(conversation.providerId);
      const outcome = await service.hydrateConversationHistoryV2(conversation, ctx);
      switch (outcome.kind) {
        case 'loaded':
          conversation.messages = outcome.messages;
          break;
        case 'cached':
        case 'empty':
          // No mutation. UI either already shows the cached transcript or an
          // intentional empty state. Empty is not an error condition.
          break;
        case 'error':
          this.deps.events.emit('conversation:hydration-failed', {
            conversationId: conversation.id,
            code: outcome.error.code,
            message: outcome.error.message,
          });
          break;
      }
    }
  ```

  Replace the `deleteConversation` body at `:144-158`:

  ```ts
    async deleteConversation(id: string): Promise<void> {
      const index = this.conversations.findIndex((c) => c.id === id);
      if (index === -1) return;
      const conversation = this.conversations[index];
      this.conversations.splice(index, 1);

      const ctx: HydrationContext = { vaultPath: this.deps.getVaultPath(), reason: 'open' };
      const outcome = await ProviderRegistry
        .getConversationHistoryService(conversation.providerId)
        .deleteConversationSessionV2(conversation, ctx);
      if (outcome.kind === 'error') {
        this.deps.events.emit('conversation:hydration-failed', {
          conversationId: id,
          code: outcome.error.code,
          message: outcome.error.message,
        });
      }

      await this.deps.storage.sessions.deleteMetadata(id);
      await this.deps.repairViewsAfterDelete(id);
    }
  ```

  Replace the `isPendingForkConversation` access at `:204`:

  ```ts
      const service = ProviderRegistry.getConversationHistoryService(conversation.providerId);
      const isPendingFork = hasForkSupport(service)
        ? service.forkSupport.isPendingForkConversation(conversation)
        : false;
      if (!isPendingFork) {
        for (const msg of conversation.messages) {
          if (msg.images) {
            for (const img of msg.images) {
              img.data = '';
            }
          }
        }
      }
  ```

  Add the `conversation:hydration-failed` event to the typed events module if it does not exist yet — payload `{ conversationId: string; code: HistoryLoadErrorCode; message: string }`.

- [ ] **Step 4: Run the test to verify it passes.**

  Run: `npm run test -- tests/unit/app/conversations/ConversationStore.test.ts`
  Expected: PASS — all four `it.each` branches assert and the HydrationContext test passes.

- [ ] **Verification gate: `npm run typecheck && npm run lint && npm run test` exits 0 before the commit step.**

  Run: `npm run typecheck && npm run lint && npm run test`
  Expected: PASS. Tasks 1-9 left v1 callable through the bridge; this task migrates the live caller to v2 while v1 still satisfies the interface.

- [ ] **Step 5: Commit.**

  ```bash
  git add src/app/conversations/ConversationStore.ts tests/unit/app/conversations/ConversationStore.test.ts
  git commit -m "refactor(app): consume HistoryLoadOutcome/DeleteHistoryOutcome v2; route fork via hasForkSupport"
  ```

---

## Task 11: Hydration-failed UI subscriber

Without this, Opencode users with corrupt SQLite see an empty pane (regression — the sentinel-message previously rendered the error in-stream). Subscribe to `conversation:hydration-failed`, render an Obsidian `Notice`, and show an inline error banner in the conversation pane. This MUST land before v1 collapse so no provider is silently broken in production between tasks.

**Files:**
- Create: `src/features/chat/hydration/hydrationFailedSubscriber.ts`
- Test: `tests/unit/features/chat/hydration/hydrationFailedSubscriber.test.ts`
- Modify: the chat plugin bootstrap (likely `src/features/chat/ChatView.ts` or the feature's main entry — locate the existing `events.on('conversation:...')` subscriber set and add the new subscription next to it)

- [ ] **Step 1: Write the failing test.**

  Create `tests/unit/features/chat/hydration/hydrationFailedSubscriber.test.ts`:

  ```ts
  import { Notice } from 'obsidian';
  import { registerHydrationFailedSubscriber } from '@/features/chat/hydration/hydrationFailedSubscriber';

  jest.mock('obsidian', () => ({
    Notice: jest.fn(),
  }));

  describe('hydrationFailedSubscriber', () => {
    afterEach(() => { jest.clearAllMocks(); });

    it('renders an Obsidian Notice on the event', () => {
      const handlers: Record<string, (payload: unknown) => void> = {};
      const events = { on: (name: string, h: typeof handlers[string]) => { handlers[name] = h; } };
      const renderBanner = jest.fn();
      registerHydrationFailedSubscriber(events as never, renderBanner);

      handlers['conversation:hydration-failed']({
        conversationId: 'c1',
        code: 'store-unreadable',
        message: 'Could not read history.',
      });

      expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Could not read history.'));
      expect(renderBanner).toHaveBeenCalledWith('c1', expect.objectContaining({ code: 'store-unreadable' }));
    });

    it('passes the error code into the banner so the UI can branch on sqlite-unavailable etc', () => {
      const handlers: Record<string, (payload: unknown) => void> = {};
      const events = { on: (name: string, h: typeof handlers[string]) => { handlers[name] = h; } };
      const renderBanner = jest.fn();
      registerHydrationFailedSubscriber(events as never, renderBanner);

      handlers['conversation:hydration-failed']({
        conversationId: 'c1',
        code: 'sqlite-unavailable',
        message: 'OpenCode history requires node:sqlite or the sqlite3 CLI.',
      });

      expect(renderBanner).toHaveBeenCalledWith('c1', expect.objectContaining({ code: 'sqlite-unavailable' }));
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `npm run test -- tests/unit/features/chat/hydration/hydrationFailedSubscriber.test.ts`
  Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the subscriber.**

  Create `src/features/chat/hydration/hydrationFailedSubscriber.ts`:

  ```ts
  import { Notice } from 'obsidian';
  import type { ClaudianEventBus } from '../../../core/events/types';
  import type { HistoryLoadErrorCode } from '../../../core/providers/types';

  export interface HydrationFailedPayload {
    conversationId: string;
    code: HistoryLoadErrorCode;
    message: string;
  }

  export type HydrationBannerRenderer = (
    conversationId: string,
    payload: { code: HistoryLoadErrorCode; message: string },
  ) => void;

  /**
   * Subscribes to `conversation:hydration-failed` and surfaces the failure two ways:
   *   1. an Obsidian `Notice` so the user sees the error even if the conversation
   *      pane is not the active tab
   *   2. an inline banner inside the conversation pane (via `renderBanner`) so the
   *      pane is not blank — this replaces the in-stream sentinel that Opencode
   *      previously used (Task 4 removed it).
   */
  export function registerHydrationFailedSubscriber(
    events: ClaudianEventBus,
    renderBanner: HydrationBannerRenderer,
  ): void {
    events.on('conversation:hydration-failed', (payload: HydrationFailedPayload) => {
      new Notice(payload.message);
      renderBanner(payload.conversationId, { code: payload.code, message: payload.message });
    });
  }
  ```

- [ ] **Step 4: Wire the subscriber into the chat feature bootstrap.**

  Find the existing chat-feature initialization (likely `ChatView.onOpen` or the chat plugin bootstrap module that already registers `events.on('conversation:created', ...)` handlers). Add:

  ```ts
  import { registerHydrationFailedSubscriber } from './hydration/hydrationFailedSubscriber';

  registerHydrationFailedSubscriber(this.events, (conversationId, payload) => {
    // Locate the conversation pane DOM (existing helper); render an `.error-banner` div
    // above the message list. Re-use the existing styling for warning banners if one
    // already exists; otherwise add a minimal banner in `src/style/`.
    const pane = this.getConversationPaneEl(conversationId);
    if (!pane) return;
    pane.querySelector('.claudian-hydration-error')?.remove();
    const banner = pane.createDiv({ cls: 'claudian-hydration-error' });
    banner.setText(payload.message);
    banner.dataset.errorCode = payload.code;
  });
  ```

  Read the existing chat bootstrap so the `events` and `getConversationPaneEl` references match the real names.

- [ ] **Step 5: Run the tests.**

  Run: `npm run test -- tests/unit/features/chat/hydration/hydrationFailedSubscriber.test.ts`
  Expected: PASS.

- [ ] **Verification gate: `npm run typecheck && npm run lint && npm run test` exits 0 before the commit step.**

  Run: `npm run typecheck && npm run lint && npm run test`
  Expected: PASS.

- [ ] **Step 6: Commit.**

  ```bash
  git add src/features/chat/hydration/hydrationFailedSubscriber.ts tests/unit/features/chat/hydration/hydrationFailedSubscriber.test.ts <chat-bootstrap-file>
  git commit -m "feat(chat): render Notice + inline banner on conversation:hydration-failed"
  ```

---

## Task 12: Land the shared contract test matrix

Parameterized contract suite that exercises the outcome scenarios against every registered provider using fakes (no real disk). Catches drift between providers as the contract evolves. Each scenario covers: empty (no-session, no-store), store-missing, store-unreadable, sqlite-unavailable, cancelled, force-refresh bypasses cache, second call returns cached, delete-unknown-session no-ops.

**Files:**
- Create: `tests/unit/providers/shared/historyServiceContract.test.ts`

Expected call counts per provider (for use in the assertions instead of the dropped `h.id === 'claude' ? 2 : 2` ternary):
- claude: 2 distinct `loadSDKSessionMessages` calls per hydrate (one previous + one current, given the seed fixture).
- codex: 1 call per hydrate (`parseCodexSessionFile`).
- opencode: 1 call per hydrate (`loadOpencodeSessionMessages`).
- cursor: 1 call per hydrate (`loadCursorChatMessagesFromStoreResult`).

The `forceRefresh` test asserts each impl's load function was called `expectedCount * 2` times after two hydrate calls.

- [ ] **Step 1: Write the test.**

  Create `tests/unit/providers/shared/historyServiceContract.test.ts`:

  ```ts
  import '@/providers';
  import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
  import type {
    HistoryLoadOutcome,
    HydrationContext,
    ProviderConversationHistoryService,
  } from '@/core/providers/types';
  import type { Conversation } from '@/core/types';

  type ProviderId = 'claude' | 'codex' | 'opencode' | 'cursor';

  interface ProviderHarness {
    id: ProviderId;
    seedConversation(): Conversation;
    /** Loader calls per single hydrate, given seedConversation. */
    callsPerHydrate: number;
    /** The spy(s) on the underlying load function — last entry is the loader call counter. */
    stubStore(out: 'loaded-one' | 'empty-no-session' | 'empty-no-rows' | 'error-store-missing' | 'error-sqlite-unavailable'): jest.SpyInstance | jest.SpyInstance[];
  }

  function makeBaseConversation(id: ProviderId, overrides: Partial<Conversation> = {}): Conversation {
    return {
      id: 'conv-1',
      title: 't',
      messages: [],
      providerId: id,
      sessionId: 'sess-a',
      providerState: {},
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    } as unknown as Conversation;
  }

  const harnesses: ProviderHarness[] = [
    {
      id: 'claude',
      callsPerHydrate: 2,
      seedConversation: () => makeBaseConversation('claude', {
        providerState: {
          providerSessionId: 'sdk-current',
          previousProviderSessionIds: ['sdk-prev'],
        },
      }),
      stubStore: (out) => {
        const Store = jest.requireActual<typeof import('@/providers/claude/history/ClaudeHistoryStore')>(
          '@/providers/claude/history/ClaudeHistoryStore',
        );
        const exists = jest.spyOn(Store, 'sdkSessionExists').mockReturnValue(out !== 'empty-no-session');
        const load = jest.spyOn(Store, 'loadSDKSessionMessages');
        switch (out) {
          case 'loaded-one':
            load.mockResolvedValue({ messages: [{ id: 'm', role: 'user', content: 'hi', timestamp: 1 } as never] });
            break;
          case 'empty-no-rows':
            load.mockResolvedValue({ messages: [] });
            break;
          case 'error-store-missing':
            load.mockResolvedValue({ messages: [], error: 'simulated' });
            break;
          case 'error-sqlite-unavailable':
            // Claude does not surface sqlite-unavailable (uses JSONL). The harness
            // maps this to empty so the parameterized test can skip the assertion
            // for Claude specifically (see the test body).
            load.mockResolvedValue({ messages: [] });
            break;
          case 'empty-no-session':
            break;
        }
        return [exists, load];
      },
    },
    {
      id: 'codex',
      callsPerHydrate: 1,
      seedConversation: () => makeBaseConversation('codex', {
        providerState: { threadId: 'thread-a', sessionFilePath: '/codex/sess-a.jsonl' },
      }),
      stubStore: (out) => {
        const Store = jest.requireActual<typeof import('@/providers/codex/history/CodexHistoryStore')>(
          '@/providers/codex/history/CodexHistoryStore',
        );
        const parse = jest.spyOn(Store, 'parseCodexSessionFile');
        switch (out) {
          case 'loaded-one':
            parse.mockReturnValue([{ id: 'm', role: 'user', content: 'hi', timestamp: 1 } as never]);
            break;
          case 'empty-no-rows':
          case 'empty-no-session':
          case 'error-store-missing':
          case 'error-sqlite-unavailable':
            // Codex JSONL parser does not distinguish these — treats them as empty.
            // The contract test accepts 'empty' for Codex on the error scenarios.
            parse.mockReturnValue([]);
            break;
        }
        return parse;
      },
    },
    {
      id: 'opencode',
      callsPerHydrate: 1,
      seedConversation: () => makeBaseConversation('opencode', {
        providerState: { databasePath: '/tmp/oc.db' },
      }),
      stubStore: (out) => {
        const Store = jest.requireActual<typeof import('@/providers/opencode/history/OpencodeHistoryStore')>(
          '@/providers/opencode/history/OpencodeHistoryStore',
        );
        const load = jest.spyOn(Store, 'loadOpencodeSessionMessages');
        switch (out) {
          case 'loaded-one':
            load.mockResolvedValue({ messages: [{ id: 'm', role: 'user', content: 'hi', timestamp: 1 } as never] });
            break;
          case 'empty-no-rows':
            load.mockResolvedValue({ messages: [] });
            break;
          case 'error-store-missing':
            load.mockResolvedValue({ messages: [], error: { code: 'store-unreadable', message: 'simulated' } });
            break;
          case 'error-sqlite-unavailable':
            load.mockResolvedValue({ messages: [], error: { code: 'sqlite-unavailable', message: 'simulated' } });
            break;
          case 'empty-no-session':
            break;
        }
        return load;
      },
    },
    {
      id: 'cursor',
      callsPerHydrate: 1,
      seedConversation: () => makeBaseConversation('cursor', {
        providerState: { chatSessionId: 'sess-a' },
      }),
      stubStore: (out) => {
        const Store = jest.requireActual<typeof import('@/providers/cursor/history/cursorHistoryStore')>(
          '@/providers/cursor/history/cursorHistoryStore',
        );
        const resolveDbPath = jest.spyOn(Store, 'resolveCursorStoreDbPath');
        const load = jest.spyOn(Store, 'loadCursorChatMessagesFromStoreResult');
        switch (out) {
          case 'loaded-one':
            resolveDbPath.mockReturnValue('/tmp/cursor-store.db');
            load.mockReturnValue({ messages: [{ id: 'm', role: 'user', content: 'hi', timestamp: 1 } as never] });
            break;
          case 'empty-no-rows':
            resolveDbPath.mockReturnValue('/tmp/cursor-store.db');
            load.mockReturnValue({ messages: [] });
            break;
          case 'error-store-missing':
            resolveDbPath.mockReturnValue('/tmp/cursor-store.db');
            load.mockReturnValue({ messages: [], error: 'simulated open failure' });
            break;
          case 'error-sqlite-unavailable':
            resolveDbPath.mockReturnValue('/tmp/cursor-store.db');
            load.mockReturnValue({
              messages: [],
              error: { code: 'sqlite-unavailable', message: 'simulated' },
            });
            break;
          case 'empty-no-session':
            resolveDbPath.mockReturnValue(null);
            load.mockReturnValue({ messages: [] });
            break;
        }
        return [resolveDbPath, load];
      },
    },
  ];

  const ctxOpen = (): HydrationContext => ({ vaultPath: '/vault', reason: 'open' });

  function getService(id: ProviderId): ProviderConversationHistoryService {
    return ProviderRegistry.getConversationHistoryService(id);
  }

  function loadSpy(stubs: jest.SpyInstance | jest.SpyInstance[]): jest.SpyInstance {
    return Array.isArray(stubs) ? stubs[stubs.length - 1] : stubs;
  }

  describe.each(harnesses)('history service contract — $id', (h) => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('returns loaded with messages and a sourceRef when the store has rows', async () => {
      h.stubStore('loaded-one');
      const conv = h.seedConversation();
      const out = await getService(h.id).hydrateConversationHistoryV2(conv, ctxOpen());
      expect(out.kind).toBe('loaded');
      if (out.kind === 'loaded') {
        expect(out.messages.length).toBeGreaterThan(0);
        expect(typeof out.sourceRef).toBe('string');
        expect(out.sourceRef.length).toBeGreaterThan(0);
      }
    });

    it('returns empty when the store has zero rows', async () => {
      h.stubStore('empty-no-rows');
      const out = await getService(h.id).hydrateConversationHistoryV2(h.seedConversation(), ctxOpen());
      expect(out.kind).toBe('empty');
    });

    it('returns error when the store reports an unreadable error', async () => {
      h.stubStore('error-store-missing');
      const out = await getService(h.id).hydrateConversationHistoryV2(h.seedConversation(), ctxOpen());
      if (h.id === 'codex') {
        // Codex JSONL parser swallows fs errors -> reports empty. Acceptable.
        expect(['error', 'empty']).toContain(out.kind);
      } else {
        expect(out.kind).toBe('error');
      }
    });

    it('returns error:sqlite-unavailable when the store reports the sqlite-unavailable code', async () => {
      h.stubStore('error-sqlite-unavailable');
      const out = await getService(h.id).hydrateConversationHistoryV2(h.seedConversation(), ctxOpen());
      if (h.id === 'claude' || h.id === 'codex') {
        // Claude uses JSONL, Codex uses JSONL — neither surfaces sqlite-unavailable.
        // The harness maps this scenario to empty for these providers.
        expect(out.kind).toBe('empty');
      } else {
        expect(out.kind).toBe('error');
        if (out.kind === 'error') expect(out.error.code).toBe('sqlite-unavailable');
      }
    });

    it('returns cached on the second call with the same context', async () => {
      h.stubStore('loaded-one');
      const conv = h.seedConversation();
      const svc = getService(h.id);
      const first = await svc.hydrateConversationHistoryV2(conv, ctxOpen());
      if (first.kind === 'loaded') conv.messages = first.messages;
      const second = await svc.hydrateConversationHistoryV2(conv, ctxOpen());
      expect(second.kind).toBe('cached');
    });

    it('forceRefresh: true bypasses the cache and re-invokes the loader', async () => {
      const stubs = h.stubStore('loaded-one');
      const conv = h.seedConversation();
      const svc = getService(h.id);
      const first = await svc.hydrateConversationHistoryV2(conv, ctxOpen());
      if (first.kind === 'loaded') conv.messages = first.messages;
      await svc.hydrateConversationHistoryV2(conv, { ...ctxOpen(), forceRefresh: true });
      // Loader runs callsPerHydrate * 2 across both hydrate calls.
      expect(loadSpy(stubs)).toHaveBeenCalledTimes(h.callsPerHydrate * 2);
    });

    it('cancelled signal returns error:cancelled before touching the store', async () => {
      const stubs = h.stubStore('loaded-one');
      const conv = h.seedConversation();
      const controller = new AbortController();
      controller.abort();
      const out = await getService(h.id).hydrateConversationHistoryV2(conv, { ...ctxOpen(), signal: controller.signal });
      expect(out.kind).toBe('error');
      if (out.kind === 'error') expect(out.error.code).toBe('cancelled');
      expect(loadSpy(stubs)).not.toHaveBeenCalled();
    });

    it('delete of a conversation without a resolvable session returns no-op or deleted with empty paths', async () => {
      const conv = h.seedConversation();
      conv.sessionId = null;
      conv.providerState = {};
      const out = await getService(h.id).deleteConversationSessionV2(conv, ctxOpen());
      expect(out.kind === 'no-op' || (out.kind === 'deleted' && out.paths.length === 0)).toBe(true);
    });
  });
  ```

- [ ] **Step 2: Run the matrix.**

  Run: `npm run test -- tests/unit/providers/shared/historyServiceContract.test.ts`
  Expected: PASS — all scenarios across all four providers.

- [ ] **Verification gate: `npm run typecheck && npm run lint && npm run test` exits 0 before the commit step.**

  Run: `npm run typecheck && npm run lint && npm run test`
  Expected: PASS.

- [ ] **Step 3: Commit.**

  ```bash
  git add tests/unit/providers/shared/historyServiceContract.test.ts
  git commit -m "test(providers): shared v2 contract matrix across all four providers"
  ```

---

## Task 13: Collapse v1 — remove the deprecated surface

Every production caller is on v2 (Task 10), the hydration-failed UI is live (Task 11), and the contract matrix covers v2 (Task 12). Task 13 removes the deprecated methods from the interface, removes the v1 bridges from `BaseHistoryService` and the four impls, deletes the dead Opencode sentinel exports, and verifies the full chain.

**Files:**
- Modify: `src/core/providers/types.ts` (drop the four `@deprecated` method signatures)
- Modify: `src/core/providers/BaseHistoryService.ts` (drop the v1 bridge methods)
- Modify: each of the four impls (remove the Task 2 throw-stubs / v1 method declarations now that the interface no longer requires them)
- Modify: `src/providers/opencode/history/OpencodeHistoryStore.ts:265-303` (delete `createOpencodeHydrationDiagnosticMessage` and `isOpencodeSessionHydrationDiagnosticMessage`)

- [ ] **Step 1: Search for any remaining v1 callers.**

  Run: `git grep -nE "hydrateConversationHistory\(|deleteConversationSession\(|isPendingForkConversation|buildForkProviderState" -- 'src/**' 'tests/**'`
  Expected: every match is one of (a) a v2 method (`hydrateConversationHistoryV2`, etc.), (b) a method **inside `forkSupport`** access (`service.forkSupport.isPendingForkConversation`, `service.forkSupport.buildForkProviderState`), or (c) a comment or doc reference. Any bare v1 call site is a leak — fix it before continuing.

- [ ] **Step 2: Drop v1 from the interface.**

  Open `src/core/providers/types.ts`. Remove the four `@deprecated` method signatures (`hydrateConversationHistory`, `deleteConversationSession`, `isPendingForkConversation`, `buildForkProviderState`) from `ProviderConversationHistoryService`. The interface now contains v2 only.

- [ ] **Step 3: Drop v1 bridges from `BaseHistoryService`.**

  Remove `hydrateConversationHistory(c, vaultPath)` and `deleteConversationSession(c, vaultPath)` bridge methods from `src/core/providers/BaseHistoryService.ts`. The base now declares only v2.

- [ ] **Step 4: Drop Task 2 throw-stubs from the four impls.**

  Each impl already implements `hydrateConversationHistoryV2` / `deleteConversationSessionV2`; the Task 2 stub lines and any leftover v1 declarations can now be deleted.

- [ ] **Step 5: Delete the dead Opencode sentinel helpers.**

  Open `src/providers/opencode/history/OpencodeHistoryStore.ts`. Confirm:
  - `mergeAdjacentAssistantMessages` (line ~199) still calls `isOpencodeHydrationDiagnosticMessage` — that is the internal-prefix variant (`OPENCODE_HYDRATION_DIAGNOSTIC_ID_PREFIX`) used by `mapOpencodeMessages` for per-row catches; it stays.
  - `isOpencodeSessionHydrationDiagnosticMessage` (line ~301) and `createOpencodeHydrationDiagnosticMessage` (line ~265) are now unused — **delete both**.

  Per-row diagnostic sentinels inside `mapOpencodeMessages` stay until a follow-up plan lifts them into the outcome (see "Out of scope"). Document the boundary with an inline comment at the catch site (~`:78`):

  ```ts
        // Per-row sentinel stays for individual malformed messages; session-level
        // failures are reported through HistoryLoadOutcome.error. Lifting per-row
        // signals into the outcome (e.g. `outcomes: HistoryLoadError[]` on the
        // loaded variant) is a follow-up.
  ```

- [ ] **Step 6: Run the full verification chain.**

  Run: `npm run typecheck && npm run lint && npm run test && npm run build`
  Expected: all four exit 0.

- [ ] **Step 7: Verify no `Promise<void>` history-service return types remain.**

  Run: `git grep -nE "hydrateConversationHistory.*Promise<void>|deleteConversationSession.*Promise<void>" -- 'src/**'`
  Expected: empty output.

- [ ] **Step 8: Verify no caller is reading Cursor's dead getter.**

  Run: `git grep -n "getLastHistoryLoadError" -- 'src/**' 'tests/**'`
  Expected: empty output.

- [ ] **Step 9: Manual smoke test in Obsidian.**

  Reload the Obsidian dev vault. Open Settings → Claudian and confirm each provider tab still loads. Switch into a Claude conversation that has at least one previous session id in `providerState.previousProviderSessionIds` — verify the full transcript still renders (Task 7 composite `sourceRef` + resumeAt-aware cache did not break the short-circuit). Open an Opencode conversation whose database is missing or unreadable — confirm the conversation pane renders the inline error banner from the `conversation:hydration-failed` subscriber (no sentinel "Failed to hydrate OpenCode session" message inside the transcript). Click a fork affordance on a Claude or Codex conversation — verify the fork resolves through `service.forkSupport.buildForkProviderState`. Confirm the fork affordance is hidden (or disabled) for Cursor and Opencode panes (Task 8 invariant).

- [ ] **Verification gate: `npm run typecheck && npm run lint && npm run test` exits 0 before the commit step.** Already covered by Step 6.

- [ ] **Step 10: Commit.**

  ```bash
  git add src/core/providers/types.ts src/core/providers/BaseHistoryService.ts src/providers/claude/history/ClaudeConversationHistoryService.ts src/providers/codex/history/CodexConversationHistoryService.ts src/providers/cursor/history/CursorConversationHistoryService.ts src/providers/opencode/history/OpencodeConversationHistoryService.ts src/providers/opencode/history/OpencodeHistoryStore.ts
  git commit -m "refactor(core): collapse deprecated v1 history methods after callers migrated"
  ```

  Hand off to the user for PR creation (do not push without an explicit request).

---

## Risks & Rollback

- **Risk:** Claude's composite `sourceRef` (now `${ids.join('|')}|resume:${resumeAt}`) changes the cache key shape. A stale persisted cache from a running session is in-memory only, so a plugin reload clears it. **Rollback:** revert Task 7.
- **Risk:** Opencode previously rendered hydration failures as a visible assistant message in the transcript. Task 11 replaces that with an Obsidian Notice + inline banner. If Task 11 ships broken, Opencode failure mode is silent until the subscriber is fixed. **Mitigation:** Task 11 lands before Task 13 (v1 collapse) so the deprecated sentinel path stays available as a fallback through every commit until the subscriber is verified.
- **Risk:** Cursor's `getLastHistoryLoadError` is removed. **Confirmed safe** — only the file's own test referenced it; no production caller.
- **Risk:** Concurrent `switchConversation(id)` calls during rapid tab-switching could race two `loadMessages` invocations into one `conversation.messages` write. **Mitigation:** the `BaseHistoryService` `inflight` map dedupes by conversation id (Task 3 test asserts this).
- **Rollback strategy:** Each task is one commit. Every commit boundary passes the verification gate, so any single task can be reverted in isolation without leaving the build red. To revert phase 1 fully: `git revert <task-1-sha>..<task-13-sha>`.

---

## Out of scope

The following are intentionally **deferred** to keep Phase 1 single-purpose:

- **`listNativeSessions` capability.** A read path that enumerates provider-native sessions outside of any conversation (used today only by the dev-tools sidebar). It is a different IO shape and would balloon the contract. Phase 2 candidate.
- **Tail / live-subscribe hook on top of `BaseHistoryService`.** Codex already streams live updates via raw JSON-RPC notifications; tailing the JSONL file is a separate concern. Adding `subscribeToHistory(c, ctx)` here would force every provider to ship a no-op subscriber. Defer until at least one provider needs it.
- **Telemetry hookup for `HistoryLoadError.code`.** Once the outcome value exists, telemetry is a one-line subscriber on `conversation:hydration-failed`. The metric naming policy (`history.load_failed.{provider}.{code}`) and the redaction contract for `detail` belong in a separate plan that owns the metric taxonomy. See `docs/superpowers/plans/2026-05-30-cursor-hardening-telemetry-design.md`.
- **Codex `~/.codex` transcript deletion.** Codex transcripts are provider-owned by design — see `src/providers/codex/CLAUDE.md`. The current no-op behavior is correct and stays.
- **Per-row diagnostic lift for Opencode.** The session-level outcome is shipped in Task 4; the per-row sentinel for individual malformed messages stays in `mapOpencodeMessages` until a separate plan defines the right signal shape (an `outcomes: HistoryLoadError[]` array on the loaded variant would be one option).
- **`HistoryLoadError.recoverable` field.** Dropped from Task 1 — no caller branches on it. If a future caller needs a retry policy hint, add the field then with the test that exercises it.

> **Sequencing note:** v1 collapse (Task 13) is required before any new v2-only capability lands. Until Task 13 ships, the interface still carries deprecated v1 signatures, and adding v2-only surface area inflates the deprecation cleanup window. Land Phase 1 in full first.

---

## Spec-coverage self-review

Mapping every "Concrete gaps to fix" item in the spec to the task that closes it:

| Gap | Task |
|---|---|
| 1. Out-of-band `getLastHistoryLoadError` escape hatch | 5 (deletes the method) + 13 (final grep) |
| 2. Three "load failed" patterns (Cursor side-channel, Opencode sentinel, Claude/Codex silent) | 1 (outcome type) + 4 (Opencode) + 5 (Cursor) + 6 (Codex) + 7 (Claude) + 11 (UI subscriber) |
| 3. `hydrateConversationHistory` returns `Promise<void>` | 1 + 2 + 3 (base) + 4-7 (impls) + 13 (v1 collapse) |
| 4. `vaultPath: string \| null` per-call | 1 (`HydrationContext`) + 4-7 (impl signatures) + 10 (callers) |
| 5. No `AbortSignal` | 1 (`signal?` on context) + 3 (base honors `signal.aborted`) + 7 (Claude mid-load check) + 12 (contract matrix) |
| 6. No `forceRefresh` | 1 (`forceRefresh?`) + 3 (base bypass) + 12 (contract matrix) |
| 7. Cache reinvented per impl | 3 (`BaseHistoryService` lifts `hydrationCache` and `inflight`) + 4-7 (each impl deletes its local cache) |
| 8. Fork stubs in providers without fork | 8 (registry invariant + type guard) + 4 + 5 (drop stubs) |
| 9. `buildPersistedProviderState` returns `Record<string, unknown>` | 2 (generic interface) + 4-7 (pinned types) + 9 (typing test) |
| 10. `deleteConversationSession` fire-and-forget | 1 (`DeleteHistoryOutcome`) + 4-7 (impls return it) + 10 (caller branches) |
| 11. Codex fork resumeAt-not-found shoehorned into parse-failed | 1 (adds `fork-checkpoint-not-found` code) + 6 (Codex emits it) |
| 12. Opencode `sqlite-unavailable` listed but unwired | 4 (`OpencodeHistoryStore` wires it at the `node:sqlite` import-failure path) |
| 13. Cursor `sqlite-unavailable` listed but unwired | 5 (`openCursorSqliteReadonly` returns the tagged error) |
| 14. Claude rewind cache key collision (`resumeAtMessageId` not in key) | 7 (composite cache key includes `resumeAtMessageId`) |
| 15. Concurrent hydration race | 3 (`inflight` map + dedupe test) |
| 16. Hydration-failed event with no UI subscriber | 11 (Notice + inline banner) |
