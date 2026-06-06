import { classifyRuntimeError } from '@/features/chat/controllers/runtimeErrorClassification';

describe('classifyRuntimeError', () => {
  describe('cli-not-found', () => {
    // Representative strings emitted by the provider runtimes (see
    // ClaudeChatRuntime, CursorChatRuntime, CursorAuxCliRunner).
    it.each([
      'Claude CLI not found. Please install Claude Code CLI.',
      'Cursor Agent CLI not found. Configure it in Cursor settings.',
      'Cursor Agent CLI not found. Install the Cursor CLI and configure its path in settings.',
      'spawn claude ENOENT',
      'codex: command not found',
      'The CLI is not installed on this system.',
    ])('classifies %j as cli-not-found', (content) => {
      expect(classifyRuntimeError(content)).toBe('cli-not-found');
    });
  });

  describe('unauthenticated', () => {
    it.each([
      'Failed to start OpenCode. Check the CLI path and login state.',
      'Authentication required: run `claude login`.',
      '401 Unauthorized',
      'Invalid API key provided.',
      'Please log in to continue.',
      'You are not authenticated.',
      'OAuth token has expired, please re-authenticate.',
    ])('classifies %j as unauthenticated', (content) => {
      expect(classifyRuntimeError(content)).toBe('unauthenticated');
    });
  });

  describe('context-too-large', () => {
    it.each([
      'prompt is too long: 250000 tokens > 200000 maximum',
      'This model\'s maximum context length is 200000 tokens.',
      'Context window exceeded.',
      'Request exceeds the maximum number of tokens.',
      'input length and max_tokens exceed context limit',
      'context_length_exceeded',
    ])('classifies %j as context-too-large', (content) => {
      expect(classifyRuntimeError(content)).toBe('context-too-large');
    });
  });

  describe('generic', () => {
    it.each([
      'Something unexpected went wrong.',
      'Network request failed.',
      '',
      'Internal server error (500).',
    ])('classifies %j as generic', (content) => {
      expect(classifyRuntimeError(content)).toBe('generic');
    });
  });

  it('prefers cli-not-found over unauthenticated when both signals appear', () => {
    // A missing CLI is the more actionable root cause; auth hints in the same
    // message must not mask it.
    expect(
      classifyRuntimeError('Claude CLI not found; you may also need to login.'),
    ).toBe('cli-not-found');
  });

  it('prefers context-too-large over generic token wording', () => {
    expect(classifyRuntimeError('Error: prompt is too long')).toBe('context-too-large');
  });
});
