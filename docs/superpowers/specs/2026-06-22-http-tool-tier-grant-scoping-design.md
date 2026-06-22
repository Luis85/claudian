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

### The load-bearing safety property (and its precise limit)

Enforcement lives on the **server**, not the provider: a given token can *only
ever* reach the tools **its own grant** allows, regardless of how Opencode/Cursor
cache, re-read, or race on their config files. The provider-side injection is
best-effort; the server-side scoping is the guarantee. This is what makes the
approach both **safe** (per-token) and **fully unit-testable without the provider
runtimes**.

The guarantee is **per-token, not automatically per-conversation.** Per-conversation
correctness additionally requires that each conversation's spawn/turn writes *its
own* grant's token into the provider config. That holds cleanly for:
- the single-conversation / single-grant case (the common one), and
- Cursor's per-turn `~/.cursor/mcp.json` write (modulo the global-file race).

It does **not** automatically hold when a provider reuses one long-running
process + config across multiple conversations with **different** grants: a later
restricted conversation could pick up an earlier conversation's (possibly broader)
token and thus **over-grant**. Whether Opencode/Cursor re-read their MCP config
per conversation/turn or pin it at spawn is a runtime unknown — so this
cross-conversation, shared-process case is explicitly a **Phase 2** concern
(validate + harden the write lifecycle). Phase 1 ships the mechanism and is
correct for the common case; it does not claim to solve shared-process
cross-conversation scoping.

## Rollout decision: always-on for restricted

Decided 2026-06-22: the scoped token is sent **whenever a bound agent has a
restricted (non-empty) grant**; the unrestricted/default path is byte-for-byte
unchanged. No settings flag.

Rationale: for the common single-conversation case (and Cursor's per-turn write)
the scoped token is correct, and the unrestricted majority path is unchanged
(zero risk), so a dormant flag would add settings surface without protecting the
common path. The residual edge is the shared-process, cross-conversation,
different-grant case described above (a later conversation reusing an earlier
token can under- or over-grant); it is bounded, requires a live runtime to
characterize, and is hardened in Phase 2 (write inside the spawn lock; confirm
per-conversation re-read). Phase 1's server-side registry is unambiguously
correct and carries no downside on its own — the only runtime-dependent part is
which token a given provider spawn actually picks up.

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
