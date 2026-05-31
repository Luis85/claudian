import type { AuxQueryConfig, AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';
import { QueryBackedInlineEditService } from '@/core/auxiliary/QueryBackedInlineEditService';
import { QueryBackedInstructionRefineService } from '@/core/auxiliary/QueryBackedInstructionRefineService';
import { QueryBackedTitleGenerationService } from '@/core/auxiliary/QueryBackedTitleGenerationService';

interface RecordedCall {
  config: AuxQueryConfig;
  prompt: string;
}

/**
 * A fake runner that records every query and lets a test script the reply.
 * Models a multi-turn conversation: reset() ends the conversation so the
 * QueryBacked* services can verify continuation guards.
 */
class FakeRunner implements AuxQueryRunner {
  readonly calls: RecordedCall[] = [];
  resetCount = 0;
  reply: string | ((call: RecordedCall) => string | Promise<string>) = '';
  throwOnNext: Error | null = null;
  emitTextChunks: string[] | null = null;

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const call = { config, prompt };
    this.calls.push(call);

    if (this.emitTextChunks) {
      let acc = '';
      for (const chunk of this.emitTextChunks) {
        acc += chunk;
        config.onTextChunk?.(acc);
      }
    }

    if (this.throwOnNext) {
      const error = this.throwOnNext;
      this.throwOnNext = null;
      throw error;
    }

    return typeof this.reply === 'function' ? this.reply(call) : this.reply;
  }

  reset(): void {
    this.resetCount += 1;
  }
}

describe('QueryBackedTitleGenerationService', () => {
  it('parses the title from the runner response and invokes the callback', async () => {
    const runner = new FakeRunner();
    runner.reply = '"Refactor React hook"';
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => runner,
    });

    const callback = jest.fn();
    await service.generateTitle('conv-1', 'How do I refactor a hook?', callback);

    expect(callback).toHaveBeenCalledWith('conv-1', {
      success: true,
      title: 'Refactor React hook',
    });
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0].prompt).toContain('How do I refactor a hook?');
  });

  it('applies a resolveModel override to the runner config', async () => {
    const runner = new FakeRunner();
    runner.reply = 'Title';
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => runner,
      resolveModel: () => 'haiku-custom',
    });

    await service.generateTitle('conv-1', 'msg', jest.fn());

    expect(runner.calls[0].config.model).toBe('haiku-custom');
  });

  it('honors a parseTitle override (provider-specific title shaping)', async () => {
    const runner = new FakeRunner();
    runner.reply = 'first line\nsecond line';
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => runner,
      parseTitle: (text) => text.split('\n')[0] ?? null,
    });

    const callback = jest.fn();
    await service.generateTitle('conv-1', 'msg', callback);

    expect(callback).toHaveBeenCalledWith('conv-1', {
      success: true,
      title: 'first line',
    });
  });

  it('reports a parse failure when the response yields no title', async () => {
    const runner = new FakeRunner();
    runner.reply = '   ';
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => runner,
    });

    const callback = jest.fn();
    await service.generateTitle('conv-1', 'msg', callback);

    expect(callback).toHaveBeenCalledWith('conv-1', {
      success: false,
      error: 'Failed to parse title from response',
    });
  });

  it('surfaces runner errors through the callback and never throws', async () => {
    const runner = new FakeRunner();
    runner.throwOnNext = new Error('runner exploded');
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => runner,
    });

    const callback = jest.fn();
    await expect(
      service.generateTitle('conv-1', 'msg', callback),
    ).resolves.toBeUndefined();
    expect(callback).toHaveBeenCalledWith('conv-1', {
      success: false,
      error: 'runner exploded',
    });
  });

  it('swallows callback failures (callback safety)', async () => {
    const runner = new FakeRunner();
    runner.reply = 'Title';
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => runner,
    });

    const throwingCallback = jest.fn().mockRejectedValue(new Error('callback boom'));
    await expect(
      service.generateTitle('conv-1', 'msg', throwingCallback),
    ).resolves.toBeUndefined();
  });

  it('aborts and resets a prior generation for the same conversation', async () => {
    let resolveFirst!: (value: string) => void;
    const firstRunner = new FakeRunner();
    firstRunner.reply = () => new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const secondRunner = new FakeRunner();
    secondRunner.reply = 'Second';

    const runners = [firstRunner, secondRunner];
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => runners.shift()!,
    });

    const cb1 = jest.fn();
    const cb2 = jest.fn();
    const p1 = service.generateTitle('conv-1', 'first', cb1);
    const p2 = service.generateTitle('conv-1', 'second', cb2);

    resolveFirst('First');
    await Promise.all([p1, p2]);

    expect(firstRunner.calls[0].config.abortController?.signal.aborted).toBe(true);
    expect(firstRunner.resetCount).toBeGreaterThanOrEqual(1);
    expect(cb2).toHaveBeenCalledWith('conv-1', { success: true, title: 'Second' });
  });

  it('cancel() aborts and resets all active generations', async () => {
    const runner = new FakeRunner();
    let resolveQuery!: (value: string) => void;
    runner.reply = () => new Promise<string>((resolve) => {
      resolveQuery = resolve;
    });
    const service = new QueryBackedTitleGenerationService({
      createRunner: () => runner,
    });

    const promise = service.generateTitle('conv-1', 'msg', jest.fn());
    service.cancel();

    expect(runner.calls[0].config.abortController?.signal.aborted).toBe(true);
    expect(runner.resetCount).toBeGreaterThanOrEqual(1);

    resolveQuery('Title');
    await promise;
  });
});

