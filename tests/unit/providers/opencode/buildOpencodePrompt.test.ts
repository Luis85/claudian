import { buildOpencodePromptBlocks, buildOpencodePromptText } from '../../../../src/providers/opencode/runtime/buildOpencodePrompt';

describe('buildOpencodePromptText', () => {
  it('appends Claudian XML context to the user query', () => {
    const prompt = buildOpencodePromptText({
      browserSelection: {
        selectedText: 'Browser quote',
        source: 'browser:https://example.com',
        title: 'Example',
        url: 'https://example.com',
      },
      currentNotePath: 'notes/today.md',
      editorSelection: {
        mode: 'selection',
        notePath: 'notes/today.md',
        selectedText: 'Selected text',
        startLine: 4,
        lineCount: 2,
      },
      text: 'Summarize this',
    });

    expect(prompt).toContain('Summarize this');
    expect(prompt).toContain('<current_note>');
    expect(prompt).toContain('notes/today.md');
    expect(prompt).toContain('<editor_selection path="notes/today.md" lines="4-5">');
    expect(prompt).toContain('<browser_selection source="browser:https://example.com" title="Example" url="https://example.com" trust="untrusted-external">');
    expect(prompt).toContain('<untrusted_external_data>');
  });

  it('does not auto-attach external context folders to the OpenCode prompt', () => {
    const prompt = buildOpencodePromptText({
      externalContextPaths: ['/tmp/project'],
      text: 'Summarize this',
    });

    expect(prompt).toContain('Summarize this');
    expect(prompt).not.toContain('<context_files>');
    expect(prompt).not.toContain('/tmp/project');
  });

  it('rebuilds prior conversation context when a native session must be recreated', () => {
    const prompt = buildOpencodePromptText(
      {
        text: 'Continue with the fix',
      },
      [
        {
          content: 'Inspect the bug',
          id: 'user-1',
          role: 'user',
          timestamp: 1,
        },
        {
          content: 'I found the failing path',
          id: 'assistant-1',
          role: 'assistant',
          timestamp: 2,
        },
      ],
    );

    expect(prompt).toContain('User: Inspect the bug');
    expect(prompt).toContain('Assistant: I found the failing path');
    expect(prompt).toContain('User: Continue with the fix');
  });
});

describe('buildOpencodePromptBlocks', () => {
  it('includes image attachments after the main text block', () => {
    const blocks = buildOpencodePromptBlocks({
      images: [{
        data: 'base64-image',
        id: 'img-1',
        mediaType: 'image/png',
        name: 'diagram.png',
        size: 123,
        source: 'file',
      }],
      text: 'Inspect this image',
    });

    expect(blocks).toEqual([
      { type: 'text', text: 'Inspect this image' },
      { type: 'image', mimeType: 'image/png', data: 'base64-image' },
    ]);
  });

  it('prepends the bound agent persona as a leading directive on the text block', () => {
    const blocks = buildOpencodePromptBlocks(
      { text: 'Summarize the vault' },
      [],
      'You are a knowledge management expert.',
    );

    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Summarize the vault');
    expect(text.startsWith('You are a knowledge management expert.\n\n---\n\n')).toBe(true);
    expect(blocks).toHaveLength(1);
  });

  it('does not prepend a persona when boundAgentPrompt is absent', () => {
    const blocks = buildOpencodePromptBlocks(
      { text: 'List recent notes' },
      [],
    );

    expect(blocks[0].type).toBe('text');
    expect((blocks[0] as { type: 'text'; text: string }).text).not.toContain('---');
    expect((blocks[0] as { type: 'text'; text: string }).text).toContain('List recent notes');
  });

  it('keeps the persona on the text block and images still follow', () => {
    const blocks = buildOpencodePromptBlocks(
      {
        images: [{
          data: 'img-data',
          id: 'img-1',
          mediaType: 'image/jpeg',
          name: 'photo.jpg',
          size: 456,
          source: 'file',
        }],
        text: 'Describe the image',
      },
      [],
      'You are a vision expert.',
    );

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('text');
    expect((blocks[0] as { type: 'text'; text: string }).text).toContain('You are a vision expert.');
    expect(blocks[1].type).toBe('image');
  });
});
