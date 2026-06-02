import type * as fsType from 'fs';
import type * as osType from 'os';
import type * as pathType from 'path';

const fs = jest.requireActual<typeof fsType>('fs');
const os = jest.requireActual<typeof osType>('os');
const path = jest.requireActual<typeof pathType>('path');

import { itPosix } from '@test/helpers/platform';

import { resolveCursorCliPromptArg } from '@/providers/cursor/runtime/cursorCliPrompt';

describe('resolveCursorCliPromptArg temp file', () => {
  itPosix('creates the temp directory and file with 0o700 / 0o600 (owner-only) on POSIX', () => {
    const longPrompt = 'x'.repeat(20_000);
    const { arg, cleanup } = resolveCursorCliPromptArg(longPrompt);
    try {
      expect(arg.startsWith('@')).toBe(true);
      const filePath = arg.slice(1);
      const dir = path.dirname(filePath);
      const dstat = fs.statSync(dir);
      expect(dstat.mode & 0o777).toBe(0o700);
      const fstat = fs.statSync(filePath);
      expect(fstat.mode & 0o777).toBe(0o600);
    } finally {
      cleanup?.();
    }
  });

  it('writes the prompt under the system tmp dir using a long prompt', () => {
    // Platform-agnostic smoke test: long prompts must spill to a @-file.
    const longPrompt = 'x'.repeat(20_000);
    const { arg, cleanup } = resolveCursorCliPromptArg(longPrompt);
    try {
      expect(arg.startsWith('@')).toBe(true);
      const filePath = arg.slice(1);
      expect(fs.existsSync(filePath)).toBe(true);
      // sanity: under os.tmpdir()
      const tmpRoot = fs.realpathSync(os.tmpdir());
      expect(fs.realpathSync(path.dirname(path.dirname(filePath)))).toBe(tmpRoot);
    } finally {
      cleanup?.();
    }
  });

  it('cleans up the temp dir when writeFileSync throws', () => {
    // Capture dirs created by mkdtempSync, spy on writeFileSync to throw.
    const createdDirs: string[] = [];
    const realMkdtempSync = fs.mkdtempSync;
    const mkdtempSpy = jest.spyOn(fs, 'mkdtempSync').mockImplementation((...args) => {
      const result = realMkdtempSync(...(args as Parameters<typeof realMkdtempSync>));
      createdDirs.push(result as string);
      return result;
    });
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('disk full');
    });

    try {
      const longPrompt = 'x'.repeat(20_000);
      expect(() => resolveCursorCliPromptArg(longPrompt)).toThrow('disk full');
      // Every dir created during the throwing call must be gone.
      for (const dir of createdDirs) {
        expect(fs.existsSync(dir)).toBe(false);
      }
    } finally {
      writeSpy.mockRestore();
      mkdtempSpy.mockRestore();
      for (const dir of createdDirs) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  });

  it('returns the raw prompt without writing a file when below the inline threshold', () => {
    const shortPrompt = 'hello';
    const result = resolveCursorCliPromptArg(shortPrompt);
    expect(result.arg).toBe(shortPrompt);
    expect(result.cleanup).toBeUndefined();
  });
});
