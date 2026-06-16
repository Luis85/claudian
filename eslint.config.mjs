import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import jestPlugin from 'eslint-plugin-jest';
import obsidianmd from 'eslint-plugin-obsidianmd';
import { DEFAULT_ACRONYMS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js';
import { DEFAULT_BRANDS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import { defineConfig } from 'eslint/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const jestRecommended = jestPlugin.configs['flat/recommended'];
const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));
// Staged at 'warn' until the backlog hit zero; promoted 2026-06-10 per the
// ratchet policy in docs/build-ci/quality-gates.md § "Lint severity policy".
const obsidianRuleSeverity = 'error';

const stagedObsidianRules = {
  'obsidianmd/commands/no-command-in-command-id': obsidianRuleSeverity,
  'obsidianmd/commands/no-command-in-command-name': obsidianRuleSeverity,
  'obsidianmd/commands/no-default-hotkeys': obsidianRuleSeverity,
  'obsidianmd/commands/no-plugin-id-in-command-id': obsidianRuleSeverity,
  'obsidianmd/commands/no-plugin-name-in-command-name': obsidianRuleSeverity,
  'obsidianmd/detach-leaves': obsidianRuleSeverity,
  'obsidianmd/editor-drop-paste': obsidianRuleSeverity,
  'obsidianmd/hardcoded-config-path': obsidianRuleSeverity,
  'obsidianmd/no-forbidden-elements': obsidianRuleSeverity,
  'obsidianmd/no-global-this': obsidianRuleSeverity,
  'obsidianmd/no-plugin-as-component': obsidianRuleSeverity,
  'obsidianmd/no-sample-code': obsidianRuleSeverity,
  'obsidianmd/no-static-styles-assignment': obsidianRuleSeverity,
  'obsidianmd/no-tfile-tfolder-cast': obsidianRuleSeverity,
  'obsidianmd/no-unsupported-api': obsidianRuleSeverity,
  'obsidianmd/no-view-references-in-plugin': obsidianRuleSeverity,
  'obsidianmd/object-assign': obsidianRuleSeverity,
  'obsidianmd/platform': obsidianRuleSeverity,
  'obsidianmd/prefer-abstract-input-suggest': obsidianRuleSeverity,
  'obsidianmd/prefer-active-doc': obsidianRuleSeverity,
  'obsidianmd/prefer-file-manager-trash-file': obsidianRuleSeverity,
  'obsidianmd/prefer-get-language': obsidianRuleSeverity,
  'obsidianmd/prefer-instanceof': obsidianRuleSeverity,
  'obsidianmd/prefer-window-timers': obsidianRuleSeverity,
  'obsidianmd/regex-lookbehind': obsidianRuleSeverity,
  'obsidianmd/sample-names': obsidianRuleSeverity,
  'obsidianmd/settings-tab/no-manual-html-headings': obsidianRuleSeverity,
  'obsidianmd/settings-tab/no-problematic-settings-headings': obsidianRuleSeverity,
  'obsidianmd/ui/sentence-case': [
    obsidianRuleSeverity,
    {
      ignoreWords: ['Claudian', 'Codex', 'OpenCode', 'WSL'],
      brands: [...DEFAULT_BRANDS, 'Claudian', 'Codex', 'OpenCode'],
      acronyms: [...DEFAULT_ACRONYMS, 'TOML', 'WSL'],
      ignoreRegex: ['\\.(?:claude|codex|cursor|opencode)/'],
      enforceCamelCaseLower: true,
    },
  ],
  'obsidianmd/vault/iterate': obsidianRuleSeverity,
};

