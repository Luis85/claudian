import {
  buildContextEnvelope,
  renderContextEnvelopeSectioned,
  renderContextEnvelopeXml,
} from '@/core/context/contextEnvelope';
import { wrapUntrustedExternalData } from '@/core/context/untrustedContent';
import type { ChatTurnRequest } from '@/core/runtime/types';
import { type BrowserSelectionContext, formatBrowserContext } from '@/utils/browser';
import { type CanvasSelectionContext, formatCanvasContext } from '@/utils/canvas';
import { formatCurrentNote } from '@/utils/context';
import { type EditorSelectionContext, formatEditorContext } from '@/utils/editor';

describe('buildContextEnvelope', () => {
  it('returns no sources for a bare text request', () => {
    expect(buildContextEnvelope({ text: 'hello' })).toEqual({ sources: [] });
  });

  it('reflects request fields regardless of command text (compact-skipping is the encoder’s job)', () => {
    const env = buildContextEnvelope({ text: '/compact', currentNotePath: 'n.md' });
    expect(env.sources.map((s) => s.sourceType)).toEqual(['vault-note']);
  });

  describe('vault-note source', () => {
    it('assigns vault trust, a chars/4 estimate, and a ctx:note handle', () => {
      const env = buildContextEnvelope({ text: 'hi', currentNotePath: 'notes/test.md' });
      expect(env.sources).toEqual([
        {
          sourceType: 'vault-note',
          notePath: 'notes/test.md',
          trust: 'vault',
          tokenEstimate: Math.ceil('notes/test.md'.length / 4),
          citationHandle: 'ctx:note:notes/test.md',
        },
      ]);
    });
  });

  describe('editor-selection source', () => {
    it('assigns vault trust, estimates from the selected text, and ranges the handle', () => {
      const selection: EditorSelectionContext = {
        notePath: 'src/main.ts',
        mode: 'selection',
        selectedText: 'const x = 42;',
        startLine: 5,
        lineCount: 3,
      };
      const env = buildContextEnvelope({ text: 'explain', editorSelection: selection });
      expect(env.sources).toEqual([
        {
          sourceType: 'editor-selection',
          selection,
          trust: 'vault',
          tokenEstimate: Math.ceil('const x = 42;'.length / 4),
          citationHandle: 'ctx:editor:src/main.ts:5-7',
        },
      ]);
    });

    it('omits the line range from the handle when line info is absent', () => {
      const selection: EditorSelectionContext = {
        notePath: 'src/main.ts',
        mode: 'selection',
        selectedText: 'code',
      };
      const [source] = buildContextEnvelope({ text: 'x', editorSelection: selection }).sources;
      expect(source.citationHandle).toBe('ctx:editor:src/main.ts');
    });

    it('estimates zero tokens for a cursor-mode selection that carries no text', () => {
      const selection: EditorSelectionContext = {
        notePath: 'n.md',
        mode: 'cursor',
        cursorContext: { beforeCursor: 'a', afterCursor: 'b', isInbetween: false, line: 0, column: 1 },
      };
      const [source] = buildContextEnvelope({ text: 'x', editorSelection: selection }).sources;
      expect(source.tokenEstimate).toBe(0);
    });
  });

  describe('browser-selection source', () => {
    it('marks web content untrusted-external and leaves the body unwrapped', () => {
      const selection: BrowserSelectionContext = {
        source: 'surfing-view',
        selectedText: 'web text',
        url: 'https://example.com',
      };
      const env = buildContextEnvelope({ text: 'summarize', browserSelection: selection });
      expect(env.sources).toEqual([
        {
          sourceType: 'browser-selection',
          selection,
          trust: 'untrusted-external',
          tokenEstimate: Math.ceil('web text'.length / 4),
          citationHandle: 'ctx:browser:https://example.com',
        },
      ]);
      // Trust assignment is the builder's job; wrapping is the renderer's.
      expect(JSON.stringify(env)).not.toContain('untrusted_external_data');
    });

    it('falls back to the source label in the handle when there is no url', () => {
      const selection: BrowserSelectionContext = { source: 'webview', selectedText: 'text' };
      const [source] = buildContextEnvelope({ text: 'x', browserSelection: selection }).sources;
      expect(source.citationHandle).toBe('ctx:browser:webview');
    });
  });

  describe('canvas-selection source', () => {
    it('assigns vault trust, estimates from the node list, and a ctx:canvas handle', () => {
      const selection: CanvasSelectionContext = { canvasPath: 'd.canvas', nodeIds: ['n1', 'n2'] };
      const env = buildContextEnvelope({ text: 'review', canvasSelection: selection });
      expect(env.sources).toEqual([
        {
          sourceType: 'canvas-selection',
          selection,
          trust: 'vault',
          tokenEstimate: Math.ceil('n1, n2'.length / 4),
          citationHandle: 'ctx:canvas:d.canvas',
        },
      ]);
    });
  });

  it('emits sources in note → editor → browser → canvas order', () => {
    const env = buildContextEnvelope({
      text: 'do',
      currentNotePath: 'n.md',
      editorSelection: { notePath: 'n.md', mode: 'selection', selectedText: 's' },
      browserSelection: { source: 'chrome', selectedText: 'b' },
      canvasSelection: { canvasPath: 'c.canvas', nodeIds: ['x'] },
    });
    expect(env.sources.map((s) => s.sourceType)).toEqual([
      'vault-note',
      'editor-selection',
      'browser-selection',
      'canvas-selection',
    ]);
  });
});

