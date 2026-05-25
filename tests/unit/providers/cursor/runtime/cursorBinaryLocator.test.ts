import * as fs from 'fs';

import { findCursorAgentBinaryPath } from '@/providers/cursor/runtime/CursorBinaryLocator';

jest.mock('fs');
jest.mock('@/utils/env', () => ({
  getEnhancedPath: (additional?: string) => additional ?? '',
  parseEnvironmentVariables: () => ({}),
}));
jest.mock('@/utils/path', () => ({
  expandHomePath: (p: string) => p,
  parsePathEntries: (value?: string) =>
    (value ? value.split(process.platform === 'win32' ? ';' : ':').filter(Boolean) : []),
}));

const mockedStat = fs.statSync as jest.Mock;

function mockExisting(predicate: (p: string) => boolean) {
  mockedStat.mockImplementation((p: string) => {
    if (predicate(String(p))) {
      return { isFile: () => true };
    }
    throw new Error('ENOENT');
  });
}

describe('findCursorAgentBinaryPath (win32)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('finds the .cmd shim when no .exe is present', () => {
    mockExisting(p => p.endsWith('agent.cmd'));
    const result = findCursorAgentBinaryPath('C:\\fakebin', 'win32');
    expect(result).not.toBeNull();
    expect(result!.endsWith('agent.cmd')).toBe(true);
  });

  it('prefers the native .exe over the .cmd shim', () => {
    mockExisting(p => p.endsWith('agent.exe') || p.endsWith('agent.cmd'));
    const result = findCursorAgentBinaryPath('C:\\fakebin', 'win32');
    expect(result!.endsWith('agent.exe')).toBe(true);
  });

  it('still resolves the extensionless shim as a last resort', () => {
    mockExisting(p => p.endsWith('agent'));
    const result = findCursorAgentBinaryPath('C:\\fakebin', 'win32');
    expect(result!.endsWith('agent')).toBe(true);
  });
});
