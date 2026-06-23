import { applyClaudeDynamicUpdates, type ClaudeDynamicUpdateDeps } from '@/providers/claude/runtime/ClaudeDynamicUpdates';

function makeDeps(over: Partial<ClaudeDynamicUpdateDeps> = {}): {
  deps: ClaudeDynamicUpdateDeps;
  setMcpServers: jest.Mock;
  setModel: jest.Mock;
  config: { model: string; effortLevel: null; permissionMode: string; sdkPermissionMode: string; mcpServersKey: string; enableAutoMode: boolean };
} {
  const setMcpServers = jest.fn().mockResolvedValue({ added: [], removed: [], errors: {} });
  const query = {
    setModel: jest.fn().mockResolvedValue(undefined),
    applyFlagSettings: jest.fn().mockResolvedValue(undefined),
    setPermissionMode: jest.fn().mockResolvedValue(undefined),
    setMcpServers,
  };
  const config = {
    model: 'sonnet',
    effortLevel: null as null,
    permissionMode: 'normal',
    sdkPermissionMode: 'default',
    mcpServersKey: 'STALE', // differs from computed key so updateMcpServers proceeds
    enableAutoMode: false,
  };
  const deps: ClaudeDynamicUpdateDeps = {
    getPersistentQuery: () => query as never,
    getCurrentConfig: () => config as never,
    mutateCurrentConfig: (mutate) => mutate(config as never),
    getVaultPath: () => '/vault',
    getCliPath: () => '/cli',
    getScopedSettings: () => ({ model: 'sonnet', effortLevel: undefined, permissionMode: 'normal' }) as never,
    getPermissionMode: () => 'normal' as never,
    resolveSDKPermissionMode: () => 'default' as never,
    mcpManager: { getActiveServers: () => ({}) } as never,
    buildPersistentQueryConfig: () => config as never,
    needsRestart: () => false,
    ensureReady: async () => true,
    setCurrentExternalContextPaths: () => {},
    notifyFailure: () => {},
    ...over,
  };
  return { deps, setMcpServers, setModel: query.setModel, config };
}

describe('applyClaudeDynamicUpdates — bound-agent model precedence', () => {
  it('keeps the bound-agent model across persistent turns (no revert to settings model)', async () => {
    // currentConfig already at the bound model 'opus'; global default is 'sonnet'.
    const { deps, setModel, config } = makeDeps({
      getScopedSettings: () => ({ model: 'sonnet', effortLevel: undefined, permissionMode: 'normal' }) as never,
    });
    config.model = 'opus';

    await applyClaudeDynamicUpdates(deps, { boundAgentModel: 'opus' } as never, undefined, false);

    // Effective model resolves to the bound 'opus' (== currentConfig.model), so
    // updateModel must NOT clobber it back to the global 'sonnet'.
    expect(setModel).not.toHaveBeenCalledWith('sonnet');
  });
});

describe('applyClaudeDynamicUpdates — specorator tool server', () => {
  it('includes the in-process specorator tool server in setMcpServers', async () => {
    const server = { type: 'sdk', name: 'specorator', instance: {} };
    const { deps, setMcpServers } = makeDeps({ getSpecoratorToolServer: () => server });

    await applyClaudeDynamicUpdates(deps, undefined, undefined, false);

    expect(setMcpServers).toHaveBeenCalledTimes(1);
    expect(setMcpServers.mock.calls[0][0]).toMatchObject({ specorator: server });
  });

  it('omits the specorator key when no tool server is available', async () => {
    const { deps, setMcpServers } = makeDeps({ getSpecoratorToolServer: () => undefined });

    await applyClaudeDynamicUpdates(deps, undefined, undefined, false);

    expect(setMcpServers).toHaveBeenCalledTimes(1);
    expect(setMcpServers.mock.calls[0][0]).not.toHaveProperty('specorator');
  });
});
