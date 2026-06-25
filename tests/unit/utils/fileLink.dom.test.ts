/**
 * @jest-environment jsdom
 */
import type * as pathType from 'path';

import { processFileLinks } from '@/utils/fileLink';
import { getVaultFileByPath } from '@/utils/obsidianCompat';

jest.mock('@/utils/obsidianCompat', () => ({
  getVaultFileByPath: jest.fn(),
}));

jest.mock('@/utils/path', () => {
  const path = jest.requireActual<typeof pathType>('path');
  // Host-absolute so absolute-path resolution exercises real semantics on the
  // running OS (POSIX `/Projects/specorator` on Linux, `C:\Projects\specorator` on
  // win32) instead of hardcoding a single platform.
  const vaultPath = path.resolve('/Projects/specorator');

  function resolveInsideVault(candidate: string): string {
    const normalized = candidate.replace(/\\/g, '/');
    return path.isAbsolute(normalized)
      ? path.normalize(normalized)
      : path.resolve(vaultPath, normalized);
  }

  function isInsideVault(candidate: string): boolean {
    const absCandidate = resolveInsideVault(candidate);
    const rel = path.relative(vaultPath, absCandidate);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  return {
    getVaultPath: () => vaultPath,
    normalizePathForFilesystem: (raw: string) => raw.replace(/\\/g, '/'),
    isPathWithinVault: (candidate: string, root: string) =>
      root === vaultPath && isInsideVault(candidate),
    normalizePathForVault: (raw: string, root: string | null) => {
      if (!root) return null;
      if (!isInsideVault(raw)) {
        return raw.replace(/\\/g, '/');
      }
      const abs = resolveInsideVault(raw);
      return path.relative(vaultPath, abs).replace(/\\/g, '/');
    },
  };
});

function createMockApp(existingFiles: string[]) {
  const fileSet = new Set(existingFiles.map(f => f.toLowerCase()));

  const app = {
    metadataCache: {
      getFirstLinkpathDest: jest.fn((linkPath: string) => {
        return fileSet.has(linkPath.toLowerCase()) ? { path: linkPath } : null;
      }),
    },
    vault: {
      adapter: { basePath: 'C:/Projects/specorator' },
      getAbstractFileByPath: jest.fn((filePath: string) => {
        if (fileSet.has(filePath.toLowerCase())) return { path: filePath, basename: filePath.replace(/\.md$/, '') };
        if (!filePath.endsWith('.md') && fileSet.has((filePath + '.md').toLowerCase())) {
          return { path: filePath + '.md', basename: filePath };
        }
        return null;
      }),
    },
  } as any;

  jest.mocked(getVaultFileByPath).mockImplementation((_, filePath) =>
    app.vault.getAbstractFileByPath(filePath) as never,
  );

  return app;
}

describe('processFileLinks', () => {
  beforeEach(() => {
    jest.mocked(getVaultFileByPath).mockReset();
  });

  describe('null/empty inputs', () => {
    it('handles null app gracefully', () => {
      const container = document.createElement('div');
      expect(() => processFileLinks(null as any, container)).not.toThrow();
    });

    it('handles null container gracefully', () => {
      const app = createMockApp([]);
      expect(() => processFileLinks(app, null as any)).not.toThrow();
    });

    it('handles empty container', () => {
      const app = createMockApp([]);
      const container = document.createElement('div');
      processFileLinks(app, container);
      expect(container.innerHTML).toBe('');
    });
  });

  describe('text nodes with wikilinks', () => {
    it('converts valid wikilinks to clickable links', () => {
      const app = createMockApp(['note.md']);
      const container = document.createElement('div');
      const span = document.createElement('span');
      span.textContent = 'See [[note.md]] for info';
      container.appendChild(span);

      processFileLinks(app, container);

      const link = container.querySelector('a.specorator-file-link');
      expect(link).not.toBeNull();
      expect(link!.textContent).toBe('note.md');
      expect(link!.getAttribute('data-href')).toBe('note.md');
    });

    it('does not create links for non-existent files', () => {
      const app = createMockApp([]);
      const container = document.createElement('div');
      const span = document.createElement('span');
      span.textContent = 'See [[missing.md]] for info';
      container.appendChild(span);

      processFileLinks(app, container);

      const link = container.querySelector('a.specorator-file-link');
      expect(link).toBeNull();
    });

    it('preserves text around links', () => {
      const app = createMockApp(['note.md']);
      const container = document.createElement('div');
      const span = document.createElement('span');
      span.textContent = 'Before [[note.md]] after';
      container.appendChild(span);

      processFileLinks(app, container);

      expect(container.textContent).toBe('Before note.md after');
    });

    it('handles multiple wikilinks in one text node', () => {
      const app = createMockApp(['a.md', 'b.md']);
      const container = document.createElement('div');
      const span = document.createElement('span');
      span.textContent = '[[a.md]] and [[b.md]]';
      container.appendChild(span);

      processFileLinks(app, container);

      const links = container.querySelectorAll('a.specorator-file-link');
      expect(links.length).toBe(2);
    });

    it('handles display text in wikilinks', () => {
      const app = createMockApp(['note.md']);
      const container = document.createElement('div');
      const span = document.createElement('span');
      span.textContent = 'See [[note.md|My Note]]';
      container.appendChild(span);

      processFileLinks(app, container);

      const link = container.querySelector('a.specorator-file-link');
      expect(link).not.toBeNull();
      expect(link!.textContent).toBe('My Note');
    });

    it('resolves files without .md extension using vault fallback', () => {
      const app = createMockApp(['note.md']);
      const container = document.createElement('div');
      const span = document.createElement('span');
      span.textContent = 'See [[note.md]] here';
      container.appendChild(span);

      processFileLinks(app, container);

      const link = container.querySelector('a.specorator-file-link');
      expect(link).not.toBeNull();
    });
  });

  describe('inline code vault paths', () => {
    it('converts inline code absolute vault paths to clickable links', () => {
      jest.mocked(getVaultFileByPath).mockImplementation((_, filePath) =>
        filePath === '.context/cursor-async-smoke-summary.md'
          ? ({ path: filePath } as never)
          : null,
      );

      // Build a host-absolute path inside the (host-derived) vault so the
      // absolute-inside-vault resolution runs on whatever OS executes the test.
      const pathMod = jest.requireActual<typeof pathType>('path');
      const absInput = pathMod.join(
        pathMod.resolve('/Projects/specorator'),
        '.context',
        'cursor-async-smoke-summary.md',
      );

      const app = createMockApp(['.context/cursor-async-smoke-summary.md']);
      const container = document.createElement('div');
      const code = document.createElement('code');
      code.textContent = absInput;
      container.appendChild(code);

      processFileLinks(app, container);

      const link = code.querySelector('a.specorator-file-link');
      expect(link).not.toBeNull();
      expect(link!.getAttribute('data-href')).toBe('.context/cursor-async-smoke-summary.md');
      expect(link!.textContent).toBe(absInput);
    });

    it('skips vault path linkify inside pre elements', () => {
      jest.mocked(getVaultFileByPath).mockReturnValue({ path: '.context/note.md' } as never);

      const app = createMockApp(['.context/note.md']);
      const container = document.createElement('div');
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = 'C:\\vault\\.context\\note.md';
      pre.appendChild(code);
      container.appendChild(pre);

      processFileLinks(app, container);

      expect(container.querySelector('a.specorator-file-link')).toBeNull();
    });
  });

  describe('inline code wikilinks', () => {
    it('processes wikilinks inside inline code elements', () => {
      const app = createMockApp(['note.md']);
      const container = document.createElement('div');
      const code = document.createElement('code');
      code.textContent = '[[note.md]]';
      container.appendChild(code);

      processFileLinks(app, container);

      const link = code.querySelector('a.specorator-file-link');
      expect(link).not.toBeNull();
      expect(link!.textContent).toBe('note.md');
    });

    it('skips code inside pre elements', () => {
      const app = createMockApp(['note.md']);
      const container = document.createElement('div');
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = '[[note.md]]';
      pre.appendChild(code);
      container.appendChild(pre);

      processFileLinks(app, container);

      const link = container.querySelector('a.specorator-file-link');
      expect(link).toBeNull();
      expect(code.textContent).toBe('[[note.md]]');
    });
  });

  describe('TreeWalker filtering', () => {
    it('skips text nodes inside pre elements', () => {
      const app = createMockApp(['note.md']);
      const container = document.createElement('div');
      const pre = document.createElement('pre');
      pre.textContent = '[[note.md]]';
      container.appendChild(pre);

      processFileLinks(app, container);

      const link = container.querySelector('a.specorator-file-link');
      expect(link).toBeNull();
    });

    it('skips text nodes inside a elements', () => {
      const app = createMockApp(['note.md']);
      const container = document.createElement('div');
      const anchor = document.createElement('a');
      anchor.textContent = '[[note.md]]';
      container.appendChild(anchor);

      processFileLinks(app, container);

      const links = container.querySelectorAll('a.specorator-file-link');
      expect(links.length).toBe(0);
    });

    it('skips text nodes inside elements with .specorator-file-link class', () => {
      const app = createMockApp(['note.md']);
      const container = document.createElement('div');
      const span = document.createElement('span');
      span.className = 'specorator-file-link';
      span.textContent = '[[note.md]]';
      container.appendChild(span);

      processFileLinks(app, container);

      // Should not create nested links
      const links = container.querySelectorAll('a.specorator-file-link');
      expect(links.length).toBe(0);
    });

    it('skips text nodes inside elements with .internal-link class', () => {
      const app = createMockApp(['note.md']);
      const container = document.createElement('div');
      const span = document.createElement('span');
      span.className = 'internal-link';
      span.textContent = '[[note.md]]';
      container.appendChild(span);

      processFileLinks(app, container);

      const links = container.querySelectorAll('a.specorator-file-link');
      expect(links.length).toBe(0);
    });

    it('repairs empty resolved internal-link anchors while leaving missing wikilinks visible', () => {
      const app = createMockApp(['note.md']);
      const container = document.createElement('div');
      container.innerHTML = '<a class="internal-link" href="note.md"></a> and [[missing.md]]';

      processFileLinks(app, container);

      const internalLink = container.querySelector('a.internal-link');
      expect(internalLink).not.toBeNull();
      expect(internalLink!.textContent).toBe('note.md');
      expect(internalLink!.classList.contains('specorator-file-link')).toBe(true);
      expect(container.textContent).toBe('note.md and [[missing.md]]');
    });

    it('processes text nodes in regular elements', () => {
      const app = createMockApp(['note.md']);
      const container = document.createElement('div');
      const p = document.createElement('p');
      p.textContent = '[[note.md]]';
      container.appendChild(p);

      processFileLinks(app, container);

      const link = container.querySelector('a.specorator-file-link');
      expect(link).not.toBeNull();
    });
  });

  describe('image embed exclusion', () => {
    it('does not convert image embeds to links', () => {
      const app = createMockApp(['image.png']);
      const container = document.createElement('div');
      const span = document.createElement('span');
      span.textContent = '![[image.png]]';
      container.appendChild(span);

      processFileLinks(app, container);

      const link = container.querySelector('a.specorator-file-link');
      expect(link).toBeNull();
    });

    it('converts file link but not image embed in same text', () => {
      const app = createMockApp(['note.md', 'image.png']);
      const container = document.createElement('div');
      const span = document.createElement('span');
      span.textContent = '[[note.md]] and ![[image.png]]';
      container.appendChild(span);

      processFileLinks(app, container);

      const links = container.querySelectorAll('a.specorator-file-link');
      expect(links.length).toBe(1);
      expect(links[0].textContent).toBe('note.md');
    });
  });
});
