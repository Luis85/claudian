---
type: design
title: "Tool Library & Skill Library: Plugin-Owned Capabilities On Top of Providers"
date: 2026-06-19
status: draft
scope: agents
tags:
  - design
  - tools
  - skills
  - mcp
related:
  - "[[docs/research/2026-06-19-user-tools-and-mcp-transport]]"
  - "[[docs/superpowers/specs/2026-06-17-ai-agents-roster-design]]"
  - "[[docs/superpowers/specs/2026-06-19-work-order-loop-controls-design]]"
  - "[[docs/research/2026-06-17-ai-agents-roster-frameworks]]"
---

# Tool Library & Skill Library: Plugin-Owned Capabilities On Top of Providers

## Status & decisions (user-confirmed)

- **Plugin-owned, provider-agnostic capabilities.** Tools and skills are
  Claudian's own concept, unique to the plugin, sitting *on top of* providers.
  The user adds them via dedicated plugin views and grants them to agents
  regardless of which provider runs the agent.
- **User-authored tools = manifest + handler.** A user tool is a TypeScript
  module exporting a declarative manifest (name, description, typed input schema,
  optional settings) plus a full-trust async handler. Inputs/outputs are
  schema-validated; the handler runs through a controlled wrapper.
- **Transport = MCP, two-tier.** One tool registry exposed two ways: **in-process
  SDK MCP for Claude**, **one shared local stdio MCP server for Codex/Cursor/
  Opencode**. (See research; this is the correct provider-agnostic seam, not a
  compromise.)
- **Dedicated views.** A **Tool Library** view and a **Skill Library** view,
  each its own workspace `ItemView` (ribbon + command), feeding the Agent detail
  view's pickers from the roster spec.
- This is a design spec, not an implementation plan. Grounding research:
  [`2026-06-19-user-tools-and-mcp-transport`](../../research/2026-06-19-user-tools-and-mcp-transport.md).

## Problem

The roster spec ([`2026-06-17`](2026-06-17-ai-agents-roster-design.md)) lets an
agent be *granted* skills and tools from a library, but assumed the existing
catalogs. The user wants the library itself to be (a) **authorable** — including
user-written TypeScript tools — and (b) **provider-neutral and managed in
dedicated views**, not buried in per-provider settings. Today: skills are
provider-scoped files surfaced only in a modal picker; there is no user-tool
concept at all (tools are either canonical built-ins or external MCP servers).

## Architecture overview

```
                ┌─────────────────────────────────────────────┐
   dedicated    │  Tool Library view        Skill Library view │   ItemViews
   views        │  (CRUD user tools)        (CRUD skills)       │   (ribbon+cmd)
                └───────────────┬───────────────────┬──────────┘
                                │                   │
                   ClaudianToolRegistry      ClaudianSkillLibrary
                   .claudian/tools/*          .claudian/skills/*
                   (manifest + handler)       (SKILL.md, canonical)
                                │                   │
            ┌───────────────────┴────────┐          │ projection (write-through)
            │ two-tier MCP host           │          ▼
            │  • Claude: in-process       │   provider skill roots
            │    createSdkMcpServer       │   (.claude/skills, .codex/skills, …)
            │  • others: 1 stdio server   │          │
            └───────────────┬─────────────┘          │
                            ▼                         ▼
                 provider runtimes  ◀── granted to agents (roster) ──▶
```

Both libraries are **Claudian-owned and provider-neutral**. Tools reach providers
through the MCP host (no files in provider roots). Skills, because providers
discover them from their own directories, reach providers by **projection**
(write-through) into the enabled providers' skill roots.

---

## Part A — Tool Library

### A1. Tool definition (manifest + handler)

A user tool is a directory `.claudian/tools/<id>/` with a `tool.ts` entry
(directory allows sibling helper files + future multi-file). The module's default
export is a `ClaudianToolModule`:

