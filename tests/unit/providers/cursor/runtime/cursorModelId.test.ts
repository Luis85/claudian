import {
  CURSOR_MODEL_PREFIX,
  fromCursorModelValue,
  isCursorModelValue,
  toCursorModelValue,
} from '@/providers/cursor/runtime/cursorModelId';

describe('cursorModelId', () => {
  describe('toCursorModelValue', () => {
    it('prefixes a raw id', () => {
      expect(toCursorModelValue('gpt-5.5')).toBe('cursor:gpt-5.5');
      expect(toCursorModelValue('auto')).toBe('cursor:auto');
    });

    it('trims before prefixing', () => {
      expect(toCursorModelValue('  composer-2  ')).toBe('cursor:composer-2');
    });

    it('is idempotent for already-prefixed input', () => {
      expect(toCursorModelValue('cursor:gpt-5.5')).toBe('cursor:gpt-5.5');
      expect(toCursorModelValue(toCursorModelValue('auto'))).toBe('cursor:auto');
    });

    it('uses the exported prefix constant', () => {
      expect(toCursorModelValue('x')).toBe(`${CURSOR_MODEL_PREFIX}x`);
    });
  });

  describe('fromCursorModelValue', () => {
    it('strips a single leading prefix', () => {
      expect(fromCursorModelValue('cursor:gpt-5.5')).toBe('gpt-5.5');
    });

    it('returns non-prefixed input unchanged (trimmed)', () => {
      expect(fromCursorModelValue('gpt-5.5')).toBe('gpt-5.5');
      expect(fromCursorModelValue('  auto  ')).toBe('auto');
    });

    it('only strips the prefix once', () => {
      expect(fromCursorModelValue('cursor:cursor:auto')).toBe('cursor:auto');
    });
  });

  describe('isCursorModelValue', () => {
    it('is true only for prefixed values', () => {
      expect(isCursorModelValue('cursor:auto')).toBe(true);
      expect(isCursorModelValue('auto')).toBe(false);
      expect(isCursorModelValue('gpt-5.5')).toBe(false);
    });
  });

  describe('round-trip', () => {
    it('to then from returns the raw id', () => {
      for (const raw of ['auto', 'gpt-5.5', 'claude-4.5-sonnet', 'composer-2']) {
        expect(fromCursorModelValue(toCursorModelValue(raw))).toBe(raw);
      }
    });
  });
});
