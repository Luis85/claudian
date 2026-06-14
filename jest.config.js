const baseConfig = require('./jest.base.config.js');

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
  // Actuals (stmt/branch/func/lines), re-measured 2026-06-14; floors below sit a
  // few points under each (regression floors, not aspirations). src/utils is
  // held — its actual slipped vs the 2026-05-31 baseline but stays above floor.
  // The global floor was tightened 2026-06-14 (78/67/74/79 → 79/68/75/80) toward
  // the crept-up actuals; per-dir floors stay as set (runtime dirs are
  // variance-prone, so their ~3-pt margin is kept to avoid flaky CI):
  //   global                          80.76 / 70.21 / 77.44 / 81.94
  //   src/utils/                      90.45 / 83.78 / 94.64 / 92.19
  //   src/core/security/              98.71 / 97.46 / 100.0 / 99.63
  //   src/core/logging/               95.50 / 96.36 / 93.54 / 97.43
  //   src/core/mcp/                   94.05 / 85.71 / 95.52 / 96.40
  //   src/providers/claude/runtime/   91.01 / 82.43 / 92.33 / 91.36
  //   src/providers/codex/runtime/    85.67 / 71.33 / 88.59 / 86.64
  //   src/providers/cursor/runtime/   83.18 / 68.44 / 82.02 / 84.58
  //   src/providers/opencode/runtime/ 71.30 / 59.14 / 65.83 / 71.21
  coverageThreshold: {
    global: { statements: 79, branches: 68, functions: 75, lines: 80 },
    'src/utils/': { statements: 88, branches: 80, functions: 92, lines: 90 },
    'src/core/security/': { statements: 96, branches: 95, functions: 98, lines: 97 },
    'src/core/logging/': { statements: 93, branches: 94, functions: 91, lines: 95 },
    'src/core/mcp/': { statements: 92, branches: 83, functions: 93, lines: 94 },
    'src/providers/claude/runtime/': { statements: 88, branches: 79, functions: 89, lines: 88 },
    'src/providers/codex/runtime/': { statements: 82, branches: 68, functions: 85, lines: 83 },
    'src/providers/cursor/runtime/': { statements: 80, branches: 65, functions: 79, lines: 82 },
    'src/providers/opencode/runtime/': { statements: 68, branches: 56, functions: 62, lines: 68 },
  },
};
