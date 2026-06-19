---
type: design
title: "Wiring the Agent Roster: Usable Chat Binding, Work-Order Assignment & Cursor Tools"
date: 2026-06-19
status: draft
scope: agents
related:
  - "[[docs/superpowers/specs/2026-06-19-roster-run-binding-design]]"
  - "[[docs/superpowers/specs/2026-06-19-http-tool-tier-design]]"
  - "[[docs/tech-debt/2026-06-19-agent-roster-tools-skills-followups]]"
---

# Wiring the Agent Roster

Closes the usability gaps that make the roster feel non-functional, plus the
next cross-provider tool target. Five tasks, three implementation slices.

## Slice 1 — Chat usability (Tasks 1–3)

1. **Fix Start-chat when the chat panel is closed.** `plugin.openConversation`
   (`main.ts`) calls `this.getView()?.getTabManager()?...` right after
   `activateView()`; `getView()` can still be null (async). Use the existing
   `ensureViewOpen()` helper to get the view, then `openConversation`. This is the
   root cause of "no way to start a chat with the agent."
2. **Bound-agent chip in the chat header.** When the active tab's `Conversation`
   has `boundAgentId`, show a "Chatting with *Agent*" chip in the chat header
   (`ClaudianView.buildNavRowContent`), with an **unbind** action
   (`updateConversation(id, { boundAgentId: undefined })`). Resync on tab
   switch / conversation change.
3. **Start-chat on each roster card.** Add a per-card "Start chat" button in
   `AgentRosterView.renderList` (today only the detail view has it), `stopPropagation`
   so the card's detail-open click still works.

## Slice 2 — Work-order → roster agent (Task 4)

- **Selection:** the work-order agent picker (`workOrderPropertiesPanel.renderAgentRow`
  + the creation flow) lists built-in personas **and** roster agents
  (`roster:<id>`), labelled "Agent: <name>". Stored in `TaskFrontmatter.agent`.
- **Run consumption:** thread `boundAgentId` from `TaskRunCoordinator.run` (when
  `task.frontmatter.agent` starts with `roster:`) through
  `TaskExecutionSurface.startTaskRun` → `ClaudianViewWorkOrderBridge` conversation
  creation (`createConversation({ providerId, boundAgentId })`). `InputController`
  already projects it. **Claude runs** apply the agent's prompt/model; non-Claude
  runs store but don't project (consistent with the Claude-only binding —
  deferred). Board-card avatar showing the roster agent name is a polish
  follow-up (resolvePersona keeps unknown ids as Standard for now).

## Slice 3 — Cursor HTTP tools (Task 5a)

- Pre-spawn, write `~/.cursor/mcp.json`
  `{ "mcpServers": { "claudian": { "url", "headers" } } }` from
  `plugin.getHttpToolServerConfig()` in `CursorChatRuntime.query` (new
  `cursorMcpConfig.ts` helper), before `acquireCursorAgentSpawnLock()`. Skip when
  config is null. Pass the config as plain data (no providers→features import).

## Deferred

- **Codex tools:** `codex app-server` exposes no MCP-config seam in the plugin
  (`reloadMcpServers` is a no-op; uncertain whether the app-server reads
  `mcp_servers` from config.toml). Needs upstream/runtime investigation.
- **Non-Claude bound-agent projection** (prompt/model for Codex/Cursor/Opencode
  runs); tool/skill *enforcement*; roster-agent board avatars.

## Gotchas
- `roster:<id>` is the existing RosterAgent id format — reuse as the work-order
  `agent` value to distinguish from personas.
- Cursor spawn-lock contention around `~/.cursor`; write the mcp.json before
  acquiring the lock; a long-lived agent may not hot-reload config (acceptable).
- Keep `core/` and `providers/` free of `features/` imports (pass config as data).
