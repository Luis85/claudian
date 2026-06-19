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

1. **User tools reach Claude's cold-start path only, not the persistent query.**
   `getClaudianToolServer` is merged in `ClaudeQueryOptionsBuilder.buildColdStartQueryOptions`,
   so the `claudian` MCP server is present in the *initial* options of a
   conversation's persistent query. But `applyClaudeDynamicUpdates`/`setMcpServers`
   (used when model/permission/MCP change mid-session) rebuilds the server set from
   `mcpManager.getActiveServers()`, which does **not** include the in-process tool
   server — so user tools can be dropped for the rest of a session after a dynamic
   update. **Fix:** also inject the in-process server into the persistent-query
   update path. *Highest-priority follow-up — it affects the core "tools usable in
   chat" promise.*

2. **No exposure to Codex / Cursor / Opencode.** Only the Claude in-process tier
   shipped. The shared local **stdio MCP server** tier (one Node entrypoint via
   `@modelcontextprotocol/sdk`, marshalled into each provider's config dialect) is
   the planned Phase 2 (see tool/skill spec). Respect the Cursor ~40-tool cap.

3. **Skill Library is view + discovery only; no canonical `.claudian/skills`
   store or provider projection.** Skills are surfaced from existing provider
   catalogs; the provider-neutral canonical store + write-through projection from
   the spec is deferred.

4. **Roster is not yet consumed by any run path.** `RosterAgent` definitions
   persist to `.claudian/agents/*.json` and are granted tools/skills, but nothing
   reads them into a chat or work-order run yet (agent binding / projection is the
   next integration). The `roster:changed` / `toolLibrary:changed` events are
   emitted but have no subscribers (live refresh is imperative for now).

## Quality / polish

5. **Inconsistent i18n.** `AgentRosterView` routes most strings through `t()`, but
   its detail field labels (`Name`, `What it's for`, `Instructions`) and the
   `ToolLibraryView` / `SkillLibraryView` literals are not localized; the 9
   non-English locales currently hold English copies of the new keys. Localize the
   remaining literals and translate the keys.

6. **`ToolHostContext.signal` is inert.** `getClaudianToolServer` mints a fresh
   `AbortController` whose signal is never aborted, so a long-running user tool
   handler can't be cancelled when a turn is aborted. Wire it to the turn's
   abort signal.

7. **Output schema unused.** `ClaudianToolManifest.output` is reserved but the
   registry does not yet validate handler results against it.

8. **`buildColdStartOptions` CRAP score.** Adding the `getClaudianToolServer`
   branch tipped this pre-existing function over the critical-complexity threshold
   under partial coverage. A targeted unit test for the new conditional (server
   present / absent) is the proportionate fix (no structural refactor needed).
