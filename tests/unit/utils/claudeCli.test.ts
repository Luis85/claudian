import * as fs from 'fs';

import { findClaudeCLIPath } from '@/providers/claude/cli/findClaudeCLIPath';
import { resolveClaudeCliPath } from '@/providers/claude/runtime/ClaudeCliResolver';

jest.mock('fs');
jest.mock('@/providers/claude/cli/findClaudeCLIPath', () => {
  const actual = jest.requireActual('@/providers/claude/cli/findClaudeCLIPath');
  return {
    ...actual,
    findClaudeCLIPath: jest.fn(),
  };
});

const mockedExists = fs.existsSync as jest.Mock;
const mockedStat = fs.statSync as jest.Mock;
const mockedFind = findClaudeCLIPath as jest.Mock;

describe('resolveClaudeCliPath', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return hostname path when valid file exists', () => {
    mockedExists.mockImplementation((p: string) => p === '/hostname/claude');
    mockedStat.mockReturnValue({ isFile: () => true });

    const result = resolveClaudeCliPath('/hostname/claude', '/legacy/claude', '');

    expect(result).toBe('/hostname/claude');
  });

  it('should skip hostname path if it is a directory', () => {
    mockedExists.mockReturnValue(true);
    mockedStat.mockImplementation((p: string) => ({
      isFile: () => p !== '/hostname/claude',
    }));

    const result = resolveClaudeCliPath('/hostname/claude', '/legacy/claude', '');

    expect(result).toBe('/legacy/claude');
  });

  it('should handle empty hostname path gracefully', () => {
    mockedExists.mockImplementation((p: string) => p === '/legacy/claude');
    mockedStat.mockReturnValue({ isFile: () => true });

    const result = resolveClaudeCliPath('', '/legacy/claude', '');

    expect(result).toBe('/legacy/claude');
  });

  it('should trim whitespace from paths', () => {
    mockedExists.mockImplementation((p: string) => p === '/hostname/claude');
    mockedStat.mockReturnValue({ isFile: () => true });

    const result = resolveClaudeCliPath('  /hostname/claude  ', '', '');

    expect(result).toBe('/hostname/claude');
  });

  it('should handle null/undefined hostname path', () => {
    mockedExists.mockImplementation((p: string) => p === '/legacy/claude');
    mockedStat.mockReturnValue({ isFile: () => true });

    const result = resolveClaudeCliPath(undefined, '/legacy/claude', '');

    expect(result).toBe('/legacy/claude');
  });

  it('should handle null/undefined legacy path', () => {
    mockedExists.mockReturnValue(false);
    mockedFind.mockReturnValue('/auto/claude');

    const result = resolveClaudeCliPath('', undefined, '');

    expect(result).toBe('/auto/claude');
  });

  it('should fall through hostname path when existsSync returns false', () => {
    mockedExists.mockImplementation((p: string) => p === '/legacy/claude');
    mockedStat.mockReturnValue({ isFile: () => true });

    const result = resolveClaudeCliPath('/nonexistent/claude', '/legacy/claude', '');

    expect(result).toBe('/legacy/claude');
  });

  it('should fall through hostname path when existsSync throws', () => {
    mockedExists.mockImplementation((p: string) => {
      if (p.includes('nonexistent')) throw new Error('Access denied');
      return p === '/legacy/claude';
    });
    mockedStat.mockReturnValue({ isFile: () => true });

    const result = resolveClaudeCliPath('/nonexistent/claude', '/legacy/claude', '');

    expect(result).toBe('/legacy/claude');
  });

  it('should fall through legacy path when existsSync throws', () => {
    mockedExists.mockImplementation(() => {
      throw new Error('Access denied');
    });
    mockedFind.mockReturnValue('/auto/claude');

    const result = resolveClaudeCliPath('', '/bad/path', '');

    expect(result).toBe('/auto/claude');
  });

  it('should skip legacy path if it is a directory', () => {
    mockedExists.mockReturnValue(true);
    mockedStat.mockReturnValue({ isFile: () => false });
    mockedFind.mockReturnValue('/auto/claude');

    const result = resolveClaudeCliPath('', '/legacy/dir', '');

    expect(result).toBe('/auto/claude');
  });

  it('should pass env PATH to findClaudeCLIPath', () => {
    mockedExists.mockReturnValue(false);
    mockedFind.mockReturnValue(null);

    resolveClaudeCliPath('', '', 'PATH=/custom/bin');

    expect(mockedFind).toHaveBeenCalledWith('/custom/bin');
  });
});
