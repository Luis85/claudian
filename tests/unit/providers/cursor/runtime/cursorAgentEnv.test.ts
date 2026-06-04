import type { PluginContext } from '@/core/types/PluginContext';
import { buildCursorAgentEnvironment } from '@/providers/cursor/runtime/cursorAgentEnv';

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

function makePlugin(envText: string): PluginContext {
  const resolved: Record<string, string> = {};
  for (const line of envText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) resolved[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return { getResolvedEnvironmentVariables: (_id: string) => resolved } as unknown as PluginContext;
}

describe('buildCursorAgentEnvironment', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = {
      PATH: '/usr/bin',
      HOME: '/home/test',
      SECRET_TOKEN: 'dummy-leak-me',
      CURSOR_API_KEY: 'cur-key',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('does not leak unrelated host env vars', () => {
    const env = buildCursorAgentEnvironment(makePlugin(''));
    expect(env.SECRET_TOKEN).toBeUndefined();
  });

  it('refuses NODE_TLS_REJECT_UNAUTHORIZED even when the host sets it', () => {
    const env = buildCursorAgentEnvironment(makePlugin('NODE_TLS_REJECT_UNAUTHORIZED=0'));
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it('passes through CURSOR_API_KEY from host env', () => {
    const env = buildCursorAgentEnvironment(makePlugin(''));
    expect(env.CURSOR_API_KEY).toBe('cur-key');
  });

  it('lets custom env override host values', () => {
    const env = buildCursorAgentEnvironment(makePlugin('CURSOR_API_KEY=override'));
    expect(env.CURSOR_API_KEY).toBe('override');
  });
});
