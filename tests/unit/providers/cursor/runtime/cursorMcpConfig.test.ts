import {
  buildCursorMcpConfig,
  type CursorHttpToolServerConfig,
  type CursorMcpJsonShape,
} from '@/providers/cursor/runtime/cursorMcpConfig';

const CONFIG: CursorHttpToolServerConfig = {
  url: 'http://127.0.0.1:12345/mcp',
  headers: { Authorization: 'Bearer tok-abc' },
};

describe('buildCursorMcpConfig', () => {
  it('returns existing unchanged when serverConfig is null', () => {
    const existing: CursorMcpJsonShape = {
      mcpServers: { other: { url: 'http://example.com' } },
    };
    const result = buildCursorMcpConfig(existing, null);
    expect(result).toBe(existing);
  });

  it('creates mcpServers when absent and adds specorator entry', () => {
    const result = buildCursorMcpConfig(null, CONFIG);
    expect(result.mcpServers).toEqual({
      specorator: { url: CONFIG.url, headers: CONFIG.headers },
    });
  });

  it('merges specorator into existing mcpServers, preserving other servers', () => {
    const existing: CursorMcpJsonShape = {
      mcpServers: {
        other: { url: 'http://example.com' },
        another: { command: 'npx', args: ['-y', 'some-mcp'] },
      },
      somethingElse: 42,
    };
    const result = buildCursorMcpConfig(existing, CONFIG);
    expect(result.mcpServers).toEqual({
      other: { url: 'http://example.com' },
      another: { command: 'npx', args: ['-y', 'some-mcp'] },
      specorator: { url: CONFIG.url, headers: CONFIG.headers },
    });
    // Other top-level keys are preserved.
    expect(result.somethingElse).toBe(42);
  });

  it('overwrites an existing specorator entry with fresh config', () => {
    const existing: CursorMcpJsonShape = {
      mcpServers: {
        specorator: { url: 'http://old.host/mcp', headers: { Authorization: 'Bearer old' } },
      },
    };
    const result = buildCursorMcpConfig(existing, CONFIG);
    expect(result.mcpServers?.specorator).toEqual({
      url: CONFIG.url,
      headers: CONFIG.headers,
    });
  });

  it('treats a non-object mcpServers field as absent', () => {
    const existing: CursorMcpJsonShape = { mcpServers: 'garbage' as unknown as Record<string, unknown> };
    const result = buildCursorMcpConfig(existing, CONFIG);
    expect(result.mcpServers).toEqual({
      specorator: { url: CONFIG.url, headers: CONFIG.headers },
    });
  });
});
