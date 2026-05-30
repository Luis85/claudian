---
status: proposed
parent: "[[Chat]]"
---
# Chat Tab Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1,895-line free-function module `src/features/chat/tabs/Tab.ts` with four cohesive modules in `src/features/chat/tabs/composition/`. A `ChatTabComposition` class becomes the small public surface; `ProviderDraftPolicy` (pure), `TabUIAssembly` (returns bundle), and `TabControllerGraph` (returns bundle) collaborate behind it. No visible behavior change.

**Architecture:** Hybrid shape. `ChatTabComposition` owns tab record, runtime creation/teardown, fork wiring, auto-turn, and lifecycle sequencing. UI assembly and controller graph return bundles that own their own teardown. Draft policy stays pure. Cleanup order is controllers → runtime → UI, encoded in tests.

**Tech Stack:** TypeScript, Obsidian Plugin API, Jest, JSDOM.

---

## Spec

Implements [[docs/superpowers/specs/2026-05-30-chat-tab-composition-design.md]] (stage 1 of [[docs/issues/Architecture Deepening Proposal.md]]).

Out of scope (deferred to later stages): stream projection split, conversation store extraction, contract split, auxiliary query reuse, settings load normalization.

## File Structure

Create:
- `src/features/chat/tabs/composition/types.ts` — `CompositionDeps`, `TabCompositionCallbacks`, lifecycle option types.
- `src/features/chat/tabs/composition/ProviderDraftPolicy.ts` — pure: `resolveBlankTabModel`, `resolveBlankTabDefaultProviderId`, `resolveBoundTabProvider`, `getBlankTabModelOptions`.
- `src/features/chat/tabs/composition/TabUIAssembly.ts` — `assembleTabUI(deps) => TabUIBundle` with `destroy()`. Owns DOM tree, toolbar, context managers, status panel, navigation sidebar, instruction/bang-bash mode managers.
- `src/features/chat/tabs/composition/TabControllerGraph.ts` — `buildControllerGraph(deps) => ControllerBundle` with `dispose()`. Wires the seven controllers in deterministic order.
- `src/features/chat/tabs/composition/ChatTabComposition.ts` — `class ChatTabComposition` with `create`, `initialize`, `reinitialize`, `destroy`, `getTabData`, `getRuntime`, `setForkContext`, `triggerAutoTurn`, `activate`, `deactivate`, `getTitle`.
- `tests/unit/features/chat/tabs/composition/ProviderDraftPolicy.test.ts`
- `tests/unit/features/chat/tabs/composition/TabUIAssembly.test.ts`
- `tests/unit/features/chat/tabs/composition/TabControllerGraph.test.ts`
- `tests/unit/features/chat/tabs/composition/ChatTabComposition.test.ts`

Modify:
- `src/features/chat/tabs/TabManager.ts` — import `ChatTabComposition` class; replace free-function calls.
- `src/features/chat/ClaudianView.ts` — adjust any direct `Tab.ts` imports (typecheck enforces).
- `tests/unit/features/chat/tabs/Tab.test.ts` — migrate cases into the four new test files, then delete this file.

Delete (after all callers moved):
- `src/features/chat/tabs/Tab.ts` (all 1,895 lines)
- `src/features/chat/tabs/providerResolution.ts` (folded into `ProviderDraftPolicy`)

---

## Phase 0 — Scaffolding

### Task 1: Create composition directory and types skeleton

**Files:**
- Create: `src/features/chat/tabs/composition/types.ts`

- [ ] **Step 1: Create the directory and types file**

Create `src/features/chat/tabs/composition/types.ts`:

```ts
import type { ProviderId } from '../../../../core/providers/types';
import type { ForkSource } from '../../rewind';
import type { Conversation } from '../../../../core/types';
import type ClaudianPlugin from '../../../../main';
import type {
  TabData,
  TabId,
  TabManagerViewHost,
} from '../types';

/**
 * Bundled callbacks passed to ChatTabComposition. Each callback corresponds
 * to a positional callback previously passed to Tab.ts free functions
 * (TabCreateOptions on-*-changed) or to TabManager-injected setup hooks.
 *
 * Adding a callback here is the only way ChatTabComposition signals external
 * state changes; methods never take ad-hoc callback parameters.
 */
export interface TabCompositionCallbacks {
  onStreamingChanged?: (isStreaming: boolean) => void;
  onTitleChanged?: (title: string) => void;
  onAttentionChanged?: (needsAttention: boolean) => void;
  onConversationIdChanged?: (conversationId: string | null) => void;
  onProviderChanged?: (providerId: ProviderId) => void;
}

export interface CompositionDeps {
  plugin: ClaudianPlugin;
  viewHost: TabManagerViewHost;
  containerEl: HTMLElement;
  callbacks: TabCompositionCallbacks;
}

export interface CreateTabOptions {
  conversation?: Conversation;
  tabId?: TabId;
  draftModel?: string | null;
  defaultProviderId?: ProviderId;
}

export interface InitializeTabOptions {
  conversation?: Conversation | null;
  forkSource?: ForkSource | null;
}

export interface ReinitializeTabOptions extends InitializeTabOptions {
  reason: 'provider-switch' | 'resume' | 'reload';
}

/**
 * Snapshot of the tab record exposed by ChatTabComposition.getTabData().
 * Re-exports the existing TabData shape so callers continue to read it
 * the same way during the migration.
 */
export type CompositionTabData = TabData;
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: no errors. (Imports of `ForkSource` resolve from `rewind.ts`; if not, swap to `import type { ForkSource } from '../Tab'` for now and adjust in Task 17.)

- [ ] **Step 3: Commit**

```bash
git add src/features/chat/tabs/composition/types.ts
git commit -m "feat(chat): scaffold composition types for chat tab composition"
```

---

## Phase 1 — ProviderDraftPolicy

### Task 2: Failing tests for ProviderDraftPolicy

**Files:**
- Create: `tests/unit/features/chat/tabs/composition/ProviderDraftPolicy.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/features/chat/tabs/composition/ProviderDraftPolicy.test.ts`:

```ts
import {
  getBlankTabModelOptions,
  resolveBlankTabDefaultProviderId,
  resolveBlankTabModel,
  resolveBoundTabProvider,
} from '../../../../../../src/features/chat/tabs/composition/ProviderDraftPolicy';
import { ProviderRegistry } from '../../../../../../src/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../../../../../src/core/providers/ProviderSettingsCoordinator';
import { DEFAULT_CHAT_PROVIDER_ID } from '../../../../../../src/core/providers/types';

jest.mock('../../../../../../src/core/providers/ProviderRegistry');
jest.mock('../../../../../../src/core/providers/ProviderSettingsCoordinator');

