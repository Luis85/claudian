import { readPath, writePath } from '../../../../../src/features/settings/registry/path';

describe('readPath', () => {
  it('reads a top-level key', () => {
    expect(readPath({ foo: 1 }, 'foo')).toBe(1);
  });
  it('reads a nested key', () => {
    expect(readPath({ a: { b: { c: 'x' } } }, 'a.b.c')).toBe('x');
  });
  it('returns undefined for a missing key', () => {
    expect(readPath({ a: 1 }, 'a.b')).toBeUndefined();
  });
});

describe('writePath', () => {
  it('writes a top-level key non-mutatively', () => {
    const source = { foo: 1, bar: 2 };
    const result = writePath(source, 'foo', 9);
    expect(result).toEqual({ foo: 9, bar: 2 });
    expect(source.foo).toBe(1);
  });

  it('writes a nested key, preserving siblings', () => {
    const source = { a: { b: 1, c: 2 } };
    const result = writePath(source, 'a.b', 9);
    expect(result).toEqual({ a: { b: 9, c: 2 } });
    expect(source.a.b).toBe(1);
  });

  it('creates intermediate objects when needed', () => {
    const source = {};
    const result = writePath(source, 'a.b.c', 7);
    expect(result).toEqual({ a: { b: { c: 7 } } });
  });
});