describe('QueryBackedInstructionRefineService', () => {
  it('refines an instruction and streams progress via onTextChunk', async () => {
    const runner = new FakeRunner();
    runner.emitTextChunks = ['<instruction>', '<instruction>- Be concise.</instruction>'];
    runner.reply = '<instruction>- Be concise.</instruction>';
    const service = new QueryBackedInstructionRefineService(runner);

    const onProgress = jest.fn();
    const result = await service.refineInstruction('be concise', '## Existing', onProgress);

    expect(result).toEqual({ success: true, refinedInstruction: '- Be concise.' });
    expect(onProgress).toHaveBeenCalled();
    expect(runner.calls[0].config.systemPrompt).toContain('EXISTING INSTRUCTIONS');
    expect(runner.calls[0].config.systemPrompt).toContain('## Existing');
  });

  it('guards continueConversation until a refinement has run', async () => {
    const runner = new FakeRunner();
    const service = new QueryBackedInstructionRefineService(runner);

    const result = await service.continueConversation('follow up');
    expect(result).toEqual({ success: false, error: 'No active conversation to continue' });
    expect(runner.calls).toHaveLength(0);
  });

  it('continues the conversation after an initial refinement', async () => {
    const runner = new FakeRunner();
    runner.reply = '<instruction>- ok</instruction>';
    const service = new QueryBackedInstructionRefineService(runner);

    await service.refineInstruction('test', '');
    const result = await service.continueConversation('more');

    expect(result.success).toBe(true);
    expect(runner.calls).toHaveLength(2);
  });

  it('resetConversation() resets the runner and blocks continuation', async () => {
    const runner = new FakeRunner();
    runner.reply = '<instruction>- ok</instruction>';
    const service = new QueryBackedInstructionRefineService(runner);

    await service.refineInstruction('test', '');
    service.resetConversation();

    const result = await service.continueConversation('more');
    expect(result).toEqual({ success: false, error: 'No active conversation to continue' });
    expect(runner.resetCount).toBeGreaterThanOrEqual(1);
  });

  it('applies the model override to the runner config', async () => {
    const runner = new FakeRunner();
    runner.reply = '<instruction>- ok</instruction>';
    const service = new QueryBackedInstructionRefineService(runner);
    service.setModelOverride('  custom-model  ');

    await service.refineInstruction('test', '');
    expect(runner.calls[0].config.model).toBe('custom-model');
  });

  it('returns a structured error when the runner throws', async () => {
    const runner = new FakeRunner();
    runner.throwOnNext = new Error('cli failed');
    const service = new QueryBackedInstructionRefineService(runner);

    const result = await service.refineInstruction('test', '');
    expect(result).toEqual({ success: false, error: 'cli failed' });
  });
});

describe('QueryBackedInlineEditService', () => {
  it('edits text and parses the inline edit response', async () => {
    const runner = new FakeRunner();
    runner.reply = '<replacement>Fixed greeting</replacement>';
    const service = new QueryBackedInlineEditService(runner);

    const result = await service.editText({
      instruction: 'Fix the greeting',
      mode: 'selection',
      notePath: 'note.md',
      selectedText: 'helo',
    });

    expect(result.success).toBe(true);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0].prompt).toContain('Fix the greeting');
  });

  it('guards continueConversation until an edit has run', async () => {
    const runner = new FakeRunner();
    const service = new QueryBackedInlineEditService(runner);

    const result = await service.continueConversation('more details');
    expect(result).toEqual({ success: false, error: 'No active conversation to continue' });
    expect(runner.calls).toHaveLength(0);
  });

  it('appends context files when continuing the conversation', async () => {
    const runner = new FakeRunner();
    runner.reply = '<replacement>ok</replacement>';
    const service = new QueryBackedInlineEditService(runner);

    await service.editText({
      instruction: 'Fix',
      mode: 'selection',
      notePath: 'note.md',
      selectedText: 'x',
    });
    await service.continueConversation('make it blue', ['notes/helper.md']);

    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[1].prompt).toContain('notes/helper.md');
  });

  it('resetConversation() resets the runner and blocks continuation', async () => {
    const runner = new FakeRunner();
    runner.reply = '<replacement>ok</replacement>';
    const service = new QueryBackedInlineEditService(runner);

    await service.editText({
      instruction: 'Fix',
      mode: 'selection',
      notePath: 'note.md',
      selectedText: 'x',
    });
    service.resetConversation();

    const result = await service.continueConversation('more');
    expect(result).toEqual({ success: false, error: 'No active conversation to continue' });
    expect(runner.resetCount).toBeGreaterThanOrEqual(1);
  });

  it('returns a structured error when the runner throws', async () => {
    const runner = new FakeRunner();
    runner.throwOnNext = new Error('edit failed');
    const service = new QueryBackedInlineEditService(runner);

    const result = await service.editText({
      instruction: 'Fix',
      mode: 'selection',
      notePath: 'note.md',
      selectedText: 'x',
    });
    expect(result).toEqual({ success: false, error: 'edit failed' });
  });
});