export default defineConfig([
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'main.js'],
  },
  js.configs.recommended,
  {
    files: ['esbuild.config.mjs', 'scripts/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        module: 'readonly',
        process: 'readonly',
      },
    },
  },
  ...tseslint.configs['flat/recommended'],
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'none', ignoreRestSiblings: true },
      ],
      // Guardrail (Q-3): src reached zero explicit `any` (tests keep their own
      // override below), so the rule is promoted to block regressions. A
      // genuinely unavoidable browser/SDK-shim `any` takes a narrow
      // eslint-disable-next-line with a justification comment.
      '@typescript-eslint/no-explicit-any': 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'error',
      // Q-1 (Notice i18n sweep). Block hardcoded English in `new Notice()`:
      // every user-visible notice must go through `t('key')` or `t('key', params)`
      // so the 10 supported locales can override it. Identifier pass-throughs
      // like `new Notice(nameError)` stay allowed — those carry strings that
      // helper functions return (see docs/issues/translate-validator-helper-strings.md
      // for the planned next step that translates those helpers).
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'NewExpression[callee.name="Notice"][arguments.0.type="Literal"]',
          message:
            "Hardcoded English in `new Notice('...')` is not allowed. Use `t('key.path')` instead, adding the canonical string to src/i18n/locales/en.json. See docs/reviews/2026-06-02-codebase-review-and-improvement-plan.md `Subspace policy` for naming.",
        },
        {
          selector:
            'NewExpression[callee.name="Notice"][arguments.0.type="TemplateLiteral"]',
          message:
            "Hardcoded English in `new Notice(`...`)` is not allowed. Use `t('key.path', { param: value })` instead, adding the canonical string with `{param}` placeholders to src/i18n/locales/en.json.",
        },
        // OBS-B (Obsidian security review). Raw HTML injection is the #1 risk
        // for a streaming chat UI: any innerHTML/outerHTML/insertAdjacentHTML
        // fed by agent/markdown/user content is an XSS vector. Build DOM with
        // createEl/createDiv/createSpan/setText/.empty(), or route untrusted
        // content through MarkdownRenderer. If a site is provably static, use a
        // narrow `// eslint-disable-next-line no-restricted-syntax` with a
        // justification comment rather than disabling this rule globally.
        {
          selector:
            'AssignmentExpression > MemberExpression[property.name="innerHTML"]',
          message:
            'Assigning to innerHTML is banned (XSS risk). Use createEl/createDiv/createSpan/setText/.empty(), or MarkdownRenderer for markdown. See docs/issues/audit-innerhtml-rendering.md (OBS-B).',
        },
        {
          selector:
            'AssignmentExpression > MemberExpression[property.name="outerHTML"]',
          message:
            'Assigning to outerHTML is banned (XSS risk). Use createEl/createDiv/createSpan/setText/.empty(), or MarkdownRenderer for markdown. See docs/issues/audit-innerhtml-rendering.md (OBS-B).',
        },
        {
          selector: 'CallExpression[callee.property.name="insertAdjacentHTML"]',
          message:
            'insertAdjacentHTML is banned (XSS risk). Use createEl/createDiv/createSpan/setText, or MarkdownRenderer for markdown. See docs/issues/audit-innerhtml-rendering.md (OBS-B).',
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir,
      },
    },
    plugins: {
      obsidianmd,
    },
    rules: stagedObsidianRules,
  },
  {
    files: ['src/**/*.ts'],
    // Function-health rules, all promoted to `error` per the ratchet policy
    // (docs/build-ci/quality-gates.md § "Lint severity policy"):
    // `max-params`/`max-depth` on 2026-06-10, then `complexity`/
    // `max-lines-per-function` on 2026-06-13 once their backlog reached zero
    // (quality campaign run 7). The LOC guard already caps whole files at
    // 500 LOC; these add the function-level signal file-level LOC can't see.
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 200, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      complexity: ['error', { max: 25 }],
      'max-params': ['error', { max: 6 }],
      'max-depth': ['error', { max: 5 }],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: [
      // Provider-internal files own their own internals.
      'src/providers/*/**/*.ts',
      // The bootstrap aggregator(s) that call ProviderRegistry.register /
      // ProviderWorkspaceRegistry.register are the one sanctioned outside
      // importer of `src/providers/<id>/registration` and workspace modules.
      'src/providers/index.ts',
    ],
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
              message:
                'Provider internals are reachable only through ProviderRegistry / ProviderWorkspaceRegistry. Add a method to ProviderRegistration / ProviderChatUIConfig / ProviderSettingsReconciler instead of importing from src/providers/<id>/. See ADR 0001 § Boundary rule.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    ...jestRecommended,
    rules: {
      ...jestRecommended.rules,
      // Tests legitimately use `any` for mocking provider/SDK shapes; the
      // near-zero-any guardrail (Q-3) only targets production `src/`, so keep
      // this off here to avoid thousands of low-signal test warnings.
      '@typescript-eslint/no-explicit-any': 'off',
      'jest/no-standalone-expect': [
        'error',
        { additionalTestBlockFunctions: ['itPosix', 'itWin32'] },
      ],
      // Promoted warn -> error 2026-06-13 (quality campaign run 13). CI does not
      // pass `--max-warnings`, so any `warn` rule is effectively unenforced;
      // these jest rules all had zero offenders, so promoting them makes the lint
      // gate genuinely all-error (no warn tier in use). `jest/expect-expect` was
      // the staged-backlog rule; `no-disabled-tests` / `no-commented-out-tests`
      // ship at `warn` from the jest-recommended preset and are promoted with it
      // so committed skipped or commented-out tests also block CI.
      'jest/expect-expect': [
        'error',
        {
          // Helper functions that wrap `expect()` for shared test scaffolding.
          assertFunctionNames: ['expect', 'assertTabRendersRegistry', 'mountSettingsShell'],
        },
      ],
      'jest/no-disabled-tests': 'error',
      'jest/no-commented-out-tests': 'error',
    },
  },
]);
