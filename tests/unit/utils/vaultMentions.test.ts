import { extractVaultMentions } from '@/utils/vaultMentions';

const vault: Record<string, 'file' | 'folder'> = {
  'notes.md': 'file',
  'src/api.ts': 'file',
  'my notes.md': 'file',
  'src/providers': 'folder',
};
const resolve = (p: string) => vault[p] ?? null;

describe('extractVaultMentions', () => {
  it('separates file and folder mentions', () => {
    const r = extractVaultMentions('see @notes.md and @src/providers/ now', resolve);
    expect(r.files).toEqual(['notes.md']);
    expect(r.folders).toEqual(['src/providers']);
  });

  it('greedily matches paths containing spaces', () => {
    const r = extractVaultMentions('open @my notes.md please', resolve);
    expect(r.files).toEqual(['my notes.md']);
  });

  it('ignores @tokens that are not vault entries', () => {
    const r = extractVaultMentions('email me @someone and @nope.txt', resolve);
    expect(r.files).toEqual([]);
    expect(r.folders).toEqual([]);
  });

  it('strips trailing punctuation to find the real file', () => {
    const r = extractVaultMentions('look at @notes.md.', resolve);
    expect(r.files).toEqual(['notes.md']);
  });

  it('de-duplicates repeated mentions', () => {
    const r = extractVaultMentions('@notes.md and again @notes.md', resolve);
    expect(r.files).toEqual(['notes.md']);
  });

  it('only matches mentions at a boundary', () => {
    const r = extractVaultMentions('email user@notes.md', resolve);
    expect(r.files).toEqual([]);
  });

  it('caps a space-path mention at the next mention so it does not swallow it', () => {
    const r = extractVaultMentions('open @my notes.md @src/api.ts', resolve);
    expect(r.files).toEqual(['my notes.md', 'src/api.ts']);
  });

  it('matches a mention at index 0', () => {
    const r = extractVaultMentions('@notes.md is the file', resolve);
    expect(r.files).toEqual(['notes.md']);
  });

  it('handles a folder mention that is the entire message with a trailing space', () => {
    const r = extractVaultMentions('@src/providers/ ', resolve);
    expect(r.folders).toEqual(['src/providers']);
    expect(r.files).toEqual([]);
  });

  it('ignores a slash-terminated token that is not a vault folder', () => {
    const r = extractVaultMentions('see @imaginary/ here', resolve);
    expect(r.folders).toEqual([]);
    expect(r.files).toEqual([]);
  });
});
