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

2. **No exposure to Codex / Cursor / Opencode.** Only the Claude in-process tier
   shipped. The shared local **stdio MCP server** tier (one Node entrypoint via
   `@modelcontextprotocol/sdk`, marshalled into each provider's config dialect) is
   the planned Phase 2 (see tool/skill spec). Respect the Cursor ~40-tool cap.

3. **Skill Library is view + discovery only; no canonical `.claudian/skills`
   store or provider projection.** Skills are surfaced from existing provider
   catalogs; the provider-neutral canonical store + write-through projection from
   the spec is deferred.

4. **Roster → run binding — PARTIAL.** Chat binding shipped (2026-06-19): a
   "Start chat with this Agent" action opens a Claude conversation bound to a
   `RosterAgent`, and the agent's **system prompt + model** are applied to every
   turn (`Conversation.boundAgentId` → `resolveBoundAgent` → query options →
   ClaudeQueryOptionsBuilder). *Still deferred:* **tool/skill enforcement** at
   run time (Claude's persistent query has no `allowedTools` API — needs the
   `canUseTool` path), **work-order → roster assignment** (touches
   `TaskRunCoordinator`), and non-Claude providers. The `roster:changed` /
   `toolLibrary:changed` events are emitted but still have no subscribers.

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
