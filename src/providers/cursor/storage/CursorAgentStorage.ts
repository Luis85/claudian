import { extractBoolean, parseFrontmatter } from '../../../utils/frontmatter';
import { serializeExtraFrontmatter, yamlString } from '../../../utils/slashCommand';
import {
  CURSOR_AGENT_KNOWN_KEYS,
  CURSOR_BUILTIN_AGENTS,
  type CursorAgentDefinition,
} from '../types/agent';

export const CURSOR_AGENT_VAULT_ROOT = '.cursor/agents';
export const CLAUDE_AGENT_COMPAT_ROOT = '.claude/agents';
/** Relative to the user's home directory (HomeFileAdapter root). */
export const CURSOR_AGENT_HOME_ROOT = '.cursor/agents';

const PERSISTENCE_PREFIX = 'cursor-agent';
const FILE_SOURCES = ['vault', 'global', 'claude-compat'] as const;
type CursorAgentFileSource = (typeof FILE_SOURCES)[number];

// Read-only compat root: agents Cursor also loads from another tool's project
// folder (`.cursor/` wins on a name conflict). Maps each compat source to the
// root used in its parse-time origin suffix. `.codex/agents` is intentionally
// omitted — Codex agents are TOML, so a Markdown scan there surfaces nothing;
// re-add with a TOML parser once Cursor's read behavior for that root is verified.
const COMPAT_ROOTS = {
  'claude-compat': CLAUDE_AGENT_COMPAT_ROOT,
} as const satisfies Partial<Record<CursorAgentFileSource, string>>;
type CompatSource = keyof typeof COMPAT_ROOTS;

function isCompatSource(source: string): source is CompatSource {
  return source in COMPAT_ROOTS;
}

export interface CursorAgentLocation {
  source: CursorAgentFileSource;
  filePath: string;
}

export function createCursorAgentPersistenceKey(location: CursorAgentLocation): string {
  return `${PERSISTENCE_PREFIX}:${location.source}:${encodeURIComponent(normalizeSlashes(location.filePath))}`;
}

export function parseCursorAgentPersistenceKey(key?: string): CursorAgentLocation | null {
  if (!key) return null;
  const [prefix, source, encodedPath] = key.split(':');
  if (prefix !== PERSISTENCE_PREFIX || !encodedPath) return null;
  if (!FILE_SOURCES.includes(source as CursorAgentFileSource)) return null;
  return {
    source: source as CursorAgentFileSource,
    filePath: normalizeSlashes(decodeURIComponent(encodedPath)),
  };
}

export function parseCursorAgentMarkdown(
  content: string,
  filePath: string,
  source: CursorAgentFileSource,
): CursorAgentDefinition | null {
  const parsed = parseFrontmatter(content);
  if (!parsed) return null;

  const frontmatter = parsed.frontmatter;
  const rawName = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '';
  const name = rawName || nameFromPath(filePath);
  const rawDescription = typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '';
  if (!name || !rawDescription) return null;

  const description = isCompatSource(source)
    ? `${rawDescription} (from ${COMPAT_ROOTS[source]})`
    : rawDescription;

  const result: CursorAgentDefinition = {
    name,
    description,
    prompt: parsed.body.trim(),
    source,
    persistenceKey: createCursorAgentPersistenceKey({ source, filePath: normalizeSlashes(filePath) }),
  };

  applyCursorOptionFrontmatter(result, frontmatter);
  const extraFrontmatter = collectExtraFrontmatter(frontmatter);
  if (extraFrontmatter) result.extraFrontmatter = extraFrontmatter;

  return result;
}

function applyCursorOptionFrontmatter(
  result: CursorAgentDefinition,
  frontmatter: Record<string, unknown>,
): void {
  const model = typeof frontmatter.model === 'string' && frontmatter.model.trim()
    ? frontmatter.model.trim()
    : undefined;
  if (model && model !== 'inherit') result.model = model;
  if (extractBoolean(frontmatter, 'readonly')) result.readonly = true;
  if (extractBoolean(frontmatter, 'is_background')) result.isBackground = true;
}

function collectExtraFrontmatter(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!CURSOR_AGENT_KNOWN_KEYS.has(key)) extra[key] = value;
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}