```typescript
// authored by the user in .claudian/tools/<id>/tool.ts
import { z } from "claudian/tools";        // plugin re-exports its bundled zod (no version skew)

export default {
  manifest: {
    name: "search_tasks",                  // -> mcp__claudian__search_tasks
    description: "Search work-order notes by status and text.",
    input: z.object({                      // single Zod schema -> validation + MCP input schema
      query: z.string().describe("Free-text to match in title/body"),
      status: z.enum(["inbox","ready","running","done"]).optional(),
    }),
    // optional, QuickAdd-style typed settings surfaced in the Tool Library UI
    settings: {
      maxResults: { type: "number", default: 20 },
      apiKey:     { type: "secret", description: "Token for X" }, // stored in SecretStorage
    },
  },
  handler: async (args, ctx) => {          // args typed from manifest.input
    const notes = await ctx.vault.search(args.query, args.status);
    return { content: [{ type: "text", text: notes.map(n => n.path).join("\n") }] };
  },
} satisfies ClaudianToolModule;
```

The in-code contract:

```typescript
// src/features/tools/toolTypes.ts (new)
export interface ClaudianToolManifest {
  name: string;                  // MCP tool name (snake/kebab)
  description: string;           // routing/usage blurb for the agent
  input: ZodTypeAny;             // -> z.toJSONSchema() for MCP; -> safeParse at call
  settings?: Record<string, ToolSettingSpec>;
  output?: ZodTypeAny;           // optional; validated when present
}
export interface ClaudianToolModule {
  manifest: ClaudianToolManifest;
  handler: (args: unknown, ctx: ToolHostContext) => Promise<CallToolResult>;
}
export interface ToolHostContext {
  vault: CuratedVaultApi;        // curated, awaitable host surface (read/write/search)
  app: App;                      // full Obsidian app (full-trust escape hatch)
  settings: Record<string, unknown>; // resolved manifest.settings (secrets injected)
  signal: AbortSignal;           // cancellation/timeout
  logger: LeveledLogger;
}
```

`CallToolResult` reuses the MCP shape (`{ content:[{type:"text",text}], isError?
}`) so the registry feeds both transports unchanged. Handlers return
`isError:true` instead of throwing (an uncaught throw would stop the agent loop).

### A2. Runtime pipeline (transpile → execute → validate → reload)

Per the research, no esbuild bundling needed:

1. **Load** via the Vault API (`app.vault.read`), not `fs`.
2. **Transpile** TS→JS with **sucrase** (`transforms:["typescript","imports"]`) —
   bundled (~tiny). Type-stripping only; we surface syntax errors in the view.
3. **Execute** via `new Function("module","exports","require", js)` with an
   injected, **whitelistable `require`** and the `ToolHostContext`. Append
   `//# sourceURL=` for stack traces.
4. **Validate** args with `manifest.input.safeParse` before calling the handler;
   validate `output` when present. Export the MCP input schema with Zod 4
   `z.toJSONSchema(manifest.input)`.
5. **Isolate (honest):** wrap in `try/catch`; enforce a **timeout** via
   `Promise.race`. Trust model is full Node/Electron (the Obsidian norm, matching
   Dataview JS / Templater) — documented, not sandboxed. Web Worker isolation is a
   deferred option.
6. **Hot reload:** `registerEvent(app.vault.on("modify", …))` over
   `.claudian/tools/**` → re-transpile + re-evaluate (fresh function) → emit
   `tool.changed` so the MCP host and dependent agents refresh.

### A3. `ClaudianToolRegistry` and the two-tier MCP host

```
src/features/tools/
  toolTypes.ts
  ClaudianToolRegistry.ts     // discover/transpile/validate/watch .claudian/tools/*
  host/
    InProcessToolMcpServer.ts // Claude: createSdkMcpServer + tool() over the registry
    StdioToolMcpServer.ts     // entrypoint: @modelcontextprotocol/sdk stdio server
    toolMcpConfigEmitter.ts   // marshal the stdio server into each provider's config dialect
  toolHostContext.ts          // CuratedVaultApi + secret injection
  view/
    ToolLibraryView.ts        // ItemView (ribbon + command)
    ToolEditor.ts             // create/edit manifest + handler, settings, test-run
```

