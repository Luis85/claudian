import { createMockEl } from '@test/helpers/mockElement';

import type { GitStatus } from '@/features/chat/services/GitService';
import { GitActionButton, shouldShowGitButton } from '@/features/chat/ui/GitActionButton';

jest.mock('obsidian', () => ({
  setIcon: jest.fn(),
}));

describe('shouldShowGitButton', () => {
  it('shows only when repo present, dirty, and enabled', () => {
    expect(shouldShowGitButton({ isRepo: true, dirtyCount: 2 }, true)).toBe(true);
    expect(shouldShowGitButton({ isRepo: true, dirtyCount: 0 }, true)).toBe(false);
    expect(shouldShowGitButton({ isRepo: false, dirtyCount: 5 }, true)).toBe(false);
    expect(shouldShowGitButton({ isRepo: true, dirtyCount: 2 }, false)).toBe(false);
    expect(shouldShowGitButton(null, true)).toBe(false);
  });
});

describe('GitActionButton', () => {
  function setup(opts?: { enabled?: boolean }) {
    const parent = createMockEl();
    let captured: ((s: GitStatus) => void) | null = null;
    const onCommit = jest.fn();
    const button = new GitActionButton(parent as any, {
      subscribeGitStatus: (cb) => { captured = cb; return () => {}; },
      isGitActionsEnabled: () => opts?.enabled ?? true,
      onGitCommit: onCommit,
    });
    return { parent, button, onCommit, emit: (s: GitStatus) => captured?.(s) };
  }

  it('is hidden until a dirty status arrives', () => {
    const { button } = setup();
    expect(button.containerEl.hasClass('claudian-hidden')).toBe(true);
  });

  it('becomes visible and shows the change count when dirty', () => {
    const { button, emit } = setup();
    emit({ isRepo: true, dirtyCount: 3 });
    expect(button.containerEl.hasClass('claudian-hidden')).toBe(false);
    expect(button.badgeEl.textContent).toBe('3');
  });

  it('hides again when changes are committed away', () => {
    const { button, emit } = setup();
    emit({ isRepo: true, dirtyCount: 3 });
    emit({ isRepo: true, dirtyCount: 0 });
    expect(button.containerEl.hasClass('claudian-hidden')).toBe(true);
  });

  it('stays hidden when the provider disables git actions', () => {
    const { button, emit } = setup({ enabled: false });
    emit({ isRepo: true, dirtyCount: 3 });
    expect(button.containerEl.hasClass('claudian-hidden')).toBe(true);
  });

  it('invokes onGitCommit when clicked', () => {
    const { button, emit, onCommit } = setup();
    emit({ isRepo: true, dirtyCount: 1 });
    button.buttonEl.click();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on dispose', () => {
    const parent = createMockEl();
    const unsub = jest.fn();
    const button = new GitActionButton(parent as any, {
      subscribeGitStatus: () => unsub,
      isGitActionsEnabled: () => true,
      onGitCommit: jest.fn(),
    });
    button.dispose();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
