---
type: research
title: "User-Authored Tools, Runtime TypeScript, and MCP as a Provider-Agnostic Tool Seam"
date: 2026-06-19
status: draft
scope: agents
tags:
  - research
  - tools
  - skills
  - mcp
related:
  - "[[docs/superpowers/specs/2026-06-19-tool-and-skill-library-design]]"
  - "[[docs/research/2026-06-17-ai-agents-roster-frameworks]]"
  - "[[docs/superpowers/specs/2026-06-17-ai-agents-roster-design]]"
sources:
  - https://code.claude.com/docs/en/agent-sdk/custom-tools
  - https://code.claude.com/docs/en/agent-sdk/typescript
  - https://www.npmjs.com/package/@modelcontextprotocol/sdk
  - https://modelcontextprotocol.io/docs/develop/build-server
  - https://modelcontextprotocol.io/specification/2025-11-25
  - https://code.claude.com/docs/en/mcp
  - https://developers.openai.com/codex/config-reference
  - https://cursor.com/docs/cli/mcp
  - https://opencode.ai/docs/mcp-servers/
  - https://quickadd.obsidian.guide/docs/UserScripts/
  - https://github.com/polyipseity/obsidian-modules
  - https://github.com/mProjectsCode/obsidian-js-engine-plugin
  - https://github.com/OlegWock/obsidian-emera
  - https://esbuild.github.io/api/
  - https://github.com/alangpierce/sucrase
  - https://zod.dev/json-schema
  - https://docs.obsidian.md/Plugins/Vault
---

# User-Authored Tools, Runtime TypeScript, and MCP as a Provider-Agnostic Tool Seam

## Why this research

Product goal: let users author their own **tools** (TypeScript) and manage both
**tools and skills** in dedicated, plugin-owned views that sit *on top of*
providers — so an agent can be granted capabilities regardless of which AI
provider runs it. This document answers the three load-bearing questions:

1. How do Obsidian plugins safely let users add and run their own JS/TS?
2. Can we transpile/execute user TypeScript at runtime inside the plugin?
3. What is the provider-agnostic seam for exposing those tools to all four
   providers (Claude, Codex, Cursor, Opencode)?

Companion design spec:
[`2026-06-19-tool-and-skill-library-design`](../superpowers/specs/2026-06-19-tool-and-skill-library-design.md).
Findings gathered 2026-06-19; see `sources`.

---

## 1. Obsidian precedents for user-authored code (converging pattern)

Four established plugins, one shape: user code lives in **vault files**, is run
through the **`Function`/`AsyncFunction` constructor** with host objects injected,
runs at **full Node/Electron trust** (no sandbox), and hot-reloads on file
change. None of these is a security boundary — the Obsidian norm is "your own
code, your own risk."

| Plugin | Where code lives | Execution mechanism | TS? | Authoring contract | Hot reload |
|---|---|---|---|---|---|
| **QuickAdd** | vault `.js` (or JS in a Markdown fence) | `new Function("require","module","exports", src)`, `require` backed by `window.require` | No (`.js` only) | **plain `async (params)`** *or* **object export `{ entry, settings }`** with typed `options` (`secret:true` masks) — a manifest+handler | yes — fresh read + re-wrap per run |
| **Modules** (polyipseity) | any vault `.js/.ts/.mjs` or Markdown code block | `new Function("module","exports","process","app", code)`; ESM via blob/dynamic import | **Yes — `@ts-morph/bootstrap` (the TS compiler) at runtime** | CommonJS/ESM module exports; resolver chain for cross-module imports | yes — `vault.on("modify")` + cache invalidation; `autoReloadStartupModules:true` |
| **JS Engine** (mProjectsCode) | `js-engine` code blocks; vault `.js`; startup scripts | `new AsyncFunction(...globals, body)` + `//# sourceURL=`; `importJs` uses native `import()` | No (types are editor-time only) | injected globals (`app`, `engine`, `obsidian`, `container`); `return` value renders | no for imports (caches by URL) |
| **Emera** (OlegWock) | inline JS/TS + multi-file user modules | `@babel/standalone` transpile + Rollup bundle; exec via `data:` URL + dynamic `import()` | Yes (Babel `preset-typescript`) | React/MDX components | — |

**Takeaways:** the **QuickAdd object-export contract** (`{ entry, settings }`) is
the closest ecosystem precedent to our chosen *manifest + handler* model, and
**Modules proves runtime TS is viable in a plugin**. Full-trust execution via the
`Function` constructor with injected host APIs is standard and accepted.

## 2. Runtime TypeScript: transpile, execute, validate, isolate

**Transpile (type-stripping; none of these type-check).**

