import { getEnabledProviderForModel } from '../../../core/providers/modelRouting';
import type { ProviderId } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { asSettingsBag } from '../../../core/types/settings';
import type ClaudianPlugin from '../../../main';
import { SubagentManager } from '../services/SubagentManager';
import { ChatState } from '../state/ChatState';
import { resolveBlankTabDefaultProviderId } from './tabModelPolicy';
import { resolveBlankTabModel } from './tabShared';
import type { TabData, TabDOMElements, TabId } from './types';
import { generateTabId } from './types';

export interface TabCreateOptions {
  plugin: ClaudianPlugin;

  containerEl: HTMLElement;
  conversation?: Conversation;
  tabId?: TabId;
  /** Restored draft model for blank tabs. */
  draftModel?: string | null;
  /**
   * Tab-pinned model that survives runtime init. Used for Agent Board task
   * runs so the work-order model:
   *   - displays in the ModelSelector for the life of the tab,
   *   - is forwarded as `queryOptions.model` on every turn.
   */
  pinnedModel?: string | null;
  /** Provider to inherit for blank tabs (e.g. from the active tab). */
  defaultProviderId?: ProviderId;
  onStreamingChanged?: (isStreaming: boolean) => void;
  onTitleChanged?: (title: string) => void;
  onAttentionChanged?: (needsAttention: boolean) => void;
  onConversationIdChanged?: (conversationId: string | null) => void;
}

/**
 * Creates a new Tab instance with all required state.
 */
export function createTab(options: TabCreateOptions): TabData {
  const {
    plugin,
    containerEl,
    conversation,
    tabId,
    onStreamingChanged,
    onAttentionChanged,
    onConversationIdChanged,
  } = options;

  const id = tabId ?? generateTabId();

  const contentEl = containerEl.createDiv({ cls: 'claudian-tab-content claudian-hidden' });

  const state = new ChatState({
    onStreamingStateChanged: onStreamingChanged,
    onAttentionChanged: onAttentionChanged,
    onConversationChanged: onConversationIdChanged,
  });

  // Create subagent manager with no-op callback.
  // This placeholder is replaced in initializeTabControllers() with the actual
  // callback that updates the StreamController. We defer the real callback
  // because StreamController doesn't exist until controllers are initialized.
  const subagentManager = new SubagentManager(plugin.app, () => {});

  const dom = buildTabDOM(contentEl);
  state.queueIndicatorEl = dom.queueIndicatorEl;

  const isBound = !!conversation?.id;
  const restoredDraftModel = typeof options.draftModel === 'string'
    ? options.draftModel.trim()
    : '';
  const draftModel = isBound
    ? null
    : (restoredDraftModel || resolveBlankTabModel(plugin, options.defaultProviderId));
  const initialProviderId = conversation?.providerId
    ?? (draftModel
      ? getEnabledProviderForModel(draftModel, plugin.settings)
      : resolveBlankTabDefaultProviderId(asSettingsBag(plugin.settings)));

  const pinnedModelInput = typeof options.pinnedModel === 'string'
    ? options.pinnedModel.trim()
    : '';
  const pinnedModel = pinnedModelInput || null;

  const tab: TabData = {
    id,
    lifecycleState: isBound ? 'bound_cold' : 'blank',
    draftModel,
    pinnedModel,
    providerId: initialProviderId,
    conversationId: conversation?.id ?? null,
    service: null,
    serviceInitialized: false,
    state,
    controllers: {
      selectionController: null,
      browserSelectionController: null,
      canvasSelectionController: null,
      conversationController: null,
      streamController: null,
      inputController: null,
      navigationController: null,
    },
    services: {
      subagentManager,
      instructionRefineService: null,
      titleGenerationService: null,
    },
    ui: {
      fileContextManager: null,
      imageContextManager: null,
      modelSelector: null,
      modeSelector: null,
      thinkingBudgetSelector: null,
      externalContextSelector: null,
      mcpServerSelector: null,
      permissionToggle: null,
      planModeToggle: null,
      serviceTierToggle: null,
      slashCommandDropdown: null,
      instructionModeManager: null,
      bangBashModeManager: null,
      contextUsageMeter: null,
      statusPanel: null,
      navigationSidebar: null,
    },
    dom,
    renderer: null,
  };

  return tab;
}

/**
 * Builds the DOM structure for a tab.
 */
function buildTabDOM(contentEl: HTMLElement): TabDOMElements {
  const messagesWrapperEl = contentEl.createDiv({ cls: 'claudian-messages-wrapper' });
  const messagesEl = messagesWrapperEl.createDiv({ cls: 'claudian-messages' });
  const welcomeEl = messagesEl.createDiv({ cls: 'claudian-welcome' });
  const statusPanelContainerEl = contentEl.createDiv({ cls: 'claudian-status-panel-container' });
  const inputContainerEl = contentEl.createDiv({ cls: 'claudian-input-container' });
  const queueIndicatorEl = inputContainerEl.createDiv({ cls: 'claudian-input-queue-row' });
  const navRowEl = inputContainerEl.createDiv({ cls: 'claudian-input-nav-row' });
  const inputWrapper = inputContainerEl.createDiv({ cls: 'claudian-input-wrapper' });
  const contextRowEl = inputWrapper.createDiv({ cls: 'claudian-context-row' });
  const inputEl = inputWrapper.createEl('textarea', {
    cls: 'claudian-input',
    attr: {
      placeholder: 'How can i help you today?',
      rows: '3',
      dir: 'auto',
    },
  });

  return {
    contentEl,
    messagesEl,
    welcomeEl,
    statusPanelContainerEl,
    inputContainerEl,
    queueIndicatorEl,
    inputWrapper,
    inputEl,
    navRowEl,
    contextRowEl,
    selectionIndicatorEl: null,
    browserIndicatorEl: null,
    canvasIndicatorEl: null,
    eventCleanups: [],
  };
}