- **`ClaudianToolRegistry`** is the single source of truth: a list of
  `{ manifest, handler, jsonSchema }`. Emits `tool.changed`.
- **Claude (in-process):** build an `McpServer` via `createSdkMcpServer({ name:
  "claudian", tools })`, where each tool wraps a registry entry with `tool(name,
  description, zodRawShape, handler)`. Inject it into the Claude runtime's query
  options as `mcpServers: { claudian: { type:"sdk", instance } }` — additive
  alongside the existing `McpServerManager.getActiveServers()` output in
  `ClaudeQueryOptionsBuilder`. Secrets stay in-process.
- **Codex / Cursor / Opencode (stdio):** `StdioToolMcpServer.ts` is a Node
  entrypoint (shipped with the plugin) that loads the same registry and serves it
  over `StdioServerTransport`. `toolMcpConfigEmitter.ts` registers it as a
  `ManagedMcpServer` (stdio) and marshals per provider: Claude/Cursor JSON,
  Codex TOML, Opencode single-`command`-array + `environment`. Reuses the existing
  `ManagedMcpServer`/secret machinery.
- **Tool-count budget:** respect **Cursor's ~40-tool ceiling** — cap or let the
  user mark which tools are exposed to which providers (default: all to Claude,
  budgeted set to Cursor).

### A4. Tool Library view (dedicated)

`ItemView` (ribbon + command "Open Tool Library"), mirroring Chat/Agent Board:

- **List:** all user tools (name, description, input summary, which providers it's
  exposed to, enabled toggle, last-error badge).
- **Editor:** name/description, a code editor for the handler, a settings-spec
  builder (typed options incl. `secret` → SecretStorage), and a **Test run**
  (invoke the handler with sample args, show validated result/errors).
- **New tool** scaffolds `.claudian/tools/<id>/tool.ts` from a template.
- Errors from transpile/validate/run surface here, not silently.

---

## Part B — Skill Library (revisited)

### B1. Plugin-owned canonical skills + projection

Today skills are provider-scoped (`.claude/skills`, `.codex/skills`) and only
discoverable per provider. To make skills provider-agnostic:

- **Canonical home:** `.claudian/skills/<name>/SKILL.md` — the Claudian-owned,
  provider-neutral source of truth the user edits.
