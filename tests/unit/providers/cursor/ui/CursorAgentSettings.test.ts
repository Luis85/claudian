/**
 * @jest-environment jsdom
 */
import '../../../../setup/obsidianDom';

jest.mock('obsidian', () => ({
  Modal: class MockModal {},
  Notice: jest.fn(),
  Setting: jest.fn(),
  setIcon: jest.fn(),
}));

jest.mock('@/shared/modals/ConfirmModal', () => ({
  confirmDelete: jest.fn(),
}));

import type { CursorAgentStorage } from '@/providers/cursor/storage/CursorAgentStorage';
import type { CursorAgentDefinition } from '@/providers/cursor/types/agent';
import {
  buildCursorAgentDraft,
  CursorAgentSettings,
  validateCursorAgentDraft,
  validateCursorAgentName,
} from '@/providers/cursor/ui/CursorAgentSettings';

const MODAL_STATE = {
  name: 'reviewer',
  description: 'Reviews code.',
  model: '',
  isBackground: false,
  saveToGlobal: false,
  prompt: 'Review like an owner.',
};

function createStorage(agents: CursorAgentDefinition[]): CursorAgentStorage {
  return {
    loadAll: jest.fn(async () => agents),
    save: jest.fn(),
    delete: jest.fn(),
    wouldOverwriteDifferentAgent: jest.fn(async () => false),
  } as unknown as CursorAgentStorage;
}

async function renderSettings(agents: CursorAgentDefinition[]): Promise<HTMLElement> {
  const container = document.createElement('div');
  const settings = new CursorAgentSettings(container, createStorage(agents), undefined, undefined);
  await settings.render();
  return container;
}

describe('CursorAgentSettings', () => {
  it('lists file agents and builtins, with edit/delete only on editable sources', async () => {
    const container = await renderSettings([
      { name: 'reviewer', description: 'Vault reviewer.', prompt: 'p', source: 'vault' },
      { name: 'compat', description: 'Compat. (from .claude/agents)', prompt: 'p', source: 'claude-compat' },
    ]);

    const text = container.textContent ?? '';
    expect(text).toContain('reviewer');
    expect(text).toContain('compat');
    expect(text).toContain('Explore');
    expect(container.querySelectorAll('[aria-label="Edit"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-label="Delete"]')).toHaveLength(1);
  });

  it('shows the create hint when no editable agents exist', async () => {
    const container = await renderSettings([]);

    expect(container.textContent).toContain('No vault or global Cursor subagents yet');
  });

  it('refreshes the @mention cache (onChanged) when Refresh is clicked', async () => {
    const onChanged = jest.fn();
    const container = document.createElement('div');
    const settings = new CursorAgentSettings(container, createStorage([]), undefined, onChanged);
    await settings.render();

    (container.querySelector('[aria-label="Refresh"]') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onChanged).toHaveBeenCalled();
  });
});

describe('validateCursorAgentDraft', () => {
  const vaultFoo: CursorAgentDefinition = {
    name: 'foo', description: 'Vault foo.', prompt: 'p', source: 'vault',
    persistenceKey: 'cursor-agent:vault:foo.md',
  };
  const compatFoo: CursorAgentDefinition = {
    name: 'foo', description: 'Compat. (from .claude/agents)', prompt: 'p', source: 'claude-compat',
    persistenceKey: 'cursor-agent:claude-compat:foo.md',
  };
  const builtinExplore: CursorAgentDefinition = {
    name: 'Explore', description: 'Built-in.', prompt: '', source: 'builtin', readonly: true,
  };

  it('allows a writable agent to shadow a read-only compat or built-in of the same name', () => {
    expect(validateCursorAgentDraft('foo', 'desc', [compatFoo], null)).toBeNull();
    expect(validateCursorAgentDraft('Explore', 'desc', [builtinExplore], null)).toBeNull();
  });

  it('still rejects a duplicate editable (vault/global) name', () => {
    expect(validateCursorAgentDraft('foo', 'desc', [vaultFoo], null)).not.toBeNull();
  });

  it('requires a description on create but allows saving an edit without one', () => {
    expect(validateCursorAgentDraft('brandnew', '', [], null)).not.toBeNull();
    expect(validateCursorAgentDraft('foo', '', [], vaultFoo)).toBeNull();
  });
});

describe('buildCursorAgentDraft', () => {
  it('preserves readonly and unknown frontmatter the modal does not expose', () => {
    const existing: CursorAgentDefinition = {
      name: 'reviewer',
      description: 'Reviews code.',
      prompt: 'Review like an owner.',
      source: 'vault',
      readonly: true,
      extraFrontmatter: { custom_key: 'custom-value' },
      persistenceKey: 'cursor-agent:vault:reviewer.md',
    };

    const draft = buildCursorAgentDraft(MODAL_STATE, existing);

    expect(draft.readonly).toBe(true);
    expect(draft.extraFrontmatter).toEqual({ custom_key: 'custom-value' });
  });

  it('omits readonly and extra frontmatter for a brand-new agent', () => {
    const draft = buildCursorAgentDraft(MODAL_STATE, null);

    expect(draft.readonly).toBeUndefined();
    expect(draft.extraFrontmatter).toBeUndefined();
  });
});

describe('validateCursorAgentName', () => {
  it('accepts simple names', () => {
    expect(validateCursorAgentName('code-reviewer')).toBeNull();
    expect(validateCursorAgentName('reviewer.v2')).toBeNull();
  });

  it('rejects empty, path-traversal, and reserved-character names', () => {
    expect(validateCursorAgentName('')).not.toBeNull();
    expect(validateCursorAgentName('..')).not.toBeNull();
    expect(validateCursorAgentName('a/b')).not.toBeNull();
    expect(validateCursorAgentName('a\\b')).not.toBeNull();
    expect(validateCursorAgentName('a:b')).not.toBeNull();
    expect(validateCursorAgentName(' padded ')).not.toBeNull();
  });
});
