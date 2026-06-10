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
  ...require('./jest.base.config.js'),
  testMatch: ['**/tests/perf/**/*.perf.test.ts'],
};
