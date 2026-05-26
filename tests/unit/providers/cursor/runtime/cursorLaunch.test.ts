import * as fs from 'fs';

import { resolveCursorLaunch } from '@/providers/cursor/runtime/cursorLaunch';

jest.mock('fs');

const mockedStat = fs.statSync as jest.Mock;
const mockedReaddir = fs.readdirSync as jest.Mock;

function setupFs(options: {
  files?: (p: string) => boolean;
  versions?: Record<string, string[]>;
}): void {
  const fileMatch = options.files ?? (() => false);
  mockedStat.mockImplementation((p: string) => {
    if (fileMatch(String(p))) {
      return { isFile: () => true };
    }
    throw new Error('ENOENT');
  });
  mockedReaddir.mockImplementation((p: string) => {
    const key = String(p);
    for (const [dir, entries] of Object.entries(options.versions ?? {})) {
      if (key === dir || key.endsWith(dir)) {
        return entries;
      }
    }
    throw new Error('ENOENT');
  });
}

describe('resolveCursorLaunch', () => {
  beforeEach(() => jest.clearAllMocks());

  it('spawns node directly from versions/<latest> on win32', () => {
    const versionsDir = 'C:\\u\\cursor-agent\\versions';
    const latest = `${versionsDir}\\2026.05.24-abc`;
    setupFs({
      files: p => p === `${latest}\\node.exe` || p === `${latest}\\index.js`,
      versions: { [versionsDir]: ['2026.05.24-abc', '2026.05.2-def', '2025.12.01-aaa'] },
    });

    const launch = resolveCursorLaunch(
      'C:\\u\\cursor-agent\\agent.cmd',
      ['-p', '"C:\\x.md"'],
      'win32',
    );

    expect(launch.command.endsWith('node.exe')).toBe(true);
    expect(launch.args[0].endsWith('index.js')).toBe(true);
    expect(launch.args.slice(1)).toEqual(['-p', '"C:\\x.md"']);
    expect(launch.extraEnv?.CURSOR_INVOKED_AS).toBe('agent');
    expect(launch.windowsVerbatimArguments).toBeUndefined();
  });

  it('spawns node directly when node.exe + index.js sit next to the shim', () => {
    const dir = 'C:\\u\\cursor-agent';
    setupFs({
      files: p => p === `${dir}\\node.exe` || p === `${dir}\\index.js`,
    });

    const launch = resolveCursorLaunch(`${dir}\\agent.cmd`, ['--list-models'], 'win32');

    expect(launch.command).toBe(`${dir}\\node.exe`);
    expect(launch.args).toEqual([`${dir}\\index.js`, '--list-models']);
    expect(launch.extraEnv?.CURSOR_INVOKED_AS).toBe('agent');
  });

  it('picks the latest version (2026.05.24 over 2026.5.2 and 2025.x)', () => {
    const versionsDir = 'C:\\u\\cursor-agent\\versions';
    const latest = `${versionsDir}\\2026.05.24-abc`;
    // Only the latest version dir actually has node.exe + index.js.
    setupFs({
      files: p => p === `${latest}\\node.exe` || p === `${latest}\\index.js`,
      versions: { [versionsDir]: ['2025.12.31-zzz', '2026.5.2-def', '2026.05.24-abc'] },
    });

    const launch = resolveCursorLaunch('C:\\u\\cursor-agent\\agent.cmd', ['-p', 'hi'], 'win32');

    expect(launch.args[0]).toBe(`${latest}\\index.js`);
  });

  it('falls back to resolveCursorSpawnSpec (cmd.exe wrapper) when no node/index.js is found', () => {
    setupFs({ files: () => false, versions: {} });

    const launch = resolveCursorLaunch(
      'C:\\Users\\me\\AppData\\Roaming\\npm\\agent.cmd',
      ['-p', 'hello world'],
      'win32',
    );

    expect(launch.command.toLowerCase()).toContain('cmd');
    expect(launch.windowsVerbatimArguments).toBe(true);
    expect(launch.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(launch.args[3]).toContain('agent.cmd');
    expect(launch.args[3]).toContain('"hello world"');
    expect(launch.extraEnv).toBeUndefined();
  });

  it('uses the extensionless node binary on non-win32', () => {
    // Match by basename so the assertion is independent of the host path
    // separator (the test runner may be win32).
    setupFs({
      files: p => p.endsWith('/node') || p.endsWith('\\node') || p.endsWith('index.js'),
    });

    const launch = resolveCursorLaunch('/home/u/.local/share/cursor-agent/cursor-agent', ['-p', 'hi'], 'linux');

    expect(launch.command.endsWith('node')).toBe(true);
    expect(launch.command.endsWith('node.exe')).toBe(false);
    expect(launch.args[0].endsWith('index.js')).toBe(true);
    expect(launch.args.slice(1)).toEqual(['-p', 'hi']);
    expect(launch.extraEnv?.CURSOR_INVOKED_AS).toBe('cursor-agent');
  });
});
