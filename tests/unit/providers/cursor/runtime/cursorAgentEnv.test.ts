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
  const originalPlatform = process.platform;
  function setPlatform(platform: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  }
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
    setPlatform(originalPlatform);
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

  describe('on Windows', () => {
    beforeEach(() => {
      setPlatform('win32');
      process.env = {
        ...process.env,
        SystemRoot: 'C:\\Windows',
        PATH: 'C:\\Users\\test\\AppData\\Local\\cursor-agent',
        MSYSTEM: 'MINGW64',
        EXEPATH: 'C:\\Program Files\\Git\\bin',
        SHELL: 'C:\\Program Files\\Git\\bin\\bash.exe',
      };
    });

    it('prefers PowerShell over Git Bash signals from the host', () => {
      const env = buildCursorAgentEnvironment(makePlugin(''));
      expect(env.MSYSTEM).toBeUndefined();
      expect(env.EXEPATH).toBeUndefined();
      expect(env.SHELL).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    });

    it('prepends System32 and WindowsPowerShell to PATH for shell discovery', () => {
      const env = buildCursorAgentEnvironment(makePlugin(''));
      expect(env.PATH?.startsWith('C:\\Windows\\System32;C:\\Windows\\System32\\WindowsPowerShell\\v1.0;')).toBe(true);
      expect(env.PATH).toContain('C:\\Users\\test\\AppData\\Local\\cursor-agent');
    });

    it('keeps Git Bash env when the user set it in custom env', () => {
      const env = buildCursorAgentEnvironment(makePlugin(
        'MSYSTEM=MINGW64\nEXEPATH=C:\\Program Files\\Git\\bin\nSHELL=C:\\Program Files\\Git\\bin\\bash.exe',
      ));
      expect(env.MSYSTEM).toBe('MINGW64');
      expect(env.EXEPATH).toBe('C:\\Program Files\\Git\\bin');
      expect(env.SHELL).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
    });
  });
});
