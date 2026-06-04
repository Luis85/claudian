import { parseClipboardConfig, tryParseClipboardConfig } from '@/core/mcp/McpConfigParser';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { McpStorage } from '@/providers/claude/storage/McpStorage';

/** Mock adapter with exposed store for test assertions. */
type MockAdapter = VaultFileAdapter & { _store: Record<string, string> };

// Mock VaultFileAdapter with minimal implementation for McpStorage tests
function createMockAdapter(files: Record<string, string> = {}): MockAdapter {
  const store = { ...files };
  return {
    exists: async (path: string) => path in store,
    read: async (path: string) => {
      if (!(path in store)) throw new Error(`File not found: ${path}`);
      return store[path];
    },
    write: async (path: string, content: string) => {
      store[path] = content;
    },
    delete: async (path: string) => {
      delete store[path];
    },
    // Expose store for assertions
    _store: store,
  } as unknown as MockAdapter;
}

describe('McpStorage', () => {
  describe('load', () => {
    it('returns empty array when file does not exist', async () => {
      const adapter = createMockAdapter();
      const storage = new McpStorage(adapter);
      const servers = await storage.load();
      expect(servers).toEqual([]);
    });

    it('loads servers with disabledTools from _claudian metadata', async () => {
      const config = {
        mcpServers: {
          alpha: { command: 'alpha-cmd', args: ['--arg'] },
        },
        _claudian: {
          servers: {
            alpha: {
              enabled: true,
              contextSaving: true,
              disabledTools: ['tool_a', 'tool_b'],
            },
          },
        },
      };

      const adapter = createMockAdapter({
        '.claude/mcp.json': JSON.stringify(config),
      });
      const storage = new McpStorage(adapter);
      const servers = await storage.load();

      expect(servers).toHaveLength(1);
      expect(servers[0]).toMatchObject({
        name: 'alpha',
        config: { command: 'alpha-cmd', args: ['--arg'] },
        enabled: true,
        contextSaving: true,
        disabledTools: ['tool_a', 'tool_b'],
      });
    });

    it('filters out non-string disabledTools', async () => {
      const config = {
        mcpServers: {
          alpha: { command: 'alpha-cmd' },
        },
        _claudian: {
          servers: {
            alpha: {
              disabledTools: ['valid', 123, null, 'also_valid'],
            },
          },
        },
      };

      const adapter = createMockAdapter({
        '.claude/mcp.json': JSON.stringify(config),
      });
      const storage = new McpStorage(adapter);
      const servers = await storage.load();

      expect(servers[0].disabledTools).toEqual(['valid', 'also_valid']);
    });

    it('returns undefined disabledTools when array is empty', async () => {
      const config = {
        mcpServers: {
          alpha: { command: 'alpha-cmd' },
        },
        _claudian: {
          servers: {
            alpha: {
              disabledTools: [],
            },
          },
        },
      };

      const adapter = createMockAdapter({
        '.claude/mcp.json': JSON.stringify(config),
      });
      const storage = new McpStorage(adapter);
      const servers = await storage.load();

      expect(servers[0].disabledTools).toBeUndefined();
    });

    it('returns empty array on JSON parse error', async () => {
      const adapter = createMockAdapter({
        '.claude/mcp.json': 'invalid json{',
      });
      const storage = new McpStorage(adapter);

      const servers = await storage.load();
      expect(servers).toEqual([]);
    });

    it('returns empty array when mcpServers is missing', async () => {
      const adapter = createMockAdapter({
        '.claude/mcp.json': JSON.stringify({}),
      });
      const storage = new McpStorage(adapter);
      const servers = await storage.load();
      expect(servers).toEqual([]);
    });

    it('returns empty array when mcpServers is not an object', async () => {
      const adapter = createMockAdapter({
        '.claude/mcp.json': JSON.stringify({ mcpServers: 'invalid' }),
      });
      const storage = new McpStorage(adapter);
      const servers = await storage.load();
      expect(servers).toEqual([]);
    });

    it('skips invalid server configs', async () => {
      const config = {
        mcpServers: {
          valid: { command: 'valid-cmd' },
          invalid: { notACommand: true },
        },
      };
      const adapter = createMockAdapter({
        '.claude/mcp.json': JSON.stringify(config),
      });
      const storage = new McpStorage(adapter);
      const servers = await storage.load();

      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('valid');
    });

    it('defaults untrusted vault-sourced servers (no _claudian metadata) to disabled', async () => {
      const config = {
        mcpServers: {
          alpha: { command: 'alpha-cmd' },
        },
      };
      const adapter = createMockAdapter({
        '.claude/mcp.json': JSON.stringify(config),
      });
      const storage = new McpStorage(adapter);
      const servers = await storage.load();

      // SEC-3: servers from vault config without trust metadata are disabled
      // until the user explicitly enables them.
      expect(servers[0]).toMatchObject({
        name: 'alpha',
        enabled: false,
        contextSaving: true,
        disabledTools: undefined,
      });
    });

    it('honors enabled=true when the server carries trust metadata', async () => {
      const config = {
        mcpServers: { alpha: { command: 'alpha-cmd' } },
        _claudian: { servers: { alpha: { enabled: true } } },
      };
      const adapter = createMockAdapter({
        '.claude/mcp.json': JSON.stringify(config),
      });
      const storage = new McpStorage(adapter);
      const servers = await storage.load();

      expect(servers[0]).toMatchObject({ name: 'alpha', enabled: true });
    });

    it('disables a server whose metadata omits an explicit enabled:true (SEC-3)', async () => {
      // Presence of a `_claudian.servers.<name>` entry is NOT trust — `_claudian`
      // is committable/syncable, so a malicious vault could ship empty/partial
      // metadata to imply trust. Only an explicit `enabled: true` enables.
      const config = {
        mcpServers: { alpha: { command: 'alpha-cmd' }, beta: { command: 'beta-cmd' } },
        _claudian: { servers: { alpha: { description: 'known server' }, beta: {} } },
      };
      const adapter = createMockAdapter({
        '.claude/mcp.json': JSON.stringify(config),
      });
      const storage = new McpStorage(adapter);
      const servers = await storage.load();

      expect(servers.find((s) => s.name === 'alpha')?.enabled).toBe(false);
      expect(servers.find((s) => s.name === 'beta')?.enabled).toBe(false);
    });

    it('enables a server only with explicit enabled:true', async () => {
      const config = {
        mcpServers: { alpha: { command: 'alpha-cmd' } },
        _claudian: { servers: { alpha: { enabled: true } } },
      };
      const adapter = createMockAdapter({
        '.claude/mcp.json': JSON.stringify(config),
      });
      const storage = new McpStorage(adapter);
      const servers = await storage.load();

      expect(servers[0]).toMatchObject({ name: 'alpha', enabled: true });
    });

    it('loads description from _claudian metadata', async () => {
      const config = {
        mcpServers: { alpha: { command: 'cmd' } },
        _claudian: {
          servers: {
            alpha: { description: 'My server' },
          },
        },
      };
      const adapter = createMockAdapter({
        '.claude/mcp.json': JSON.stringify(config),
      });
      const storage = new McpStorage(adapter);
      const servers = await storage.load();
      expect(servers[0].description).toBe('My server');
    });
  });

  describe('save', () => {
    it('saves disabledTools to _claudian metadata', async () => {
      const adapter = createMockAdapter();
      const storage = new McpStorage(adapter);

      await storage.save([
        {
          name: 'alpha',
          config: { command: 'alpha-cmd' },
          enabled: true,
          contextSaving: true,
          disabledTools: ['tool_a', 'tool_b'],
        },
      ]);

      const saved = JSON.parse(adapter._store['.claude/mcp.json']);
      expect(saved._claudian.servers.alpha.disabledTools).toEqual(['tool_a', 'tool_b']);
    });

    it('trims and filters blank disabledTools on save', async () => {
      const adapter = createMockAdapter();
      const storage = new McpStorage(adapter);

      await storage.save([
        {
          name: 'alpha',
          config: { command: 'alpha-cmd' },
          enabled: true,
          contextSaving: true,
          disabledTools: ['  tool_a  ', '', '  ', 'tool_b'],
        },
      ]);

      const saved = JSON.parse(adapter._store['.claude/mcp.json']);
      expect(saved._claudian.servers.alpha.disabledTools).toEqual(['tool_a', 'tool_b']);
    });

    it('omits disabledTools from metadata when empty but persists trust', async () => {
      const adapter = createMockAdapter();
      const storage = new McpStorage(adapter);

      await storage.save([
        {
          name: 'alpha',
          config: { command: 'alpha-cmd' },
          enabled: true,
          contextSaving: true,  // default
          disabledTools: [],
        },
      ]);

      const saved = JSON.parse(adapter._store['.claude/mcp.json']);
      // SEC-3: enabled is always persisted so the server is remembered as
      // user-trusted; only the truly default disabledTools/contextSaving are omitted.
      expect(saved._claudian.servers.alpha).toEqual({ enabled: true });
    });

    it('preserves existing _claudian metadata when saving', async () => {
      const existing = {
        mcpServers: {
          alpha: { command: 'alpha-cmd' },
        },
        _claudian: {
          customField: 'should be preserved',
          servers: {
            alpha: { enabled: false },
          },
        },
      };

      const adapter = createMockAdapter({
        '.claude/mcp.json': JSON.stringify(existing),
      });
      const storage = new McpStorage(adapter);

      await storage.save([
        {
          name: 'alpha',
          config: { command: 'alpha-cmd' },
          enabled: true,
          contextSaving: true,
          disabledTools: ['tool_a'],
        },
      ]);

      const saved = JSON.parse(adapter._store['.claude/mcp.json']);
      expect(saved._claudian.customField).toBe('should be preserved');
      expect(saved._claudian.servers.alpha.disabledTools).toEqual(['tool_a']);
    });

    it('round-trips disabledTools correctly', async () => {
      const adapter = createMockAdapter();
      const storage = new McpStorage(adapter);

      const original = [
        {
          name: 'alpha',
          config: { command: 'alpha-cmd' },
          enabled: true,
          contextSaving: true,
          disabledTools: ['tool_a', 'tool_b'],
        },
        {
          name: 'beta',
          config: { command: 'beta-cmd' },
          enabled: false,
          contextSaving: false,
          disabledTools: undefined,
        },
      ];

      await storage.save(original);
      const loaded = await storage.load();

      expect(loaded).toHaveLength(2);
      expect(loaded[0]).toMatchObject({
        name: 'alpha',
        disabledTools: ['tool_a', 'tool_b'],
      });
      expect(loaded[1]).toMatchObject({
        name: 'beta',
        disabledTools: undefined,
      });
    });

    it('saves description to _claudian metadata', async () => {
      const adapter = createMockAdapter();
      const storage = new McpStorage(adapter);

      await storage.save([
        {
          name: 'alpha',
          config: { command: 'cmd' },
          enabled: true,
          contextSaving: true,
          description: 'A test server',
        },
      ]);

      const saved = JSON.parse(adapter._store['.claude/mcp.json']);
      expect(saved._claudian.servers.alpha.description).toBe('A test server');
    });

    it('stores enabled=false in _claudian when different from default', async () => {
      const adapter = createMockAdapter();
      const storage = new McpStorage(adapter);

      await storage.save([
        {
          name: 'alpha',
          config: { command: 'cmd' },
          enabled: false,
          contextSaving: true,
        },
      ]);

      const saved = JSON.parse(adapter._store['.claude/mcp.json']);
      expect(saved._claudian.servers.alpha.enabled).toBe(false);
    });

    it('stores contextSaving=false in _claudian when different from default', async () => {
      const adapter = createMockAdapter();
      const storage = new McpStorage(adapter);

      await storage.save([
        {
          name: 'alpha',
          config: { command: 'cmd' },
          enabled: true,
          contextSaving: false,
        },
      ]);

      const saved = JSON.parse(adapter._store['.claude/mcp.json']);
      expect(saved._claudian.servers.alpha.contextSaving).toBe(false);
    });

    it('persists enabled metadata for trusted servers (no longer all-default)', async () => {
      const existing = {
        mcpServers: { alpha: { command: 'cmd' } },
        _claudian: { servers: { alpha: { enabled: false } } },
      };
      const adapter = createMockAdapter({
        '.claude/mcp.json': JSON.stringify(existing),
      });
      const storage = new McpStorage(adapter);

      await storage.save([
        {
          name: 'alpha',
          config: { command: 'cmd' },
          enabled: true,
          contextSaving: true,
        },
      ]);

      const saved = JSON.parse(adapter._store['.claude/mcp.json']);
      // SEC-3: enabled state is always recorded so trust survives reloads.
      expect(saved._claudian.servers.alpha).toEqual({ enabled: true });
    });

    it('preserves non-servers _claudian fields when saving', async () => {
      const existing = {
        mcpServers: { alpha: { command: 'cmd' } },
        _claudian: {
          customField: 'keep',
          servers: { alpha: { enabled: false } },
        },
      };
      const adapter = createMockAdapter({
        '.claude/mcp.json': JSON.stringify(existing),
      });
      const storage = new McpStorage(adapter);

      await storage.save([
        {
          name: 'alpha',
          config: { command: 'cmd' },
          enabled: true,
          contextSaving: true,
        },
      ]);

      const saved = JSON.parse(adapter._store['.claude/mcp.json']);
      expect(saved._claudian.customField).toBe('keep');
      expect(saved._claudian.servers.alpha).toEqual({ enabled: true });
    });

    it('handles corrupted existing file gracefully', async () => {
      const adapter = createMockAdapter({
        '.claude/mcp.json': 'not json',
      });
      const storage = new McpStorage(adapter);

      await storage.save([
        {
          name: 'alpha',
          config: { command: 'cmd' },
          enabled: true,
          contextSaving: true,
        },
      ]);

      const saved = JSON.parse(adapter._store['.claude/mcp.json']);
      expect(saved.mcpServers.alpha).toEqual({ command: 'cmd' });
    });

    it('preserves extra top-level fields in existing file', async () => {
      const existing = {
        mcpServers: { old: { command: 'old-cmd' } },
        someExtraField: 'preserved',
      };
      const adapter = createMockAdapter({
        '.claude/mcp.json': JSON.stringify(existing),
      });
      const storage = new McpStorage(adapter);

      await storage.save([
        {
          name: 'new',
          config: { command: 'new-cmd' },
          enabled: true,
          contextSaving: true,
        },
      ]);

      const saved = JSON.parse(adapter._store['.claude/mcp.json']);
      expect(saved.someExtraField).toBe('preserved');
      expect(saved.mcpServers).toEqual({ new: { command: 'new-cmd' } });
    });
  });

  describe('SEC-A Phase 3 — secret header/env refs', () => {
    it('round-trips secretHeaders/secretEnv through _claudian metadata', async () => {
      const adapter = createMockAdapter();
      const storage = new McpStorage(adapter);

      await storage.save([
        {
          name: 'remote',
          config: { type: 'http', url: 'https://x', headers: { Accept: 'application/json' } },
          enabled: true,
          contextSaving: false,
          secretHeaders: { Authorization: 'claudian-mcp-remote-header-authorization' },
        },
      ]);

      const file = JSON.parse(adapter._store['.claude/mcp.json']) as {
        mcpServers: Record<string, { headers?: Record<string, string> }>;
        _claudian: { servers: Record<string, { secretHeaders?: Record<string, string> }> };
      };
      expect(file._claudian.servers.remote.secretHeaders).toEqual({
        Authorization: 'claudian-mcp-remote-header-authorization',
      });
      expect(file.mcpServers.remote.headers).toEqual({ Accept: 'application/json' });

      const [loaded] = await storage.load();
      expect(loaded.secretHeaders).toEqual({ Authorization: 'claudian-mcp-remote-header-authorization' });
    });

    it('strips a secret-referenced header value from the persisted plaintext config', async () => {
      const adapter = createMockAdapter();
      const storage = new McpStorage(adapter);

      // A caller left the resolved value on the config; save must not write it.
      await storage.save([
        {
          name: 'remote',
          config: { type: 'http', url: 'https://x', headers: { Authorization: 'Bearer LEAK', Accept: 'json' } },
          enabled: true,
          contextSaving: false,
          secretHeaders: { Authorization: 'id-auth' },
        },
      ]);

      const raw = adapter._store['.claude/mcp.json'];
      expect(raw).not.toContain('Bearer LEAK');
      const file = JSON.parse(raw) as { mcpServers: Record<string, { headers?: Record<string, string> }> };
      expect(file.mcpServers.remote.headers).toEqual({ Accept: 'json' });
    });
  });

  describe('exists', () => {
    it('returns false when mcp.json does not exist', async () => {
      const adapter = createMockAdapter();
      const storage = new McpStorage(adapter);
      expect(await storage.exists()).toBe(false);
    });

    it('returns true when mcp.json exists', async () => {
      const adapter = createMockAdapter({
        '.claude/mcp.json': '{}',
      });
      const storage = new McpStorage(adapter);
      expect(await storage.exists()).toBe(true);
    });
  });

  describe('grandfatherExistingServers (SEC-3 one-time migration)', () => {
    it('marks metadata-less servers trusted so they survive default-untrusted loading', async () => {
      const adapter = createMockAdapter({
        '.claude/mcp.json': JSON.stringify({
          mcpServers: { alpha: { command: 'a' }, beta: { command: 'b' } },
        }),
      });
      const storage = new McpStorage(adapter);

      // Pre-migration: no metadata → both load disabled.
      const before = await storage.load();
      expect(before.every((s) => s.enabled === false)).toBe(true);

      await storage.grandfatherExistingServers();

      const after = await storage.load();
      expect(after.find((s) => s.name === 'alpha')?.enabled).toBe(true);
      expect(after.find((s) => s.name === 'beta')?.enabled).toBe(true);
    });

    it('preserves explicit user state and only touches metadata-less servers', async () => {
      const adapter = createMockAdapter({
        '.claude/mcp.json': JSON.stringify({
          mcpServers: { keep: { command: 'k' }, off: { command: 'o' } },
          _claudian: { servers: { off: { enabled: false } } },
        }),
      });
      const storage = new McpStorage(adapter);

      await storage.grandfatherExistingServers();

      const after = await storage.load();
      expect(after.find((s) => s.name === 'keep')?.enabled).toBe(true); // grandfathered
      expect(after.find((s) => s.name === 'off')?.enabled).toBe(false); // user choice kept
    });

    it('is a no-op when there is no config file', async () => {
      const adapter = createMockAdapter();
      const storage = new McpStorage(adapter);
      await expect(storage.grandfatherExistingServers()).resolves.toBeUndefined();
      expect('.claude/mcp.json' in adapter._store).toBe(false);
    });

    it('does not rewrite the file when every server already has metadata', async () => {
      const content = JSON.stringify({
        mcpServers: { a: { command: 'a' } },
        _claudian: { servers: { a: { enabled: true } } },
      });
      const adapter = createMockAdapter({ '.claude/mcp.json': content });
      const storage = new McpStorage(adapter);
      await storage.grandfatherExistingServers();
      expect(adapter._store['.claude/mcp.json']).toBe(content);
    });
  });

  describe('parseClipboardConfig', () => {
    it('parses full Claude Code format (mcpServers wrapper)', () => {
      const json = JSON.stringify({
        mcpServers: {
          'my-server': { command: 'node', args: ['server.js'] },
        },
      });

      const result = parseClipboardConfig(json);
      expect(result.needsName).toBe(false);
      expect(result.servers).toHaveLength(1);
      expect(result.servers[0].name).toBe('my-server');
      expect(result.servers[0].config).toEqual({ command: 'node', args: ['server.js'] });
    });

    it('parses multiple servers in mcpServers format', () => {
      const json = JSON.stringify({
        mcpServers: {
          alpha: { command: 'alpha-cmd' },
          beta: { type: 'sse', url: 'http://localhost:3000' },
        },
      });

      const result = parseClipboardConfig(json);
      expect(result.servers).toHaveLength(2);
      expect(result.needsName).toBe(false);
    });

    it('parses single server config without name (command-based)', () => {
      const json = JSON.stringify({ command: 'node', args: ['server.js'] });

      const result = parseClipboardConfig(json);
      expect(result.needsName).toBe(true);
      expect(result.servers).toHaveLength(1);
      expect(result.servers[0].name).toBe('');
      expect((result.servers[0].config as { command: string }).command).toBe('node');
    });

    it('parses single server config without name (url-based)', () => {
      const json = JSON.stringify({ type: 'sse', url: 'http://example.com' });

      const result = parseClipboardConfig(json);
      expect(result.needsName).toBe(true);
      expect(result.servers[0].config).toEqual({ type: 'sse', url: 'http://example.com' });
    });

    it('parses single named server', () => {
      const json = JSON.stringify({
        'my-server': { command: 'node', args: ['server.js'] },
      });

      const result = parseClipboardConfig(json);
      expect(result.needsName).toBe(false);
      expect(result.servers).toHaveLength(1);
      expect(result.servers[0].name).toBe('my-server');
    });

    it('parses multiple named servers without mcpServers wrapper', () => {
      const json = JSON.stringify({
        server1: { command: 'cmd1' },
        server2: { command: 'cmd2' },
      });

      const result = parseClipboardConfig(json);
      expect(result.needsName).toBe(false);
      expect(result.servers).toHaveLength(2);
    });

    it('throws for invalid JSON', () => {
      expect(() => parseClipboardConfig('not json'))
        .toThrow('Invalid JSON');
    });

    it('throws for non-object JSON', () => {
      expect(() => parseClipboardConfig('"string"'))
        .toThrow('Invalid JSON object');
    });

    it('throws when mcpServers contains no valid configs', () => {
      const json = JSON.stringify({
        mcpServers: {
          invalid: { notACommand: true },
        },
      });

      expect(() => parseClipboardConfig(json))
        .toThrow('No valid server configs found');
    });

    it('throws for unrecognized format', () => {
      const json = JSON.stringify({ someRandomField: 123 });

      expect(() => parseClipboardConfig(json))
        .toThrow('Invalid MCP configuration format');
    });

    it('skips invalid entries in mcpServers but includes valid ones', () => {
      const json = JSON.stringify({
        mcpServers: {
          valid: { command: 'cmd' },
          invalid: { notACommand: true },
        },
      });

      const result = parseClipboardConfig(json);
      expect(result.servers).toHaveLength(1);
      expect(result.servers[0].name).toBe('valid');
    });
  });

  describe('tryParseClipboardConfig', () => {
    it('returns parsed config for valid JSON', () => {
      const text = JSON.stringify({ command: 'node', args: ['server.js'] });
      const result = tryParseClipboardConfig(text);
      expect(result).not.toBeNull();
      expect(result!.needsName).toBe(true);
    });

    it('returns null for non-JSON text', () => {
      expect(tryParseClipboardConfig('hello world')).toBeNull();
    });

    it('returns null for text not starting with {', () => {
      expect(tryParseClipboardConfig('[1, 2, 3]')).toBeNull();
    });

    it('returns null for invalid MCP config that is valid JSON', () => {
      expect(tryParseClipboardConfig('{ "random": 42 }')).toBeNull();
    });

    it('trims whitespace before checking', () => {
      const text = '  \n  ' + JSON.stringify({ command: 'node' }) + '  \n';
      const result = tryParseClipboardConfig(text);
      expect(result).not.toBeNull();
    });
  });
});
