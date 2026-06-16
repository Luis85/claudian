/**
 * @jest-environment jsdom
 */
import '../../../setup/obsidianDom';

jest.mock('obsidian', () => ({ Notice: jest.fn(), setIcon: jest.fn() }));
jest.mock('@/shared/modals/ConfirmModal', () => ({ confirmDelete: jest.fn() }));

import type { App } from 'obsidian';
import { Notice } from 'obsidian';

import { confirmDeleteListItem } from '@/shared/components/settingsListUI';
import { confirmDelete } from '@/shared/modals/ConfirmModal';

const mockConfirm = confirmDelete as jest.Mock;
const mockNotice = Notice as unknown as jest.Mock;
const app = {} as App;

describe('confirmDeleteListItem', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes, runs afterDelete, and shows the success notice when confirmed', async () => {
    mockConfirm.mockResolvedValue(true);
    const doDelete = jest.fn().mockResolvedValue(undefined);
    const afterDelete = jest.fn().mockResolvedValue(undefined);

    await confirmDeleteListItem({
      app, message: 'Delete?', doDelete, afterDelete,
      successNotice: 'Deleted', failureNotice: 'Failed',
    });

    expect(mockConfirm).toHaveBeenCalledWith(app, 'Delete?');
    expect(doDelete).toHaveBeenCalledTimes(1);
    expect(afterDelete).toHaveBeenCalledTimes(1);
    expect(mockNotice).toHaveBeenCalledWith('Deleted');
  });

  it('does nothing when the confirm is declined', async () => {
    mockConfirm.mockResolvedValue(false);
    const doDelete = jest.fn();

    await confirmDeleteListItem({
      app, message: 'Delete?', doDelete, afterDelete: jest.fn(),
      successNotice: 'Deleted', failureNotice: 'Failed',
    });

    expect(doDelete).not.toHaveBeenCalled();
    expect(mockNotice).not.toHaveBeenCalled();
  });

  it('shows the failure notice when the delete throws', async () => {
    mockConfirm.mockResolvedValue(true);
    const doDelete = jest.fn().mockRejectedValue(new Error('boom'));

    await confirmDeleteListItem({
      app, message: 'Delete?', doDelete, afterDelete: jest.fn(),
      successNotice: 'Deleted', failureNotice: 'Failed',
    });

    expect(mockNotice).toHaveBeenCalledWith('Failed');
  });
});
