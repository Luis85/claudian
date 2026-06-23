# Agent Roster, Tools & Skills — Implementation Plan (Increment 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a provider-agnostic Agent Roster plus a user-authored Tool Library and a Skill Library, each in its own dedicated Obsidian view, with user tools exposed to Claude via an in-process MCP server.

**Architecture:** Three plugin-owned, provider-neutral registries backed by vault JSON / TS files (`.claudian/agents/*.json`, `.claudian/tools/<id>/tool.ts`), surfaced in three `ItemView`s. User tools are authored as a TypeScript `{ manifest, handler }` module, transpiled at runtime with **sucrase**, validated with **zod**, and registered as an in-process Claude Agent SDK MCP server (`createSdkMcpServer`/`tool`). The Roster detail view grants tools/skills to an agent by storing their ids on the `RosterAgent`.

**Tech Stack:** TypeScript, Obsidian API, Jest (ts-jest, jsdom), `@anthropic-ai/claude-agent-sdk` (already a dep), `zod` + `sucrase` (added here). Path alias `@/` → `src/`.

**Scope note:** This is one increment spanning three subsystems, sequenced Part A → D. Each Part is independently testable. Deliberately **out of scope** for this increment (separate later plans): the stdio MCP tier for Codex/Cursor/Opencode, canonical `.claudian/skills` + provider projection, work-order loop controls, and the cross-provider model picker. Tools reach **Claude** this increment; other providers come with the stdio tier.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/features/agents/roster/rosterTypes.ts` | `RosterAgent` type + id/slug helpers |
| `src/features/agents/roster/AgentRosterStore.ts` | CRUD over `.claudian/agents/*.json` |
| `src/features/agents/roster/rosterCapabilities.ts` | pure helpers: tool→capability id, default agent factory |
| `src/features/agents/roster/view/AgentRosterView.ts` | dedicated Roster `ItemView` (list + detail editor) |
| `src/features/tools/toolTypes.ts` | `ClaudianToolModule`/manifest/`LoadedTool`/`ToolHostContext` |
| `src/features/tools/transpile.ts` | sucrase TS→CJS wrapper |
| `src/features/tools/ClaudianToolRegistry.ts` | discover/transpile/eval/validate/list user tools |
| `src/features/tools/host/InProcessToolMcpServer.ts` | build a Claude SDK in-process MCP server from the registry |
| `src/features/tools/view/ToolLibraryView.ts` | dedicated Tool Library `ItemView` (list + editor + test-run) |
| `src/features/skills/skillLibraryRows.ts` | pure helper mapping `SkillTabEntry[]`→library rows |
| `src/features/skills/view/SkillLibraryView.ts` | dedicated Skill Library `ItemView` (list + CRUD) |
| `src/features/agents/events.ts` | `AgentsEventMap` (`roster:changed`, `toolLibrary:changed`) |
| `src/app/events/claudianEvents.ts` | **modify**: compose `AgentsEventMap` |
| `src/providers/claude/runtime/ClaudeQueryOptionsBuilder.ts` | **modify**: merge the in-process tool server into `options.mcpServers` |
| `src/main.ts` | **modify**: construct registries, register 3 views, ribbon+commands, provide tool server |
| `tests/unit/features/**` | mirrored unit tests |

---

## Task 0: Add runtime dependencies

**Files:**
- Modify: `package.json` (dependencies)

- [ ] **Step 1: Install zod and sucrase as runtime deps**

Run:
```bash
npm install zod@^4 sucrase@^3
```
Expected: `package.json` `dependencies` gains `"zod": "^4.x"` and `"sucrase": "^3.x"`; `package-lock.json` updates.

- [ ] **Step 2: Verify zod v4 exposes `z.toJSONSchema`**

Run:
```bash
node -e "const {z}=require('zod'); console.log(typeof z.toJSONSchema)"
```
Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add zod and sucrase for user tool authoring"
```

---

## Part A — Agent Roster core

### Task A1: Roster event keys

**Files:**
- Create: `src/features/agents/events.ts`
- Modify: `src/app/events/claudianEvents.ts`

- [ ] **Step 1: Create the events map**

```typescript
// src/features/agents/events.ts
export interface AgentsEventMap {
  'roster:changed': void;
  'toolLibrary:changed': void;
}
```

- [ ] **Step 2: Compose it into `ClaudianEventMap`**

Open `src/app/events/claudianEvents.ts`. Add the import and extend the intersection:

```typescript
import type { AgentsEventMap } from '../../features/agents/events';
// …existing imports…

export type ClaudianEventMap = ChatEventMap
  & QuickActionsEventMap
  & SettingsEventMap
  & TaskEventMap
  & UsageEventMap
  & AgentsEventMap;
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/features/agents/events.ts src/app/events/claudianEvents.ts
git commit -m "feat(agents): add roster/toolLibrary event keys"
```

### Task A2: `RosterAgent` type + helpers

**Files:**
- Create: `src/features/agents/roster/rosterTypes.ts`
- Create: `src/features/agents/roster/rosterCapabilities.ts`
- Test: `tests/unit/features/agents/roster/rosterCapabilities.test.ts`

- [ ] **Step 1: Write the type**

```typescript
// src/features/agents/roster/rosterTypes.ts
import type { ProviderId } from '../../../core/providers/types';

export interface RosterAgentModelSelection {
  modelId: string;
  providerId: ProviderId;
}

export interface RosterAgent {
  id: string;                 // `roster:<slug>`
  name: string;
  description: string;        // routing blurb
  prompt: string;             // system prompt
  tools: string[];            // granted capability ids (e.g. `mcp__claudian__search_tasks`, `Read`)
  disallowedTools: string[];
  skills: string[];           // skill names from the skill catalog
  providerOverride?: ProviderId;
  modelSelection?: RosterAgentModelSelection;
  permissionMode?: string;
  roles: Array<'worker' | 'verifier'>;
  color?: string;
  initials?: string;
  icon?: string;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 2: Write the failing test for helpers**

```typescript
// tests/unit/features/agents/roster/rosterCapabilities.test.ts
import {
  CLAUDIAN_TOOL_MCP_PREFIX,
  toolCapabilityId,
  rosterIdFromSlug,
  slugifyRosterName,
  createRosterAgent,
} from '@/features/agents/roster/rosterCapabilities';

describe('rosterCapabilities', () => {
  it('builds the mcp capability id for a user tool', () => {
    expect(toolCapabilityId('search_tasks')).toBe('mcp__claudian__search_tasks');
    expect(CLAUDIAN_TOOL_MCP_PREFIX).toBe('mcp__claudian__');
  });

  it('slugifies a name and forms a roster id', () => {
    expect(slugifyRosterName('My Cool Agent!')).toBe('my-cool-agent');
    expect(rosterIdFromSlug('my-cool-agent')).toBe('roster:my-cool-agent');
  });

  it('creates a default agent with required fields', () => {
    const a = createRosterAgent('Reviewer', 1000);
    expect(a.id).toBe('roster:reviewer');
    expect(a.name).toBe('Reviewer');
    expect(a.roles).toEqual(['worker']);
    expect(a.tools).toEqual([]);
    expect(a.skills).toEqual([]);
    expect(a.createdAt).toBe(1000);
    expect(a.updatedAt).toBe(1000);
  });
});
```

- [ ] **Step 3: Run it to verify failure**

Run: `npm run test -- --selectProjects unit -t rosterCapabilities`
Expected: FAIL ("Cannot find module '@/features/agents/roster/rosterCapabilities'").

- [ ] **Step 4: Implement the helpers**

```typescript
// src/features/agents/roster/rosterCapabilities.ts
import type { RosterAgent } from './rosterTypes';

export const CLAUDIAN_TOOL_MCP_PREFIX = 'mcp__claudian__';

export function toolCapabilityId(toolName: string): string {
  return `${CLAUDIAN_TOOL_MCP_PREFIX}${toolName}`;
}

export function slugifyRosterName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function rosterIdFromSlug(slug: string): string {
  return `roster:${slug}`;
}

export function createRosterAgent(name: string, now: number): RosterAgent {
  const slug = slugifyRosterName(name) || 'agent';
  return {
    id: rosterIdFromSlug(slug),
    name,
    description: '',
    prompt: '',
    tools: [],
    disallowedTools: [],
    skills: [],
    roles: ['worker'],
    createdAt: now,
    updatedAt: now,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- --selectProjects unit -t rosterCapabilities`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/agents/roster/rosterTypes.ts src/features/agents/roster/rosterCapabilities.ts tests/unit/features/agents/roster/rosterCapabilities.test.ts
git commit -m "feat(agents): RosterAgent type and capability helpers"
```

### Task A3: `AgentRosterStore`

**Files:**
- Create: `src/features/agents/roster/AgentRosterStore.ts`
- Test: `tests/unit/features/agents/roster/AgentRosterStore.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/features/agents/roster/AgentRosterStore.test.ts
import { AgentRosterStore, ROSTER_DIR } from '@/features/agents/roster/AgentRosterStore';
import { createRosterAgent } from '@/features/agents/roster/rosterCapabilities';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

function makeAdapter(files: Record<string, string>) {
  return {
    ensureFolder: jest.fn().mockResolvedValue(undefined),
    listFiles: jest.fn(async (dir: string) =>
      Object.keys(files).filter((p) => p.startsWith(`${dir}/`)),
    ),
    read: jest.fn(async (p: string) => files[p]),
    write: jest.fn(async (p: string, c: string) => { files[p] = c; }),
    exists: jest.fn(async (p: string) => p in files),
    delete: jest.fn(async (p: string) => { delete files[p]; }),
  } as unknown as VaultFileAdapter;
}

describe('AgentRosterStore', () => {
  it('saves an agent as JSON under the roster dir', async () => {
    const files: Record<string, string> = {};
    const adapter = makeAdapter(files);
    const store = new AgentRosterStore(adapter);
    const agent = createRosterAgent('Reviewer', 1);

    await store.save(agent);

    expect(adapter.ensureFolder).toHaveBeenCalledWith(ROSTER_DIR);
    expect(files[`${ROSTER_DIR}/reviewer.json`]).toContain('"name": "Reviewer"');
  });

  it('lists saved agents', async () => {
    const agent = createRosterAgent('Reviewer', 1);
    const files = { [`${ROSTER_DIR}/reviewer.json`]: JSON.stringify(agent) };
    const store = new AgentRosterStore(makeAdapter(files));

    const all = await store.list();

    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('roster:reviewer');
  });

  it('skips malformed json files', async () => {
    const files = { [`${ROSTER_DIR}/bad.json`]: '{not json' };
    const store = new AgentRosterStore(makeAdapter(files));
    await expect(store.list()).resolves.toEqual([]);
  });

  it('deletes an agent by id', async () => {
    const agent = createRosterAgent('Reviewer', 1);
    const files = { [`${ROSTER_DIR}/reviewer.json`]: JSON.stringify(agent) };
    const adapter = makeAdapter(files);
    const store = new AgentRosterStore(adapter);

    await store.delete('roster:reviewer');

    expect(adapter.delete).toHaveBeenCalledWith(`${ROSTER_DIR}/reviewer.json`);
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npm run test -- --selectProjects unit -t AgentRosterStore`
Expected: FAIL ("Cannot find module '@/features/agents/roster/AgentRosterStore'").

- [ ] **Step 3: Implement the store**

```typescript
// src/features/agents/roster/AgentRosterStore.ts
import type { EventBus } from '../../../core/events/EventBus';
import type { ClaudianEventMap } from '../../../app/events/claudianEvents';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { RosterAgent } from './rosterTypes';

export const ROSTER_DIR = '.claudian/agents';

function fileNameForId(id: string): string {
  const slug = id.startsWith('roster:') ? id.slice('roster:'.length) : id;
  return `${ROSTER_DIR}/${slug}.json`;
}

export class AgentRosterStore {
  constructor(
    private readonly adapter: VaultFileAdapter,
    private readonly events?: EventBus<ClaudianEventMap>,
  ) {}

  async list(): Promise<RosterAgent[]> {
    if (!(await this.adapter.exists(ROSTER_DIR))) return [];
    const paths = await this.adapter.listFiles(ROSTER_DIR);
    const agents: RosterAgent[] = [];
    for (const path of paths) {
      if (!path.endsWith('.json')) continue;
      try {
        agents.push(JSON.parse(await this.adapter.read(path)) as RosterAgent);
      } catch {
        // skip malformed files; the editor surfaces validation elsewhere
      }
    }
    return agents.sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<RosterAgent | null> {
    const path = fileNameForId(id);
    if (!(await this.adapter.exists(path))) return null;
    try {
      return JSON.parse(await this.adapter.read(path)) as RosterAgent;
    } catch {
      return null;
    }
  }

  async save(agent: RosterAgent): Promise<void> {
    await this.adapter.ensureFolder(ROSTER_DIR);
    await this.adapter.write(fileNameForId(agent.id), JSON.stringify(agent, null, 2));
    this.events?.emit('roster:changed');
  }

  async delete(id: string): Promise<void> {
    const path = fileNameForId(id);
    if (await this.adapter.exists(path)) {
      await this.adapter.delete(path);
    }
    this.events?.emit('roster:changed');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- --selectProjects unit -t AgentRosterStore`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/agents/roster/AgentRosterStore.ts tests/unit/features/agents/roster/AgentRosterStore.test.ts
git commit -m "feat(agents): AgentRosterStore JSON CRUD over .claudian/agents"
```

---

## Part B — Tool Library core + Claude exposure

### Task B1: Tool types

**Files:**
- Create: `src/features/tools/toolTypes.ts`

- [ ] **Step 1: Write the types**

```typescript
// src/features/tools/toolTypes.ts
import type { App } from 'obsidian';
import type { z } from 'zod';

export interface ToolTextResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ClaudianToolManifest {
  name: string;                       // -> mcp__claudian__<name>
  description: string;
  input: z.ZodObject<z.ZodRawShape>;  // single schema -> validation + JSON schema
  output?: z.ZodTypeAny;
}

export interface ToolHostContext {
  app: App;
  signal: AbortSignal;
}

export interface ClaudianToolModule {
  manifest: ClaudianToolManifest;
  handler: (
    args: unknown,
    ctx: ToolHostContext,
  ) => Promise<ToolTextResult> | ToolTextResult;
}

export interface LoadedTool {
  id: string;                          // tool directory name
  module?: ClaudianToolModule;
  jsonSchema?: Record<string, unknown>;
  error?: string;                      // transpile/eval/validation error, for the UI
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/tools/toolTypes.ts
git commit -m "feat(tools): ClaudianTool manifest+handler types"
```

### Task B2: Sucrase transpile wrapper

**Files:**
- Create: `src/features/tools/transpile.ts`
- Test: `tests/unit/features/tools/transpile.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/features/tools/transpile.test.ts
import { transpileToolSource } from '@/features/tools/transpile';

describe('transpileToolSource', () => {
  it('strips TypeScript types', () => {
    const out = transpileToolSource('const x: number = 1; export default x;');
    expect(out).not.toContain(': number');
    expect(out).toContain('1');
  });

  it('converts esm imports/exports to commonjs', () => {
    const out = transpileToolSource(
      "import { z } from 'zod';\nexport default { z };",
    );
    expect(out).toContain('require');
    expect(out).toContain('exports');
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npm run test -- --selectProjects unit -t transpileToolSource`
Expected: FAIL ("Cannot find module '@/features/tools/transpile'").

- [ ] **Step 3: Implement the wrapper**

```typescript
// src/features/tools/transpile.ts
import { transform } from 'sucrase';

export function transpileToolSource(source: string): string {
  return transform(source, {
    transforms: ['typescript', 'imports'],
    filePath: 'tool.ts',
  }).code;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- --selectProjects unit -t transpileToolSource`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tools/transpile.ts tests/unit/features/tools/transpile.test.ts
git commit -m "feat(tools): runtime TS->CJS transpile via sucrase"
```

### Task B3: `ClaudianToolRegistry`

The registry discovers `.claudian/tools/<id>/tool.ts`, transpiles, evaluates as CommonJS with an injected `require`, validates the manifest, and builds a JSON schema. `transpile` and `requireResolve` are injected for testability.

**Files:**
- Create: `src/features/tools/ClaudianToolRegistry.ts`
- Test: `tests/unit/features/tools/ClaudianToolRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/features/tools/ClaudianToolRegistry.test.ts
import { z } from 'zod';
import { ClaudianToolRegistry, TOOLS_DIR } from '@/features/tools/ClaudianToolRegistry';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

const TOOL_SRC = `
module.exports.default = {
  manifest: {
    name: 'echo',
    description: 'echoes input',
    input: Z.object({ text: Z.string() }),
  },
  handler: async (args) => ({ content: [{ type: 'text', text: args.text }] }),
};
`;

function makeAdapter(files: Record<string, string>, folders: Record<string, string[]>) {
  return {
    exists: jest.fn(async (p: string) => p in files || p in folders),
    listFolders: jest.fn(async (dir: string) => folders[dir] ?? []),
    read: jest.fn(async (p: string) => files[p]),
  } as unknown as VaultFileAdapter;
}

describe('ClaudianToolRegistry', () => {
  it('loads, validates, and exposes a tool with a json schema', async () => {
    const files = { [`${TOOLS_DIR}/echo/tool.ts`]: TOOL_SRC };
    const folders = { [TOOLS_DIR]: [`${TOOLS_DIR}/echo`] };
    const registry = new ClaudianToolRegistry(makeAdapter(files, folders), {
      transpile: (src) => src, // already CJS in the fixture
      requireResolve: (id) => (id === 'zod' ? { z } : undefined),
    });

    await registry.load();
    const tools = registry.list();

    expect(tools).toHaveLength(1);
    expect(tools[0].id).toBe('echo');
    expect(tools[0].error).toBeUndefined();
    expect(tools[0].module?.manifest.name).toBe('echo');
    expect(tools[0].jsonSchema).toHaveProperty('type', 'object');
  });

  it('records an error for a tool whose default export lacks a manifest', async () => {
    const files = { [`${TOOLS_DIR}/broken/tool.ts`]: 'module.exports.default = {};' };
    const folders = { [TOOLS_DIR]: [`${TOOLS_DIR}/broken`] };
    const registry = new ClaudianToolRegistry(makeAdapter(files, folders), {
      transpile: (src) => src,
      requireResolve: () => undefined,
    });

    await registry.load();

    expect(registry.list()[0].error).toMatch(/manifest/i);
  });

  it('returns empty when the tools dir is absent', async () => {
    const registry = new ClaudianToolRegistry(makeAdapter({}, {}), {
      transpile: (src) => src,
      requireResolve: () => undefined,
    });
    await registry.load();
    expect(registry.list()).toEqual([]);
  });
});
```

> Note: the fixture uses `Z.object` and the test injects `requireResolve('zod') -> { z }`; the registry exposes the resolved `zod` module to evaluated code under the global name `Z` (see implementation). Real authored tools write `import { z } from 'zod'`, which sucrase rewrites to `require('zod')`.

- [ ] **Step 2: Run it to verify failure**

Run: `npm run test -- --selectProjects unit -t ClaudianToolRegistry`
Expected: FAIL ("Cannot find module '@/features/tools/ClaudianToolRegistry'").

- [ ] **Step 3: Implement the registry**

```typescript
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
    const globalRequire = (globalThis as { require?: (id: string) => unknown }).require;
    if (globalRequire) return globalRequire(id);
    throw new Error(`Cannot resolve module '${id}'`);
  };
  const module = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line no-new-func -- intentional user-tool execution (full-trust, documented)
  const fn = new Function('module', 'exports', 'require', 'Z', `${js}\n//# sourceURL=claudian-tool`);
  fn(module, module.exports, requireShim, requireResolve('zod') ?? { z });
  return (module.exports as { default?: unknown }).default ?? module.exports;
}

function validateModule(value: unknown): ClaudianToolModule {
  const mod = value as Partial<ClaudianToolModule>;
  if (!mod || typeof mod !== 'object' || !mod.manifest) {
    throw new Error('Tool module is missing a `manifest` export.');
  }
  const m = mod.manifest;
  if (typeof m.name !== 'string' || !m.name) throw new Error('manifest.name is required.');
  if (typeof m.description !== 'string') throw new Error('manifest.description is required.');
  if (!m.input || typeof (m.input as { safeParse?: unknown }).safeParse !== 'function') {
    throw new Error('manifest.input must be a zod object schema.');
  }
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- --selectProjects unit -t ClaudianToolRegistry`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tools/ClaudianToolRegistry.ts tests/unit/features/tools/ClaudianToolRegistry.test.ts
git commit -m "feat(tools): ClaudianToolRegistry discover/transpile/validate"
```

### Task B4: In-process Claude MCP server

**Files:**
- Create: `src/features/tools/host/InProcessToolMcpServer.ts`
- Test: `tests/unit/features/tools/host/InProcessToolMcpServer.test.ts`

- [ ] **Step 1: Write the failing test (mock the SDK)**

```typescript
// tests/unit/features/tools/host/InProcessToolMcpServer.test.ts
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: jest.fn((name: string) => ({ __tool: name })),
  createSdkMcpServer: jest.fn((cfg: unknown) => ({ __server: cfg })),
}));

import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { buildClaudianToolMcpServer } from '@/features/tools/host/InProcessToolMcpServer';
import type { LoadedTool } from '@/features/tools/toolTypes';

describe('buildClaudianToolMcpServer', () => {
  it('registers one SDK tool per error-free loaded tool', () => {
    const loaded: LoadedTool[] = [
      {
        id: 'echo',
        module: {
          manifest: { name: 'echo', description: 'd', input: z.object({ text: z.string() }) },
          handler: async (a) => ({ content: [{ type: 'text', text: String((a as { text: string }).text) }] }),
        },
        jsonSchema: {},
      },
      { id: 'broken', error: 'bad' },
    ];

    buildClaudianToolMcpServer(loaded, () => ({ app: {} as never, signal: new AbortController().signal }));

    expect(tool).toHaveBeenCalledTimes(1);
    expect((tool as jest.Mock).mock.calls[0][0]).toBe('echo');
    expect(createSdkMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'claudian' }),
    );
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npm run test -- --selectProjects unit -t buildClaudianToolMcpServer`
Expected: FAIL ("Cannot find module '@/features/tools/host/InProcessToolMcpServer'").

- [ ] **Step 3: Implement the host builder**

```typescript
// src/features/tools/host/InProcessToolMcpServer.ts
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { LoadedTool, ToolHostContext, ToolTextResult } from '../toolTypes';

export const CLAUDIAN_TOOL_SERVER_NAME = 'claudian';

export function buildClaudianToolMcpServer(
  loaded: LoadedTool[],
  ctxFactory: () => ToolHostContext,
): ReturnType<typeof createSdkMcpServer> {
  const tools = loaded
    .filter((t): t is LoadedTool & { module: NonNullable<LoadedTool['module']> } => !!t.module && !t.error)
    .map((t) =>
      tool(
        t.module.manifest.name,
        t.module.manifest.description,
        t.module.manifest.input.shape,
        async (args: unknown) => {
          const result: ToolTextResult = await t.module.handler(args, ctxFactory());
          return result;
        },
      ),
    );

  return createSdkMcpServer({
    name: CLAUDIAN_TOOL_SERVER_NAME,
    version: '1.0.0',
    tools,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- --selectProjects unit -t buildClaudianToolMcpServer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tools/host/InProcessToolMcpServer.ts tests/unit/features/tools/host/InProcessToolMcpServer.test.ts
git commit -m "feat(tools): in-process Claude SDK MCP server from registry"
```

### Task B5: Wire the tool server into the Claude query options

**Files:**
- Modify: `src/providers/claude/runtime/ClaudeQueryOptionsBuilder.ts` (cold-start `mcpServers` assignment, ~lines 204–208)

- [ ] **Step 1: Inspect the assignment site**

Run: `npm run test -- --selectProjects unit -t ClaudeQueryOptionsBuilder` (note current passing baseline; if no such test exists, skip and rely on typecheck).
Then read lines around the `options.mcpServers = mcpServers;` assignment.

- [ ] **Step 2: Add an optional provider on the builder context and merge it**

At the cold-start build site, replace:

```typescript
const mcpServers = ctx.mcpManager.getActiveServers(combinedMentions);

if (Object.keys(mcpServers).length > 0) {
  options.mcpServers = mcpServers;
}
```

with:

```typescript
const mcpServers: Record<string, unknown> = {
  ...ctx.mcpManager.getActiveServers(combinedMentions),
};
const claudianToolServer = ctx.getClaudianToolServer?.();
if (claudianToolServer) {
  mcpServers['claudian'] = claudianToolServer;
}

if (Object.keys(mcpServers).length > 0) {
  options.mcpServers = mcpServers as typeof options.mcpServers;
}
```

- [ ] **Step 3: Add `getClaudianToolServer` to the cold-start context type**

In the same file, find the interface describing the cold-start `ctx` (the object exposing `mcpManager`). Add:

```typescript
  /** Optional in-process Claudian user-tool MCP server (Claude only). */
  getClaudianToolServer?: () => unknown;
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (The `unknown` cast keeps the SDK `mcpServers` union — which already includes the `sdk` variant — satisfied.)

