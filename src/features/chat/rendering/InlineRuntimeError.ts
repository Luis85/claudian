import { Notice, setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { TranslationKey } from '../../../i18n/types';
import type { RuntimeErrorKind } from '../controllers/runtimeErrorClassification';

/**
 * Actionable runtime-error card (UX-F/UX-J).
 *
 * Renders a guided recovery card in place of the old bare `projectErrorText`
 * stream line. The card surfaces a clear title + message and action buttons
 * appropriate to the classified {@link RuntimeErrorKind}: open settings for a
 * missing CLI, a copyable provider login command for auth failures, and a retry
 * affordance on every kind (even `generic`) so unclassified errors still offer a
 * one-click re-send. DOM is built with `createEl`/`createDiv`/`createSpan`/
 * `setText` only (no innerHTML), mirroring the other inline card renderers.
 */

export interface InlineRuntimeErrorOptions {
  /** Classified error kind driving which actions appear. */
  kind: RuntimeErrorKind;
  /** Raw provider error message; shown verbatim in a collapsible details row. */
  content: string;
  /** Active provider id, used to pick the right login hint command. */
  providerId: string;
  /** Opens the provider's settings tab (CLI path field). Omitted when unavailable. */
  onOpenSettings?: () => void;
  /** Re-dispatches the last turn. Omitted when no turn is available to retry. */
  onRetry?: () => void;
}

const LOGIN_HINT_KEYS: Record<string, TranslationKey> = {
  claude: 'chat.runtimeError.unauthenticated.claudeHint',
  codex: 'chat.runtimeError.unauthenticated.codexHint',
  cursor: 'chat.runtimeError.unauthenticated.cursorHint',
  opencode: 'chat.runtimeError.unauthenticated.opencodeHint',
};

function titleKey(kind: RuntimeErrorKind): TranslationKey {
  switch (kind) {
    case 'cli-not-found':
      return 'chat.runtimeError.cliNotFound.title';
    case 'unauthenticated':
      return 'chat.runtimeError.unauthenticated.title';
    case 'context-too-large':
      return 'chat.runtimeError.contextTooLarge.title';
    case 'generic':
      return 'chat.runtimeError.generic.title';
  }
}

function bodyKey(kind: RuntimeErrorKind): TranslationKey | null {
  switch (kind) {
    case 'cli-not-found':
      return 'chat.runtimeError.cliNotFound.body';
    case 'unauthenticated':
      return 'chat.runtimeError.unauthenticated.body';
    case 'context-too-large':
      return 'chat.runtimeError.contextTooLarge.body';
    case 'generic':
      // Generic falls back to showing the raw message as its body.
      return null;
  }
}

export function renderInlineRuntimeError(
  parentEl: HTMLElement,
  options: InlineRuntimeErrorOptions,
): HTMLElement {
  const { kind, content, providerId, onOpenSettings, onRetry } = options;

  const card = parentEl.createDiv({ cls: `claudian-runtime-error-card claudian-runtime-error-${kind}` });

  const header = card.createDiv({ cls: 'claudian-runtime-error-header' });
  const iconEl = header.createSpan({ cls: 'claudian-runtime-error-icon' });
  setIcon(iconEl, 'alert-triangle');
  header.createSpan({ cls: 'claudian-runtime-error-title', text: t(titleKey(kind)) });

  const resolvedBodyKey = bodyKey(kind);
  if (resolvedBodyKey) {
    card.createDiv({ cls: 'claudian-runtime-error-body', text: t(resolvedBodyKey) });
  } else if (content) {
    // Generic: the raw provider message is the most useful body text.
    card.createDiv({ cls: 'claudian-runtime-error-body', text: content });
  }

  if (kind === 'unauthenticated') {
    renderLoginHint(card, providerId);
  }

  // Raw provider message kept available behind a collapsible details row for the
  // classified kinds (the generic card already shows it as the body).
  if (resolvedBodyKey && content) {
    const details = card.createEl('details', { cls: 'claudian-runtime-error-details' });
    details.createEl('summary', {
      cls: 'claudian-runtime-error-details-summary',
      text: t('chat.runtimeError.detailsLabel'),
    });
    details.createEl('pre', { cls: 'claudian-runtime-error-details-text', text: content });
  }

  const actions = card.createDiv({ cls: 'claudian-runtime-error-actions' });

  if (onOpenSettings && (kind === 'cli-not-found' || kind === 'unauthenticated')) {
    const settingsKey: TranslationKey =
      kind === 'cli-not-found'
        ? 'chat.runtimeError.cliNotFound.openSettings'
        : 'chat.runtimeError.unauthenticated.openSettings';
    const settingsBtn = actions.createEl('button', {
      cls: 'claudian-runtime-error-button',
      text: t(settingsKey),
    });
    settingsBtn.addEventListener('click', () => onOpenSettings());
  }

  if (onRetry) {
    const retryBtn = actions.createEl('button', {
      cls: 'claudian-runtime-error-button claudian-runtime-error-button-primary',
      text: t('chat.runtimeError.retry'),
    });
    retryBtn.addEventListener('click', () => onRetry());
  }

  return card;
}

function renderLoginHint(card: HTMLElement, providerId: string): void {
  const hintKey = LOGIN_HINT_KEYS[providerId] ?? 'chat.runtimeError.unauthenticated.genericHint';
  const command = t(hintKey);

  const hint = card.createDiv({ cls: 'claudian-runtime-error-hint' });
  hint.createDiv({
    cls: 'claudian-runtime-error-hint-label',
    text: t('chat.runtimeError.unauthenticated.hintLabel'),
  });

  const row = hint.createDiv({ cls: 'claudian-runtime-error-hint-row' });
  row.createEl('code', { cls: 'claudian-runtime-error-hint-command', text: command });

  const copyBtn = row.createEl('button', {
    cls: 'claudian-runtime-error-hint-copy',
    attr: { 'aria-label': t('chat.runtimeError.unauthenticated.copyHint') },
  });
  setIcon(copyBtn, 'copy');
  copyBtn.addEventListener('click', () => {
    void navigator.clipboard?.writeText(command).then(() => {
      new Notice(t('chat.runtimeError.unauthenticated.copied'));
    });
  });
}
