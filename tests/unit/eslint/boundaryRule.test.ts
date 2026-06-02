import { ESLint, type Linter } from 'eslint';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');

// Mirror the boundary block from eslint.config.mjs. Inline here so the suite
// does not have to dynamic-import the flat config (Jest cannot load .mjs
// configs without --experimental-vm-modules).
const BOUNDARY_CONFIG: Linter.Config[] = [
  {
    files: ['src/**/*.ts'],
    ignores: ['src/providers/*/**/*.ts', 'src/providers/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/providers/claude/**',
                '**/providers/codex/**',
                '**/providers/cursor/**',
                '**/providers/opencode/**',
              ],
              message: 'Provider internals are reachable only through the registry.',
            },
          ],
        },
      ],
    },
  },
];

function makeEslint(): ESLint {
  return new ESLint({
    cwd: REPO_ROOT,
    overrideConfigFile: true,
    overrideConfig: BOUNDARY_CONFIG,
  });
}

describe('provider boundary ESLint rule', () => {
  it('fires when code outside src/providers/<id>/ imports from src/providers/<id>/', async () => {
    const eslint = makeEslint();
    const source = "import { something } from '@/providers/claude/runtime/ClaudeChatRuntime';\nexport const x = something;\n";
    const results = await eslint.lintText(source, {
      filePath: path.join(REPO_ROOT, 'src/features/synthetic-boundary-violation.ts'),
    });
    const messages = results[0]?.messages ?? [];
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
  });

  it('does not fire when src/providers/index.ts imports a provider registration', async () => {
    const eslint = makeEslint();
    const source = "import { claudeProviderRegistration } from './claude/registration';\nexport const r = claudeProviderRegistration;\n";
    const results = await eslint.lintText(source, {
      filePath: path.join(REPO_ROOT, 'src/providers/index.ts'),
    });
    const messages = results[0]?.messages ?? [];
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(false);
  });

  it('does not fire on intra-provider imports', async () => {
    const eslint = makeEslint();
    const source = "import { OPENCODE_PLAN_MODE_ID } from '../modes';\nexport const id = OPENCODE_PLAN_MODE_ID;\n";
    const results = await eslint.lintText(source, {
      filePath: path.join(REPO_ROOT, 'src/providers/opencode/env/synthetic.ts'),
    });
    const messages = results[0]?.messages ?? [];
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(false);
  });
});

describe('eslint.config.mjs boundary block — drift guard', () => {
  // Cheap text-level check: assert the live config still contains the four
  // provider-internal patterns + both exemption paths. Catches drift between
  // the inlined BOUNDARY_CONFIG above and the real eslint.config.mjs without
  // requiring --experimental-vm-modules to load the .mjs config.
  const configText = fs.readFileSync(path.join(REPO_ROOT, 'eslint.config.mjs'), 'utf8');

  it.each([
    '**/providers/claude/**',
    '**/providers/codex/**',
    '**/providers/cursor/**',
    '**/providers/opencode/**',
  ])('contains pattern %s', (pattern) => {
    expect(configText).toContain(pattern);
  });

  it('contains intra-provider ignore', () => {
    expect(configText).toContain('src/providers/*/**/*.ts');
  });

  it('contains bootstrap-aggregator ignore', () => {
    expect(configText).toContain('src/providers/index.ts');
  });
});