| Tool | Pure JS? | Footprint | Notes |
|---|---|---|---|
| **sucrase** ✅ recommended | yes, no native deps | smallest of the group | `transform(code,{transforms:["typescript","jsx","imports"]})`; ~20× faster than Babel; the common runtime-stripping choice |
| `typescript` (`ts.transpileModule`) | yes | large (multi-MB) | official fidelity, zero extra deps if already bundled; pair with `isolatedModules` |
| `@babel/standalone` | yes | largest | only if you need a plugin pipeline (Emera) |
| esbuild-wasm / swc-wasm | wasm | **~10 MB + init** | only when you need real bundling/import resolution |

> Native `esbuild` is a no-go shipped in a plugin — it spawns an external Go
> binary that isn't present at runtime. Reserve wasm builds for genuine bundling.

**Execute.** For a CommonJS-style handler, `new Function('module','exports',
'require', code)` with an injected, **whitelistable `require`** is the cleanest —
synchronous, full control over the host surface, returns `module.exports`. For
ESM, blob-URL + dynamic `import()` in the renderer (unique URL per reload,
`revokeObjectURL` after). Node `vm` adds a `timeout` option but is **not** a
security sandbox.

**Reload.** `this.registerEvent(app.vault.on('modify', …))` → re-read via the
Vault API → re-evaluate with a fresh function/URL (and `delete
require.cache[...]` if using Node `require`). Prefer the Vault API over
`fs.watch` (serialized, cache-aware).

**Validate.** Bundle **zod** (~2 kB core). Validate handler I/O with
`schema.safeParse`. **Zod 4 ships `z.toJSONSchema()`** (Draft 2020-12 default) —
so one Zod schema yields both runtime validation and the MCP/provider input
schema, no `zod-to-json-schema` dependency.

**Isolate (honest limits).** Obsidian's renderer runs with Node integration and
the OS sandbox disabled — **there is no true sandbox**, and `vm` is not one.
Practical mitigations: wrap every handler in `try/catch`, enforce a **timeout**
(`Promise.race` for async; `vm` `timeout` for sync loops), and — if stronger
isolation is ever required — run handlers in a **terminable Web Worker** with
host capabilities proxied over `postMessage` (no DOM/Node unless granted). Given
the chosen *full-trust handler* model, document the trust posture (matching
Dataview JS / Templater) rather than pretend to contain it.

## 3. MCP as the provider-agnostic tool seam (the verdict)