export function serializeCursorAgentMarkdown(agent: CursorAgentDefinition): string {
  const lines: string[] = ['---'];
  lines.push(`name: ${yamlString(agent.name)}`);
  // The compat-origin suffix is appended at parse time for compat agents only,
  // so strip it only for those sources — an editable agent whose real
  // description happens to end with the same text must round-trip untouched.
  const description = isCompatSource(agent.source)
    ? stripCompatSuffix(agent.description)
    : agent.description;
  lines.push(`description: ${yamlString(description)}`);
  if (agent.model) lines.push(`model: ${yamlString(agent.model)}`);
  if (agent.readonly) lines.push('readonly: true');
  if (agent.isBackground) lines.push('is_background: true');
  serializeExtraFrontmatter(lines, agent.extraFrontmatter);
  lines.push('---');
  lines.push(agent.prompt);
  return lines.join('\n');
}

// Inverse of the parse-time compat suffix; kept as a literal because the compat
// root is a fixed constant and the dynamic escaping read ambiguously.
const COMPAT_SUFFIX_PATTERN = / \(from \.claude\/agents\)$/;

function stripCompatSuffix(description: string): string {
  return description.replace(COMPAT_SUFFIX_PATTERN, '');
}

function nameFromPath(filePath: string): string {
  const base = normalizeSlashes(filePath).split('/').pop() ?? '';
  return base.replace(/\.md$/i, '');
}

function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

type CursorAgentVaultAdapter = {
  exists(p: string): Promise<boolean>;
  read(p: string): Promise<string>;
  write(p: string, content: string): Promise<void>;
  delete(p: string): Promise<void>;
  listFiles(folder: string): Promise<string[]>;
  ensureFolder(p: string): Promise<void>;
};

type CursorAgentHomeAdapter = {
  exists(p: string): Promise<boolean>;
  read(p: string): Promise<string>;
  write(p: string, content: string): Promise<void>;
  delete(p: string): Promise<void>;
  listFiles(folder: string): Promise<string[]>;
  ensureFolder(p: string): Promise<void>;
};

export class CursorAgentStorage {
  constructor(
    private readonly vaultAdapter: CursorAgentVaultAdapter,
    private readonly homeAdapter: CursorAgentHomeAdapter,
  ) {}

  /**
   * Scan order encodes precedence (later wins on name conflict), matching
   * Cursor's own loading: compat root, then user-global, then project.
   */
  async loadAll(): Promise<CursorAgentDefinition[]> {
    const byName = new Map<string, CursorAgentDefinition>();
    const collect = (agents: CursorAgentDefinition[]) => {
      for (const agent of agents) {
        const key = agent.name.toLowerCase();
        byName.delete(key);
        byName.set(key, agent);
      }
    };

    collect(await this.scanVaultRoot(CLAUDE_AGENT_COMPAT_ROOT, 'claude-compat'));
    collect(await this.scanHomeRoot());
    collect(await this.scanVaultRoot(CURSOR_AGENT_VAULT_ROOT, 'vault'));

    return Array.from(byName.values());
  }

  async save(agent: CursorAgentDefinition, previous?: CursorAgentDefinition | null): Promise<void> {
    const adapter = this.writableAdapterFor(agent.source);
    const targetPath = this.targetPathFor(agent, previous);
    await adapter.ensureFolder(folderOf(targetPath));
    await adapter.write(targetPath, serializeCursorAgentMarkdown(agent));

    if (!previous) return;
    const previousAdapter = this.writableAdapterFor(previous.source);
    const previousPath = this.editablePath(previous);
    if (previous.source === agent.source && previousPath === targetPath) return;

    await previousAdapter.delete(previousPath);
    // A case-only rename (e.g. "Foo" -> "foo") leaves previousPath and targetPath
    // aliasing the same file on case-insensitive filesystems (Windows, default
    // macOS), so the delete above also removed what we just wrote. Restore it; on
    // case-sensitive filesystems targetPath is a distinct file that still exists,
    // so this is a no-op.
    if (previous.source === agent.source && !(await adapter.exists(targetPath))) {
      await adapter.write(targetPath, serializeCursorAgentMarkdown(agent));
    }
  }

