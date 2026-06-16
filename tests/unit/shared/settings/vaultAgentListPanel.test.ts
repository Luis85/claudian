/**
 * @jest-environment jsdom
 */
import '../../../setup/obsidianDom';

jest.mock('obsidian', () => ({ Notice: jest.fn(), setIcon: jest.fn() }));
jest.mock('@/shared/modals/ConfirmModal', () => ({ confirmDelete: jest.fn() }));

import type { App } from 'obsidian';

import { confirmDelete } from '@/shared/modals/ConfirmModal';
import { renderVaultAgentListItem } from '@/shared/settings/vaultAgentListPanel';

const mockConfirm = confirmDelete as jest.Mock;
const app = {} as App;
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type ItemOptions = Parameters<typeof renderVaultAgentListItem>[2];

function renderRow(overrides: Partial<ItemOptions> = {}): HTMLElement {
  const listEl = document.createElement('div');
  renderVaultAgentListItem(listEl, app, {
    name: 'reviewer',
    description: 'Reviews code.',
    onEdit: jest.fn(),
    deleteConfirmMessage: 'Delete "reviewer"?',
    onDelete: jest.fn().mockResolvedValue(undefined),
    onDeleteFailed: jest.fn(),
    ...overrides,
  });
  return listEl;
}

describe('renderVaultAgentListItem', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the name and fires onEdit when the edit affordance is clicked', () => {
    const onEdit = jest.fn();
    const listEl = renderRow({ onEdit });

    expect(listEl.textContent).toContain('reviewer');
    (listEl.querySelector('[aria-label="Edit"]') as HTMLElement).click();
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('confirms then deletes', async () => {
    mockConfirm.mockResolvedValue(true);
    const onDelete = jest.fn().mockResolvedValue(undefined);
    const onDeleteFailed = jest.fn();
    const listEl = renderRow({ onDelete, onDeleteFailed });

    (listEl.querySelector('[aria-label="Delete"]') as HTMLElement).click();
    await flush();

    expect(mockConfirm).toHaveBeenCalledWith(app, 'Delete "reviewer"?');
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDeleteFailed).not.toHaveBeenCalled();
  });

  it('skips deletion when the confirm is declined', async () => {
    mockConfirm.mockResolvedValue(false);
    const onDelete = jest.fn();
    const listEl = renderRow({ onDelete });

    (listEl.querySelector('[aria-label="Delete"]') as HTMLElement).click();
    await flush();

    expect(onDelete).not.toHaveBeenCalled();
  });

  it('surfaces failure via onDeleteFailed when the delete throws', async () => {
    mockConfirm.mockResolvedValue(true);
    const onDelete = jest.fn().mockRejectedValue(new Error('boom'));
    const onDeleteFailed = jest.fn();
    const listEl = renderRow({ onDelete, onDeleteFailed });

    (listEl.querySelector('[aria-label="Delete"]') as HTMLElement).click();
    await flush();

    expect(onDeleteFailed).toHaveBeenCalledTimes(1);
  });
});
