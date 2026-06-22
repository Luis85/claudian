---
type: tech-debt
title: "Agent Roster / Tools / Skills — Increment 1 Follow-ups"
date: 2026-06-19
status: open
scope: agents
related:
  - "[[docs/superpowers/plans/2026-06-19-agent-roster-tools-skills]]"
  - "[[docs/superpowers/specs/2026-06-17-ai-agents-roster-design]]"
  - "[[docs/superpowers/specs/2026-06-19-tool-and-skill-library-design]]"
---

# Agent Roster / Tools / Skills — Increment 1 Follow-ups

Increment 1 (PR #117) shipped the provider-agnostic Agent Roster, a user-authored
Tool Library (manifest+handler, sucrase transpile, zod validation) exposed to
Claude via an in-process SDK MCP server, and a Skill Library — each in a
dedicated workspace view. These items were deliberately deferred or surfaced in
final review and remain open.

## Functional gaps

1. ~~**User tools reach Claude's cold-start path only, not the persistent query.**~~
   **RESOLVED (2026-06-19).** `applyClaudeDynamicUpdates`/`updateMcpServers` now
   merges the in-process `claudian` server into every `setMcpServers` call (after
   SSRF vetting, since it's an `sdk`-type server) and tracks its presence in the
   MCP key, so it is no longer dropped on dynamic model/permission/MCP updates.
   *Residual:* adding a tool **mid-session** isn't reflected on the live persistent
   query until the managed-MCP set changes or a new conversation cold-starts
   (the key tracks claudian presence, not its tool-set contents) — a minor,
   acceptable limitation; a fresh conversation always cold-starts with current tools.

2. **Cross-provider tools — Opencode + Cursor done; Codex deferred.** Superseded
   the stdio plan with an **in-process local HTTP MCP server** (full Obsidian
   context; see `2026-06-19-http-tool-tier-design`). Shipped 2026-06-19: the
   plugin hosts a loopback Streamable-HTTP MCP server (per-process bearer token,
   constant-time auth); **Opencode** (`mcp.claudian` in the managed config) and
   **Cursor** (`~/.cursor/mcp.json` written pre-spawn, preserving user servers)
   are wired. *Deferred:* **Codex** — its `app-server` exposes no MCP-config seam
   in the plugin (`reloadMcpServers` is a no-op; unclear whether it reads
   `mcp_servers` from config.toml). Needs upstream/runtime investigation. Respect
   the Cursor ~40-tool cap.

3. **Skill Library is view + discovery only; no canonical `.claudian/skills`
   store or provider projection.** Skills are surfaced from existing provider
   catalogs; the provider-neutral canonical store + write-through projection from
   the spec is deferred. *(Its own increment — not a quick follow-up.)*

4. **Roster → run binding — chat + work-order done.** Shipped 2026-06-19:
   "Start chat with this Agent" (roster cards + detail) reliably opens a Claude
   conversation bound to a `RosterAgent`; a header chip shows the bound agent with
   an unbind action; the agent's **system prompt + model** apply to every turn.
   **Work-orders** can be assigned a roster agent (agent picker lists
   `roster:<id>` agents) and runs consume it (`boundAgentId` threaded
   coordinator → execution surface → run conversation, consume-once per tab).
   **Non-Claude projection done (2026-06-19).** Binding an agent now applies its
   **system prompt + model** across all four providers: `InputController` folds
   `boundAgentModel` into `queryOptions.model` (explicit tab/work-order override
   wins; bound model is the fallback) so the three providers that read
   `queryOptions.model` pick it up for free, and each runtime appends the bound
   prompt per turn — Codex via `buildSystemPrompt` appendices (`baseInstructions`
   re-sent on `thread/start` **and** `thread/resume`), Cursor via a delimited
   `# Agent Instructions` section in the CLI prompt, Opencode via the same
   appended section in the ACP prompt blocks. Claude is unchanged
   (`resolveEffectiveModel` already reads `boundAgentModel` separately).
   **Roster-agent board avatars done (2026-06-20).** `rosterAgentToPersona` +
   a preloaded `buildPersonaResolver` (mirroring `buildAgentOptionsLoader`,
   invalidated on `roster:changed`) now render each roster agent's color +
   initials on the board card footer, the work-order detail modal agent row, and
   the read-only activity modal. *Still open:* **tool/skill enforcement** at run
   time — see item 9.

## Quality / polish

5. ~~**Inconsistent i18n.**~~ **RESOLVED (2026-06-20).** The roster detail field
   labels and the `ToolLibraryView` / `SkillLibraryView` literals now route
   through `t()` (`agentRoster.field*`, `toolLibrary.*`, `skillLibrary.*`). The 9
   non-English locales hold English copies of the new keys (structural parity
   passes; translation of the copies remains open as ordinary i18n backlog).

6. ~~**`ToolHostContext.signal` is inert.**~~ **RESOLVED (2026-06-20).** Both tool
   host boundaries (SDK + HTTP) now thread the MCP request's `AbortSignal` (from
   the handler's `extra`) into `ToolHostContext` via the shared `requestSignal()`
   helper, so an aborted turn cancels a long-running user tool. Falls back to a
   fresh never-aborted signal when the host supplies none.

7. **Output schema unused — needs a structured-output channel first.**
   `ClaudianToolManifest.output` is reserved, but handlers return only a
   `ToolTextResult` text envelope, so there is nothing structured to validate
   `output` against today. Validating the text envelope against a zod schema is
   meaningless; this needs a structured-result channel (handler returns parsed
   data alongside text) before `output` can be enforced. Deferred by design, not
   an oversight.

8. ~~**`buildColdStartOptions` CRAP score.**~~ **RESOLVED (2026-06-20).** Added
   targeted unit coverage for the `getClaudianToolServer` branch (server present
   merges `mcpServers.claudian`; absent omits it), the proportionate fix.

9. **Roster tool/skill enforcement — user-tool scoping done (2026-06-20).**
   Chosen direction: **scope user tools per conversation.** A bound agent's
   granted capability ids (`RosterAgent.tools`) now flow `resolveBoundAgent` →
   `boundAgentTools` on `ChatRuntimeQueryOptions` → `currentBoundAgentTools` on
   the Claude runtime → `getClaudianToolServer(grantedToolIds)`, which scopes the
   in-process claudian tool server to only the granted ids (empty/absent grant =
   all user tools, preserving the prior default). Applies on both the cold-start
   and dynamic-update (persistent-query `setMcpServers`) paths. Built-in Claude
   tools (Read/Write/Bash) are untouched. *Still open:* the roster UI grants only
   user tools — built-in tool allow/deny and `disallowedTools` editing have no UI
   yet; **non-Claude (HTTP-tier) scoping** (Opencode/Cursor share one long-running
   HTTP server that lists all tools — per-conversation scoping there needs
   per-session request filtering); true per-call enforcement still needs
   `canUseTool`.

## New starter-agent presets (2026-06-20)

Shipped eight installable starter agents (Feature Builder, Debugger, Refactorer,
Test Author, Researcher, Documentation Writer, Planner, Code Reviewer) via
`presetAgents.ts` + an "Install starter agents" button in the roster view,
mirroring the work-order template presets (non-destructive: skips ids that
already exist). Presets ship prompt + identity only; tools/skills start empty
because those are vault-specific. *Open polish:* the preset prompts are English
literals (not i18n'd, same as work-order template bodies).

## Hardening pass (2026-06-21)

A deep harden/polish pass over the roster + tool/skill surfaces landed the
contained fixes (provider-projection sanitization, tool-handler timeout +
result bounding, tool-name validation/dup detection, the persistent-query
tool-scope staleness key, the synchronous persona resolver, error notices,
and modal/a11y polish). Three larger items were triaged out as genuine
decisions rather than bugs:

1. **User-tool trust model (consent gate).** User tools run as trusted
   in-process code with full Node/host privileges — a deliberate product
   choice. The timeout + output bounds added in this pass guard the *runaway*
   failure mode, not the *malicious* one. A first-run "this tool runs with full
   vault/host access — enable?" consent gate (per-tool, remembered) would close
   the trust gap without sandboxing. Open question: gate per-tool, or a single
   "I trust my .claudian/tools" workspace toggle. Needs a product call before
   building.

2. **Opencode/Cursor HTTP-tier tool-scope relocation.** The loopback HTTP tool
   server lists *all* user tools to every spawned provider; per-conversation
   scoping (the Claude-tier `getClaudianToolKey` equivalent) needs per-session
   request filtering on that shared long-running server. Touches the spawn
   lifecycle and can't be validated without a live Opencode/Cursor runtime, so
   it was not attempted blind.

3. **Locale coverage for new strings.** The roster/tool/skill UI strings and the
   eight preset-agent prompts are English literals; the nine non-English locales
   fall back to English for the new keys. A full translation pass (~720 strings ×
   9 locales) is a sizeable, separate effort.

## Improvement pass deferrals (2026-06-22)

A 5-lens review (UX, accessibility, security/resilience, architecture, i18n) drove
a nine-increment improvement pass. The contained items shipped; these were
deliberately deferred (tracked here):

1. **Bulk translation.** ~837 locale entries (95 agent-feature keys × 9 locales)
   plus the 8 preset-agent prompts remain English. The structural i18n bugs
   (dollar-brace interpolation, dead keys, hardcoded strings, color-picker label)
   were fixed; the translation backlog is the remaining work and benefits from
   native review.
2. **Atomic config writes.** The roster (`AgentRosterStore`) and conversation
   metadata stores write JSON directly (no temp-file + rename), so a crash
   mid-write can truncate a file; a malformed file is then silently skipped (now
   logged). Add an atomic write helper for the JSON config stores.
3. **HTTP tool-server in-flight drain.** `ClaudianHttpToolServer.rebuild()` tears
   down the MCP layer unconditionally; an Opencode tool call in flight when a tool
   file is saved gets dropped (503). Needs request-count tracking + deferral, and
   a live Opencode runtime to validate.
4. **Project tool-grant restrictions into provider subagents.** A roster agent's
   tool grant is enforced on the bound-chat path (`getScopedTools`) but not on the
   projected `@`-mentionable subagent files (they inherit provider defaults). Map
   the grant into each provider's native `tools`/`disallowedTools`, or document the
   divergence in the UI.
5. **Turn-cancel → running tool.** When the MCP host omits a request signal, a
   user cancelling a turn can't abort an in-flight tool; it runs to the 30s
   ceiling. Thread the runtime turn `AbortSignal` into the tool ctx.
6. **`getDisplayText`/ribbon/command i18n.** View titles, ribbon tooltips, and
   command-palette names are English (Obsidian registers them once; localizing
   needs re-registration on locale change).
7. **Library-shell unification.** `AgentRosterView` still hand-rolls its card/shell
   DOM instead of the shared `renderLibraryShell`/`createLibraryCard` the Tool/Skill
   views use; unify before a fourth library view is added.
