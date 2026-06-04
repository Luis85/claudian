import { McpServerManager } from '@/core/mcp/McpServerManager';
import type { ManagedMcpServer, McpHttpServerConfig, McpStdioServerConfig } from '@/core/types';

// SEC-4: keep the curation deterministic so assertions can verify host vars are
// withheld while configured vars + an enhanced PATH survive.
jest.mock('@/utils/env', () => ({
  curateStdioMcpEnv: jest.fn((configuredEnv: Record<string, string> = {}) => ({
    HOME: '/home/tester',
    ...configuredEnv,
    PATH: `${configuredEnv.PATH ?? ''}:/usr/bin`,
  })),
}));

const createManager = async (servers: ManagedMcpServer[]) => {
  const manager = new McpServerManager({
    load: async () => servers,
  });
  await manager.loadServers();
  return manager;
};

describe('McpServerManager', () => {
  describe('getDisallowedMcpTools', () => {
    it('returns empty array when no servers are loaded', async () => {
      const manager = await createManager([]);
      expect(manager.getDisallowedMcpTools(new Set())).toEqual([]);
    });

    it('formats disabled tools for enabled servers', async () => {
      const manager = await createManager([
        {
          name: 'alpha',
          config: { command: 'alpha-cmd' },
          enabled: true,
          contextSaving: false,
          disabledTools: ['tool_a', 'tool_b'],
        },
      ]);

      expect(manager.getDisallowedMcpTools(new Set())).toEqual([
        'mcp__alpha__tool_a',
        'mcp__alpha__tool_b',
      ]);
    });

    it('skips disabled servers', async () => {
      const manager = await createManager([
        {
          name: 'alpha',
          config: { command: 'alpha-cmd' },
          enabled: false,
          contextSaving: false,
          disabledTools: ['tool_a'],
        },
        {
          name: 'beta',
          config: { command: 'beta-cmd' },
          enabled: true,
          contextSaving: false,
          disabledTools: ['tool_b'],
        },
      ]);

      expect(manager.getDisallowedMcpTools(new Set())).toEqual(['mcp__beta__tool_b']);
    });

    it('trims tool names and ignores blanks', async () => {
      const manager = await createManager([
        {
          name: 'alpha',
          config: { command: 'alpha-cmd' },
          enabled: true,
          contextSaving: false,
          disabledTools: ['  tool_a  ', ''],
        },
      ]);

      expect(manager.getDisallowedMcpTools(new Set())).toEqual(['mcp__alpha__tool_a']);
    });

    it('skips context-saving servers not mentioned', async () => {
      const manager = await createManager([
        {
          name: 'alpha',
          config: { command: 'alpha-cmd' },
          enabled: true,
          contextSaving: true,
          disabledTools: ['tool_a'],
        },
        {
          name: 'beta',
          config: { command: 'beta-cmd' },
          enabled: true,
          contextSaving: false,
          disabledTools: ['tool_b'],
        },
      ]);

      expect(manager.getDisallowedMcpTools(new Set())).toEqual(['mcp__beta__tool_b']);
    });

    it('includes context-saving servers when mentioned', async () => {
      const manager = await createManager([
        {
          name: 'alpha',
          config: { command: 'alpha-cmd' },
          enabled: true,
          contextSaving: true,
          disabledTools: ['tool_a'],
        },
        {
          name: 'beta',
          config: { command: 'beta-cmd' },
          enabled: true,
          contextSaving: false,
          disabledTools: ['tool_b'],
        },
      ]);

      expect(manager.getDisallowedMcpTools(new Set(['alpha']))).toEqual([
        'mcp__alpha__tool_a',
        'mcp__beta__tool_b',
      ]);
    });
  });

  describe('getActiveServers', () => {
    it('returns empty record when no servers loaded', async () => {
      const manager = await createManager([]);
      expect(manager.getActiveServers(new Set())).toEqual({});
    });

    it('returns enabled non-context-saving servers', async () => {
      const manager = await createManager([
        {
          name: 'alpha',
          config: { command: 'alpha-cmd', args: ['--flag'] },
          enabled: true,
          contextSaving: false,
        },
      ]);

      const result = manager.getActiveServers(new Set());
      expect(result).toEqual({
        alpha: {
          command: 'alpha-cmd',
          args: ['--flag'],
          env: { HOME: '/home/tester', PATH: ':/usr/bin' },
        },
      });
    });

    it('excludes disabled servers', async () => {
      const manager = await createManager([
        {
          name: 'disabled-one',
          config: { command: 'cmd' },
          enabled: false,
          contextSaving: false,
        },
        {
          name: 'enabled-one',
          config: { command: 'cmd2' },
          enabled: true,
          contextSaving: false,
        },
      ]);

      const result = manager.getActiveServers(new Set());
      expect(Object.keys(result)).toEqual(['enabled-one']);
    });

    it('excludes context-saving servers not mentioned', async () => {
      const manager = await createManager([
        {
          name: 'ctx-server',
          config: { command: 'ctx-cmd' },
          enabled: true,
          contextSaving: true,
        },
        {
          name: 'normal-server',
          config: { command: 'normal-cmd' },
          enabled: true,
          contextSaving: false,
        },
      ]);

      const result = manager.getActiveServers(new Set());
      expect(Object.keys(result)).toEqual(['normal-server']);
    });

    it('includes context-saving servers when mentioned', async () => {
      const manager = await createManager([
        {
          name: 'ctx-server',
          config: { command: 'ctx-cmd' },
          enabled: true,
          contextSaving: true,
        },
      ]);

      const result = manager.getActiveServers(new Set(['ctx-server']));
      expect(result).toEqual({
        'ctx-server': {
          command: 'ctx-cmd',
          env: { HOME: '/home/tester', PATH: ':/usr/bin' },
        },
      });
    });

    describe('SEC-4 curated env for live stdio MCP spawns', () => {
      it('pins a curated env on stdio servers: configured vars + PATH survive, host vars are withheld', async () => {
        const manager = await createManager([
          {
            name: 'fs',
            config: {
              command: 'mcp-fs',
              env: { MY_SERVER_TOKEN: 'configured', PATH: '/server/bin' },
            },
            enabled: true,
            contextSaving: false,
          },
        ]);

        const config = manager.getActiveServers(new Set()).fs as {
          command: string;
          env?: Record<string, string>;
        };

        // Configured var preserved, PATH enhanced, an essential present...
        expect(config.env?.MY_SERVER_TOKEN).toBe('configured');
        expect(config.env?.PATH).toContain('/server/bin');
        expect(config.env?.HOME).toBe('/home/tester');
        // ...but an arbitrary host var the user never configured does NOT leak.
        expect(config.env?.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      });

      it('leaves SSE/HTTP servers untouched (no child env)', async () => {
        const manager = await createManager([
          {
            name: 'remote',
            config: { type: 'http', url: 'https://example.com/mcp' },
            enabled: true,
            contextSaving: false,
          },
        ]);

        const result = manager.getActiveServers(new Set());
        expect(result.remote).toEqual({ type: 'http', url: 'https://example.com/mcp' });
        expect('env' in result.remote).toBe(false);
      });
    });
  });

  describe('getAllDisallowedMcpTools', () => {
    it('returns empty array when no servers', async () => {
      const manager = await createManager([]);
      expect(manager.getAllDisallowedMcpTools()).toEqual([]);
    });

    it('includes disabled tools from all enabled servers regardless of context-saving', async () => {
      const manager = await createManager([
        {
          name: 'ctx-server',
          config: { command: 'cmd' },
          enabled: true,
          contextSaving: true,
          disabledTools: ['tool_x'],
        },
        {
          name: 'normal-server',
          config: { command: 'cmd2' },
          enabled: true,
          contextSaving: false,
          disabledTools: ['tool_y'],
        },
      ]);

      const result = manager.getAllDisallowedMcpTools();
      expect(result).toEqual([
        'mcp__ctx-server__tool_x',
        'mcp__normal-server__tool_y',
      ]);
    });

    it('skips disabled servers', async () => {
      const manager = await createManager([
        {
          name: 'off',
          config: { command: 'cmd' },
          enabled: false,
          contextSaving: false,
          disabledTools: ['tool_a'],
        },
      ]);

      expect(manager.getAllDisallowedMcpTools()).toEqual([]);
    });

    it('returns sorted results', async () => {
      const manager = await createManager([
        {
          name: 'beta',
          config: { command: 'cmd' },
          enabled: true,
          contextSaving: false,
          disabledTools: ['zzz'],
        },
        {
          name: 'alpha',
          config: { command: 'cmd' },
          enabled: true,
          contextSaving: false,
          disabledTools: ['aaa'],
        },
      ]);

      const result = manager.getAllDisallowedMcpTools();
      expect(result).toEqual(['mcp__alpha__aaa', 'mcp__beta__zzz']);
    });

    it('skips servers with no disabledTools', async () => {
      const manager = await createManager([
        {
          name: 'no-disabled',
          config: { command: 'cmd' },
          enabled: true,
          contextSaving: false,
        },
        {
          name: 'empty-disabled',
          config: { command: 'cmd' },
          enabled: true,
          contextSaving: false,
          disabledTools: [],
        },
      ]);

      expect(manager.getAllDisallowedMcpTools()).toEqual([]);
    });
  });

  describe('getEnabledCount', () => {
    it('returns 0 for no servers', async () => {
      const manager = await createManager([]);
      expect(manager.getEnabledCount()).toBe(0);
    });

    it('counts only enabled servers', async () => {
      const manager = await createManager([
        { name: 'a', config: { command: 'a' }, enabled: true, contextSaving: false },
        { name: 'b', config: { command: 'b' }, enabled: false, contextSaving: false },
        { name: 'c', config: { command: 'c' }, enabled: true, contextSaving: false },
      ]);
      expect(manager.getEnabledCount()).toBe(2);
    });
  });

  describe('hasServers', () => {
    it('returns false for empty', async () => {
      const manager = await createManager([]);
      expect(manager.hasServers()).toBe(false);
    });

    it('returns true when servers exist', async () => {
      const manager = await createManager([
        { name: 'a', config: { command: 'a' }, enabled: false, contextSaving: false },
      ]);
      expect(manager.hasServers()).toBe(true);
    });
  });

  describe('getServers', () => {
    it('returns loaded servers', async () => {
      const servers: ManagedMcpServer[] = [
        { name: 'x', config: { command: 'x' }, enabled: true, contextSaving: false },
      ];
      const manager = await createManager(servers);
      expect(manager.getServers()).toEqual(servers);
    });
  });

  describe('getContextSavingServers', () => {
    it('returns only enabled context-saving servers', async () => {
      const manager = await createManager([
        { name: 'ctx-on', config: { command: 'a' }, enabled: true, contextSaving: true },
        { name: 'ctx-off', config: { command: 'b' }, enabled: true, contextSaving: false },
        { name: 'disabled-ctx', config: { command: 'c' }, enabled: false, contextSaving: true },
      ]);

      const result = manager.getContextSavingServers();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('ctx-on');
    });
  });

  describe('extractMentions', () => {
    it('extracts mentions of context-saving servers from text', async () => {
      const manager = await createManager([
        { name: 'my-server', config: { command: 'a' }, enabled: true, contextSaving: true },
        { name: 'other', config: { command: 'b' }, enabled: true, contextSaving: false },
      ]);

      const mentions = manager.extractMentions('please use @my-server for this');
      expect(mentions).toEqual(new Set(['my-server']));
    });

    it('ignores mentions of non-context-saving servers', async () => {
      const manager = await createManager([
        { name: 'normal', config: { command: 'a' }, enabled: true, contextSaving: false },
      ]);

      const mentions = manager.extractMentions('@normal do something');
      expect(mentions.size).toBe(0);
    });

    it('ignores mentions of disabled context-saving servers', async () => {
      const manager = await createManager([
        { name: 'disabled-ctx', config: { command: 'a' }, enabled: false, contextSaving: true },
      ]);

      const mentions = manager.extractMentions('@disabled-ctx');
      expect(mentions.size).toBe(0);
    });
  });

  describe('transformMentions', () => {
    it('appends MCP after context-saving server mentions', async () => {
      const manager = await createManager([
        { name: 'my-server', config: { command: 'a' }, enabled: true, contextSaving: true },
      ]);

      const result = manager.transformMentions('use @my-server please');
      expect(result).toBe('use @my-server MCP please');
    });

    it('does not transform non-context-saving server mentions', async () => {
      const manager = await createManager([
        { name: 'normal', config: { command: 'a' }, enabled: true, contextSaving: false },
      ]);

      const result = manager.transformMentions('use @normal please');
      expect(result).toBe('use @normal please');
    });

    it('returns text unchanged when no context-saving servers', async () => {
      const manager = await createManager([]);
      const text = 'hello @world';
      expect(manager.transformMentions(text)).toBe(text);
    });
  });

  describe('loadServers', () => {
    it('populates servers from storage', async () => {
      const servers: ManagedMcpServer[] = [
        { name: 'a', config: { command: 'cmd-a' }, enabled: true, contextSaving: false },
        { name: 'b', config: { type: 'sse', url: 'http://localhost' }, enabled: false, contextSaving: true },
      ];
      const manager = new McpServerManager({ load: async () => servers });

      expect(manager.getServers()).toEqual([]);
      await manager.loadServers();
      expect(manager.getServers()).toEqual(servers);
    });
  });

  describe('getActiveServers — SEC-A secret resolution', () => {
    it('overlays a resolved secret header for an enabled url server', async () => {
      const servers: ManagedMcpServer[] = [
        {
          name: 'remote',
          config: { type: 'http', url: 'https://x', headers: { Accept: 'application/json' } },
          enabled: true,
          contextSaving: false,
          secretHeaders: { Authorization: 'id-auth' },
        },
      ];
      const manager = new McpServerManager(
        { load: async () => servers },
        (id) => (id === 'id-auth' ? 'Bearer live' : null),
      );
      await manager.loadServers();

      const remote = manager.getActiveServers(new Set()).remote as McpHttpServerConfig;
      expect(remote.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer live' });
    });

    it('curates a stdio server with its secret env overlaid before curation', async () => {
      const servers: ManagedMcpServer[] = [
        {
          name: 'local',
          config: { command: 'run', env: { LOG_LEVEL: 'debug' } },
          enabled: true,
          contextSaving: false,
          secretEnv: { API_KEY: 'id-key' },
        },
      ];
      const manager = new McpServerManager(
        { load: async () => servers },
        () => 'sk-live',
      );
      await manager.loadServers();

      const local = manager.getActiveServers(new Set()).local as McpStdioServerConfig;
      // curateStdioMcpEnv (mocked) keeps configured vars + adds HOME/PATH; the
      // secret env var must be present (resolved before curation).
      expect(local.env?.API_KEY).toBe('sk-live');
      expect(local.env?.LOG_LEVEL).toBe('debug');
    });

    it('omits a missing secret rather than injecting empty', async () => {
      const servers: ManagedMcpServer[] = [
        {
          name: 'remote',
          config: { type: 'http', url: 'https://x' },
          enabled: true,
          contextSaving: false,
          secretHeaders: { Authorization: 'id-auth' },
        },
      ];
      const manager = new McpServerManager({ load: async () => servers }, () => null);
      await manager.loadServers();

      const remote = manager.getActiveServers(new Set()).remote as McpHttpServerConfig;
      expect(remote.headers?.Authorization).toBeUndefined();
    });
  });
});