- [ ] **Step 5: Commit**

```bash
git add src/providers/claude/runtime/ClaudeQueryOptionsBuilder.ts
git commit -m "feat(claude): merge in-process Claudian tool MCP server into query options"
```

> Plumbing the `getClaudianToolServer` callback from the plugin down to the builder context happens in Task D4, where the registry and server exist.

---

## Part C — Skill Library (view over existing catalog)

This increment reuses the existing `VaultSkillAggregator` (discovery) and Claude `ProviderCommandCatalog` (CRUD). Only a pure row-mapper is new logic.

### Task C1: Skill library row mapper

**Files:**
- Create: `src/features/skills/skillLibraryRows.ts`
- Test: `tests/unit/features/skills/skillLibraryRows.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/features/skills/skillLibraryRows.test.ts
import { toSkillLibraryRows } from '@/features/skills/skillLibraryRows';
import type { SkillTabEntry } from '@/features/quickActions/skills/types';

const entry = (over: Partial<SkillTabEntry>): SkillTabEntry => ({
  id: 'claude:tdd',
  providerId: 'claude',
  providerDisplayName: 'Claude',
  name: 'tdd',
  description: 'Test-driven dev',
  insertPrefix: '$',
  sourceFilePath: '.claude/skills/tdd/SKILL.md',
  providerEnabled: true,
  ...over,
});

describe('toSkillLibraryRows', () => {
  it('marks file-backed entries editable and runtime entries read-only', () => {
    const rows = toSkillLibraryRows([
      entry({ id: 'claude:tdd', sourceFilePath: '.claude/skills/tdd/SKILL.md' }),
      entry({ id: 'opencode:x', providerId: 'opencode', sourceFilePath: null }),
    ]);
    expect(rows.find((r) => r.id === 'claude:tdd')?.editable).toBe(true);
    expect(rows.find((r) => r.id === 'opencode:x')?.editable).toBe(false);
  });

  it('sorts by name', () => {
    const rows = toSkillLibraryRows([
      entry({ id: 'b', name: 'beta' }),
      entry({ id: 'a', name: 'alpha' }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(['alpha', 'beta']);
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npm run test -- --selectProjects unit -t toSkillLibraryRows`
Expected: FAIL ("Cannot find module '@/features/skills/skillLibraryRows'").

