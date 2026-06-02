import * as patchSdkImportMetaUrlHelpers from '../../../scripts/patchSdkImportMetaUrl.js';

const {
  escapeRegExp,
  getNamedImportAliases,
  patchSdkImportMetaUrl,
} = patchSdkImportMetaUrlHelpers;

describe('patchSdkImportMetaUrl', () => {
  it('rewrites the literal createRequire(import.meta.url) call', () => {
    const input = 'const req = createRequire(import.meta.url);';

    const output = patchSdkImportMetaUrl(input);

    expect(output).toContain('createRequire(__filename)');
    expect(output).not.toContain('createRequire(import.meta.url)');
  });

  it('rewrites aliased createRequire imported from node:module', () => {
    const input = [
      "import { createRequire as Wk } from 'node:module';",
      'const req = Wk(import.meta.url);',
    ].join('\n');

    const output = patchSdkImportMetaUrl(input);

    expect(output).toContain('Wk(__filename)');
    expect(output).not.toContain('Wk(import.meta.url)');
  });

  it('rewrites aliased createRequire imported from module (no node: prefix)', () => {
    const input = [
      "import { createRequire as X } from 'module';",
      'X(import.meta.url);',
    ].join('\n');

    const output = patchSdkImportMetaUrl(input);

    expect(output).toContain('X(__filename)');
    expect(output).not.toContain('X(import.meta.url)');
  });

  it('rewrites aliased fileURLToPath imported from node:url to __filename', () => {
    const input = [
      "import { fileURLToPath as H } from 'node:url';",
      'const p = H(import.meta.url);',
    ].join('\n');

    const output = patchSdkImportMetaUrl(input);

    expect(output).toContain('const p = __filename;');
    expect(output).not.toContain('H(import.meta.url)');
  });

  it('rewrites both createRequire and fileURLToPath in the same file', () => {
    const input = [
      "import { createRequire as Cr } from 'node:module';",
      "import { fileURLToPath as Fp } from 'node:url';",
      'const req = Cr(import.meta.url);',
      'const p = Fp(import.meta.url);',
    ].join('\n');

    const output = patchSdkImportMetaUrl(input);

    expect(output).toContain('Cr(__filename)');
    expect(output).toContain('const p = __filename;');
    expect(output).not.toContain('import.meta.url');
  });

  it('returns the input unchanged when no import.meta.url occurrences exist', () => {
    const input = [
      "import { createRequire } from 'node:module';",
      'const req = createRequire(__filename);',
    ].join('\n');

    const output = patchSdkImportMetaUrl(input);

    expect(output).toBe(input);
  });

  it('does not rewrite import.meta.url occurrences inside string literals', () => {
    const input = 'console.log("import.meta.url here");';

    const output = patchSdkImportMetaUrl(input);

    expect(output).toBe(input);
    expect(output).toContain('"import.meta.url here"');
  });

  it('only resolves aliases from the requested module names (combined import statement)', () => {
    // `import { createRequire, fileURLToPath as fu } from 'node:module'` is not
    // valid ESM at runtime, but documents the helper's scoping: only the alias
    // whose source module is listed gets picked up. fileURLToPath under
    // node:module is ignored because url/node:url are the keyed sources.
    const contents = [
      "import { createRequire, fileURLToPath as fu } from 'node:module';",
      'createRequire(import.meta.url);',
      'fu(import.meta.url);',
    ].join('\n');

    expect(
      getNamedImportAliases(contents, 'createRequire', ['module', 'node:module']),
    ).toEqual(['createRequire']);
    expect(
      getNamedImportAliases(contents, 'fileURLToPath', ['url', 'node:url']),
    ).toEqual(['fileURLToPath']);
  });
});

describe('escapeRegExp', () => {
  it('escapes every regex metacharacter', () => {
    const metacharacters = '.*+?^${}()|[]\\';

    const escaped = escapeRegExp(metacharacters);

    expect(escaped).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
    // Round-trip: building a regex from the escaped string matches the
    // original literal exactly.
    expect(new RegExp(`^${escaped}$`).test(metacharacters)).toBe(true);
  });

  it('leaves ordinary identifier characters untouched', () => {
    expect(escapeRegExp('createRequire')).toBe('createRequire');
    expect(escapeRegExp('Wk')).toBe('Wk');
    expect(escapeRegExp('_a1$')).toBe('_a1\\$');
  });
});

describe('getNamedImportAliases', () => {
  it('returns the export name itself when no import statements match', () => {
    expect(getNamedImportAliases('', 'createRequire', ['module', 'node:module']))
      .toEqual(['createRequire']);
    expect(
      getNamedImportAliases(
        "import { unrelated } from 'somewhere-else';",
        'createRequire',
        ['module', 'node:module'],
      ),
    ).toEqual(['createRequire']);
  });

  it('collects multiple aliases for the same export across separate import statements', () => {
    const contents = [
      "import { createRequire as A } from 'node:module';",
      "import { createRequire as B } from 'module';",
      "import { createRequire } from 'node:module';",
    ].join('\n');

    const aliases = getNamedImportAliases(contents, 'createRequire', [
      'module',
      'node:module',
    ]);

    // Order: default seed first, then insertion order from the regex scan.
    expect(aliases).toEqual(['createRequire', 'A', 'B']);
  });

  it('ignores imports whose source module is not in the requested list', () => {
    const contents = "import { createRequire as Z } from 'other-pkg';";

    expect(
      getNamedImportAliases(contents, 'createRequire', ['module', 'node:module']),
    ).toEqual(['createRequire']);
  });
});
