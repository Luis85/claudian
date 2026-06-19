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

function assertManifestValid(m: Partial<ClaudianToolModule['manifest']>): void {
  if (typeof m.name !== 'string' || !m.name) throw new Error('manifest.name is required.');
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
    for (const dir of dirs) {
      const id = dir.split('/').pop() ?? dir;
      const entryPath = `${dir}/tool.ts`;
      try {
        const source = await this.adapter.read(entryPath);
        const js = this.deps.transpile(source);
        const evaluated = evaluateModule(js, this.deps.requireResolve);
        const module = validateModule(evaluated);
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