**One tool registry, two transports.** All four providers are MCP clients that
spawn local **stdio** servers (`command` + `args` + `env`, JSON-RPC over
stdio, tools-only capability) — that is the lowest common denominator and it is
**fully supported today, not gated** (the gating in CLAUDE.md concerns Claudian's
MCP *management UI*, not an agent's ability to *consume* a stdio server).

But Claude has a strictly better path, so the optimal design is **two-tier**:

- **Claude → in-process SDK MCP.** `@anthropic-ai/claude-agent-sdk` exposes
  `tool(name, description, zodRawShape, handler)` and `createSdkMcpServer({ name,
  version, tools })`, passed as `mcpServers: { claudian: { type:"sdk", instance
  } }`. *"The server runs in-process inside your application, not as a separate
  process."* No subprocess, no stdio serialization, direct access to the Obsidian
  `App`/vault and to **secrets already in SecretStorage** (they never enter a
  child env). Handlers return MCP `CallToolResult` (`{ content:[{type:"text",
  text}], isError? }`); return `isError:true` rather than throwing (an uncaught
  throw stops the agent loop). Tools namespaced `mcp__claudian__<tool>`; allow via
  `allowedTools` (wildcard `mcp__claudian__*`).
- **Codex / Cursor / Opencode → one shared stdio server.** Ship a small Node
  entrypoint using `@modelcontextprotocol/sdk` (`McpServer.registerTool(name,
  {description, inputSchema: zodRawShape}, handler)` + `StdioServerTransport`)
  exposing the **same** tool set, and emit each provider's config dialect pointing
  at it. Schema is identical (both consume Zod shapes, both return
  `CallToolResult`); only the *config shape* differs.

**Per-provider stdio config shapes (marshalling, not rewriting):**

| Provider | File | Shape |
|---|---|---|
| Claude | `.mcp.json` / SDK option | `{ type:"stdio", command, args[], env }` (or in-process `type:"sdk"`) |
| Codex | `~/.codex/config.toml` / `.codex/config.toml` | `[mcp_servers.<name>] command, args[], env{}, …` (TOML; project trust required) |
| Cursor | `.cursor/mcp.json`, `~/.cursor/mcp.json` | `{ type:"stdio", command, args[], env{}, envFile }` (CLI honors the same file) |
| Opencode | `opencode.json` (`mcp` key) | `{ type:"local", command:[exe,...args], environment{}, enabled }` |

**Gotchas to design around:**
- **Process lifecycle:** Claude does not auto-reconnect stdio servers; Codex
  enforces 10 s startup / 60 s per-tool timeouts. Supervise/restart the shared
  server; keep startup fast. (The in-process Claude tier sidesteps all of this.)
- **Secrets:** the stdio tier must pass secrets via `env` — they leave
  SecretStorage into a child process. The in-process Claude tier keeps them in
  memory. Real security delta favoring the two-tier split.
- **Tool-count ceiling:** **Cursor ~40 tools** (forum-reported) is the binding
  limit; Claude has no hard cap (warns on context, offers tool search). Budget
  tool count to the Cursor ceiling or gate extras per provider.
- **Approval friction:** Claude prompts on project `.mcp.json`; Cursor prompts
  before MCP tools (`--approve-mcps`). Pre-approve for automation flows.

**Why MCP and not provider-native APIs:** only Claude has a non-MCP local
custom-tool path (its in-process SDK tools, which are still "SDK MCP"). Codex,
Cursor, and Opencode have **no** non-MCP local custom-tool mechanism — MCP stdio
*is* their extension point. So "one shared stdio server + Claude in-process" is
not a compromise; it is the genuinely correct provider-agnostic design.

## 4. Codebase fit (what already exists)

- **MCP substrate is ready.** `src/core/types/mcp.ts` already models
  `McpStdioServerConfig` / `McpSSEServerConfig` / `McpHttpServerConfig` and
  `ManagedMcpServer` (enable, `contextSaving`, `disabledTools`, `secretHeaders`
  /`secretEnv` → SecretStorage). `McpServerManager.getActiveServers()` feeds the
  Claude runtime, which already passes `mcpServers` into the SDK `query()` options
  (`ClaudeQueryOptionsBuilder`). `.claude/mcp.json` I/O + secret extraction +
  SSRF vetting exist. The SDK `McpServerConfig` union **also accepts `type:"sdk"`**
  — so registering an in-process server is additive.
- **Skills already support CRUD**, not just discovery:
  `ProviderCommandCatalog.saveVaultEntry()/deleteVaultEntry()` write
  `.claude/skills/<name>/SKILL.md` (and `.codex/skills/…`), with `vaultSkill.changed`
  cache invalidation via `VaultSkillAggregator`. Missing: a **dedicated view**
  (skills only appear in the Quick Actions modal picker + composer dropdown) and a
  **provider-neutral, Claudian-owned skill home**.
- **View registration pattern is established:** `registerView(VIEW_TYPE_…, leaf =>
  new …View)` in `main.ts`, extending `ItemView`, + ribbon icon + command — as
  used by Chat (`ClaudianView`) and Agent Board (`AgentBoardView`).
- **Gap:** no tool abstraction parallel to skills yet. The user Tool Library is
  genuinely new surface (manifest+handler files, transpile/load, the MCP host).

## 5. Design implications (carried into the spec)

1. **Tool model = QuickAdd-style object export:** a TypeScript module exporting a
   **manifest** (`name`, `description`, Zod `input` schema, optional `settings`)
   plus an **async `handler`** returning a string/structured result. One Zod
   schema → runtime validation *and* MCP input schema (`z.toJSONSchema`).
2. **Single tool registry, two-tier exposure:** Claude in-process (`type:"sdk"`),
   one shared stdio server for the others — both built from the same registry.
3. **Runtime pipeline:** sucrase transpile → `new Function` execute with injected
   host API → `vault.on('modify')` hot-reload → zod validate → `try/catch` +
   timeout.
4. **Plugin-owned, provider-neutral storage** (`.claudian/tools/`,
   `.claudian/skills/`) that is the canonical source and is **projected** into
   each provider only when needed (skills must be written into provider skill
   roots for discovery; tools are exposed via the MCP host).
5. **Two dedicated views** (Tool Library, Skill Library) following the Chat/Agent
   Board `ItemView` pattern, feeding the Agent detail-view pickers from the roster
   spec.
6. **Honest trust model:** full-trust handlers (Obsidian norm), `try/catch` +
   timeout, documented; Web Worker isolation deferred.

## Open questions for the spec
- Skill projection: copy/sync `.claudian/skills/*` into provider roots vs. keep
  per-provider skills and only *unify the view*.
- Tool storage granularity: single `.claudian/tools/<name>.ts` vs. directory per
  tool (multi-file, sibling imports).
- Whether to expose a curated host API to handlers (vault read/write, fetch,
  notice) vs. raw `window.require` full access.
