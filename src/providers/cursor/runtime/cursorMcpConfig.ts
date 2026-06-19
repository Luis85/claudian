import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Shape Cursor reads from ~/.cursor/mcp.json. HTTP-style MCP servers specify
 * `url` and optional `headers`; other server types are opaque to us and must
 * be preserved unmodified.
 */
export interface CursorMcpJsonShape {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CursorHttpToolServerConfig {
  url: string;
  headers: Record<string, string>;
}

/**
 * Merges `{ mcpServers.claudian: { url, headers } }` into an existing
 * `~/.cursor/mcp.json` object, preserving every other entry the user has
 * configured. When `serverConfig` is null the existing object is returned
 * unchanged (caller skips the write).
 */
export function buildCursorMcpConfig(
  existing: CursorMcpJsonShape | null,
  serverConfig: CursorHttpToolServerConfig | null,
): CursorMcpJsonShape {
  if (!serverConfig) {
    return existing ?? {};
  }

  const base = existing ?? {};
  return {
    ...base,
    mcpServers: {
      ...(isPlainObject(base.mcpServers) ? base.mcpServers : {}),
      claudian: {
        url: serverConfig.url,
        headers: serverConfig.headers,
      },
    },
  };
}

/**
 * Reads `~/.cursor/mcp.json` (tolerating missing or unparseable content),
 * merges the claudian entry via `buildCursorMcpConfig`, and writes the result
 * back. Creates `~/.cursor/` if absent. Skips entirely when `serverConfig` is
 * null.
 */
export async function writeCursorMcpConfig(
  serverConfig: CursorHttpToolServerConfig | null,
): Promise<void> {
  if (!serverConfig) {
    return;
  }

  const cursorDir = path.join(os.homedir(), '.cursor');
  const mcpJsonPath = path.join(cursorDir, 'mcp.json');

  let existing: CursorMcpJsonShape | null = null;
  try {
    const raw = await fs.readFile(mcpJsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    existing = isPlainObject(parsed) ? (parsed as CursorMcpJsonShape) : null;
  } catch {
    // Missing file or invalid JSON → treat as empty config.
  }

  const merged = buildCursorMcpConfig(existing, serverConfig);
  await fs.mkdir(cursorDir, { recursive: true });
  await fs.writeFile(mcpJsonPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
