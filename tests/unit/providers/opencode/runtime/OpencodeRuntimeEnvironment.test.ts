import { buildOpencodeRuntimeEnv } from '@/providers/opencode/runtime/OpencodeRuntimeEnvironment';

jest.mock('@/utils/env', () => ({
  getEnhancedPath: jest.fn((p?: string) => p ?? process.env.PATH ?? '/usr/bin'),
}));

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
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('does not leak unrelated host env vars', () => {
    const env = buildOpencodeRuntimeEnv({}, '');
    expect(env.SECRET_TOKEN).toBeUndefined();
  });

  it('refuses NODE_TLS_REJECT_UNAUTHORIZED even when the resolved env sets it', () => {
    const env = buildOpencodeRuntimeEnv({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, '');
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it('passes through OPENCODE_API_KEY from host env', () => {
    const env = buildOpencodeRuntimeEnv({}, '');
    expect(env.OPENCODE_API_KEY).toBe('op-key');
  });

  it('lets the resolved env override host values', () => {
    const env = buildOpencodeRuntimeEnv({ OPENCODE_API_KEY: 'override' }, '');
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
