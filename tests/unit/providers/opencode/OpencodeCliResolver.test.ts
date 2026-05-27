import * as fs from 'fs';

import { resolveOpencodeCliPath } from '@/providers/opencode/runtime/OpencodeCliResolver';

jest.mock('fs');

const mockedExists = fs.existsSync as jest.Mock;
const mockedStat = fs.statSync as jest.Mock;

// Hostname selection is owned by CachedCliResolver; these target the pure path resolver
// with an already-selected host path.
describe('resolveOpencodeCliPath', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the configured host path when it is a valid file', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/current/opencode');
    mockedStat.mockReturnValue({ isFile: () => true });

    expect(resolveOpencodeCliPath('/current/opencode', '/legacy/opencode')).toBe('/current/opencode');
  });

  it('falls back to the legacy path when no host path is selected', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/legacy/opencode');
    mockedStat.mockReturnValue({ isFile: () => true });

    expect(resolveOpencodeCliPath('', '/legacy/opencode')).toBe('/legacy/opencode');
  });

  it('returns null when neither path resolves to a file', () => {
    mockedExists.mockReturnValue(false);

    expect(resolveOpencodeCliPath('', '/legacy/opencode')).toBeNull();
  });
});