- [ ] **Step 3: Implement the mapper**

```typescript
// src/features/skills/skillLibraryRows.ts
import type { SkillTabEntry } from '../quickActions/skills/types';

export interface SkillLibraryRow {
  id: string;
  name: string;
  description: string;
  providerDisplayName: string;
  sourceFilePath: string | null;
  editable: boolean;
}

export function toSkillLibraryRows(entries: SkillTabEntry[]): SkillLibraryRow[] {
  return entries
    .map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      providerDisplayName: e.providerDisplayName,
      sourceFilePath: e.sourceFilePath,
      editable: e.sourceFilePath !== null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- --selectProjects unit -t toSkillLibraryRows`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/skills/skillLibraryRows.ts tests/unit/features/skills/skillLibraryRows.test.ts
git commit -m "feat(skills): skill library row mapper"
```

---

## Part D — Dedicated views, pickers, and plugin wiring

> UI views are verified manually in Obsidian (the codebase does not unit-test `ItemView`s). Each task ends with a typecheck + lint + build, then a manual verification checklist.

### Task D1: Agent Roster view

**Files:**
- Create: `src/features/agents/roster/view/AgentRosterView.ts`

- [ ] **Step 1: Implement the view (list + detail editor with tool/skill pickers)**

```typescript
// src/features/agents/roster/view/AgentRosterView.ts
import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type ClaudianPlugin from '../../../../main';
import { AgentRosterStore } from '../AgentRosterStore';
import { createRosterAgent, toolCapabilityId } from '../rosterCapabilities';
import type { RosterAgent } from '../rosterTypes';

