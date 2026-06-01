/**
 * Performance regression suite — intentionally separate from `jest.config.js`.
 *
 * These tests are NOT part of `npm test`, CI, or the coverage gate. They are a
 * long-term monitoring tool: run on demand with `npm run test:perf`. Each spec
 * pairs deterministic scaling assertions (the durable safety net — node/listener
 * growth must track the render window, not conversation length) with a
 * report-only metrics dump for trend tracking. Timings are informational and
 * never assert, so the suite stays stable on noisy machines.
 *
 * @type {import('ts-jest').JestConfigWithTsJest}
 */
module.exports = {
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
  testMatch: ['**/tests/perf/**/*.perf.test.ts'],
};