- **Projection (write-through):** when a skill is granted to an agent (or globally
  enabled), Claudian copies/syncs it into the **enabled providers' skill roots**
  so each provider's native discovery finds it. Projection is idempotent and
  reconciled on `vaultSkill.changed`. (Required because skill discovery reads
  provider directories; unlike tools, skills can't be injected purely at runtime.)
- Existing per-provider vault skills remain discoverable and are surfaced in the
  view as **read-only "provider-native"** entries (not absorbed), consistent with
  the roster's "layer on top, don't replace" principle.

### B2. Skill Library view (dedicated)

`ItemView` (ribbon + command "Open Skill Library"), backed by the existing
`VaultSkillAggregator` (discovery, TTL cache, streaming) and
`ProviderCommandCatalog.saveVaultEntry()/deleteVaultEntry()` (CRUD already
exists):

- **List:** all skills, source-tagged (Claudian-canonical vs provider-native),
  searchable; shows which providers each is projected to.
- **Editor:** create/edit a `SKILL.md` (name, description, body, `argument-hint`,
  `allowed-tools`) in the canonical store; provider-native skills are read-only
  with an "adopt into Claudian library" action.
- Reuses `vaultSkill.changed` for cache invalidation and to trigger re-projection.

---

## Integration with the roster (Agent detail view)

The roster spec's detail-view pickers now read from these libraries:

- **Tools picker** = `ClaudianToolRegistry` (user tools) **+** the canonical
  built-in tool vocabulary, as friendly capability toggles. Granting a user tool
  to an agent adds `mcp__claudian__<tool>` to the agent's allow set; the MCP host
  ensures it's exposed for the resolved provider.
- **Skills picker** = `ClaudianSkillLibrary` (canonical + provider-native),
  writing the agent's `skills: string[]`; projection guarantees availability on
  the resolved provider.
- Provider-capability validation (from the roster spec) now also accounts for the
  **Cursor tool-count ceiling** and tools not yet exposed to a given provider.

## Conflicts & resolutions

| Concern | Resolution |
|---|---|
| No true sandbox for user TS | Full-trust handler (Obsidian norm) + `try/catch` + timeout, documented; Web Worker isolation deferred. |
| Secrets leaking to subprocess (stdio tier) | Claude tier keeps secrets in-process; stdio tier passes via `env` from SecretStorage (existing `secretEnv` machinery) — surfaced as a trade-off in the view. |
| Cursor ~40-tool cap | Per-provider exposure selection; default Claude-all, budgeted set elsewhere. |
| Skill discovery is per-provider dir | Canonical `.claudian/skills` + idempotent projection into enabled provider roots. |
| Two "tool" meanings (built-in canonical vs user MCP tool) | Unified in the picker as capabilities; namespaced `mcp__claudian__*` under the hood. |
| Bundle size | sucrase + zod are small; avoid esbuild/babel-standalone. |

## Phasing

- **Phase 1 — Tool Library (Claude in-process).** `toolTypes`,
  `ClaudianToolRegistry` (sucrase transpile + `new Function` + zod + hot reload),
  `InProcessToolMcpServer` wired into `ClaudeQueryOptionsBuilder`, and the **Tool
  Library view** with editor + test-run. Ship value: user-authored tools working
  end-to-end on Claude with secrets staying in-process.
- **Phase 2 — Stdio tool host (Codex/Cursor/Opencode).** `StdioToolMcpServer`
  entrypoint + `toolMcpConfigEmitter` per-provider dialects + lifecycle
  supervision; per-provider exposure UI honoring the Cursor cap. Ship value:
  user tools across all providers.
- **Phase 3 — Skill Library.** Canonical `.claudian/skills`, the **Skill Library
  view** (CRUD over existing catalog APIs), and projection into provider roots.
  Ship value: provider-agnostic, authorable skills.
- **Phase 4 — Roster integration polish.** Detail-view pickers read both
  libraries; capability validation incl. Cursor cap; "adopt provider-native into
  Claudian" flows.

## Tools as work-order verifiers

A user Tool is the ideal **programmatic completion oracle** for a Work-Order:
because handlers return a structured `CallToolResult`, a tool such as
`tests_pass`, `lint_clean`, or `acceptance_check` can be wired as a Work-Order's
`done_when: { kind: 'tool', toolId }` and asserted by the run loop. This is the
bridge between the Tool Library and the verification loop — user-authored checks
become the board's external ground truth. See
[`2026-06-19-work-order-loop-controls-design`](2026-06-19-work-order-loop-controls-design.md).
No new mechanism is required; the tool is invoked through the same registry/MCP
host, and its result is what the oracle evaluates.

## Out of scope
- Web Worker / true sandbox isolation (revisit if untrusted sharing emerges).
- A marketplace / sharing registry for tools and skills.
- Remote (HTTP) Claudian tool host — local stdio + in-process only.

## Decisions still needing the user
1. **Host API surface for handlers:** curated `ctx.vault`/`fetch`/`notice` only,
   vs. also exposing raw `window.require` (full Node). *Recommend: curated by
   default, full `app` as an escape hatch.*
2. **Skill projection vs view-only unification:** write-through into provider
   roots (true provider-agnostic) vs. only unifying the management view while
   skills stay provider-scoped. *Recommend: projection.*
3. **Tool storage granularity:** directory-per-tool (multi-file, recommended) vs.
   single-file `.claudian/tools/<id>.ts`.
