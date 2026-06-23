const mockPrepareOpencodeLaunchArtifacts = jest.fn().mockResolvedValue({
  configPath: '/tmp/opencode.json',
  configContent: '{}',
  databasePath: null,
  launchKey: 'k',
  systemPromptPath: '/tmp/prompt.md',
});
jest.mock('@/providers/opencode/runtime/OpencodeLaunchArtifacts', () => ({
  prepareOpencodeLaunchArtifacts: (...args: unknown[]) => mockPrepareOpencodeLaunchArtifacts(...args),
  startOpencodeAcpProcess: jest.fn(),
}));

import { OpencodeChatRuntime } from '@/providers/opencode/runtime/OpencodeChatRuntime';

// The constructor only stores its (plugin, host) args, so a barebones runtime
// exercises the pure error-formatting seam without the ACP subprocess.
function makeRuntime(): Record<string, unknown> {
  const runtime = new OpencodeChatRuntime({} as never, {} as never);
  return runtime as unknown as Record<string, unknown>;
}

describe('OpencodeChatRuntime.formatRuntimeError', () => {
  type Format = (error: unknown) => string;

  it('uses the Error message when no stderr is captured', () => {
    const r = makeRuntime();
    expect((r.formatRuntimeError as Format).call(r, new Error('boom'))).toBe('boom');
  });

  it('falls back to a generic message for non-Error throwables', () => {
    const r = makeRuntime();
    expect((r.formatRuntimeError as Format).call(r, 'nope')).toBe('OpenCode request failed');
  });

  it('appends the process stderr snapshot when present', () => {
    const r = makeRuntime();
    r.process = { getStderrSnapshot: () => 'stderr tail' };
    expect((r.formatRuntimeError as Format).call(r, new Error('boom'))).toBe('boom\n\nstderr tail');
  });

  it('omits the stderr block when the snapshot is empty', () => {
    const r = makeRuntime();
    r.process = { getStderrSnapshot: () => '' };
    expect((r.formatRuntimeError as Format).call(r, new Error('boom'))).toBe('boom');
  });
});

// The full query → ensureReady path needs a live ACP subprocess, so we pin the
// invariant at the narrowest threaded seam: prepareLaunchArtifacts must forward
// the bound agent's grant into getHttpToolServerConfig so the managed
// mcp.specorator config carries the scoped (per-grant) bearer token.
describe('OpencodeChatRuntime.prepareLaunchArtifacts grant threading', () => {
  type PrepareLaunchArtifacts = (
    settings: unknown,
    runtimeEnv: unknown,
    cwd: string,
    grantedToolIds?: string[],
  ) => Promise<unknown>;

  beforeEach(() => {
    mockPrepareOpencodeLaunchArtifacts.mockClear();
  });

  it('forwards the bound agent grant to getHttpToolServerConfig', async () => {
    const grant = ['mcp__specorator__search_tasks'];
    const getHttpToolServerConfig = jest.fn().mockReturnValue({ url: 'http://127.0.0.1:1/mcp', headers: {} });
    const r = makeRuntime();
    r.plugin = { getHttpToolServerConfig };

    await (r.prepareLaunchArtifacts as PrepareLaunchArtifacts).call(r, {}, {}, '/vault', grant);

    expect(getHttpToolServerConfig).toHaveBeenCalledWith(grant);
    expect(mockPrepareOpencodeLaunchArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({ httpToolServerConfig: { url: 'http://127.0.0.1:1/mcp', headers: {} } }),
    );
  });

  it('requests the default (all-tools) config when no grant is threaded', async () => {
    const getHttpToolServerConfig = jest.fn().mockReturnValue(null);
    const r = makeRuntime();
    r.plugin = { getHttpToolServerConfig };

    await (r.prepareLaunchArtifacts as PrepareLaunchArtifacts).call(r, {}, {}, '/vault');

    // No grant ⇒ undefined arg ⇒ byte-identical all-tools default token.
    expect(getHttpToolServerConfig).toHaveBeenCalledWith(undefined);
  });
});
