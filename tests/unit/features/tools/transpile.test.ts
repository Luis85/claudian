// tests/unit/features/tools/transpile.test.ts
import { transpileToolSource } from '@/features/tools/transpile';

describe('transpileToolSource', () => {
  it('strips TypeScript types', () => {
    const out = transpileToolSource('const x: number = 1; export default x;');
    expect(out).not.toContain(': number');
    expect(out).toContain('1');
  });

  it('converts esm imports/exports to commonjs', () => {
    const out = transpileToolSource(
      "import { z } from 'zod';\nexport default { z };",
    );
    expect(out).toContain('require');
    expect(out).toContain('exports');
  });
});