  /**
   * True when persisting `agent` would overwrite a *different* on-disk agent at
   * its target (source, name). Catches source moves and renames onto the
   * same-name entries that loadAll() hides via name de-duplication (e.g. a vault
   * agent shadowing a same-named global one), which the settings list's
   * visible-conflict check cannot see.
   */
  async wouldOverwriteDifferentAgent(
    agent: CursorAgentDefinition,
    previous?: CursorAgentDefinition | null,
  ): Promise<boolean> {
    const targetPath = this.targetPathFor(agent, previous);
    if (!(await this.writableAdapterFor(agent.source).exists(targetPath))) return false;
    if (!previous) return true;
    // An in-place edit or case-only rename keeps the same on-disk file, so it is
    // not a clobber; anything else writing onto an existing target is.
    const previousPath = this.editablePath(previous);
    return previous.source !== agent.source
      || previousPath.toLowerCase() !== targetPath.toLowerCase();
  }

  async delete(agent: CursorAgentDefinition): Promise<void> {
    const adapter = this.writableAdapterFor(agent.source);
    await adapter.delete(this.editablePath(agent));
  }

  private targetPathFor(
    agent: CursorAgentDefinition,
    previous?: CursorAgentDefinition | null,
  ): string {
    // The persisted location only survives when name and source are unchanged;
    // renames and vault<->global moves re-derive the path from the new name.
    return previous && previous.source === agent.source && previous.name === agent.name
      ? this.editablePath(previous)
      : `${this.rootFor(agent.source)}/${agent.name}.md`;
  }

  private writableAdapterFor(source: CursorAgentDefinition['source']): CursorAgentVaultAdapter | CursorAgentHomeAdapter {
    if (source === 'vault') return this.vaultAdapter;
    if (source === 'global') return this.homeAdapter;
    throw new Error(`Cursor ${source} agents are read-only`);
  }

  private rootFor(source: CursorAgentDefinition['source']): string {
    return source === 'global' ? CURSOR_AGENT_HOME_ROOT : CURSOR_AGENT_VAULT_ROOT;
  }

  private editablePath(agent: CursorAgentDefinition): string {
    const persisted = parseCursorAgentPersistenceKey(agent.persistenceKey);
    if (persisted && persisted.source === agent.source) return persisted.filePath;
    return `${this.rootFor(agent.source)}/${agent.name}.md`;
  }

  private async scanVaultRoot(
    root: string,
    source: Exclude<CursorAgentFileSource, 'global'>,
  ): Promise<CursorAgentDefinition[]> {
    try {
      return await parseAgentFiles(
        // Flat scan only: Cursor discovers agents directly under the root, not in
        // nested subfolders — matching the flat ~/.cursor/agents scan and Cursor's
        // own discovery, so we don't advertise agents the runtime won't load.
        (await this.vaultAdapter.listFiles(root)).filter((p) => p.endsWith('.md')),
        (p) => this.vaultAdapter.read(p),
        source,
      );
    } catch {
      return [];
    }
  }

  private async scanHomeRoot(): Promise<CursorAgentDefinition[]> {
    try {
      return await parseAgentFiles(
        (await this.homeAdapter.listFiles(CURSOR_AGENT_HOME_ROOT)).filter((p) => p.endsWith('.md')),
        (p) => this.homeAdapter.read(p),
        'global',
      );
    } catch {
      return [];
    }
  }
}

async function parseAgentFiles(
  filePaths: string[],
  read: (p: string) => Promise<string>,
  source: CursorAgentFileSource,
): Promise<CursorAgentDefinition[]> {
  const agents: CursorAgentDefinition[] = [];
  for (const filePath of filePaths) {
    try {
      const agent = parseCursorAgentMarkdown(await read(filePath), filePath, source);
      if (agent) agents.push(agent);
    } catch {
      // Skip unreadable/malformed files; the rest of the scan still succeeds.
    }
  }
  return agents;
}

function folderOf(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx >= 0 ? filePath.slice(0, idx) : '';
}

/** File agents shadow builtins by name (project definitions win). */
export async function loadCursorAgentsWithBuiltins(
  storage: Pick<CursorAgentStorage, 'loadAll'>,
): Promise<CursorAgentDefinition[]> {
  const fileAgents = await storage.loadAll();
  const taken = new Set(fileAgents.map((a) => a.name.toLowerCase()));
  return [
    ...fileAgents,
    ...CURSOR_BUILTIN_AGENTS.filter((a) => !taken.has(a.name.toLowerCase())),
  ];
}
