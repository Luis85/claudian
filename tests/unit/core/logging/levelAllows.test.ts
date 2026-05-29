// tests/unit/core/logging/levelAllows.test.ts
import { levelAllows } from '../../../../src/core/logging/types';

describe('levelAllows', () => {
  it('allows a message when its level is at or below the threshold rank', () => {
    expect(levelAllows('warn', 'error')).toBe(true); // error passes a warn threshold
    expect(levelAllows('warn', 'warn')).toBe(true);
  });

  it('blocks a message below the threshold', () => {
    expect(levelAllows('warn', 'info')).toBe(false);
    expect(levelAllows('warn', 'debug')).toBe(false);
  });

  it('blocks everything when the threshold is off', () => {
    expect(levelAllows('off', 'error')).toBe(false);
    expect(levelAllows('off', 'debug')).toBe(false);
  });

  it('allows everything at debug threshold', () => {
    for (const lvl of ['error', 'warn', 'info', 'debug'] as const) {
      expect(levelAllows('debug', lvl)).toBe(true);
    }
  });
});
