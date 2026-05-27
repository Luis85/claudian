import { itPosix } from '@test/helpers/platform';
import * as fs from 'fs';

import { resolveCodexCliPath } from '@/providers/codex/runtime/CodexBinaryLocator';

jest.mock('fs');

const mockedExists = fs.existsSync as jest.Mock;
const mockedStat = fs.statSync as jest.Mock;

// Hostname selection is owned by CachedCliResolver; these target the pure path resolver
// with an already-selected host path.
describe('resolveCodexCliPath', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the configured host path when it is a valid file', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/current/codex');
    mockedStat.mockReturnValue({ isFile: () => true });

    expect(resolveCodexCliPath('/current/codex', '/legacy/codex', '')).toBe('/current/codex');
  });

  it('falls back to the legacy path when no host path is selected', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/legacy/codex');
    mockedStat.mockReturnValue({ isFile: () => true });

    expect(resolveCodexCliPath('', '/legacy/codex', '')).toBe('/legacy/codex');
  });

  // POSIX-only PATH/path assertion; source resolves Windows paths on win32.
  itPosix('auto-detects from the runtime PATH when no configured path is valid', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/custom/bin/codex');
    mockedStat.mockImplementation((filePath: string) => ({
      isFile: () => filePath === '/custom/bin/codex',
    }));

    expect(resolveCodexCliPath('', '', 'PATH=/custom/bin')).toBe('/custom/bin/codex');
  });

  it('returns a Linux-side command in WSL mode without host filesystem validation', () => {
    mockedExists.mockReturnValue(false);

    const resolved = resolveCodexCliPath('codex', '', '', {
      installationMethod: 'wsl',
      hostPlatform: 'win32',
    });

    expect(resolved).toBe('codex');
  });

  it('falls back to the Linux command when a Windows-native CLI path is configured in WSL mode', () => {
    mockedExists.mockReturnValue(false);

    const resolved = resolveCodexCliPath(
      'C:\\Users\\user\\AppData\\Roaming\\npm\\codex.exe',
      '',
      '',
      { installationMethod: 'wsl', hostPlatform: 'win32' },
    );

    expect(resolved).toBe('codex');
  });
});
