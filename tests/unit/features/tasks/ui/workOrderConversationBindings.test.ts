import type { TaskSpec } from '@/features/tasks/model/taskTypes';
import { buildWorkOrderConversationBindings } from '@/features/tasks/ui/workOrderConversationBindings';
import type SpecoratorPlugin from '@/main';

type PluginStub = {
  openConversation: jest.Mock;
  getConversationSync: jest.Mock;
};

function makePlugin(overrides: Partial<PluginStub> = {}): PluginStub {
  return {
    openConversation: jest.fn().mockResolvedValue(undefined),
    getConversationSync: jest.fn(() => null),
    ...overrides,
  };
}

function asPlugin(stub: PluginStub): SpecoratorPlugin {
  return stub as unknown as SpecoratorPlugin;
}

function makeTask(conversationId?: string): TaskSpec {
  return {
    path: 'Agent Board/tasks/wo-1.md',
    frontmatter: {
      type: 'specorator-work-order',
      schema_version: 1,
      id: 'wo-1',
      title: 'WO 1',
      status: 'ready',
      priority: '2 - normal',
      created: '2026-06-05T00:00:00Z',
      updated: '2026-06-05T00:00:00Z',
      attempts: 0,
      conversation_id: conversationId,
    },
    sections: {
      objective: '',
      acceptanceCriteria: '',
      context: '',
      constraints: '',
      ledger: '',
      handoff: '',
    },
    body: '',
    raw: '',
  };
}

describe('buildWorkOrderConversationBindings', () => {
  describe('canOpenConversation', () => {
    it('returns false when conversation_id is missing', () => {
      const plugin = makePlugin({ getConversationSync: jest.fn(() => ({ id: 'x' })) });
      const { canOpenConversation } = buildWorkOrderConversationBindings(asPlugin(plugin));

      expect(canOpenConversation(makeTask(undefined))).toBe(false);
      // Short-circuit — no lookup happens for a missing id.
      expect(plugin.getConversationSync).not.toHaveBeenCalled();
    });

    it('returns false when getConversationSync resolves to null', () => {
      const plugin = makePlugin({ getConversationSync: jest.fn(() => null) });
      const { canOpenConversation } = buildWorkOrderConversationBindings(asPlugin(plugin));

      expect(canOpenConversation(makeTask('conv-1'))).toBe(false);
      expect(plugin.getConversationSync).toHaveBeenCalledWith('conv-1');
    });

    it('returns true when conversation_id is present AND the lookup resolves', () => {
      const plugin = makePlugin({ getConversationSync: jest.fn(() => ({ id: 'conv-1' })) });
      const { canOpenConversation } = buildWorkOrderConversationBindings(asPlugin(plugin));

      expect(canOpenConversation(makeTask('conv-1'))).toBe(true);
      expect(plugin.getConversationSync).toHaveBeenCalledWith('conv-1');
    });
  });

  describe('onOpenConversation', () => {
    it('no-ops when conversation_id is missing', () => {
      const plugin = makePlugin();
      const { onOpenConversation } = buildWorkOrderConversationBindings(asPlugin(plugin));

      onOpenConversation(makeTask(undefined));

      expect(plugin.openConversation).not.toHaveBeenCalled();
    });

    it('dispatches to plugin.openConversation with requireNewTab so the active tab is never hijacked', () => {
      const plugin = makePlugin();
      const { onOpenConversation } = buildWorkOrderConversationBindings(asPlugin(plugin));

      onOpenConversation(makeTask('conv-1'));

      // requireNewTab: a click on a paused work-order card must open a fresh
      // tab or surface a notice — never close a running session in the
      // currently active chat tab.
      expect(plugin.openConversation).toHaveBeenCalledWith('conv-1', { requireNewTab: true });
    });
  });
});