describe('renderContextEnvelopeXml (Claude / Opencode)', () => {
  it('renders each source through its utils format* helper, in source order', () => {
    const editor: EditorSelectionContext = {
      notePath: 'src/a.ts',
      mode: 'selection',
      selectedText: 'code',
      startLine: 1,
      lineCount: 1,
    };
    const browser: BrowserSelectionContext = {
      source: 'surfing-view',
      selectedText: 'web',
      url: 'https://x.com',
    };
    const canvas: CanvasSelectionContext = { canvasPath: 'c.canvas', nodeIds: ['n1'] };
    const env = buildContextEnvelope({
      text: 'x',
      currentNotePath: 'n.md',
      editorSelection: editor,
      browserSelection: browser,
      canvasSelection: canvas,
    });

    expect(renderContextEnvelopeXml(env)).toEqual([
      formatCurrentNote('n.md'),
      formatEditorContext(editor),
      formatBrowserContext(browser),
      formatCanvasContext(canvas),
    ]);
  });

  it('drops sources whose format* output is empty', () => {
    const env = buildContextEnvelope({
      text: 'x',
      editorSelection: { notePath: 'n.md', mode: 'none' },
      browserSelection: { source: 's', selectedText: '   ' },
      canvasSelection: { canvasPath: 'c.canvas', nodeIds: [] },
    });
    expect(renderContextEnvelopeXml(env)).toEqual([]);
  });

  it('joins with the user text byte-for-byte like the legacy append* chain', () => {
    const request: ChatTurnRequest = {
      text: 'hello',
      currentNotePath: 'notes/test.md',
      editorSelection: { notePath: 'notes/test.md', mode: 'selection', selectedText: 'sel', startLine: 4, lineCount: 2 },
    };
    const joined = [request.text, ...renderContextEnvelopeXml(buildContextEnvelope(request))].join('\n\n');
    expect(joined).toBe(
      'hello' +
        '\n\n<current_note>\nnotes/test.md\n</current_note>' +
        '\n\n<editor_selection path="notes/test.md" lines="4-5">\nsel\n</editor_selection>',
    );
  });
});

describe('renderContextEnvelopeSectioned (Codex / Cursor)', () => {
  it('renders editor / browser / canvas brackets and EXCLUDES the vault note', () => {
    const env = buildContextEnvelope({
      text: 'x',
      // The current-note hint is each provider's buildContextHints callback, not the shared renderer.
      currentNotePath: 'n.md',
      editorSelection: { notePath: 'src/a.ts', mode: 'selection', selectedText: 'code' },
      browserSelection: { source: 'chrome', selectedText: 'web', url: 'https://x.com' },
      canvasSelection: { canvasPath: 'c.canvas', nodeIds: ['n1', 'n2'] },
    });
    expect(renderContextEnvelopeSectioned(env)).toEqual([
      '\n[Editor selection from src/a.ts:\ncode\n]',
      `\n[Browser selection from https://x.com:\n${wrapUntrustedExternalData('web')}\n]`,
      '\n[Canvas selection from c.canvas:\nn1, n2\n]',
    ]);
  });

  it('uses the "current note" and "unknown page" fallbacks', () => {
    const env = buildContextEnvelope({
      text: 'x',
      editorSelection: { notePath: '', mode: 'selection', selectedText: 'sel' },
      browserSelection: { source: 'chrome', selectedText: 'web' },
    });
    expect(renderContextEnvelopeSectioned(env)).toEqual([
      '\n[Editor selection from current note:\nsel\n]',
      `\n[Browser selection from unknown page:\n${wrapUntrustedExternalData('web')}\n]`,
    ]);
  });

  it('skips empty editor/browser selections and empty canvas node lists', () => {
    const env = buildContextEnvelope({
      text: 'x',
      editorSelection: { notePath: 'n.md', mode: 'none', selectedText: '' },
      browserSelection: { source: 's', selectedText: '' },
      canvasSelection: { canvasPath: 'c.canvas', nodeIds: [] },
    });
    expect(renderContextEnvelopeSectioned(env)).toEqual([]);
  });
});

describe('untrusted-external wrap invariant', () => {
  const browser: BrowserSelectionContext = {
    source: 'surfing-view',
    selectedText: 'sensitive web text',
    url: 'https://x.com',
  };

  it('the builder tags browser content untrusted but never wraps it', () => {
    const [source] = buildContextEnvelope({ text: 'x', browserSelection: browser }).sources;
    expect(source.trust).toBe('untrusted-external');
    expect(JSON.stringify(source)).not.toContain('<untrusted_external_data>');
  });

  it('both render styles wrap the untrusted browser body', () => {
    const env = buildContextEnvelope({ text: 'x', browserSelection: browser });
    const xml = renderContextEnvelopeXml(env).join('\n');
    const sectioned = renderContextEnvelopeSectioned(env).join('\n');
    const wrapped = wrapUntrustedExternalData('sensitive web text');
    expect(xml).toContain(wrapped);
    expect(sectioned).toContain(wrapped);
  });
});
