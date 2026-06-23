import {
  buildWorkOrderMarkdownForSeed,
  type ResolvedRunTarget,
  type WorkOrderMarkdownBuilders,
  type WorkOrderMarkdownContext,
} from '../../../../../src/features/tasks/commands/workOrderResolution';
import type { WorkOrderTemplate } from '../../../../../src/features/tasks/templates/templateTypes';

const ctx: WorkOrderMarkdownContext = {
  id: 'task-1',
  title: 'Templated order',
  status: 'inbox',
  timestamp: '2026-06-23T10:00:00.000Z',
  isoDate: '2026-06-23',
  conversationId: null,
  sourcePath: null,
  sourceFolderPath: null,
};

const target: ResolvedRunTarget = { provider: 'claude', model: 'sonnet', priority: '2 - normal' };

function capturingBuilders(): {
  builders: WorkOrderMarkdownBuilders;
  fromTemplateArgs: Array<Parameters<WorkOrderMarkdownBuilders['fromTemplate']>[0]>;
} {
  const fromTemplateArgs: Array<Parameters<WorkOrderMarkdownBuilders['fromTemplate']>[0]> = [];
  return {
    fromTemplateArgs,
    builders: {
      fromTemplate: (args) => {
        fromTemplateArgs.push(args);
        return 'TEMPLATE';
      },
      fromSeed: () => 'SEED',
    },
  };
}

describe('buildWorkOrderMarkdownForSeed — template agent', () => {
  it('threads the template agent into the fromTemplate builder', () => {
    const { builders, fromTemplateArgs } = capturingBuilders();
    const template: WorkOrderTemplate = {
      path: 'Agent Board/templates/t.md',
      name: 'T',
      body: '# {{title}}',
      agent: 'roster:planner',
    };

    const out = buildWorkOrderMarkdownForSeed(ctx, target, template, builders);

    expect(out).toBe('TEMPLATE');
    expect(fromTemplateArgs).toHaveLength(1);
    expect(fromTemplateArgs[0].agent).toBe('roster:planner');
  });

  it('passes undefined when the template has no agent', () => {
    const { builders, fromTemplateArgs } = capturingBuilders();
    const template: WorkOrderTemplate = {
      path: 'Agent Board/templates/t.md',
      name: 'T',
      body: '# {{title}}',
    };

    buildWorkOrderMarkdownForSeed(ctx, target, template, builders);

    expect(fromTemplateArgs[0].agent).toBeUndefined();
  });
});
