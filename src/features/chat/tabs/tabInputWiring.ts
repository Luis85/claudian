import { Platform } from 'obsidian';

import type { ClaudianSettings } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { autoResizeTextarea } from '../ui/textareaResize';
import { getTabCapabilities } from './tabShared';
import type { TabData } from './types';

function isEnterWithoutShiftOrComposition(e: KeyboardEvent): boolean {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) {
    return false;
  }

  return true;
}

function hasPlatformSendModifier(e: KeyboardEvent): boolean {
  if (Platform.isMacOS) {
    return e.metaKey === true && !e.ctrlKey && !e.altKey;
  }

  return e.ctrlKey === true && !e.metaKey && !e.altKey;
}

function shouldSendMessageFromExplicitEnterShortcut(e: KeyboardEvent): boolean {
  return isEnterWithoutShiftOrComposition(e) && hasPlatformSendModifier(e);
}

function shouldSendMessageFromEnterKey(
  e: KeyboardEvent,
  settings: Pick<ClaudianSettings, 'requireCommandOrControlEnterToSend'>,
): boolean {
  if (!isEnterWithoutShiftOrComposition(e)) {
    return false;
  }

  if (settings.requireCommandOrControlEnterToSend === true) {
    return hasPlatformSendModifier(e);
  }

  return true;
}

function isTabInputFocused(tab: TabData): boolean {
  return tab.dom.inputEl.ownerDocument.activeElement === tab.dom.inputEl;
}

function sendTabInputMessage(
  tab: TabData,
  e: KeyboardEvent,
  options?: { requireInputFocus?: boolean },
): boolean {
  if (options?.requireInputFocus && !isTabInputFocused(tab)) {
    return false;
  }

  const inputController = tab.controllers.inputController;
  if (!inputController) {
    return false;
  }

  e.preventDefault();
  void inputController.sendMessage();
  return true;
}

export function sendTabInputMessageFromExplicitEnterShortcut(
  tab: TabData,
  e: KeyboardEvent,
  options?: { requireInputFocus?: boolean },
): boolean {
  if (!shouldSendMessageFromExplicitEnterShortcut(e)) {
    return false;
  }

  return sendTabInputMessage(tab, e, options);
}

function sendTabInputMessageFromEnterKey(
  tab: TabData,
  settings: Pick<ClaudianSettings, 'requireCommandOrControlEnterToSend'>,
  e: KeyboardEvent,
): boolean {
  if (!shouldSendMessageFromEnterKey(e, settings)) {
    return false;
  }

  return sendTabInputMessage(tab, e);
}

/**
 * Wires up input event handlers for a tab.
 * Call this after controllers are initialized.
 * Stores cleanup functions in dom.eventCleanups for proper memory management.
 */
export function wireTabInputEvents(tab: TabData, plugin: ClaudianPlugin): void {
  const { dom, ui, state, controllers } = tab;

  let wasBangBashActive = ui.bangBashModeManager?.isActive() ?? false;
  const syncBangBashSuppression = (): void => {
    const isActive = ui.bangBashModeManager?.isActive() ?? false;
    if (isActive === wasBangBashActive) return;
    wasBangBashActive = isActive;

    ui.slashCommandDropdown?.setEnabled(!isActive);
    if (isActive) {
      ui.fileContextManager?.hideMentionDropdown();
    }
  };

  const keydownHandler = (e: KeyboardEvent) => {
    if (ui.bangBashModeManager?.isActive()) {
      ui.bangBashModeManager.handleKeydown(e);
      syncBangBashSuppression();
      return;
    }

    if (getTabCapabilities(tab, plugin).supportsInstructionMode && ui.instructionModeManager?.handleTriggerKey(e)) {
      return;
    }

    if (ui.bangBashModeManager?.handleTriggerKey(e)) {
      syncBangBashSuppression();
      return;
    }

    if (getTabCapabilities(tab, plugin).supportsInstructionMode && ui.instructionModeManager?.handleKeydown(e)) {
      return;
    }

    if (sendTabInputMessageFromExplicitEnterShortcut(tab, e)) {
      return;
    }

    if (controllers.inputController?.handleResumeKeydown(e)) {
      return;
    }

    if (ui.slashCommandDropdown?.handleKeydown(e)) {
      return;
    }

    if (ui.fileContextManager?.handleMentionKeydown(e)) {
      return;
    }

    // Check !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
    if (e.key === 'Escape' && !e.isComposing && state.isStreaming) {
      e.preventDefault();
      controllers.inputController?.cancelStreaming();
      return;
    }

    if (sendTabInputMessageFromEnterKey(tab, plugin.settings, e)) {
      return;
    }
  };
  dom.inputEl.addEventListener('keydown', keydownHandler);
  dom.eventCleanups.push(() => dom.inputEl.removeEventListener('keydown', keydownHandler));

  const inputHandler = () => {
    if (!ui.bangBashModeManager?.isActive()) {
      ui.fileContextManager?.handleInputChange();
    }
    ui.instructionModeManager?.handleInputChange();
    ui.bangBashModeManager?.handleInputChange();
    syncBangBashSuppression();
    autoResizeTextarea(dom.inputEl);
  };
  dom.inputEl.addEventListener('input', inputHandler);
  dom.eventCleanups.push(() => dom.inputEl.removeEventListener('input', inputHandler));

  // Sidebar focus handler — show selection highlight when focus enters the tab from outside
  const focusHandler = (e: FocusEvent) => {
    if (e.relatedTarget && dom.contentEl.contains(e.relatedTarget as Node)) return;
    controllers.selectionController?.showHighlight();
  };
  dom.contentEl.addEventListener('focusin', focusHandler);
  dom.eventCleanups.push(() => dom.contentEl.removeEventListener('focusin', focusHandler));

  // Scroll listener for auto-scroll control (tracks position always, not just during streaming)
  const SCROLL_THRESHOLD = 20; // pixels from bottom to consider "at bottom"
  const RE_ENABLE_DELAY = 150; // ms to wait before re-enabling auto-scroll
  let reEnableTimeout: number | null = null;

  const isAutoScrollAllowed = (): boolean => plugin.settings.enableAutoScroll ?? true;

  const scrollHandler = () => {
    if (!isAutoScrollAllowed()) {
      if (reEnableTimeout) {
        window.clearTimeout(reEnableTimeout);
        reEnableTimeout = null;
      }
      state.autoScrollEnabled = false;
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = dom.messagesEl;
    const isAtBottom = scrollHeight - scrollTop - clientHeight <= SCROLL_THRESHOLD;

    if (!isAtBottom) {
      // Immediately disable when user scrolls up
      if (reEnableTimeout) {
        window.clearTimeout(reEnableTimeout);
        reEnableTimeout = null;
      }
      state.autoScrollEnabled = false;
    } else if (!state.autoScrollEnabled) {
      // Debounce re-enabling to avoid bounce during scroll animation
      if (!reEnableTimeout) {
        reEnableTimeout = window.setTimeout(() => {
          reEnableTimeout = null;
          // Re-verify position before enabling (content may have changed)
          const { scrollTop, scrollHeight, clientHeight } = dom.messagesEl;
          if (scrollHeight - scrollTop - clientHeight <= SCROLL_THRESHOLD) {
            state.autoScrollEnabled = true;
          }
        }, RE_ENABLE_DELAY);
      }
    }
  };
  dom.messagesEl.addEventListener('scroll', scrollHandler, { passive: true });
  dom.eventCleanups.push(() => {
    dom.messagesEl.removeEventListener('scroll', scrollHandler);
    if (reEnableTimeout) window.clearTimeout(reEnableTimeout);
  });
}