export const VIEW_TYPE_AGENT_ROSTER = 'claudian-agent-roster';

export class AgentRosterView extends ItemView {
  private store: AgentRosterStore;

  constructor(leaf: WorkspaceLeaf, private plugin: ClaudianPlugin) {
    super(leaf);
    this.store = new AgentRosterStore(plugin.vaultFileAdapter, plugin.events);
  }

  getViewType(): string { return VIEW_TYPE_AGENT_ROSTER; }
  getDisplayText(): string { return 'Agent Roster'; }
  getIcon(): string { return 'users'; }

  async onOpen(): Promise<void> {
    await this.renderList();
  }

  private async renderList(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('claudian-roster');
    const header = root.createDiv({ cls: 'claudian-roster-header' });
    header.createEl('h2', { text: 'Agent Roster' });
    header.createEl('button', { text: 'New Agent' }).onclick = async () => {
      const agent = createRosterAgent('New Agent', Date.now());
      await this.store.save(agent);
      await this.renderDetail(agent);
    };

    const agents = await this.store.list();
    const list = root.createDiv({ cls: 'claudian-roster-list' });
    if (agents.length === 0) {
      list.createEl('p', { text: 'No agents yet. Create one to get started.' });
    }
    for (const agent of agents) {
      const card = list.createDiv({ cls: 'claudian-roster-card' });
      card.createEl('div', { cls: 'claudian-roster-card-name', text: agent.name });
      card.createEl('div', { cls: 'claudian-roster-card-desc', text: agent.description });
      card.createEl('div', {
        cls: 'claudian-roster-card-caps',
        text: `${agent.skills.length} skills · ${agent.tools.length} tools`,
      });
      card.onclick = () => void this.renderDetail(agent);
    }
  }

