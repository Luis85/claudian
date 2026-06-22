---
title: "HTTP Tool-Tier Grant Scoping — Design"
date: 2026-06-22
status: draft
scope: tools
related:
  - "[[docs/superpowers/specs/2026-06-19-http-tool-tier-design]]"
  - "[[docs/superpowers/specs/2026-06-17-ai-agents-roster-design]]"
  - "[[docs/tech-debt/2026-06-19-agent-roster-tools-skills-followups]]"
---

# HTTP Tool-Tier Grant Scoping — Design

## Problem

A roster agent can be granted a **restricted subset** of the user's Tool Library
tools (`RosterAgent.tools`, a list of capability ids like
`mcp__claudian__search_tasks`). On **Claude** that grant is enforced: the bound
chat path threads `boundAgentTools` → `getClaudianToolServer(grantedToolIds)`,
which builds a *scoped* in-process SDK MCP server exposing only the granted tools
(`src/features/tools/scopedTools.ts`, `getScopedTools`/`scopedToolKey`).

On **Opencode and Cursor** the grant is **not** enforced. Those providers reach
Claudian user tools through one shared loopback HTTP MCP server,
`ClaudianHttpToolServer`. Both runtimes call `getHttpToolServerConfig()` — which
returns the **process-global** URL + bearer token — and write `mcp.claudian`
into their managed config. That server lists **every** error-free tool from
`toolRegistry.list()`. So an agent restricted to `[search_tasks]` can still list
and invoke *all* user tools on Cursor/Opencode. This is the P1 gap tracked in the
follow-ups doc (functional gap #9 / hardening item #2).

## Why it is structurally hard

From an end-to-end trace of the current wiring:

1. **One server, one token, all tools.** `ClaudianHttpToolServer`
   (`src/features/tools/host/ClaudianHttpToolServer.ts`) holds a single
   `bearerToken` (`crypto.randomUUID()`, line 70) and a single
   `transport`+`mcpServer` built from the full tool set (`attachMcpLayer`,
   `buildHttpMcpServer`). The transport is **stateless**
   (`sessionIdGenerator: undefined`, line 160) — every call is an independent
   round-trip with no conversation identity.
2. **The grant never reaches the write point.** `boundAgentTools` is present in
   `queryOptions` and *does* reach `OpencodeChatRuntime.query()` and
   `CursorChatRuntime.query()`, but both **ignore it**. Opencode writes
   `mcp.claudian` in `buildOpencodeManagedConfig`
   (`OpencodeLaunchArtifacts.ts` ~188-198); Cursor writes `~/.cursor/mcp.json`
   in `writeCursorMcpConfig` (`cursorMcpConfig.ts`); neither consults the grant.
3. **Cursor's config is a single global file.** `~/.cursor/mcp.json` is shared by
   every Cursor conversation; the file alone cannot point concurrent
   conversations at different tool sets.
4. **Tool identity differs across tiers.** The grant list holds capability ids
   (`mcp__claudian__<name>`, via `toolCapabilityId`), while the HTTP server
   registers tools by bare `manifest.name`. `getScopedTools(loaded, grant)`
   already bridges this (filters by `toolCapabilityId(name)`), so it is the
   reuse point for server-side scoping.

## Resolution: token-keyed scoped endpoints

Make the **server itself** grant-aware, keyed by the bearer token.

- The server keeps a registry `Map<token, scoped MCP layer>` instead of a single
  layer. A **default token = all tools** (the existing process token) preserves
  today's behavior exactly — zero regression for unrestricted conversations.
- `getHttpToolServerConfig(grantedToolIds?)` resolves (or mints) a **token per
  grant signature** — deduped via a `scopedToolKey`-style fingerprint so
  identical grants share one cached layer — lazily builds a scoped layer from
  `getScopedTools(getLoaded(), grant)`, and returns
  `{ url, headers: { Authorization: Bearer <grantToken> } }`. An `undefined`/empty
  grant returns the default (all-tools) token.
- `handleHttpRequest` resolves the presented token → its scoped layer →
  delegates. Unknown token → 401 (unchanged auth posture; the comparison stays
  constant-time per registered token).
- The list-tools and call-tool handlers are scoped **by construction**: each
  per-grant `McpServer` is built from only the granted `LoadedTool[]`, so both
  *listing* and *invocation* are enforced. Defense in depth for free — a tool
  outside the grant is simply not registered on that server.
- `rebuild()` (tool-file change) tears down **all** cached layers and rebuilds
  lazily; the existing in-flight drain applies across the registry.
- Each runtime threads `queryOptions.boundAgentTools` into its config write:
  `getHttpToolServerConfig(boundAgentTools)`.

### The load-bearing safety property

Enforcement lives on the **server**, not the provider. A token can *only ever*
reach the tools its grant allows, regardless of how Opencode/Cursor cache,
re-read, or race on their config files. The provider-side injection is
best-effort; the server-side scoping is the guarantee. This is what makes the
approach both **safe** and **fully unit-testable without the provider runtimes**.

A corollary: shipping the scoped path before live-runtime validation can only
ever *tighten* what a restricted agent sees (the server caps it), never widen it.

## Rollout decision: always-on for restricted

Decided 2026-06-22: the scoped token is sent **whenever a bound agent has a
restricted (non-empty) grant**; the unrestricted/default path is byte-for-byte
unchanged. No settings flag.

Rationale: the server-side guarantee means the restricted path can never
over-grant. The only residual risk is a *functionality* degradation (a restricted
agent on Cursor/Opencode seeing **missing** tools if a provider caches a stale
config across concurrent conversations) — bounded, non-security, and addressed in
Phase 2 by writing the config inside the spawn lock. The unrestricted majority
case carries zero risk, so a dormant flag adds settings surface without
protecting the common path.

## Phasing

### Phase 1 — buildable + unit-testable now (no provider runtime)

1. **Server grant registry.** `ClaudianHttpToolServer` gains a token→scoped-layer
   registry. `getConfig(grantedToolIds?)` returns a stable token per grant
   signature; `undefined`/empty → the all-tools default. Identical grants dedupe.
2. **Server enforcement.** A request authed with grant-A's token lists only A's
   tools; invoking a tool outside A fails; the default token lists all; unknown
   token → 401. (Testable in-process exactly like the existing
   `ClaudianHttpToolServer` / `buildHttpMcpServer` tests.)
3. **Config-builder threading.** `buildOpencodeManagedConfig` and
   `buildCursorMcpConfig` carry the scoped token when given a grant; the Opencode
   and Cursor runtimes pass `queryOptions.boundAgentTools` into
   `getHttpToolServerConfig(...)` at their write sites.
4. **`main.ts` accessor.** `getHttpToolServerConfig(grantedToolIds?)` delegates to
   the server registry (mirrors the Claude-tier `getClaudianToolServer`/
   `getClaudianToolKey` signature).

All behind full unit tests. Default/unrestricted path unchanged.

### Phase 2 — needs a live Opencode + Cursor runtime

- Validate end-to-end: a restricted agent on Opencode/Cursor lists and invokes
  only its granted tools; granted tools still work.
- Cursor global-`mcp.json` concurrency: confirm whether Cursor re-reads per spawn;
  harden by moving `writeCursorMcpConfig` **inside** the spawn lock so the written
  token matches the spawn it precedes.
- Respect Cursor's ~40-tool cap interaction with scoped sets.
- Token lifecycle/revocation tuning (per-conversation vs per-grant; eviction).

## Test strategy

Phase 1 is fully covered by unit tests without any provider runtime:

| Area | Test |
|------|------|
| Token registry | same grant → same token; different grant → different token; undefined → default token |
| Default preservation | no grant ⇒ identical config (url/header) to today |
| List scoping | request with grant-A token lists only A's tools; default token lists all |
| Call scoping | invoking an ungranted tool with grant-A token is rejected/unknown |
| Auth | unknown/garbage token → 401 (constant-time preserved) |
| rebuild() | after a tool-file change, scoped layers rebuild; drain still applies |
| Config builders | `buildOpencodeManagedConfig`/`buildCursorMcpConfig` carry the scoped token for a grant |
| Plumbing | Opencode/Cursor runtimes request `getHttpToolServerConfig(boundAgentTools)` |

### Runtime-validation checklist (Phase 2, manual, with real CLIs)

- [ ] Opencode bound to a restricted agent: `tools/list` over `mcp.claudian`
      returns only granted tools.
- [ ] Opencode invoking an ungranted tool fails server-side.
- [ ] Cursor bound to a restricted agent: only granted tools are available.
- [ ] Two concurrent Cursor conversations with different grants don't bleed
      tools across each other (or the limitation is confirmed + documented).
- [ ] Granted tools remain fully callable end-to-end on both providers.
- [ ] Cursor ~40-tool cap behaves with scoped sets.

## Non-goals / out of scope

- Codex cross-provider tools (no MCP-config seam in its app-server; tracked
  separately).
- Per-call `canUseTool`-style interactive gating (the user-tool consent gate is a
  separate, deferred product decision).
- Changing the user-tool trust model (tools still run as trusted in-process code).