describe('ProviderDraftPolicy', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('resolveBlankTabDefaultProviderId', () => {
    it('returns active settingsProvider when enabled', () => {
      (ProviderRegistry.getRegisteredProviderIds as jest.Mock).mockReturnValue(['claude', 'codex']);
      (ProviderRegistry.isEnabled as jest.Mock).mockImplementation(
        (id) => id === 'claude',
      );
      (ProviderRegistry.getEnabledProviderIds as jest.Mock).mockReturnValue(['claude']);

      const result = resolveBlankTabDefaultProviderId({ settingsProvider: 'claude' });
      expect(result).toBe('claude');
    });

    it('falls back to first enabled provider when active provider disabled', () => {
      (ProviderRegistry.getRegisteredProviderIds as jest.Mock).mockReturnValue(['claude', 'codex']);
      (ProviderRegistry.isEnabled as jest.Mock).mockImplementation(
        (id) => id === 'codex',
      );
      (ProviderRegistry.getEnabledProviderIds as jest.Mock).mockReturnValue(['codex']);

      const result = resolveBlankTabDefaultProviderId({ settingsProvider: 'claude' });
      expect(result).toBe('codex');
    });

    it('returns DEFAULT_CHAT_PROVIDER_ID when nothing enabled', () => {
      (ProviderRegistry.getRegisteredProviderIds as jest.Mock).mockReturnValue([]);
      (ProviderRegistry.getEnabledProviderIds as jest.Mock).mockReturnValue([]);

      const result = resolveBlankTabDefaultProviderId({});
      expect(result).toBe(DEFAULT_CHAT_PROVIDER_ID);
    });
  });

  describe('resolveBlankTabModel', () => {
    it('returns provider-specific snapshot model when providerId enabled', () => {
      (ProviderRegistry.isEnabled as jest.Mock).mockReturnValue(true);
      (ProviderSettingsCoordinator.getProviderSettingsSnapshot as jest.Mock).mockReturnValue({
        model: 'claude-opus-4',
      });

      const plugin = { settings: { model: 'fallback-model' } } as any;
      const result = resolveBlankTabModel(plugin, 'claude');
      expect(result).toBe('claude-opus-4');
    });

    it('returns settings.model when no providerId given', () => {
      const plugin = { settings: { model: 'fallback-model' } } as any;
      const result = resolveBlankTabModel(plugin);
      expect(result).toBe('fallback-model');
    });
  });

  describe('resolveBoundTabProvider', () => {
    it('honors conversation.providerId when present', () => {
      const tab = { providerId: 'claude', conversationId: 'conv-1' } as any;
      const plugin = { getConversationSync: jest.fn() } as any;
      const conversation = { providerId: 'codex' } as any;

      const result = resolveBoundTabProvider(tab, plugin, conversation);
      expect(result).toBe('codex');
    });

    it('falls back to stored conversation provider when not passed', () => {
      const tab = { providerId: 'claude', conversationId: 'conv-1' } as any;
      const plugin = {
        getConversationSync: jest.fn().mockReturnValue({ providerId: 'codex' }),
      } as any;

      const result = resolveBoundTabProvider(tab, plugin, null);
      expect(result).toBe('codex');
    });
  });

  describe('getBlankTabModelOptions', () => {
    it('flatMaps enabled providers into UI options with group + icon', () => {
      (ProviderRegistry.getEnabledProviderIds as jest.Mock).mockReturnValue(['claude', 'codex']);
      (ProviderRegistry.getChatUIConfig as jest.Mock).mockImplementation((id) => ({
        getProviderIcon: () => `icon-${id}`,
        getModelOptions: () => [{ value: `${id}-model`, label: `${id} Model` }],
      }));
      (ProviderRegistry.getProviderDisplayName as jest.Mock).mockImplementation(
        (id) => `${id} display`,
      );

      const result = getBlankTabModelOptions({});
      expect(result).toEqual([
        { value: 'claude-model', label: 'claude Model', group: 'claude display', providerIcon: 'icon-claude' },
        { value: 'codex-model', label: 'codex Model', group: 'codex display', providerIcon: 'icon-codex' },
      ]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "ProviderDraftPolicy"`
Expected: FAIL with `Cannot find module 'src/features/chat/tabs/composition/ProviderDraftPolicy'`.

### Task 3: Implement ProviderDraftPolicy

**Files:**
- Create: `src/features/chat/tabs/composition/ProviderDraftPolicy.ts`

- [ ] **Step 1: Implement the module**

Create `src/features/chat/tabs/composition/ProviderDraftPolicy.ts`:

```ts
import { getEnabledProviderForModel } from '../../../../core/providers/modelRouting';
import { ProviderRegistry } from '../../../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../../../core/providers/ProviderSettingsCoordinator';
import {
  DEFAULT_CHAT_PROVIDER_ID,
  type ProviderId,
  type ProviderUIOption,
} from '../../../../core/providers/types';
import type { Conversation } from '../../../../core/types';
import type ClaudianPlugin from '../../../../main';
import type { TabProviderContext } from '../types';

/**
 * Returns model options for a blank tab. Uses provider registration metadata
 * to determine which providers are available and how they should appear in
 * the mixed picker.
 */
export function getBlankTabModelOptions(
  settings: Record<string, unknown>,
): ProviderUIOption[] {
  return ProviderRegistry.getEnabledProviderIds(settings).flatMap((providerId) => {
    const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
    const providerIcon = uiConfig.getProviderIcon?.() ?? undefined;
    const group = ProviderRegistry.getProviderDisplayName(providerId);

    return uiConfig.getModelOptions(settings)
      .map(model => ({ ...model, group, providerIcon }));
  });
}

/**
 * Resolves the draft model for a new blank tab by projecting provider-specific
 * saved settings. Without this, `plugin.settings.model` reflects only the
 * settings-provider's model, which may belong to a different provider.
 */
export function resolveBlankTabModel(
  plugin: ClaudianPlugin,
  providerId?: ProviderId,
): string {
  const settings = plugin.settings as unknown as Record<string, unknown>;
  if (!providerId) {
    return settings.model as string;
  }

  const targetProviderId = ProviderRegistry.isEnabled(providerId, settings)
    ? providerId
    : ProviderRegistry.resolveSettingsProviderId(settings);
  const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(settings, targetProviderId);
  return snapshot.model as string;
}

/**
 * Resolves the default provider for a blank/first tab when no draft model
 * dictates the provider. Prefers the active settings provider when it is
 * enabled, otherwise the first enabled provider by blank-tab order.
 */
export function resolveBlankTabDefaultProviderId(settings: Record<string, unknown>): ProviderId {
  const current = settings.settingsProvider;
  if (typeof current === 'string'
    && ProviderRegistry.getRegisteredProviderIds().includes(current as ProviderId)
    && ProviderRegistry.isEnabled(current as ProviderId, settings)) {
    return current as ProviderId;
  }
  return ProviderRegistry.getEnabledProviderIds(settings)[0] ?? DEFAULT_CHAT_PROVIDER_ID;
}

/**
 * Resolves the active provider for a bound tab. Conversation provider wins;
 * otherwise the tab's stored or draft provider.
 */
export function resolveBoundTabProvider(
  tab: TabProviderContext,
  plugin: ClaudianPlugin,
  conversation?: Conversation | null,
): ProviderId {
  if (conversation?.providerId) return conversation.providerId;

  if (tab.conversationId) {
    const stored = plugin.getConversationSync(tab.conversationId);
    if (stored?.providerId) return stored.providerId;
  }

  if (tab.lifecycleState === 'blank' && tab.draftModel) {
    return getEnabledProviderForModel(tab.draftModel, plugin.settings);
  }

  return tab.service?.providerId ?? tab.providerId;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm run test -- --selectProjects unit -t "ProviderDraftPolicy"`
Expected: all PASS.

- [ ] **Step 3: Run lint + typecheck**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors, 0 warnings.

### Task 4: Re-export new functions from old paths to keep Tab.ts/providerResolution.ts callers compiling

**Files:**
- Modify: `src/features/chat/tabs/Tab.ts` (replace `resolveBlankTabModel` and `getBlankTabModelOptions` and `resolveBlankTabDefaultProviderId` implementations with re-exports from `ProviderDraftPolicy`)
- Modify: `src/features/chat/tabs/providerResolution.ts` (replace `getTabProviderId` body with delegate to `resolveBoundTabProvider`)

- [ ] **Step 1: Replace Tab.ts implementations with re-exports**

In `src/features/chat/tabs/Tab.ts`, replace lines 75–122 (the `getBlankTabModelOptions`, `resolveBlankTabModel`, `resolveBlankTabDefaultProviderId` definitions) with:

```ts
export {
  getBlankTabModelOptions,
  resolveBlankTabDefaultProviderId,
  resolveBlankTabModel,
} from './composition/ProviderDraftPolicy';
```

Note: `resolveBlankTabModel` was previously private; make it imported instead of redefined. The internal callsite (`createTab`) keeps working because it imports from the local module.

- [ ] **Step 2: Replace providerResolution.ts body with delegate**

Replace the full body of `src/features/chat/tabs/providerResolution.ts` with:

```ts
import type { Conversation } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import type { ProviderId } from '../../../core/providers/types';
import type { TabProviderContext } from './types';
import { resolveBoundTabProvider } from './composition/ProviderDraftPolicy';

export function getTabProviderId(
  tab: TabProviderContext,
  plugin: ClaudianPlugin,
  conversation?: Conversation | null,
): ProviderId {
  return resolveBoundTabProvider(tab, plugin, conversation);
}
```

- [ ] **Step 3: Run typecheck + full test suite**

Run: `npm run typecheck && npm run test`
Expected: all pass. `Tab.test.ts` may have tests covering the old function signatures; they should still pass since signatures are preserved through re-export.

- [ ] **Step 4: Commit**

```bash
git add src/features/chat/tabs/composition/ProviderDraftPolicy.ts \
        tests/unit/features/chat/tabs/composition/ProviderDraftPolicy.test.ts \
        src/features/chat/tabs/Tab.ts \
        src/features/chat/tabs/providerResolution.ts
git commit -m "feat(chat): extract ProviderDraftPolicy from Tab.ts"
```

---

## Phase 2 — TabUIAssembly

### Task 5: Define TabUIBundle and assembleTabUI signature

**Files:**
- Create: `src/features/chat/tabs/composition/TabUIAssembly.ts` (signature stub only)

- [ ] **Step 1: Create the file with signature stub**

Create `src/features/chat/tabs/composition/TabUIAssembly.ts`:

```ts
import type { ProviderCapabilities, ProviderChatUIConfig, ProviderId } from '../../../../core/providers/types';
import type ClaudianPlugin from '../../../../main';
import type { ChatState } from '../../state/ChatState';
import type { BangBashModeManager } from '../../ui/BangBashModeManager';
import type { FileContextManager } from '../../ui/FileContext';
import type { ImageContextManager } from '../../ui/ImageContext';
import type {
  ContextUsageMeter,
  ExternalContextSelector,
  McpServerSelector,
  ModelSelector,
  ModeSelector,
  OrchestratorToggle,
  PermissionToggle,
  PlanModeToggle,
  ServiceTierToggle,
  ThinkingBudgetSelector,
} from '../../ui/InputToolbar';
import type { InstructionModeManager } from '../../ui/InstructionModeManager';
import type { NavigationSidebar } from '../../ui/NavigationSidebar';
import type { StatusPanel } from '../../ui/StatusPanel';
import type { SlashCommandDropdown } from '../../../../shared/components/SlashCommandDropdown';
import type { TabDOMElements } from '../types';

export interface TabUIDeps {
  containerEl: HTMLElement;
  plugin: ClaudianPlugin;
  providerId: ProviderId;
  capabilities: ProviderCapabilities;
  uiConfig: ProviderChatUIConfig;
  chatState: ChatState;
}

export interface TabUIBundle {
  dom: TabDOMElements;
  fileContextManager: FileContextManager;
  imageContextManager: ImageContextManager;
  modelSelector: ModelSelector | null;
  modeSelector: ModeSelector | null;
  thinkingBudgetSelector: ThinkingBudgetSelector | null;
  externalContextSelector: ExternalContextSelector | null;
  mcpServerSelector: McpServerSelector | null;
  permissionToggle: PermissionToggle | null;
  planModeToggle: PlanModeToggle | null;
  orchestratorToggle: OrchestratorToggle | null;
  serviceTierToggle: ServiceTierToggle | null;
  slashCommandDropdown: SlashCommandDropdown | null;
  instructionModeManager: InstructionModeManager;
  bangBashModeManager: BangBashModeManager | null;
  contextUsageMeter: ContextUsageMeter | null;
  statusPanel: StatusPanel;
  navigationSidebar: NavigationSidebar;
  destroy(): void;
}

export function assembleTabUI(_deps: TabUIDeps): TabUIBundle {
  throw new Error('not implemented');
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: no errors.

### Task 6: Failing test for assembleTabUI mounts DOM and destroy() unmounts

**Files:**
- Create: `tests/unit/features/chat/tabs/composition/TabUIAssembly.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/chat/tabs/composition/TabUIAssembly.test.ts`:

```ts
/** @jest-environment jsdom */

import { assembleTabUI } from '../../../../../../src/features/chat/tabs/composition/TabUIAssembly';
import { ChatState } from '../../../../../../src/features/chat/state/ChatState';

// Minimal stubs for ProviderCapabilities/ProviderChatUIConfig; real wiring is
// exercised by the integration suite (TabManager.test.ts).
function makeFakeDeps(containerEl: HTMLElement) {
  const fakeUiConfig = {
    getProviderIcon: () => 'icon',
    getModelOptions: () => [{ value: 'm', label: 'm' }],
    ownsModel: () => true,
    getPermissionModeToggle: () => null,
  } as any;
  const fakeCapabilities = {
    providerId: 'claude',
    supportsMcpTools: false,
    supportsPlanMode: false,
    supportsImageAttachments: true,
  } as any;
  const fakePlugin = {
    settings: { model: 'm', settingsProvider: 'claude' },
    saveSettings: jest.fn(),
    app: { workspace: { getActiveViewOfType: jest.fn() } },
  } as any;
  return {
    containerEl,
    plugin: fakePlugin,
    providerId: 'claude' as const,
    capabilities: fakeCapabilities,
    uiConfig: fakeUiConfig,
    chatState: new ChatState({}),
  };
}

describe('assembleTabUI', () => {
  it('mounts a tab content element under containerEl', () => {
    const containerEl = document.createElement('div');
    const bundle = assembleTabUI(makeFakeDeps(containerEl));
    expect(containerEl.querySelector('.claudian-tab-content')).toBe(bundle.dom.contentEl);
    expect(bundle.dom.inputEl).toBeInstanceOf(HTMLTextAreaElement);
    bundle.destroy();
  });

  it('destroy() removes the content element and is idempotent', () => {
    const containerEl = document.createElement('div');
    const bundle = assembleTabUI(makeFakeDeps(containerEl));
    bundle.destroy();
    expect(containerEl.querySelector('.claudian-tab-content')).toBeNull();
    expect(() => bundle.destroy()).not.toThrow();
  });

  // DOM-structure regression: locks the pre-refactor shape so the extraction
  // cannot silently drop a class or rename a key element.
  it('mounts the expected element tree under content (regression snapshot)', () => {
    const containerEl = document.createElement('div');
    const bundle = assembleTabUI(makeFakeDeps(containerEl));
    const html = bundle.dom.contentEl.outerHTML
      .replace(/\sdir="auto"/g, '');
    // The snapshot should list the same class names as Tab.ts:buildTabDOM
    // produced before extraction. Capture the snapshot once from the
    // pre-refactor build, then assert equality here.
    expect(html).toContain('claudian-messages-wrapper');
    expect(html).toContain('claudian-messages');
    expect(html).toContain('claudian-status-panel-container');
    expect(html).toContain('claudian-input-container');
    expect(html).toContain('claudian-input-queue-row');
    expect(html).toContain('claudian-input-nav-row');
    expect(html).toContain('claudian-input-wrapper');
    expect(html).toContain('claudian-context-row');
    expect(html).toContain('claudian-input');
    bundle.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "assembleTabUI"`
Expected: FAIL with `not implemented`.

### Task 7: Implement assembleTabUI by extracting from Tab.ts

**Files:**
- Modify: `src/features/chat/tabs/composition/TabUIAssembly.ts`

- [ ] **Step 1: Implement assembleTabUI**

Replace the stub body of `src/features/chat/tabs/composition/TabUIAssembly.ts`'s `assembleTabUI` with the extracted logic. The implementation lifts:

- `buildTabDOM` (Tab.ts:494–512)
- `initializeContextManagers` (Tab.ts:640+)
- `initializeSlashCommands` (Tab.ts:681+)
- `initializeInstructionAndTodo` (Tab.ts:706+)
- `initializeInputToolbar` (Tab.ts:762+)
- The body of `initializeTabUI` (Tab.ts:998+)

Pattern:

```ts
export function assembleTabUI(deps: TabUIDeps): TabUIBundle {
  const { containerEl, plugin, capabilities, uiConfig, chatState } = deps;

  const dom = buildTabDOM(containerEl);
  chatState.queueIndicatorEl = dom.queueIndicatorEl;

  const fileContextManager = createFileContextManager(plugin, dom);
  const imageContextManager = createImageContextManager(plugin, dom);
  const statusPanel = createStatusPanel(plugin, dom);
  const navigationSidebar = createNavigationSidebar(plugin, dom);
  const instructionModeManager = createInstructionModeManager(plugin, dom);
  const bangBashModeManager = createBangBashModeManager(plugin, dom);
  const slashCommandDropdown = createSlashCommandDropdown(plugin, dom);
  const toolbar = createInputToolbar({
    plugin, dom, capabilities, uiConfig, chatState,
  });

  return {
    dom,
    fileContextManager,
    imageContextManager,
    modelSelector: toolbar.modelSelector,
    modeSelector: toolbar.modeSelector,
    thinkingBudgetSelector: toolbar.thinkingBudgetSelector,
    externalContextSelector: toolbar.externalContextSelector,
    mcpServerSelector: toolbar.mcpServerSelector,
    permissionToggle: toolbar.permissionToggle,
    planModeToggle: toolbar.planModeToggle,
    orchestratorToggle: toolbar.orchestratorToggle,
    serviceTierToggle: toolbar.serviceTierToggle,
    slashCommandDropdown,
    instructionModeManager,
    bangBashModeManager,
    contextUsageMeter: toolbar.contextUsageMeter,
    statusPanel,
    navigationSidebar,
    destroy() {
      fileContextManager.destroy();
      slashCommandDropdown?.destroy();
      instructionModeManager.destroy();
      bangBashModeManager?.destroy();
      statusPanel.destroy();
      navigationSidebar.destroy();
      for (const cleanup of dom.eventCleanups) cleanup();
      dom.eventCleanups.length = 0;
      dom.contentEl.remove();
    },
  };
}
```

Lift the supporting helpers (`buildTabDOM`, `createFileContextManager`, `createImageContextManager`, `createStatusPanel`, `createNavigationSidebar`, `createInstructionModeManager`, `createBangBashModeManager`, `createSlashCommandDropdown`, `createInputToolbar`) into this file as private functions, copied 1:1 from Tab.ts. Preserve `void` returns, `await` patterns, and CSS class names exactly.

Also lift the helpers `refreshTabProviderUI`, `applyProviderUIGating`, `syncSlashCommandDropdownForProvider`, `isBangBashEnabled` into this file as exported helpers so the composition root can call them.

- [ ] **Step 2: Run TabUIAssembly tests**

Run: `npm run test -- --selectProjects unit -t "assembleTabUI"`
Expected: PASS (both tests).

- [ ] **Step 3: Run full suite to confirm Tab.test.ts still passes**

Run: `npm run test`
Expected: all PASS. Tab.ts still references its own copies of these functions; no removal yet.

### Task 8: Replace Tab.ts `initializeTabUI` body with delegate

**Files:**
- Modify: `src/features/chat/tabs/Tab.ts`

- [ ] **Step 1: Delete the inline helpers from Tab.ts**

Delete from `src/features/chat/tabs/Tab.ts`:
- `buildTabDOM` (~lines 494–530)
- `initializeContextManagers` (~lines 640–680)
- `initializeSlashCommands` (~lines 681–705)
- `initializeInstructionAndTodo` (~lines 706–752)
- `initializeInputToolbar` (~lines 762–997)
- `isBangBashEnabled` (~lines 753–761)
- `refreshTabProviderUI`, `applyProviderUIGating`, `syncSlashCommandDropdownForProvider` helpers (~lines 234–322)

Replace the body of `initializeTabUI` (lines 998–1060) with:

```ts
export function initializeTabUI(
  tab: TabData,
  plugin: ClaudianPlugin,
): void {
  const providerId = getTabProviderId(tab, plugin);
  const capabilities = ProviderRegistry.getCapabilities(providerId);
  const uiConfig = ProviderRegistry.getChatUIConfig(providerId);

  const bundle = assembleTabUI({
    containerEl: tab.dom.contentEl.parentElement!,
    plugin,
    providerId,
    capabilities,
    uiConfig,
    chatState: tab.state,
  });

  // Copy bundle fields onto tab.ui/tab.dom for the rest of Tab.ts callers.
  tab.dom = bundle.dom;
  tab.ui.fileContextManager = bundle.fileContextManager;
  tab.ui.imageContextManager = bundle.imageContextManager;
  tab.ui.modelSelector = bundle.modelSelector;
  tab.ui.modeSelector = bundle.modeSelector;
  tab.ui.thinkingBudgetSelector = bundle.thinkingBudgetSelector;
  tab.ui.externalContextSelector = bundle.externalContextSelector;
  tab.ui.mcpServerSelector = bundle.mcpServerSelector;
  tab.ui.permissionToggle = bundle.permissionToggle;
  tab.ui.planModeToggle = bundle.planModeToggle;
  tab.ui.orchestratorToggle = bundle.orchestratorToggle;
  tab.ui.serviceTierToggle = bundle.serviceTierToggle;
  tab.ui.slashCommandDropdown = bundle.slashCommandDropdown;
  tab.ui.instructionModeManager = bundle.instructionModeManager;
  tab.ui.bangBashModeManager = bundle.bangBashModeManager;
  tab.ui.contextUsageMeter = bundle.contextUsageMeter;
  tab.ui.statusPanel = bundle.statusPanel;
  tab.ui.navigationSidebar = bundle.navigationSidebar;

  refreshTabProviderUI(tab, plugin);
  applyProviderUIGating(tab, plugin);
}
```

Add at top of `Tab.ts`:

```ts
import {
  applyProviderUIGating,
  assembleTabUI,
  refreshTabProviderUI,
  syncSlashCommandDropdownForProvider,
} from './composition/TabUIAssembly';
```

Remove now-orphan imports (e.g., `createInputToolbar` from `../ui/InputToolbar`).

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors. If some private helper in Tab.ts still references a deleted local function, lift it too or call the exported one from `TabUIAssembly`.

- [ ] **Step 3: Run full test suite**

Run: `npm run test`
Expected: all PASS. Visual regression on tabs is exercised through integration tests in `TabManager.test.ts`.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/tabs/composition/TabUIAssembly.ts \
        tests/unit/features/chat/tabs/composition/TabUIAssembly.test.ts \
        src/features/chat/tabs/Tab.ts
git commit -m "feat(chat): extract TabUIAssembly bundle from Tab.ts"
```

---

## Phase 3 — TabControllerGraph

### Task 9: Define ControllerBundle and buildControllerGraph signature

**Files:**
- Create: `src/features/chat/tabs/composition/TabControllerGraph.ts`

- [ ] **Step 1: Create file with signature stub**

Create `src/features/chat/tabs/composition/TabControllerGraph.ts`:

```ts
import type ClaudianPlugin from '../../../../main';
import type { ChatRuntime } from '../../../../core/runtime/ChatRuntime';
import type { ChatState } from '../../state/ChatState';
import type { SubagentManager } from '../../services/SubagentManager';
import type { BrowserSelectionController } from '../../controllers/BrowserSelectionController';
import type { CanvasSelectionController } from '../../controllers/CanvasSelectionController';
import type { ConversationController } from '../../controllers/ConversationController';
import type { InputController } from '../../controllers/InputController';
import type { NavigationController } from '../../controllers/NavigationController';
import type { SelectionController } from '../../controllers/SelectionController';
import type { StreamController } from '../../controllers/StreamController';
import type { MessageRenderer } from '../../rendering/MessageRenderer';
import type { TabUIBundle } from './TabUIAssembly';

export interface ControllerGraphDeps {
  plugin: ClaudianPlugin;
  tabUI: TabUIBundle;
  runtime: ChatRuntime;
  chatState: ChatState;
  subagentManager: SubagentManager;
  renderer: MessageRenderer;
  // Additional deps are enumerated during the extraction by reading every
  // parameter currently passed to initializeTabControllers + setupServiceCallbacks
  // + wireTabInputEvents in Tab.ts. The list is fixed at extraction time;
  // no dep is added speculatively.
}

export interface ControllerBundle {
  conversation: ConversationController;
  stream: StreamController;
  input: InputController;
  selection: SelectionController;
  browser: BrowserSelectionController;
  canvas: CanvasSelectionController;
  navigation: NavigationController;
  dispose(): void;
}

export function buildControllerGraph(_deps: ControllerGraphDeps): ControllerBundle {
  throw new Error('not implemented');
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

### Task 10: Failing test for buildControllerGraph returns all controllers and dispose order

**Files:**
- Create: `tests/unit/features/chat/tabs/composition/TabControllerGraph.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/chat/tabs/composition/TabControllerGraph.test.ts`:

```ts
import { buildControllerGraph } from '../../../../../../src/features/chat/tabs/composition/TabControllerGraph';
import { ChatState } from '../../../../../../src/features/chat/state/ChatState';
import { SubagentManager } from '../../../../../../src/features/chat/services/SubagentManager';

function makeFakeDeps() {
  const fakeRuntime = {
    providerId: 'claude',
    setApprovalCallback: jest.fn(),
    setApprovalDismisser: jest.fn(),
    setAskUserQuestionCallback: jest.fn(),
    setExitPlanModeCallback: jest.fn(),
    setSubagentHookProvider: jest.fn(),
    setAutoTurnCallback: jest.fn(),
    setPermissionModeSyncCallback: jest.fn(),
    cleanup: jest.fn(),
  } as any;

  const fakePlugin = {
    settings: { model: 'm' },
    app: { workspace: { getActiveViewOfType: jest.fn() } },
  } as any;

  const tabUI = {
    dom: {
      contentEl: document.createElement('div'),
      messagesEl: document.createElement('div'),
      inputEl: document.createElement('textarea'),
      inputContainerEl: document.createElement('div'),
      inputWrapper: document.createElement('div'),
      contextRowEl: document.createElement('div'),
      navRowEl: document.createElement('div'),
      queueIndicatorEl: document.createElement('div'),
      welcomeEl: null,
      statusPanelContainerEl: document.createElement('div'),
      selectionIndicatorEl: null,
      browserIndicatorEl: null,
      canvasIndicatorEl: null,
      eventCleanups: [],
    },
    fileContextManager: { destroy: jest.fn(), setMcpManager: jest.fn(), setAgentService: jest.fn() },
    imageContextManager: { setEnabled: jest.fn() },
    statusPanel: { destroy: jest.fn() },
    navigationSidebar: { destroy: jest.fn(), updateVisibility: jest.fn() },
    instructionModeManager: { destroy: jest.fn() },
    bangBashModeManager: { destroy: jest.fn() },
    slashCommandDropdown: null,
    modelSelector: null,
    modeSelector: null,
    thinkingBudgetSelector: null,
    externalContextSelector: null,
    mcpServerSelector: null,
    permissionToggle: null,
    planModeToggle: null,
    orchestratorToggle: null,
    serviceTierToggle: null,
    contextUsageMeter: null,
    destroy: jest.fn(),
  } as any;

  return {
    plugin: fakePlugin,
    tabUI,
    runtime: fakeRuntime,
    chatState: new ChatState({}),
    subagentManager: new SubagentManager(fakePlugin.app, () => {}),
    renderer: { addMessage: jest.fn(), scrollToBottom: jest.fn() } as any,
  };
}

describe('buildControllerGraph', () => {
  it('returns all seven controllers wired to runtime + tabUI', () => {
    const deps = makeFakeDeps();
    const bundle = buildControllerGraph(deps);
    expect(bundle.conversation).toBeDefined();
    expect(bundle.stream).toBeDefined();
    expect(bundle.input).toBeDefined();
    expect(bundle.selection).toBeDefined();
    expect(bundle.browser).toBeDefined();
    expect(bundle.canvas).toBeDefined();
    expect(bundle.navigation).toBeDefined();
  });

  it('dispose() calls navigation.dispose, stops selection controllers, and is idempotent', () => {
    const deps = makeFakeDeps();
    const bundle = buildControllerGraph(deps);
    const navDispose = jest.spyOn(bundle.navigation, 'dispose');
    const selStop = jest.spyOn(bundle.selection, 'stop');
    bundle.dispose();
    expect(navDispose).toHaveBeenCalledTimes(1);
    expect(selStop).toHaveBeenCalledTimes(1);
    expect(() => bundle.dispose()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "buildControllerGraph"`
Expected: FAIL with `not implemented`.

### Task 11: Implement buildControllerGraph by extracting from Tab.ts

**Files:**
- Modify: `src/features/chat/tabs/composition/TabControllerGraph.ts`

- [ ] **Step 1: Implement buildControllerGraph**

Replace the stub `buildControllerGraph` body in `src/features/chat/tabs/composition/TabControllerGraph.ts` with extracted logic from Tab.ts's `initializeTabControllers` (lines 1219–1482) and `wireTabInputEvents` (lines 1483–1615).

Pattern:

```ts
export function buildControllerGraph(deps: ControllerGraphDeps): ControllerBundle {
  const { plugin, tabUI, runtime, chatState, subagentManager, renderer } = deps;

  const stream = new StreamController({ ... });
  const conversation = new ConversationController({ plugin, runtime, chatState, renderer });
  const input = new InputController({ plugin, runtime, chatState, stream, conversation, tabUI });
  const selection = new SelectionController(plugin.app, tabUI.dom.selectionIndicatorEl);
  const browser = new BrowserSelectionController(plugin.app, tabUI.dom.browserIndicatorEl);
  const canvas = new CanvasSelectionController(plugin.app, tabUI.dom.canvasIndicatorEl);
  const navigation = new NavigationController({ plugin, tabUI, chatState, stream });

  // Wire SubagentManager callback that previously was a placeholder in createTab.
  subagentManager.setStreamingHandler?.((chunk) => stream.handleStreamChunk(chunk));

  // Wire input events extracted from wireTabInputEvents.
  wireInputEvents({ plugin, tabUI, input, stream });

  return {
    conversation, stream, input, selection, browser, canvas, navigation,
    dispose() {
      // Order: stop selection polling first, then dispose stream/conversation listeners,
      // then navigation (which detaches keyboard handlers).
      selection.stop(); selection.clear();
      browser.stop(); browser.clear();
      canvas.stop(); canvas.clear();
      stream.cancel?.();
      conversation.cancelTitleGeneration?.();
      input.destroyResumeDropdown();
      input.dismissPendingApproval();
      navigation.dispose();
    },
  };
}
```

Lift the `wireInputEvents` body 1:1 from `wireTabInputEvents` (Tab.ts:1483), substituting `tabUI.dom.inputEl`/etc. for `tab.dom.inputEl`/etc. The handler closures stay structurally identical.

- [ ] **Step 2: Run TabControllerGraph tests**

Run: `npm run test -- --selectProjects unit -t "buildControllerGraph"`
Expected: PASS (both tests).

- [ ] **Step 3: Run full test suite**

Run: `npm run test`
Expected: all PASS.

### Task 12: Replace Tab.ts `initializeTabControllers` and `wireTabInputEvents` with delegate

**Files:**
- Modify: `src/features/chat/tabs/Tab.ts`

- [ ] **Step 1: Delete the inline overloads and helpers from Tab.ts**

Delete from `src/features/chat/tabs/Tab.ts`:
- Three overloads of `initializeTabControllers` (lines 1219–1482)
- `wireTabInputEvents` (lines 1483–1615)

Replace with delegating exports:

```ts
import { buildControllerGraph } from './composition/TabControllerGraph';

export function initializeTabControllers(
  tab: TabData,
  plugin: ClaudianPlugin,
): void {
  if (!tab.service) {
    throw new Error('initializeTabControllers requires tab.service to be initialized first');
  }
  const renderer = tab.renderer ?? createRenderer(tab, plugin);
  const bundle = buildControllerGraph({
    plugin,
    tabUI: bundleFromTab(tab),
    runtime: tab.service,
    chatState: tab.state,
    subagentManager: tab.services.subagentManager,
    renderer,
  });
  tab.controllers.conversationController = bundle.conversation;
  tab.controllers.streamController = bundle.stream;
  tab.controllers.inputController = bundle.input;
  tab.controllers.selectionController = bundle.selection;
  tab.controllers.browserSelectionController = bundle.browser;
  tab.controllers.canvasSelectionController = bundle.canvas;
  tab.controllers.navigationController = bundle.navigation;
  tab.renderer = renderer;
  // Stash dispose handle on tab so destroyTab can call it.
  (tab as any).__controllerDispose = bundle.dispose;
}

export function wireTabInputEvents(_tab: TabData, _plugin: ClaudianPlugin): void {
  // No-op: wiring now happens inside buildControllerGraph. Retained for
  // compatibility with TabManager during the migration; removed in Task 19.
}
```

Provide a local `bundleFromTab(tab)` helper that synthesizes the minimal `TabUIBundle` shape from existing `tab.ui` and `tab.dom` so the controller graph can be built without re-running `assembleTabUI`. Similarly, `createRenderer` lifts the renderer construction lines from the old `initializeTabControllers`.

- [ ] **Step 2: Run typecheck + full test suite**

Run: `npm run typecheck && npm run test`
Expected: all PASS.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add src/features/chat/tabs/composition/TabControllerGraph.ts \
        tests/unit/features/chat/tabs/composition/TabControllerGraph.test.ts \
        src/features/chat/tabs/Tab.ts
git commit -m "feat(chat): extract TabControllerGraph bundle from Tab.ts"
```

---

## Phase 4 — ChatTabComposition root

### Task 13: Define ChatTabComposition class skeleton

**Files:**
- Create: `src/features/chat/tabs/composition/ChatTabComposition.ts`

- [ ] **Step 1: Create class skeleton**

Create `src/features/chat/tabs/composition/ChatTabComposition.ts`:

```ts
import type { ChatRuntime } from '../../../../core/runtime/ChatRuntime';
import type { AutoTurnResult } from '../../../../core/runtime/types';
import type { ForkSource } from '../../rewind';
import type { TabData, TabId } from '../types';
import {
  CompositionDeps,
  CreateTabOptions,
  InitializeTabOptions,
  ReinitializeTabOptions,
} from './types';
import type { ControllerBundle } from './TabControllerGraph';
import type { TabUIBundle } from './TabUIAssembly';

export class ChatTabComposition {
  private readonly deps: CompositionDeps;
  private tab: TabData | null = null;
  private runtime: ChatRuntime | null = null;
  private tabUI: TabUIBundle | null = null;
  private controllers: ControllerBundle | null = null;
  private forkSource: ForkSource | null = null;

  constructor(deps: CompositionDeps) {
    this.deps = deps;
  }

  create(_opts: CreateTabOptions): TabData {
    throw new Error('not implemented');
  }

  async initialize(_opts: InitializeTabOptions): Promise<void> {
    throw new Error('not implemented');
  }

  async reinitialize(_opts: ReinitializeTabOptions): Promise<void> {
    throw new Error('not implemented');
  }

  async destroy(): Promise<void> {
    throw new Error('not implemented');
  }

  activate(): void {
    throw new Error('not implemented');
  }

  deactivate(): void {
    throw new Error('not implemented');
  }

  getTabData(): TabData {
    if (!this.tab) throw new Error('ChatTabComposition.create() must run first');
    return this.tab;
  }

  getRuntime(): ChatRuntime | null {
    return this.runtime;
  }

  getTitle(): string {
    throw new Error('not implemented');
  }

  setForkContext(source: ForkSource | null): void {
    this.forkSource = source;
  }

  async triggerAutoTurn(_result: AutoTurnResult): Promise<void> {
    throw new Error('not implemented');
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: no errors.

### Task 14: Failing test for ChatTabComposition.create() returns blank TabData

**Files:**
- Create: `tests/unit/features/chat/tabs/composition/ChatTabComposition.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/chat/tabs/composition/ChatTabComposition.test.ts`:

```ts
/** @jest-environment jsdom */

import { ChatTabComposition } from '../../../../../../src/features/chat/tabs/composition/ChatTabComposition';

function makeFakePlugin() {
  return {
    settings: { model: 'claude-opus-4', settingsProvider: 'claude' },
    saveSettings: jest.fn(),
    getConversationSync: jest.fn().mockReturnValue(null),
    app: { workspace: { getActiveViewOfType: jest.fn() } },
  } as any;
}

function makeFakeViewHost() {
  return {
    leaf: {},
    getTabManager: () => null,
    register: jest.fn(),
    registerEvent: jest.fn(),
    registerDomEvent: jest.fn(),
  } as any;
}

describe('ChatTabComposition.create', () => {
  it('returns a blank TabData with no runtime', () => {
    const composition = new ChatTabComposition({
      plugin: makeFakePlugin(),
      viewHost: makeFakeViewHost(),
      containerEl: document.createElement('div'),
      callbacks: {},
    });
    const tab = composition.create({});
    expect(tab.id).toMatch(/^tab-/);
    expect(tab.lifecycleState).toBe('blank');
    expect(tab.service).toBeNull();
    expect(tab.serviceInitialized).toBe(false);
    expect(composition.getRuntime()).toBeNull();
  });

  it('returns a bound_cold TabData when conversation is passed', () => {
    const composition = new ChatTabComposition({
      plugin: makeFakePlugin(),
      viewHost: makeFakeViewHost(),
      containerEl: document.createElement('div'),
      callbacks: {},
    });
    const tab = composition.create({
      conversation: { id: 'c1', providerId: 'claude', messages: [] } as any,
    });
    expect(tab.lifecycleState).toBe('bound_cold');
    expect(tab.conversationId).toBe('c1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "ChatTabComposition.create"`
Expected: FAIL with `not implemented`.

### Task 15: Implement create() by delegating to existing Tab.ts createTab

**Files:**
- Modify: `src/features/chat/tabs/composition/ChatTabComposition.ts`

- [ ] **Step 1: Implement create()**

Replace `create()` body with:

```ts
create(opts: CreateTabOptions): TabData {
  // Delegate to existing createTab logic while it lives. Removed in Task 22.
  this.tab = createTab({
    plugin: this.deps.plugin,
    containerEl: this.deps.containerEl,
    conversation: opts.conversation,
    tabId: opts.tabId,
    draftModel: opts.draftModel,
    defaultProviderId: opts.defaultProviderId,
    onStreamingChanged: this.deps.callbacks.onStreamingChanged,
    onTitleChanged: this.deps.callbacks.onTitleChanged,
    onAttentionChanged: this.deps.callbacks.onAttentionChanged,
    onConversationIdChanged: this.deps.callbacks.onConversationIdChanged,
  });
  return this.tab;
}
```

Add at top:

```ts
import { createTab } from '../Tab';
```

- [ ] **Step 2: Run tests**

Run: `npm run test -- --selectProjects unit -t "ChatTabComposition.create"`
Expected: both PASS.

### Task 16: Failing tests for initialize() and destroy() cleanup order

**Files:**
- Modify: `tests/unit/features/chat/tabs/composition/ChatTabComposition.test.ts` (add new describe blocks)

- [ ] **Step 1: Append the tests**

Append to `tests/unit/features/chat/tabs/composition/ChatTabComposition.test.ts`:

```ts
describe('ChatTabComposition.initialize + destroy', () => {
  it('initialize() mounts UI, creates runtime, builds controllers in order', async () => {
    const plugin = makeFakePlugin();
    const composition = new ChatTabComposition({
      plugin,
      viewHost: makeFakeViewHost(),
      containerEl: document.createElement('div'),
      callbacks: {},
    });
    composition.create({});

    const order: string[] = [];
    jest.spyOn(composition as any, 'mountUI').mockImplementation(() => order.push('ui'));
    jest.spyOn(composition as any, 'createRuntime').mockResolvedValue({
      providerId: 'claude',
      setApprovalCallback: jest.fn(),
      setApprovalDismisser: jest.fn(),
      setAskUserQuestionCallback: jest.fn(),
      setExitPlanModeCallback: jest.fn(),
      setSubagentHookProvider: jest.fn(),
      setAutoTurnCallback: jest.fn(),
      setPermissionModeSyncCallback: jest.fn(),
      cleanup: jest.fn(),
    });
    jest.spyOn(composition as any, 'wireControllers').mockImplementation(() => order.push('controllers'));

    await composition.initialize({});
    expect(order).toEqual(['ui', 'controllers']);
    expect(composition.getRuntime()).not.toBeNull();
  });

  it('destroy() disposes controllers, then runtime, then UI', async () => {
    const plugin = makeFakePlugin();
    const composition = new ChatTabComposition({
      plugin,
      viewHost: makeFakeViewHost(),
      containerEl: document.createElement('div'),
      callbacks: {},
    });
    composition.create({});

    const order: string[] = [];
    const fakeUI = { destroy: jest.fn(() => order.push('ui')) };
    const fakeControllers = { dispose: jest.fn(() => order.push('controllers')) };
    const fakeRuntime = { cleanup: jest.fn(() => order.push('runtime')) };
    (composition as any).tabUI = fakeUI;
    (composition as any).controllers = fakeControllers;
    (composition as any).runtime = fakeRuntime;

    await composition.destroy();
    expect(order).toEqual(['controllers', 'runtime', 'ui']);
  });

  it('destroy() is idempotent', async () => {
    const plugin = makeFakePlugin();
    const composition = new ChatTabComposition({
      plugin,
      viewHost: makeFakeViewHost(),
      containerEl: document.createElement('div'),
      callbacks: {},
    });
    composition.create({});
    await composition.destroy();
    await expect(composition.destroy()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify they fail**

Run: `npm run test -- --selectProjects unit -t "ChatTabComposition.initialize"`
Expected: FAIL with `not implemented`.

### Task 17: Implement initialize() and destroy()

**Files:**
- Modify: `src/features/chat/tabs/composition/ChatTabComposition.ts`

- [ ] **Step 1: Implement initialize() and destroy()**

Replace `initialize()` body with:

```ts
async initialize(opts: InitializeTabOptions): Promise<void> {
  if (!this.tab) throw new Error('initialize() requires create() first');

  this.mountUI();
  this.runtime = await this.createRuntime(opts);
  this.wireServiceCallbacks();
  this.wireControllers();

  if (opts.conversation) {
    await this.hydrateConversation(opts.conversation);
  }
}

private mountUI(): void {
  // Calls TabUIAssembly.assembleTabUI; stashes bundle.
  const providerId = resolveBoundTabProvider(this.tab!, this.deps.plugin);
  const capabilities = ProviderRegistry.getCapabilities(providerId);
  const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
  this.tabUI = assembleTabUI({
    containerEl: this.deps.containerEl,
    plugin: this.deps.plugin,
    providerId, capabilities, uiConfig,
    chatState: this.tab!.state,
  });
  // Mirror into tab.ui/tab.dom for legacy callers during migration.
  syncTabFromBundle(this.tab!, this.tabUI);
}

private async createRuntime(opts: InitializeTabOptions): Promise<ChatRuntime> {
  // Lifts the body of Tab.ts's initializeTabService(tab, plugin) into the class.
  // ... (full extraction; see Tab.ts:540–632 for source.)
}

private wireServiceCallbacks(): void {
  // Lifts setupServiceCallbacks (Tab.ts:1703–1760).
}

private wireControllers(): void {
  this.controllers = buildControllerGraph({
    plugin: this.deps.plugin,
    tabUI: this.tabUI!,
    runtime: this.runtime!,
    chatState: this.tab!.state,
    subagentManager: this.tab!.services.subagentManager,
    renderer: this.tab!.renderer!,
  });
  // Mirror into tab.controllers for legacy callers.
  syncControllersFromBundle(this.tab!, this.controllers);
}

async destroy(): Promise<void> {
  if (!this.tab) return;
  this.tab.lifecycleState = 'closing';
  this.controllers?.dispose();
  this.controllers = null;
  await this.runtime?.cleanup?.();
  this.runtime = null;
  this.tabUI?.destroy();
  this.tabUI = null;
  this.tab = null;
}
```

Add the helpers `syncTabFromBundle` and `syncControllersFromBundle` as private methods that copy bundle fields into the legacy `tab.ui`/`tab.controllers` shape so the rest of the app continues to read from `tab.ui` during the migration. They are deleted in Task 22 once all callers move to bundles.

- [ ] **Step 2: Run tests**

Run: `npm run test -- --selectProjects unit -t "ChatTabComposition"`
Expected: all PASS.

### Task 18: Tests for reinitialize(), fork wiring, auto-turn, activate/deactivate, getTitle

**Files:**
- Modify: `tests/unit/features/chat/tabs/composition/ChatTabComposition.test.ts`

- [ ] **Step 1: Append the tests**

Append:

```ts
describe('ChatTabComposition.reinitialize', () => {
  it('disposes old runtime/controllers/UI before creating new', async () => {
    const composition = new ChatTabComposition({
      plugin: makeFakePlugin(),
      viewHost: makeFakeViewHost(),
      containerEl: document.createElement('div'),
      callbacks: {},
    });
    composition.create({});
    await composition.initialize({});

    const oldRuntime = composition.getRuntime();
    await composition.reinitialize({ reason: 'provider-switch' });
    expect(composition.getRuntime()).not.toBe(oldRuntime);
  });
});

describe('ChatTabComposition.setForkContext', () => {
  it('passes fork source through to runtime creation on initialize', async () => {
    const composition = new ChatTabComposition({
      plugin: makeFakePlugin(),
      viewHost: makeFakeViewHost(),
      containerEl: document.createElement('div'),
      callbacks: {},
    });
    composition.create({});
    const fork = { conversationId: 'c1', messageIndex: 3 } as any;
    composition.setForkContext(fork);
    const createRuntime = jest.spyOn(composition as any, 'createRuntime');
    await composition.initialize({});
    expect(createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ forkSource: fork }),
    );
  });
});

describe('ChatTabComposition.triggerAutoTurn', () => {
  it('streams chunks through stream controller', async () => {
    const composition = new ChatTabComposition({
      plugin: makeFakePlugin(),
      viewHost: makeFakeViewHost(),
      containerEl: document.createElement('div'),
      callbacks: {},
    });
    composition.create({});
    await composition.initialize({});

    const handleChunk = jest.spyOn(
      (composition as any).controllers.stream,
      'handleStreamChunk',
    );
    await composition.triggerAutoTurn({
      chunks: [{ type: 'text', content: 'hello' } as any],
      metadata: { assistantMessageId: 'm1' },
    } as any);
    expect(handleChunk).toHaveBeenCalled();
  });

  // Race regression: an auto-turn dispatched while a regular stream is in
  // flight must not corrupt the in-flight assistant message. The runtime
  // queues through QueuedTurn; the composition root must preserve and restore
  // the chat-state cursors around the auto-turn render.
  it('preserves and restores in-flight stream cursors when auto-turn fires mid-stream', async () => {
    const composition = new ChatTabComposition({
      plugin: makeFakePlugin(),
      viewHost: makeFakeViewHost(),
      containerEl: document.createElement('div'),
      callbacks: {},
    });
    composition.create({});
    await composition.initialize({});

    const tab = composition.getTabData();
    const inFlightContentEl = document.createElement('div');
    const inFlightTextEl = document.createElement('span');
    tab.state.currentContentEl = inFlightContentEl;
    tab.state.currentTextEl = inFlightTextEl;
    tab.state.currentTextContent = 'partial';

    await composition.triggerAutoTurn({
      chunks: [{ type: 'text', content: 'autoturn text' } as any],
      metadata: { assistantMessageId: 'auto-1' },
    } as any);

    expect(tab.state.currentContentEl).toBe(inFlightContentEl);
    expect(tab.state.currentTextEl).toBe(inFlightTextEl);
    expect(tab.state.currentTextContent).toBe('partial');
  });
});

describe('ChatTabComposition.activate / deactivate', () => {
  it('activate() removes hidden class and starts selection controllers', async () => {
    const composition = new ChatTabComposition({
      plugin: makeFakePlugin(),
      viewHost: makeFakeViewHost(),
      containerEl: document.createElement('div'),
      callbacks: {},
    });
    composition.create({});
    await composition.initialize({});

    composition.activate();
    expect(composition.getTabData().dom.contentEl.hasClass('claudian-hidden')).toBe(false);

    composition.deactivate();
    expect(composition.getTabData().dom.contentEl.hasClass('claudian-hidden')).toBe(true);
  });
});

describe('ChatTabComposition.getTitle', () => {
  it('returns conversation.title when bound', () => {
    const plugin = makeFakePlugin();
    plugin.getConversationSync = jest.fn().mockReturnValue({ title: 'My Chat' });
    const composition = new ChatTabComposition({
      plugin,
      viewHost: makeFakeViewHost(),
      containerEl: document.createElement('div'),
      callbacks: {},
    });
    composition.create({
      conversation: { id: 'c1', providerId: 'claude', messages: [] } as any,
    });
    expect(composition.getTitle()).toBe('My Chat');
  });

  it('returns "New Chat" when blank', () => {
    const composition = new ChatTabComposition({
      plugin: makeFakePlugin(),
      viewHost: makeFakeViewHost(),
      containerEl: document.createElement('div'),
      callbacks: {},
    });
    composition.create({});
    expect(composition.getTitle()).toBe('New Chat');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- --selectProjects unit -t "ChatTabComposition"`
Expected: FAIL on the new tests.

### Task 19: Implement reinitialize(), triggerAutoTurn(), activate/deactivate, getTitle

**Files:**
- Modify: `src/features/chat/tabs/composition/ChatTabComposition.ts`

- [ ] **Step 1: Implement remaining methods**

Add to `ChatTabComposition`:

```ts
async reinitialize(opts: ReinitializeTabOptions): Promise<void> {
  // Tear down without nulling this.tab.
  this.controllers?.dispose(); this.controllers = null;
  await this.runtime?.cleanup?.(); this.runtime = null;
  this.tabUI?.destroy(); this.tabUI = null;
  await this.initialize(opts);
}

activate(): void {
  if (!this.tab) return;
  this.tab.dom.contentEl.removeClass('claudian-hidden');
  this.controllers?.selection.start();
  this.controllers?.browser.start();
  this.controllers?.canvas.start();
  this.tabUI?.navigationSidebar.updateVisibility();
}

deactivate(): void {
  if (!this.tab) return;
  this.tab.dom.contentEl.addClass('claudian-hidden');
  this.controllers?.selection.stop();
  this.controllers?.browser.stop();
  this.controllers?.canvas.stop();
}

getTitle(): string {
  if (!this.tab) return 'New Chat';
  if (this.tab.conversationId) {
    const c = this.deps.plugin.getConversationSync(this.tab.conversationId);
    if (c?.title) return c.title;
  }
  return 'New Chat';
}

async triggerAutoTurn(result: AutoTurnResult): Promise<void> {
  if (!this.tab || !this.controllers) return;
  // Lifts Tab.ts:renderAutoTriggeredTurn body into the class, replacing
  // `tab.*` references with `this.tab!.*` / `this.controllers!.*` /
  // `this.tabUI!.*`.
}
```

- [ ] **Step 2: Run tests**

Run: `npm run test -- --selectProjects unit -t "ChatTabComposition"`
Expected: all PASS.

- [ ] **Step 3: Run lint + typecheck**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add src/features/chat/tabs/composition/ChatTabComposition.ts \
        tests/unit/features/chat/tabs/composition/ChatTabComposition.test.ts
git commit -m "feat(chat): add ChatTabComposition root with full lifecycle"
```

---

## Phase 5 — Migrate TabManager

### Task 20: Switch TabManager to construct ChatTabComposition per tab

**Files:**
- Modify: `src/features/chat/tabs/TabManager.ts`

- [ ] **Step 1: Replace Tab.ts free-function calls with ChatTabComposition methods**

In `src/features/chat/tabs/TabManager.ts`:

Replace the import block from `./Tab`:

```ts
import {
  activateTab,
  createTab,
  deactivateTab,
  destroyTab,
  type ForkContext,
  getTabTitle,
  initializeTabControllers,
  initializeTabService,
  initializeTabUI,
  setupServiceCallbacks,
  wireTabInputEvents,
} from './Tab';
```

With:

```ts
import { ChatTabComposition } from './composition/ChatTabComposition';
import type { ForkContext } from './composition/types';
```

Inside TabManager, replace the per-tab construction sites. Store a `Map<TabId, ChatTabComposition>` on TabManager. Each tab gets one composition; TabManager calls:

- `composition.create({...})` instead of `createTab({...})`
- `composition.initialize({...})` instead of `initializeTabUI` + `initializeTabService` + `initializeTabControllers` + `setupServiceCallbacks` + `wireTabInputEvents`
- `composition.activate()` instead of `activateTab(tab)`
- `composition.deactivate()` instead of `deactivateTab(tab)`
- `composition.destroy()` instead of `destroyTab(tab)`
- `composition.getTitle()` instead of `getTabTitle(tab, plugin)`
- `composition.setForkContext(source)` for fork handling
- `composition.triggerAutoTurn(result)` for auto-turn dispatch

Concretely, every TabManager method that took a `TabData` and called a Tab.ts free function now resolves the composition from the map: `const c = this.compositions.get(tabId); c.activate();`.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors. If TabManager calls `setupServiceCallbacks(tab, plugin)` somewhere, replace with `composition.initialize(...)` (which calls it internally) or delete the standalone call.

- [ ] **Step 3: Run full test suite**

Run: `npm run test`
Expected: all PASS. `TabManager.test.ts` may need light updates if it asserted on free-function behavior; prefer asserting on the public composition surface.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/tabs/TabManager.ts tests/unit/features/chat/tabs/TabManager.test.ts
git commit -m "feat(chat): switch TabManager to ChatTabComposition"
```

---

## Phase 6 — Delete legacy and verify

### Task 21: Migrate Tab.test.ts cases into the four new test files

**Files:**
- Delete: `tests/unit/features/chat/tabs/Tab.test.ts`
- Modify: any of `tests/unit/features/chat/tabs/composition/*.test.ts` that need to absorb cases

- [ ] **Step 1: Read Tab.test.ts and bucket each test**

Open `tests/unit/features/chat/tabs/Tab.test.ts`. For each `it(...)` block, classify:
- Provider/model resolution → move to `ProviderDraftPolicy.test.ts`
- DOM/UI mounting or destruction → move to `TabUIAssembly.test.ts`
- Controller wiring or dispose → move to `TabControllerGraph.test.ts`
- Lifecycle (create/initialize/destroy/reinitialize/fork/auto-turn) → move to `ChatTabComposition.test.ts`

Rewrite each migrated test against the new module's interface. If a test was asserting a private helper, drop it.

- [ ] **Step 2: Delete Tab.test.ts**

```bash
git rm tests/unit/features/chat/tabs/Tab.test.ts
```

- [ ] **Step 3: Run all tests**

Run: `npm run test`
Expected: all PASS.

### Task 22: Delete Tab.ts and providerResolution.ts

**Files:**
- Delete: `src/features/chat/tabs/Tab.ts`
- Delete: `src/features/chat/tabs/providerResolution.ts`

- [ ] **Step 1: Confirm no callers remain**

Run: `npx grep -rn "from '.*tabs/Tab'" src tests`
Expected: no output.

Run: `npx grep -rn "from '.*providerResolution'" src tests`
Expected: no output.

If output present, update those callers to use `composition/ChatTabComposition` or `composition/ProviderDraftPolicy` and re-run.

- [ ] **Step 2: Delete the files**

```bash
git rm src/features/chat/tabs/Tab.ts src/features/chat/tabs/providerResolution.ts
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Run full test suite**

Run: `npm run test`
Expected: all PASS.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Run build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit the deletion**

```bash
git commit -m "refactor(chat): delete legacy Tab.ts and providerResolution.ts after migration"
```

### Task 23: Smoke test in Obsidian

**Files:** none (manual verification).

- [ ] **Step 1: Build and copy plugin to vault**

Run: `npm run build`
Expected: build succeeds. The build script copies `main.js`, `manifest.json`, and `styles.css` into the vault's `.obsidian/plugins/<plugin-id>/` directory.

- [ ] **Step 2: Reload Obsidian and verify**

Reload Obsidian (Ctrl/Cmd+R or restart). Run the following manual smoke checks:

| Scenario | Expected |
|----------|----------|
| Open a new chat tab | Blank tab appears with default provider and model |
| Switch provider in blank tab | Model picker updates; no console errors |
| Open a bound conversation | Messages hydrate; provider matches conversation |
| Send a message and stream a response | Stream renders; auto-scroll works |
| Open and close 10 tabs | No console warnings; no memory growth in Devtools heap snapshot |
| Fork a conversation | Fork target modal appears; new tab opens at fork point |
| Trigger auto-turn (Agent Board task that posts a result) | Result renders in the parent tab |
| Switch tabs via Ctrl+Tab | Active tab changes; selection controllers restart |

- [ ] **Step 2: If any manual check fails, file a follow-up issue and fix before merging**

### Task 24: Update the source issue with completion link

**Files:**
- Modify: `docs/issues/Architecture Deepening Proposal.md`

- [ ] **Step 1: Mark stage 1 done in the stage status table**

In `docs/issues/Architecture Deepening Proposal.md`, change the row for stage 1 from `spec proposed (2026-05-30)` to `done (<today's date>)` and add the implementation plan link:

```md
| 1 — Chat tab composition | done (<YYYY-MM-DD>) | spec: [[docs/superpowers/specs/2026-05-30-chat-tab-composition-design.md]] · plan: [[docs/superpowers/plans/2026-05-30-chat-tab-composition.md]] |
```

- [ ] **Step 2: Commit and push**

```bash
git add docs/issues/Architecture Deepening Proposal.md docs/superpowers/plans/2026-05-30-chat-tab-composition.md
git commit -m "docs(architecture): mark chat tab composition stage done"
git push
```

---

## Verification Checklist

After all tasks complete:

- [ ] `src/features/chat/tabs/Tab.ts` does not exist
- [ ] `src/features/chat/tabs/providerResolution.ts` does not exist
- [ ] `src/features/chat/tabs/composition/` contains 5 source files and 4 test files
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` reports 0 errors and 0 warnings
- [ ] `npm run test` passes all suites
- [ ] `npm run build` succeeds
- [ ] Manual smoke checks in Task 23 all pass
- [ ] Stage 1 row in `docs/issues/Architecture Deepening Proposal.md` says `done`

---

## Notes for the Implementer

- **TDD discipline:** every Phase task starts with a failing test before implementation. Do not skip the failure verification step — it confirms the test actually reaches the new code.
- **Preserve behavior:** when lifting helpers (`refreshTabProviderUI`, `applyProviderUIGating`, `renderAutoTriggeredTurn`, etc.) into new modules, copy the body 1:1 first. Refactor only after the migration completes and tests prove behavior preserved.
- **Avoid speculative deps:** every `ControllerGraphDeps`/`TabUIDeps` field comes from reading the current Tab.ts call sites. Do not add fields "in case we need them."
- **Bundle pattern discipline:** `TabUIBundle.destroy()` and `ControllerBundle.dispose()` are the only ways to tear down those collaborators. The composition root must not reach into bundle internals.
- **Cleanup ordering invariant:** controllers → runtime → UI. Stream cancellation must precede runtime shutdown to avoid orphaned events. UI last so error messages can render during teardown.
- **Compat shims:** the temporary `syncTabFromBundle` / `syncControllersFromBundle` helpers in `ChatTabComposition` and the no-op `wireTabInputEvents` in `Tab.ts` are the only shims. They are deleted in Task 22 with `Tab.ts`. No shim survives the PR.