  private async renderDetail(agent: RosterAgent): Promise<void> {
    const root = this.contentEl;
    root.empty();
    const back = root.createEl('button', { text: '← Back' });
    back.onclick = () => void this.renderList();

    const nameInput = this.field(root, 'Name', agent.name);
    const descInput = this.field(root, 'What it’s for', agent.description);
    const promptArea = this.textArea(root, 'Instructions', agent.prompt);

    // Skills picker
    root.createEl('h3', { text: 'Skills' });
    const skillBox = root.createDiv();
    const skillEntries = (await this.plugin.vaultSkillAggregator?.listAll()) ?? [];
    for (const s of skillEntries) {
      const label = skillBox.createEl('label');
      const cb = label.createEl('input', { type: 'checkbox' });
      cb.checked = agent.skills.includes(s.name);
      cb.onchange = () => {
        agent.skills = cb.checked
          ? [...new Set([...agent.skills, s.name])]
          : agent.skills.filter((n) => n !== s.name);
      };
      label.appendText(` ${s.name}`);
    }

    // Tools picker (user tools from the registry)
    root.createEl('h3', { text: 'Tools' });
    const toolBox = root.createDiv();
    for (const t of this.plugin.toolRegistry?.list() ?? []) {
      if (t.error || !t.module) continue;
      const cap = toolCapabilityId(t.module.manifest.name);
      const label = toolBox.createEl('label');
      const cb = label.createEl('input', { type: 'checkbox' });
      cb.checked = agent.tools.includes(cap);
      cb.onchange = () => {
        agent.tools = cb.checked
          ? [...new Set([...agent.tools, cap])]
          : agent.tools.filter((n) => n !== cap);
      };
      label.appendText(` ${t.module.manifest.name} — ${t.module.manifest.description}`);
    }

    const save = root.createEl('button', { text: 'Save' });
    save.onclick = async () => {
      agent.name = nameInput.value;
      agent.description = descInput.value;
      agent.prompt = promptArea.value;
      agent.updatedAt = Date.now();
      await this.store.save(agent);
      await this.renderList();
    };
  }

