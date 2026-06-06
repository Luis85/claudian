import type { PluginContext } from '@/core/types/PluginContext';
import { buildCodexAppServerEnvironment } from '@/providers/codex/runtime/codexAppServerSupport';

function makePlugin(customEnv: Record<string, string>): PluginContext {
  return {
    getResolvedEnvironmentVariables: () => customEnv,
  } as unknown as PluginContext;
}

describe('buildCodexAppServerEnvironment', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    // Restore any host env mutations so tests stay isolated.
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
  });

  it('does not leak unrelated host secrets into the Codex spawn env', () => {
    process.env.AWS_SECRET_ACCESS_KEY = 'aws-leak-me';
    process.env.UNRELATED_SECRET = 'nope';

    const env = buildCodexAppServerEnvironment(makePlugin({}));

    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.UNRELATED_SECRET).toBeUndefined();
  });

  it('preserves OPENAI_/CODEX_-prefixed host vars', () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    process.env.CODEX_FOO = 'codex-bar';

    const env = buildCodexAppServerEnvironment(makePlugin({}));

    expect(env.OPENAI_API_KEY).toBe('sk-openai');
    expect(env.CODEX_FOO).toBe('codex-bar');
  });

  it('keeps baseline allowlisted vars (HOME) and an enhanced PATH', () => {
    process.env.HOME = '/home/codex-test';

    const env = buildCodexAppServerEnvironment(makePlugin({}));

    expect(env.HOME).toBe('/home/codex-test');
    expect(typeof env.PATH).toBe('string');
    expect(env.PATH.length).toBeGreaterThan(0);
  });

  it('forwards user-entered custom env (opt-in) outside the allowlist', () => {
    const env = buildCodexAppServerEnvironment(makePlugin({ MY_CUSTOM: 'yes' }));

    expect(env.MY_CUSTOM).toBe('yes');
  });
});
