import { resolveCursorSpawnSpec } from '@/providers/cursor/runtime/cursorWindowsSpawn';

describe('resolveCursorSpawnSpec', () => {
  it('passes the command through unchanged on non-Windows platforms', () => {
    const spec = resolveCursorSpawnSpec('/home/u/.local/bin/agent', ['-p', 'hi there'], 'linux');
    expect(spec).toEqual({ command: '/home/u/.local/bin/agent', args: ['-p', 'hi there'] });
    expect(spec.windowsVerbatimArguments).toBeUndefined();
  });

  it('passes native .exe binaries through unchanged on Windows', () => {
    const spec = resolveCursorSpawnSpec('C:\\cursor\\agent.exe', ['-p', 'hi'], 'win32');
    expect(spec.command).toBe('C:\\cursor\\agent.exe');
    expect(spec.args).toEqual(['-p', 'hi']);
    expect(spec.windowsVerbatimArguments).toBeUndefined();
  });

  it('wraps a .cmd shim through cmd.exe on Windows to avoid spawn EINVAL', () => {
    const prev = process.env.ComSpec;
    process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';
    try {
      const spec = resolveCursorSpawnSpec(
        'C:\\Users\\me\\AppData\\Roaming\\npm\\agent.cmd',
        ['-p', 'hello world'],
        'win32',
      );
      expect(spec.command).toBe('C:\\Windows\\System32\\cmd.exe');
      expect(spec.windowsVerbatimArguments).toBe(true);
      expect(spec.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
      // Prompt with a space must be quoted, and the whole command wrapped in quotes.
      expect(spec.args[3]).toContain('agent.cmd');
      expect(spec.args[3]).toContain('"hello world"');
      expect(spec.args[3].startsWith('"')).toBe(true);
      expect(spec.args[3].endsWith('"')).toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.ComSpec;
      } else {
        process.env.ComSpec = prev;
      }
    }
  });

  it('wraps a .bat shim through cmd.exe on Windows', () => {
    const spec = resolveCursorSpawnSpec('C:\\tools\\agent.bat', ['arg'], 'win32');
    expect(spec.command.toLowerCase()).toContain('cmd');
    expect(spec.windowsVerbatimArguments).toBe(true);
  });

  it('falls back to cmd.exe when ComSpec is unset', () => {
    const prev = process.env.ComSpec;
    delete process.env.ComSpec;
    try {
      const spec = resolveCursorSpawnSpec('C:\\npm\\agent.cmd', ['-p', 'x'], 'win32');
      expect(spec.command).toBe('cmd.exe');
    } finally {
      if (prev !== undefined) {
        process.env.ComSpec = prev;
      }
    }
  });
});