  private field(parent: HTMLElement, label: string, value: string): HTMLInputElement {
    parent.createEl('label', { text: label });
    const input = parent.createEl('input', { type: 'text' });
    input.value = value;
    return input;
  }

  private textArea(parent: HTMLElement, label: string, value: string): HTMLTextAreaElement {
    parent.createEl('label', { text: label });
    const area = parent.createEl('textarea');
    area.value = value;
    return area;
  }
}
```

- [ ] **Step 2: Typecheck** — Run: `npm run typecheck`. (Will fail until `plugin.vaultFileAdapter` and `plugin.toolRegistry` exist — added in Task D4. If running this task before D4, stub references are expected to error; complete D4 then re-run.)

- [ ] **Step 3: Commit**

```bash
git add src/features/agents/roster/view/AgentRosterView.ts
git commit -m "feat(agents): Agent Roster view with tool/skill pickers"
```

### Task D2: Tool Library view

**Files:**
- Create: `src/features/tools/view/ToolLibraryView.ts`

- [ ] **Step 1: Implement the view (list + new-tool scaffold + error display)**

```typescript
// src/features/tools/view/ToolLibraryView.ts
import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import type ClaudianPlugin from '../../../main';
import { TOOLS_DIR } from '../ClaudianToolRegistry';

export const VIEW_TYPE_TOOL_LIBRARY = 'claudian-tool-library';

