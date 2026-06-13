import { setIcon } from 'obsidian';

import type { ChatMessageAction } from '../../../core/types';

/**
 * Shared button chrome for message toolbars. Extracted from {@link MessageRenderer}
 * where the copy-button click flow and the message-action button loop were
 * duplicated across the user and assistant render paths. Each helper builds one
 * affordance; callers own the surrounding container and CSS class.
 */

/**
 * Wires a copy affordance: on click, copies `getText()` to the clipboard and
 * shows a transient "Copied!" label before restoring the copy icon. A pending
 * feedback timeout is cleared on rapid clicks so the icon is never left stale.
 * Caller creates `copyBtn` (and its class / aria-label); this owns the icon and
 * click behavior.
 */
export function wireCopyButton(copyBtn: HTMLElement, getText: () => string): void {
  setIcon(copyBtn, 'copy');

  let feedbackTimeout: number | null = null;

  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void (async () => {
      try {
        await navigator.clipboard.writeText(getText());
      } catch {
        // Clipboard API may fail in non-secure contexts.
        return;
      }

      if (feedbackTimeout) window.clearTimeout(feedbackTimeout);
      copyBtn.empty();
      copyBtn.setText('Copied!');
      copyBtn.classList.add('copied');
      feedbackTimeout = window.setTimeout(() => {
        copyBtn.empty();
        setIcon(copyBtn, 'copy');
        copyBtn.classList.remove('copied');
        feedbackTimeout = null;
      }, 1500);
    })();
  });
}

/**
 * Renders one registered message-action button into `container`. The icon,
 * aria-label, and click→run wiring are identical across the user-toolbar and
 * assistant-inline action paths; only the button class and the message/
 * conversation context differ, so those are parameters.
 */
export function renderMessageActionButton(
  container: HTMLElement,
  action: ChatMessageAction,
  cls: string,
  run: () => void,
): void {
  const btn = container.createSpan({ cls });
  setIcon(btn, action.icon);
  btn.setAttribute('aria-label', action.label);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    run();
  });
}
