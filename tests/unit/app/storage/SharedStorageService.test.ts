import type { Plugin } from 'obsidian';

import { SharedStorageService } from '@/app/storage/SharedStorageService';

function createMockPlugin(dataJson: unknown): Plugin {
  return {
    app: { vault: { adapter: {} } },
    loadData: jest.fn().mockResolvedValue(dataJson),
    saveData: jest.fn().mockResolvedValue(undefined),
  } as unknown as Plugin;
}

describe('SharedStorageService.getTabManagerState', () => {
  it('preserves persisted tab kind through validation', async () => {
    const storage = new SharedStorageService(createMockPlugin({
      tabManagerState: {
        openTabs: [
          { tabId: 'tab-1', conversationId: 'conv-1', kind: 'chat' },
          { tabId: 'tab-2', conversationId: 'conv-2', kind: 'work-order' },
          { tabId: 'tab-3', conversationId: null },
        ],
        activeTabId: 'tab-1',
      },
    }));

    const result = await storage.getTabManagerState();

    expect(result).not.toBeNull();
    expect(result!.openTabs).toEqual([
      { tabId: 'tab-1', conversationId: 'conv-1', kind: 'chat' },
      { tabId: 'tab-2', conversationId: 'conv-2', kind: 'work-order' },
      { tabId: 'tab-3', conversationId: null },
    ]);
  });

  it('drops unknown kind values instead of the whole tab', async () => {
    const storage = new SharedStorageService(createMockPlugin({
      tabManagerState: {
        openTabs: [
          { tabId: 'tab-1', conversationId: null, kind: 'bogus' },
          { tabId: 'tab-2', conversationId: null, kind: 42 },
        ],
        activeTabId: null,
      },
    }));

    const result = await storage.getTabManagerState();

    expect(result!.openTabs).toEqual([
      { tabId: 'tab-1', conversationId: null },
      { tabId: 'tab-2', conversationId: null },
    ]);
  });

  it('still skips entries without a valid tabId and keeps draftModel', async () => {
    const storage = new SharedStorageService(createMockPlugin({
      tabManagerState: {
        openTabs: [
          { tabId: 123, conversationId: null, kind: 'work-order' },
          { tabId: 'tab-1', conversationId: null, draftModel: 'sonnet', kind: 'work-order' },
        ],
        activeTabId: 'tab-1',
      },
    }));

    const result = await storage.getTabManagerState();

    expect(result!.openTabs).toEqual([
      { tabId: 'tab-1', conversationId: null, draftModel: 'sonnet', kind: 'work-order' },
    ]);
  });
});
