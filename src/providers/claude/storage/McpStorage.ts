import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type {
  ManagedMcpConfigFile,
  ManagedMcpServer,
  McpHttpServerConfig,
  McpServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from '../../../core/types';
import { DEFAULT_MCP_SERVER, getMcpServerType, isValidMcpServerConfig } from '../../../core/types';

export const MCP_CONFIG_PATH = '.claude/mcp.json';

/** Validate a `_claudian` secret-ref map (name → secret id), dropping bad entries. */
function normalizeSecretRefs(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const refs: Record<string, string> = {};
  for (const [name, id] of Object.entries(value as Record<string, unknown>)) {
    if (typeof id === 'string' && id) refs[name] = id;
  }
  return Object.keys(refs).length > 0 ? refs : undefined;
}

/**
 * SEC-A Phase 3: return a copy of the server config with any header/env key that
 * has a secret ref removed, so a resolved secret value never lands in the
 * committable/syncable `.claude/mcp.json`.
 */
function stripSecretKeys(server: ManagedMcpServer): McpServerConfig {
  if (getMcpServerType(server.config) === 'stdio') {
    const refs = server.secretEnv;
    const stdio = server.config as McpStdioServerConfig;
    if (!refs || !stdio.env) return server.config;
    const env = { ...stdio.env };
    for (const name of Object.keys(refs)) delete env[name];
    const next: McpStdioServerConfig = { ...stdio };
    if (Object.keys(env).length > 0) next.env = env;
    else delete next.env;
    return next;
  }

  const refs = server.secretHeaders;
  const url = server.config as McpSSEServerConfig | McpHttpServerConfig;
  if (!refs || !url.headers) return server.config;
  const headers = { ...url.headers };
  for (const name of Object.keys(refs)) delete headers[name];
  const next = { ...url };
  if (Object.keys(headers).length > 0) next.headers = headers;
  else delete next.headers;
  return next;
}

export class McpStorage {
  constructor(private adapter: VaultFileAdapter) {}

  async load(): Promise<ManagedMcpServer[]> {
    try {
      if (!(await this.adapter.exists(MCP_CONFIG_PATH))) {
        return [];
      }

      const content = await this.adapter.read(MCP_CONFIG_PATH);
      const file = JSON.parse(content) as ManagedMcpConfigFile;

      if (!file.mcpServers || typeof file.mcpServers !== 'object') {
        return [];
      }

      const claudianMeta = file._claudian?.servers ?? {};
      const servers: ManagedMcpServer[] = [];

      for (const [name, config] of Object.entries(file.mcpServers)) {
        if (!isValidMcpServerConfig(config)) {
          continue;
        }

        // SECURITY (SEC-3): A vault MCP server is enabled ONLY when its Claudian
        // metadata explicitly sets `enabled: true`. The mere *presence* of a
        // `_claudian.servers.<name>` entry is not trust — `_claudian` lives in the
        // same committable/syncable `.claude/mcp.json`, so an attacker could ship
        // empty/partial metadata to imply trust. Anything else (no metadata,
        // `{}`, `enabled` absent/false) defaults to DISABLED, so opening an
        // untrusted vault never auto-launches MCP processes. User-enabled servers
        // round-trip because save() always writes the explicit `enabled` flag, and
        // the one-time grandfather migration writes `enabled: true` for pre-existing
        // servers.
        const meta = claudianMeta[name] ?? {};
        const disabledTools = Array.isArray(meta.disabledTools)
          ? meta.disabledTools.filter((tool) => typeof tool === 'string')
          : undefined;
        const normalizedDisabledTools =
          disabledTools && disabledTools.length > 0 ? disabledTools : undefined;

        servers.push({
          name,
          config,
          enabled: meta.enabled === true,
          contextSaving: meta.contextSaving ?? DEFAULT_MCP_SERVER.contextSaving,
          disabledTools: normalizedDisabledTools,
          description: meta.description,
          // SEC-A Phase 3: secret header/env refs (name → SecretStorage id); the
          // value is resolved in-plugin at launch and never lives in this file.
          secretHeaders: normalizeSecretRefs(meta.secretHeaders),
          secretEnv: normalizeSecretRefs(meta.secretEnv),
        });
      }

      return servers;
    } catch {
      return [];
    }
  }

  async save(servers: ManagedMcpServer[]): Promise<void> {
    const mcpServers: Record<string, McpServerConfig> = {};
    const claudianServers: Record<
      string,
      {
        enabled?: boolean;
        contextSaving?: boolean;
        disabledTools?: string[];
        description?: string;
        secretHeaders?: Record<string, string>;
        secretEnv?: Record<string, string>;
      }
    > = {};

    for (const server of servers) {
      // SEC-A Phase 3: never persist a secret-referenced header/env value as
      // plaintext, even if a caller left it on the config — strip those keys.
      mcpServers[server.name] = stripSecretKeys(server);

      const meta: {
        enabled?: boolean;
        contextSaving?: boolean;
        disabledTools?: string[];
        description?: string;
        secretHeaders?: Record<string, string>;
        secretEnv?: Record<string, string>;
      } = {};

      // SECURITY (SEC-3): Always persist the `enabled` flag. The presence of a
      // metadata entry is what marks a server as user-trusted on reload; without
      // it, a re-saved enabled server would be re-classified as untrusted
      // vault-config and silently disabled. Writing the explicit flag keeps
      // enabled state stable across reloads while still defaulting unknown
      // vault-sourced servers (no metadata) to disabled.
      meta.enabled = server.enabled;
      if (server.contextSaving !== DEFAULT_MCP_SERVER.contextSaving) {
        meta.contextSaving = server.contextSaving;
      }
      const normalizedDisabledTools = server.disabledTools
        ?.map((tool) => tool.trim())
        .filter((tool) => tool.length > 0);
      if (normalizedDisabledTools && normalizedDisabledTools.length > 0) {
        meta.disabledTools = normalizedDisabledTools;
      }
      if (server.description) {
        meta.description = server.description;
      }
      if (server.secretHeaders && Object.keys(server.secretHeaders).length > 0) {
        meta.secretHeaders = server.secretHeaders;
      }
      if (server.secretEnv && Object.keys(server.secretEnv).length > 0) {
        meta.secretEnv = server.secretEnv;
      }

      if (Object.keys(meta).length > 0) {
        claudianServers[server.name] = meta;
      }
    }

    let existing: Record<string, unknown> | null = null;
    if (await this.adapter.exists(MCP_CONFIG_PATH)) {
      try {
        const raw = await this.adapter.read(MCP_CONFIG_PATH);
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          existing = parsed as Record<string, unknown>;
        }
      } catch {
        existing = null;
      }
    }

    const file: Record<string, unknown> = existing ? { ...existing } : {};
    file.mcpServers = mcpServers;

    const existingClaudian =
      existing && typeof existing._claudian === 'object'
        ? (existing._claudian as Record<string, unknown>)
        : null;

    if (Object.keys(claudianServers).length > 0) {
      file._claudian = { ...(existingClaudian ?? {}), servers: claudianServers };
    } else if (existingClaudian) {
      const rest = { ...existingClaudian };
      delete rest.servers;
      if (Object.keys(rest).length > 0) {
        file._claudian = rest;
      } else {
        delete file._claudian;
      }
    } else {
      delete file._claudian;
    }

    const content = JSON.stringify(file, null, 2);
    await this.adapter.write(MCP_CONFIG_PATH, content);
  }

  /**
   * One-time SEC-3 grandfather migration. Marks every server currently present
   * in the vault `.claude/mcp.json` as user-trusted (enabled) by writing Claudian
   * metadata, so a config that predates default-untrusted loading is not silently
   * disabled on upgrade. Only servers lacking metadata are touched; servers the
   * user already configured keep their explicit state.
   *
   * The caller gates this on a per-install settings flag so it runs once and does
   * not re-trust servers synced into the vault after the upgrade. (A fresh install
   * whose first-opened vault already contains untrusted servers is the residual
   * case closed only by the SEC-2 interactive trust prompt.)
   */
  async grandfatherExistingServers(): Promise<void> {
    if (!(await this.adapter.exists(MCP_CONFIG_PATH))) {
      return;
    }

    let file: ManagedMcpConfigFile;
    try {
      file = JSON.parse(await this.adapter.read(MCP_CONFIG_PATH)) as ManagedMcpConfigFile;
    } catch {
      return;
    }

    if (!file.mcpServers || typeof file.mcpServers !== 'object') {
      return;
    }

    const existingMeta = file._claudian?.servers ?? {};
    const servers: typeof existingMeta = { ...existingMeta };
    let changed = false;

    for (const name of Object.keys(file.mcpServers)) {
      if (!Object.prototype.hasOwnProperty.call(servers, name)) {
        servers[name] = { ...servers[name], enabled: true };
        changed = true;
      }
    }

    if (!changed) {
      return;
    }

    const updated: ManagedMcpConfigFile = {
      ...file,
      _claudian: { ...file._claudian, servers },
    };
    await this.adapter.write(MCP_CONFIG_PATH, JSON.stringify(updated, null, 2));
  }

  async exists(): Promise<boolean> {
    return this.adapter.exists(MCP_CONFIG_PATH);
  }
}
