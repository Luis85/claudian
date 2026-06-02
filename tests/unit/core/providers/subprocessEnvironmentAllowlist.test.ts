import {
  buildAllowlistedSubprocessEnvironment,
  SUBPROCESS_ENV_ALLOWLIST,
} from '@/core/providers/subprocessEnvironmentAllowlist';

describe('buildAllowlistedSubprocessEnvironment', () => {
  it('drops unrelated host env vars by default', () => {
    const result = buildAllowlistedSubprocessEnvironment({
      processEnv: {
        PATH: '/usr/bin',
        HOME: '/home/test',
        SECRET_TOKEN: 'sk-leak-me',
        NPM_TOKEN: 'npm-secret',
        DEBUG: '1',
      },
      customEnv: {},
      providerPrefixPattern: /^CURSOR_/i,
    });
    expect(result.SECRET_TOKEN).toBeUndefined();
    expect(result.NPM_TOKEN).toBeUndefined();
    expect(result.DEBUG).toBeUndefined();
    expect(result.PATH).toBe('/usr/bin');
    expect(result.HOME).toBe('/home/test');
  });

  it('explicitly refuses NODE_TLS_REJECT_UNAUTHORIZED', () => {
    const result = buildAllowlistedSubprocessEnvironment({
      processEnv: { NODE_TLS_REJECT_UNAUTHORIZED: '0', PATH: '/usr/bin' },
      customEnv: { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      providerPrefixPattern: /^CURSOR_/i,
    });
    expect(result.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it('passes through GIT_SSH_COMMAND, SSH_AUTH_SOCK, NODE_OPTIONS, NODE_EXTRA_CA_CERTS', () => {
    const result = buildAllowlistedSubprocessEnvironment({
      processEnv: {
        GIT_SSH_COMMAND: 'ssh -i ~/.ssh/id_x',
        SSH_AUTH_SOCK: '/tmp/ssh.sock',
        NODE_OPTIONS: '--max-old-space-size=4096',
        NODE_EXTRA_CA_CERTS: '/etc/ssl/ca.pem',
      },
      customEnv: {},
      providerPrefixPattern: /^CURSOR_/i,
    });
    expect(result.GIT_SSH_COMMAND).toBe('ssh -i ~/.ssh/id_x');
    expect(result.SSH_AUTH_SOCK).toBe('/tmp/ssh.sock');
    expect(result.NODE_OPTIONS).toBe('--max-old-space-size=4096');
    expect(result.NODE_EXTRA_CA_CERTS).toBe('/etc/ssl/ca.pem');
  });

  it('passes through provider-prefix keys from host env', () => {
    const result = buildAllowlistedSubprocessEnvironment({
      processEnv: { CURSOR_API_KEY: 'cur-key' },
      customEnv: {},
      providerPrefixPattern: /^CURSOR_/i,
    });
    expect(result.CURSOR_API_KEY).toBe('cur-key');
  });

  it('customEnv overrides processEnv values for the same key', () => {
    const result = buildAllowlistedSubprocessEnvironment({
      processEnv: { CURSOR_API_KEY: 'host-key', PATH: '/usr/bin' },
      customEnv: { CURSOR_API_KEY: 'override' },
      providerPrefixPattern: /^CURSOR_/i,
    });
    expect(result.CURSOR_API_KEY).toBe('override');
  });

  it('customEnv keys outside the allowlist still pass through (user opt-in)', () => {
    const result = buildAllowlistedSubprocessEnvironment({
      processEnv: { PATH: '/usr/bin' },
      customEnv: { MY_CUSTOM_VAR: 'yes' },
      providerPrefixPattern: /^CURSOR_/i,
    });
    expect(result.MY_CUSTOM_VAR).toBe('yes');
  });

  it('exposes the allowlist for inspection', () => {
    expect(SUBPROCESS_ENV_ALLOWLIST.has('PATH')).toBe(true);
    expect(SUBPROCESS_ENV_ALLOWLIST.has('SECRET_TOKEN')).toBe(false);
  });
});
