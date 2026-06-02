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

  it('refuses NODE_TLS_REJECT_UNAUTHORIZED in any letter case (Windows env-var names are case-insensitive)', () => {
    const result = buildAllowlistedSubprocessEnvironment({
      processEnv: {
        node_tls_reject_unauthorized: '0',
        Node_TLS_REJECT_UNAUTHORIZED: '0',
        PATH: '/usr/bin',
      },
      customEnv: {
        node_tls_reject_unauthorized: '0',
        Node_TLS_REJECT_UNAUTHORIZED: '0',
      },
      providerPrefixPattern: /^CURSOR_/i,
    });
    expect(result.node_tls_reject_unauthorized).toBeUndefined();
    expect(result.Node_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
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

  it('forwards XDG base-dir keys so host XDG_DATA_HOME flows through to the CLI', () => {
    // Opencode reads XDG_DATA_HOME to locate its database under
    // $XDG_DATA_HOME/opencode/. Our DB-path resolution and the CLI must see
    // the same value, otherwise hydration points at the wrong DB.
    const result = buildAllowlistedSubprocessEnvironment({
      processEnv: {
        XDG_DATA_HOME: '/home/u/data',
        XDG_CONFIG_HOME: '/home/u/cfg',
        XDG_CACHE_HOME: '/home/u/cache',
        XDG_STATE_HOME: '/home/u/state',
        XDG_RUNTIME_DIR: '/run/u',
      },
      customEnv: {},
      providerPrefixPattern: /^OPENCODE_/i,
    });
    expect(result.XDG_DATA_HOME).toBe('/home/u/data');
    expect(result.XDG_CONFIG_HOME).toBe('/home/u/cfg');
    expect(result.XDG_CACHE_HOME).toBe('/home/u/cache');
    expect(result.XDG_STATE_HOME).toBe('/home/u/state');
    expect(result.XDG_RUNTIME_DIR).toBe('/run/u');
  });
});
