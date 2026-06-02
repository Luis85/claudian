import { buildOpencodeRuntimeEnv } from '@/providers/opencode/runtime/OpencodeRuntimeEnvironment';

jest.mock('@/utils/env', () => ({
  parseEnvironmentVariables: jest.fn((text: string) => {
    if (!text) return {};
    const out: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const [k, v] = line.split('=');
      if (k) out[k] = v ?? '';
    }
    return out;
  }),
  getEnhancedPath: jest.fn((p?: string) => p ?? process.env.PATH ?? '/usr/bin'),
}));

jest.mock('@/core/providers/providerEnvironment', () => ({
  getRuntimeEnvironmentText: jest.fn(() => ''),
}));

import { getRuntimeEnvironmentText } from '@/core/providers/providerEnvironment';

const mockedGetRuntimeEnvironmentText = getRuntimeEnvironmentText as unknown as jest.Mock;

describe('buildOpencodeRuntimeEnv', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = {
      PATH: '/usr/bin',
      HOME: '/home/test',
      SECRET_TOKEN: 'sk-leak-me',
      OPENCODE_API_KEY: 'op-key',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    };
    mockedGetRuntimeEnvironmentText.mockReset();
    mockedGetRuntimeEnvironmentText.mockReturnValue('');
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('does not leak unrelated host env vars', () => {
    const env = buildOpencodeRuntimeEnv({}, '');
    expect(env.SECRET_TOKEN).toBeUndefined();
  });

  it('refuses NODE_TLS_REJECT_UNAUTHORIZED even when the host sets it', () => {
    mockedGetRuntimeEnvironmentText.mockReturnValue('NODE_TLS_REJECT_UNAUTHORIZED=0');
    const env = buildOpencodeRuntimeEnv({}, '');
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it('passes through OPENCODE_API_KEY from host env', () => {
    const env = buildOpencodeRuntimeEnv({}, '');
    expect(env.OPENCODE_API_KEY).toBe('op-key');
  });

  it('lets custom env override host values', () => {
    mockedGetRuntimeEnvironmentText.mockReturnValue('OPENCODE_API_KEY=override');
    const env = buildOpencodeRuntimeEnv({}, '');
    expect(env.OPENCODE_API_KEY).toBe('override');
  });

  it("always sets OPENCODE_DISABLE_CLAUDE_CODE_PROMPT='true'", () => {
    const env = buildOpencodeRuntimeEnv({}, '');
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT).toBe('true');
  });

  it('sets OPENCODE_DB when databasePathOverride provided', () => {
    const env = buildOpencodeRuntimeEnv({}, '', '/path/to/db.sqlite');
    expect(env.OPENCODE_DB).toBe('/path/to/db.sqlite');
  });

  it('omits OPENCODE_DB when no databasePathOverride', () => {
    const env = buildOpencodeRuntimeEnv({}, '');
    expect(env.OPENCODE_DB).toBeUndefined();
  });
});
