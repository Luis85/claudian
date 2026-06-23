import { createMockEl } from '@test/helpers/mockElement';

import {
  ConversationHistoryView,
  type ConversationHistoryViewDeps,
} from '@/features/chat/ui/ConversationHistoryView';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(overrides: Partial<ConversationHistoryViewDeps> = {}) {
  const dropdown = createMockEl();
  const state = { currentConversationId: null as string | null, isStreaming: false } as never;
  const plugin = {
    getConversationList: jest.fn().mockReturnValue([]),
    deleteConversation: jest.fn().mockResolvedValue(undefined),
    renameConversation: jest.fn().mockResolvedValue(undefined),
    getConversationById: jest.fn().mockResolvedValue(null),
    updateConversation: jest.fn().mockResolvedValue(undefined),
    settings: { enableAutoTitleGeneration: true },
  } as never;
  const onSelectConversation = jest.fn().mockResolvedValue(undefined);
  const onReloadAfterActiveDelete = jest.fn().mockResolvedValue(undefined);

  const deps: ConversationHistoryViewDeps = {
    plugin,
    state,
    getHistoryDropdown: () => dropdown as never,
    getTitleGenerationService: () => null,
    onSelectConversation,
    onReloadAfterActiveDelete,
    ...overrides,
  };

  return {
    view: new ConversationHistoryView(deps),
    dropdown,
    plugin: plugin as never as {
      getConversationList: jest.Mock;
      deleteConversation: jest.Mock;
      getConversationById: jest.Mock;
      settings: { enableAutoTitleGeneration: boolean };
    },
    state: state as never as { currentConversationId: string | null; isStreaming: boolean },
    onSelectConversation,
    onReloadAfterActiveDelete,
  };
}

describe('ConversationHistoryView', () => {
  it('renders a header and a windowed list of rows into the dropdown', () => {
    const { view, dropdown, plugin } = setup();
    plugin.getConversationList.mockReturnValue([
      { id: 'a', title: 'Alpha', createdAt: 1, lastResponseAt: 2 },
      { id: 'b', title: 'Beta', createdAt: 1, lastResponseAt: 1 },
    ]);

    view.updateHistoryDropdown();

    expect(dropdown.children.length).toBe(2); // header + list
    const list = dropdown.children[1];
    expect(list.hasClass('specorator-history-list')).toBe(true);
    expect(list.children.length).toBe(2);
  });

  it('shows the empty state when there are no conversations', () => {
    const { view, dropdown } = setup();

    view.updateHistoryDropdown();

    const list = dropdown.children[1];
    expect(list.children[0].hasClass('specorator-history-empty')).toBe(true);
  });

  it('invokes onSelectConversation when a non-current row is clicked', async () => {
    const { view, dropdown, plugin, onSelectConversation } = setup();
    plugin.getConversationList.mockReturnValue([
      { id: 'other', title: 'Other', createdAt: 1, lastResponseAt: 1 },
    ]);

    view.updateHistoryDropdown();

    const content = dropdown.children[1].children[0].querySelector('.specorator-history-item-content');
    const click = content!._eventListeners?.get('click');
    await click![0]({ stopPropagation: jest.fn(), preventDefault: jest.fn() });
    await flush();

    expect(onSelectConversation).toHaveBeenCalledWith('other');
  });

  it('reloads the active conversation after deleting the current one', async () => {
    const { view, dropdown, plugin, state, onReloadAfterActiveDelete } = setup();
    state.currentConversationId = 'cur';
    plugin.getConversationList.mockReturnValue([
      { id: 'cur', title: 'Current', createdAt: 1, lastResponseAt: 1 },
    ]);

    view.updateHistoryDropdown();

    const deleteBtn = dropdown.children[1].children[0].querySelector('.specorator-delete-btn');
    const click = deleteBtn!._eventListeners?.get('click');
    await click![0]({ stopPropagation: jest.fn() });
    await flush();

    expect(plugin.deleteConversation).toHaveBeenCalledWith('cur');
    expect(onReloadAfterActiveDelete).toHaveBeenCalled();
  });

  it('does not reload when deleting a non-current conversation', async () => {
    const { view, dropdown, plugin, state, onReloadAfterActiveDelete } = setup();
    state.currentConversationId = 'cur';
    plugin.getConversationList.mockReturnValue([
      { id: 'cur', title: 'Current', createdAt: 1, lastResponseAt: 2 },
      { id: 'other', title: 'Other', createdAt: 1, lastResponseAt: 1 },
    ]);

    view.updateHistoryDropdown();

    const deleteBtn = dropdown.children[1].children[1].querySelector('.specorator-delete-btn');
    const click = deleteBtn!._eventListeners?.get('click');
    await click![0]({ stopPropagation: jest.fn() });
    await flush();

    expect(plugin.deleteConversation).toHaveBeenCalledWith('other');
    expect(onReloadAfterActiveDelete).not.toHaveBeenCalled();
  });

  it('renderHistoryDropdown renders into a caller container and uses its selection callback', async () => {
    const { view, plugin } = setup();
    const container = createMockEl();
    const onSelectConversation = jest.fn().mockResolvedValue(undefined);
    plugin.getConversationList.mockReturnValue([
      { id: 'x', title: 'X', createdAt: 1, lastResponseAt: 1 },
    ]);

    view.renderHistoryDropdown(container as never, { onSelectConversation });

    const content = container.children[1].children[0].querySelector('.specorator-history-item-content');
    const click = content!._eventListeners?.get('click');
    await click![0]({ stopPropagation: jest.fn(), preventDefault: jest.fn() });
    await flush();

    expect(onSelectConversation).toHaveBeenCalledWith('x');
  });

  it('skips title regeneration when auto-title generation is disabled', async () => {
    const { view, plugin } = setup();
    plugin.settings.enableAutoTitleGeneration = false;

    await view.regenerateTitle('any');

    expect(plugin.getConversationById).not.toHaveBeenCalled();
  });

  describe('formatDate', () => {
    it('renders a time for same-day timestamps and a date otherwise', () => {
      const { view } = setup();
      expect(view.formatDate(Date.now())).toContain(':');
      expect(view.formatDate(new Date('2000-01-02T10:00:00').getTime())).not.toContain(':');
    });
  });
});
