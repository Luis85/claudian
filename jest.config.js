/** @type {import('ts-jest').JestConfigWithTsJest} */
const baseConfig = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFilesAfterEnv: ['<rootDir>/tests/setupWindow.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@test/(.*)$': '<rootDir>/tests/$1',
    '^@anthropic-ai/claude-agent-sdk$': '<rootDir>/tests/__mocks__/claude-agent-sdk.ts',
    '^obsidian$': '<rootDir>/tests/__mocks__/obsidian.ts',
    '^@modelcontextprotocol/sdk/(.*)$': '<rootDir>/node_modules/@modelcontextprotocol/sdk/dist/cjs/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@anthropic-ai/claude-agent-sdk)/)',
  ],
};

module.exports = {
  projects: [
    {
      ...baseConfig,
      displayName: 'unit',
      // Suffix glob (no `<rootDir>`) so Windows worktree paths with backslashes
      // (`.worktrees\...`) don't break micromatch. `roots` already scopes the search.
      testMatch: ['**/tests/unit/**/*.test.ts'],
    },
    {
      ...baseConfig,
      displayName: 'integration',
      testMatch: ['**/tests/integration/**/*.test.ts'],
    },
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  // Guardrail (Q-3): regression floors, not aspirations. Each floor sits a few
  // points BELOW the coverage measured on this baseline so the gate passes
  // today but trips when coverage slips meaningfully. Per-path floors are set
  // HIGHER for the security- and robustness-critical areas that must stay
  // well-covered (utils, provider runtimes, security, logging, MCP).
  // Path keys match by prefix; the most specific match wins, so the looser
  // `global` floor only applies to files no per-path key covers.
  //
  // Baseline (stmt/branch/func/lines), measured 2026-05-31:
  //   global                          73.61 / 65.06 / 69.68 / 74.51
  //   src/utils/                      92.12 / 85.22 / 96.60 / 94.04
  //   src/core/security/              98.89 / 96.15 / 100.0 / 98.82
  //   src/core/logging/               94.74 / 95.83 / 93.10 / 97.01
  //   src/core/mcp/                   96.02 / 83.06 / 95.74 / 97.10
  //   src/providers/claude/runtime/   85.18 / 77.05 / 88.79 / 85.63
  //   src/providers/codex/runtime/    84.88 / 70.58 / 85.49 / 85.78
  //   src/providers/cursor/runtime/   76.26 / 62.45 / 75.68 / 77.40
  //   src/providers/opencode/runtime/ 64.29 / 50.86 / 58.90 / 64.19
  coverageThreshold: {
    global: { statements: 70, branches: 60, functions: 65, lines: 70 },
    'src/utils/': { statements: 88, branches: 80, functions: 92, lines: 90 },
    'src/core/security/': { statements: 95, branches: 92, functions: 96, lines: 95 },
    'src/core/logging/': { statements: 90, branches: 90, functions: 88, lines: 93 },
    'src/core/mcp/': { statements: 92, branches: 78, functions: 92, lines: 93 },
    'src/providers/claude/runtime/': { statements: 80, branches: 72, functions: 84, lines: 81 },
    'src/providers/codex/runtime/': { statements: 80, branches: 65, functions: 80, lines: 81 },
    'src/providers/cursor/runtime/': { statements: 71, branches: 57, functions: 70, lines: 72 },
    'src/providers/opencode/runtime/': { statements: 59, branches: 45, functions: 53, lines: 59 },
  },
};