const TEMPLATE = `import { z } from 'zod';

export default {
  manifest: {
    name: 'my_tool',
    description: 'Describe what this tool does and when to use it.',
    input: z.object({ text: z.string().describe('Example input') }),
  },
  handler: async (args, ctx) => {
    return { content: [{ type: 'text', text: 'You sent: ' + args.text }] };
  },
};
`;

export class ToolLibraryView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: ClaudianPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_TOOL_LIBRARY; }
  getDisplayText(): string { return 'Tool Library'; }
  getIcon(): string { return 'wrench'; }

  async onOpen(): Promise<void> {
    await this.render();
  }

  private async render(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('claudian-tool-library');
    const header = root.createDiv();
    header.createEl('h2', { text: 'Tool Library' });
    header.createEl('button', { text: 'New Tool' }).onclick = async () => {
      const adapter = this.plugin.vaultFileAdapter;
      const dir = `${TOOLS_DIR}/my-tool`;
      await adapter.ensureFolder(dir);
      const path = `${dir}/tool.ts`;
      if (!(await adapter.exists(path))) {
        await adapter.write(path, TEMPLATE);
      }
      await this.plugin.toolRegistry.load();
      new Notice(`Created ${path}. Edit it, then it loads automatically.`);
      await this.render();
    };
    header.createEl('button', { text: 'Reload' }).onclick = async () => {
      await this.plugin.toolRegistry.load();
      await this.render();
    };

    const list = root.createDiv();
    const tools = this.plugin.toolRegistry.list();
    if (tools.length === 0) list.createEl('p', { text: 'No tools yet.' });
    for (const t of tools) {
      const card = list.createDiv({ cls: 'claudian-tool-card' });
      card.createEl('div', { cls: 'claudian-tool-name', text: t.id });
      if (t.error) {
        card.createEl('div', { cls: 'claudian-tool-error', text: `Error: ${t.error}` });
      } else if (t.module) {
        card.createEl('div', { text: t.module.manifest.description });
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/tools/view/ToolLibraryView.ts
git commit -m "feat(tools): Tool Library view (list, scaffold, reload, errors)"
```

### Task D3: Skill Library view

**Files:**
- Create: `src/features/skills/view/SkillLibraryView.ts`

- [ ] **Step 1: Implement the view (list over the aggregator)**

```typescript
// src/features/skills/view/SkillLibraryView.ts
import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type ClaudianPlugin from '../../../main';
import { toSkillLibraryRows } from '../skillLibraryRows';

export const VIEW_TYPE_SKILL_LIBRARY = 'claudian-skill-library';

export class SkillLibraryView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: ClaudianPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_SKILL_LIBRARY; }
  getDisplayText(): string { return 'Skill Library'; }
  getIcon(): string { return 'book-open'; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('claudian-skill-library');
    root.createEl('h2', { text: 'Skill Library' });
    const entries = (await this.plugin.vaultSkillAggregator?.listAll()) ?? [];
    const rows = toSkillLibraryRows(entries);
    if (rows.length === 0) root.createEl('p', { text: 'No skills discovered.' });
    for (const r of rows) {
      const card = root.createDiv({ cls: 'claudian-skill-card' });
      card.createEl('div', { cls: 'claudian-skill-name', text: r.name });
      card.createEl('div', { text: r.description });
      card.createEl('div', {
        cls: 'claudian-skill-meta',
        text: `${r.providerDisplayName}${r.editable ? '' : ' · read-only'}`,
      });
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/skills/view/SkillLibraryView.ts
git commit -m "feat(skills): Skill Library view over the vault skill aggregator"
```

### Task D4: Plugin wiring (registries, views, ribbon/commands, tool server)

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Expose a `VaultFileAdapter` and the tool registry on the plugin**

In `ClaudianPlugin` class fields (near `vaultSkillAggregator`), add:

```typescript
  public vaultFileAdapter!: import('./core/storage/VaultFileAdapter').VaultFileAdapter;
  public toolRegistry!: import('./features/tools/ClaudianToolRegistry').ClaudianToolRegistry;
```

- [ ] **Step 2: Construct them in `onload` (after settings/storage are ready)**

Add (importing `VaultFileAdapter`, `ClaudianToolRegistry`, `transpileToolSource`, `buildClaudianToolMcpServer`, `z` from `zod`):

```typescript
import { z } from 'zod';
import { VaultFileAdapter } from './core/storage/VaultFileAdapter';
import { ClaudianToolRegistry } from './features/tools/ClaudianToolRegistry';
import { transpileToolSource } from './features/tools/transpile';
import { buildClaudianToolMcpServer } from './features/tools/host/InProcessToolMcpServer';
// …
this.vaultFileAdapter = new VaultFileAdapter(this.app);
this.toolRegistry = new ClaudianToolRegistry(this.vaultFileAdapter, {
  transpile: transpileToolSource,
  requireResolve: (id) => {
    if (id === 'zod' || id === 'claudian/tools') return { z };
    const req = (globalThis as { require?: (m: string) => unknown }).require;
    return req ? req(id) : undefined;
  },
});
await this.toolRegistry.load();
this.registerEvent(
  this.app.vault.on('modify', (file) => {
    if (file.path.startsWith('.claudian/tools/')) {
      void this.toolRegistry.load().then(() => this.events.emit('toolLibrary:changed'));
    }
  }),
);
```

- [ ] **Step 3: Register the three views**

```typescript
import { AgentRosterView, VIEW_TYPE_AGENT_ROSTER } from './features/agents/roster/view/AgentRosterView';
import { ToolLibraryView, VIEW_TYPE_TOOL_LIBRARY } from './features/tools/view/ToolLibraryView';
import { SkillLibraryView, VIEW_TYPE_SKILL_LIBRARY } from './features/skills/view/SkillLibraryView';
// …in onload, alongside the existing registerView calls:
this.registerView(VIEW_TYPE_AGENT_ROSTER, (leaf) => new AgentRosterView(leaf, this));
this.registerView(VIEW_TYPE_TOOL_LIBRARY, (leaf) => new ToolLibraryView(leaf, this));
this.registerView(VIEW_TYPE_SKILL_LIBRARY, (leaf) => new SkillLibraryView(leaf, this));
```

- [ ] **Step 4: Add ribbon icons + commands to open each view**

```typescript
const openView = async (viewType: string) => {
  const leaf = this.app.workspace.getLeaf('tab');
  await leaf.setViewState({ type: viewType, active: true });
  this.app.workspace.revealLeaf(leaf);
};
this.addRibbonIcon('users', 'Open Agent Roster', () => void openView(VIEW_TYPE_AGENT_ROSTER));
this.addCommand({ id: 'open-agent-roster', name: 'Open Agent Roster', callback: () => void openView(VIEW_TYPE_AGENT_ROSTER) });
this.addCommand({ id: 'open-tool-library', name: 'Open Tool Library', callback: () => void openView(VIEW_TYPE_TOOL_LIBRARY) });
this.addCommand({ id: 'open-skill-library', name: 'Open Skill Library', callback: () => void openView(VIEW_TYPE_SKILL_LIBRARY) });
```

- [ ] **Step 5: Provide the in-process tool server to the Claude runtime**

Find where the Claude provider/runtime is initialized (provider workspace services / runtime construction) and pass a `getClaudianToolServer` callback that the cold-start options builder context (Task B5) reads. Provide:

```typescript
const getClaudianToolServer = () => {
  const loaded = this.toolRegistry.list().filter((t) => t.module && !t.error);
  if (loaded.length === 0) return undefined;
  return buildClaudianToolMcpServer(loaded, () => ({
    app: this.app,
    signal: new AbortController().signal,
  }));
};
```

Thread `getClaudianToolServer` into the Claude cold-start options builder context (the object that already carries `mcpManager`) so the merge added in Task B5 resolves it.

- [ ] **Step 6: Typecheck, lint, build**

Run:
```bash
npm run typecheck && npm run lint && npm run build
```
Expected: all PASS. (Fixes any earlier cross-file references from Tasks D1–D3.)

- [ ] **Step 7: Manual verification in Obsidian**

- Reload the plugin. Confirm three commands appear: *Open Agent Roster*, *Open Tool Library*, *Open Skill Library*, and the Agent Roster ribbon icon.
- Tool Library → **New Tool** → confirm `.claudian/tools/my-tool/tool.ts` is created and appears with its description (no error). Introduce a type error in the file → **Reload** → confirm the error renders on the card.
- Skill Library → confirm existing vault skills list (and read-only entries are tagged).
- Agent Roster → **New Agent** → set name/description/instructions, tick the new tool and a skill, **Save** → reopen the agent → confirm selections persisted to `.claudian/agents/<slug>.json`.
- In a **Claude** chat, confirm `mcp__claudian__my_tool` is offered to the model (e.g. ask it to call the tool) and returns the handler's output.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire roster store, tool registry, three views, and Claude tool server"
```

---

## Self-Review

**Spec coverage** (against the roster + tool/skill specs, MVP scope):
- Roster core (type, store, dedicated view): A1–A3, D1 ✔
- Provider-neutral agent with tools/skills/roles/model fields: A2 (type) ✔ (model picker UI deferred per scope)
- User-authored tools (manifest+handler, transpile, validate, hot-reload): B1–B3, D4 ✔
- Claude in-process MCP exposure: B4–B5, D4 ✔
- Tool Library dedicated view (list/scaffold/errors/test-run): D2 ✔ (inline "test-run" button is a follow-up; scaffold+reload+error display covered)
- Skill Library dedicated view: C1, D3 ✔
- Roster detail pickers grant tools/skills: D1 ✔
- Deferred & called out: stdio tier (Codex/Cursor/Opencode), canonical `.claudian/skills`+projection, model picker, loop controls.

**Placeholder scan:** No "TBD"/"handle errors"/"similar to". The one cross-task dependency (D1/D2/D3 reference `plugin.vaultFileAdapter`/`plugin.toolRegistry`) is explicitly resolved in D4 with a note; build is run in D4 Step 6.

**Type consistency:** `RosterAgent`, `LoadedTool`, `ClaudianToolModule`, `ToolHostContext`, `toolCapabilityId`, `TOOLS_DIR`, `ROSTER_DIR`, `buildClaudianToolMcpServer`, `transpileToolSource`, `VIEW_TYPE_*` are defined once and reused with matching signatures across tasks. The registry's `requireResolve('zod') -> { z }` matches the plugin wiring (D4 Step 2) and the test injection (B3).

**Known risk (flagged):** Task B5/D4 Step 5 plumbs `getClaudianToolServer` through the Claude cold-start options-builder context. The exact field lives on the existing `ctx` that already carries `mcpManager`; follow that object's construction site. If the runtime rebuilds options per turn, ensure the callback returns a freshly-built server reflecting the latest `toolRegistry.list()`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-19-agent-roster-tools-skills.md`.
