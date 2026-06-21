// src/features/tools/ClaudianToolRegistry.ts
import { z } from 'zod';

import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import type { ClaudianToolModule, LoadedTool } from './toolTypes';

export const TOOLS_DIR = '.claudian/tools';

export interface ToolRegistryDeps {
  transpile: (source: string) => string;
  /** Resolve a bare import id to a module; return undefined to fall through. */
  requireResolve: (id: string) => unknown;
}

function evaluateModule(js: string, requireResolve: (id: string) => unknown): unknown {
  const requireShim = (id: string): unknown => {
    // `claudian/tools` is the plugin's bundled re-export of zod: authored tools
    // write `import { z } from 'claudian/tools'`. Both ids resolve to zod.
    if (id === 'claudian/tools' || id === 'zod') {
      return requireResolve(id) ?? requireResolve('zod') ?? { z };
    }
    const resolved = requireResolve(id);
    if (resolved !== undefined) return resolved;
    const globalRequire = (window as { require?: (id: string) => unknown }).require;
    if (globalRequire) return globalRequire(id);
    throw new Error(`Cannot resolve module '${id}'`);
  };
  const module = { exports: {} as Record<string, unknown> };
  const fn = new Function('module', 'exports', 'require', 'Z', `${js}\n//# sourceURL=claudian-tool`);
  const zodModule = requireResolve('zod') ?? { z };
  // Expose zod as `Z` global: if the resolved module has a `z` property (named export shape),
  // use that; otherwise assume the resolved value is the zod namespace directly.
  const zodZ = (zodModule as { z?: unknown }).z ?? zodModule ?? z;
  fn(module, module.exports, requireShim, zodZ);
  return (module.exports as { default?: unknown }).default ?? module.exports;
}

// Tool names are spliced into the MCP id `mcp__claudian__<name>`, where `__`
// separates the segments. Restrict to a conservative identifier set so a name
// can't introduce a separator, whitespace, or path-like character that would
// reshape the exposed tool id the provider matches against.
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const MAX_TOOL_NAME_LENGTH = 64;

function assertManifestValid(m: Partial<ClaudianToolModule['manifest']>): void {
  if (typeof m.name !== 'string' || !m.name) throw new Error('manifest.name is required.');
  if (m.name.length > MAX_TOOL_NAME_LENGTH) {
    throw new Error(`manifest.name must be ${MAX_TOOL_NAME_LENGTH} characters or fewer.`);
  }
  if (!TOOL_NAME_PATTERN.test(m.name)) {
    throw new Error('manifest.name must match [a-zA-Z0-9][a-zA-Z0-9_-]* (no dots, spaces, or separators).');
  }
  if (typeof m.description !== 'string') throw new Error('manifest.description is required.');
  if (!m.input || typeof (m.input as { safeParse?: unknown }).safeParse !== 'function') {
    throw new Error('manifest.input must be a zod object schema.');
  }
}

function validateModule(value: unknown): ClaudianToolModule {
  const mod = value as Partial<ClaudianToolModule>;
  if (!mod || typeof mod !== 'object' || !mod.manifest) {
    throw new Error('Tool module is missing a `manifest` export.');
  }
  assertManifestValid(mod.manifest);
  if (typeof mod.handler !== 'function') throw new Error('handler must be a function.');
  return mod as ClaudianToolModule;
}

export class ClaudianToolRegistry {
  private tools = new Map<string, LoadedTool>();

  constructor(
    private readonly adapter: VaultFileAdapter,
    private readonly deps: ToolRegistryDeps,
  ) {}

  async load(): Promise<void> {
    this.tools.clear();
    if (!(await this.adapter.exists(TOOLS_DIR))) return;
    const dirs = await this.adapter.listFolders(TOOLS_DIR);
    // Two tools declaring the same `manifest.name` would collide as one
    // `mcp__claudian__<name>` id — the provider would see only one and silently
    // route every call to whichever registered last. Flag the later one instead.
    const claimedNames = new Map<string, string>();
    for (const dir of dirs) {
      const id = dir.split('/').pop() ?? dir;
      const entryPath = `${dir}/tool.ts`;
      try {
        const source = await this.adapter.read(entryPath);
        const js = this.deps.transpile(source);
        const evaluated = evaluateModule(js, this.deps.requireResolve);
        const module = validateModule(evaluated);
        const owner = claimedNames.get(module.manifest.name);
        if (owner) {
          throw new Error(`Tool name '${module.manifest.name}' is already used by '${owner}'.`);
        }
        claimedNames.set(module.manifest.name, id);
        const jsonSchema = z.toJSONSchema(module.manifest.input) as Record<string, unknown>;
        this.tools.set(id, { id, module, jsonSchema });
      } catch (err) {
        this.tools.set(id, { id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  list(): LoadedTool[] {
    return [...this.tools.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): LoadedTool | undefined {
    return this.tools.get(id);
  }
}
