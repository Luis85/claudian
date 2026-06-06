import { createMockEl } from '@test/helpers/mockElement';

import { renderInlineRuntimeError } from '@/features/chat/rendering/InlineRuntimeError';

describe('renderInlineRuntimeError', () => {
  function render(overrides: Partial<Parameters<typeof renderInlineRuntimeError>[1]> = {}) {
    const parent = createMockEl('div');
    renderInlineRuntimeError(parent as unknown as HTMLElement, {
      kind: 'generic',
      content: 'Boom',
      providerId: 'claude',
      ...overrides,
    });
    return parent;
  }

  it('renders a card with a title and a retry button when onRetry is provided', () => {
    const onRetry = jest.fn();
    const parent = render({ kind: 'generic', content: 'Network failed', onRetry });

    const card = parent.querySelector('.claudian-runtime-error-card');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.claudian-runtime-error-title')?.textContent).toBeTruthy();

    const buttons = parent.querySelectorAll('.claudian-runtime-error-button');
    expect(buttons.length).toBe(1);
    buttons[0].click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('cli-not-found shows both Open settings and Retry actions', () => {
    const onOpenSettings = jest.fn();
    const onRetry = jest.fn();
    const parent = render({
      kind: 'cli-not-found',
      content: 'Claude CLI not found',
      onOpenSettings,
      onRetry,
    });

    const buttons = parent.querySelectorAll('.claudian-runtime-error-button');
    expect(buttons.length).toBe(2);
    buttons[0].click(); // open settings (first)
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    buttons[1].click(); // retry
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('unauthenticated renders a copyable provider login hint', () => {
    const parent = render({ kind: 'unauthenticated', content: '401 Unauthorized', onRetry: jest.fn() });

    const command = parent.querySelector('.claudian-runtime-error-hint-command');
    expect(command?.textContent).toBe('claude login');
    expect(parent.querySelector('.claudian-runtime-error-hint-copy')).not.toBeNull();
  });

  it('unauthenticated picks the provider-specific login command', () => {
    const parent = render({
      kind: 'unauthenticated',
      content: 'Please log in',
      providerId: 'cursor',
      onRetry: jest.fn(),
    });
    expect(parent.querySelector('.claudian-runtime-error-hint-command')?.textContent).toBe(
      'cursor-agent login',
    );
  });

  it('context-too-large shows a guided body and retry but no open-settings action', () => {
    const onOpenSettings = jest.fn();
    const onRetry = jest.fn();
    const parent = render({
      kind: 'context-too-large',
      content: 'prompt is too long',
      onOpenSettings,
      onRetry,
    });

    expect(parent.querySelector('.claudian-runtime-error-body')?.textContent).toBeTruthy();
    const buttons = parent.querySelectorAll('.claudian-runtime-error-button');
    expect(buttons.length).toBe(1); // retry only
    buttons[0].click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it('classified kinds keep the raw provider message in a details row', () => {
    const parent = render({ kind: 'cli-not-found', content: 'spawn claude ENOENT', onRetry: jest.fn() });
    expect(parent.querySelector('.claudian-runtime-error-details-text')?.textContent).toBe(
      'spawn claude ENOENT',
    );
  });
});
