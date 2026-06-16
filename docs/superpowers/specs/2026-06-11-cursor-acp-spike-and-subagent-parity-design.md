---
title: Cursor ACP spike and subagent parity design
date: 2026-06-11
status: in-review
scope: cursor-provider
related:
  - "[[0002-cursor-askuserquestion-transport]]"
  - "[[cursor-subagents]]"
  - "[[2026-06-07-provider-native-parity-gaps]]"
---

# Cursor ACP spike and subagent parity design

## Context

Claudian targets feature parity across providers with Claude as the benchmark. The agreed
parity roadmap for Cursor, in order, is:

1. **Subagents** (this spec, plus the transport spike below) — open P1 issue [[cursor-subagents]]
2. `/` commands + `$` skills (skills-first; Cursor has folded commands into Skills)
3. In-app MCP management (project `.cursor/mcp.json` manager)
4. Unified rewind/safe-revert (Claudian-owned snapshots, cross-provider)

Two findings from June 2026 research (live cursor.com docs/changelog) reshape sub-project 1:

- **Cursor ships a first-party ACP server**: `agent acp` (cursor.com/docs/cli/acp) — JSON-RPC
  2.0 over stdio with `initialize`/`authenticate`, `session/new`, `session/load`,
  `session/prompt`, streamed `session/update`, `session/request_permission`
  (allow-once / allow-always / reject-once), `session/cancel`, plus Cursor extensions:
  blocking `cursor/ask_question`, `cursor/create_plan`, `cursor/update_todos`,
  `cursor/task`, `cursor/generate_image`. Modes: `agent | plan | ask`. MCP loads from
  project/user `.cursor/mcp.json`.
  ADR 0002 deferred ACP migration explicitly "until Cursor ships native ACP support" —
  that condition is now met, so the ADR's spike gate applies.
- **Subagents are first-class in the CLI since Cursor 2.4** (cursor.com/docs/context/subagents):
  markdown definitions in `.cursor/agents/` (project) and `~/.cursor/agents/` (user), with
  compatibility loading from `.claude/agents/` and `.codex/agents/` (`.cursor/` wins name
  conflicts). Frontmatter: `name`, `description`, `model` (`inherit` or a model id),
  `readonly`, `is_background`. Built-ins: Explore, Bash, Browser. Background output lands in
  `~/.cursor/subagents/`; subagents return resumable agent IDs; nesting since 2.5.

The cross-provider subagent seam is already provider-neutral: `SubagentRenderer` and
`SubagentManager` (features/chat) consume the shared contracts `AgentMentionProvider`,
`ProviderTaskResultInterpreter`, and `ProviderSubagentLifecycleAdapter`
(`src/core/providers/types.ts`). Cursor already registers a `CursorTaskResultInterpreter`
with nested-tool extraction (`cursorTaskSubagent.ts`); it is missing agent storage, a
mention provider registration in `CursorWorkspaceServices`, and a settings UI.

## Decision frame

The spike settles the transport before the subagent implementation plan is executed,
because live subagent stream mapping is transport-dependent (NDJSON `tool_call` events via
`cursorStreamMapper` vs ACP `session/update` / `cursor/task` via the shared
`src/providers/acp/` normalizer). Building the mapping twice is the failure mode this
sequencing avoids.

- Spike outcome **GO** → sub-project 1 implements subagents on a Cursor-over-ACP runtime
  (reusing `src/providers/acp/`), and a new ADR supersedes ADR 0002.
- Spike outcome **NO-GO** → sub-project 1 implements subagents on the existing one-shot
  `stream-json` transport, and a new ADR reaffirms ADR 0002 with the recorded evidence.

The subagent **foundation** (storage, discovery, mentions, settings UI) is
transport-independent and is specced here; it is built as part of sub-project 1 regardless
of the spike outcome.

## Part A — ACP transport spike

### Harness

- Location: `dev/spikes/cursor-acp/` — a standalone Node script (`spike.mjs`) plus a
  `README.md` run protocol. No Obsidian or `src/` imports; plain stdio JSON-RPC. The
  harness is durable tooling (re-run against future Cursor releases), hence `dev/`, not
  `.context/`.
- Execution environment: a machine with an authenticated `cursor-agent` (the spike cannot
  run in CI or remote sandboxes). The script writes every raw JSON-RPC frame, both
  directions, to timestamped NDJSON capture files.
- Artifacts: raw captures stay local in `.context/` (never committed); findings and
  sanitized excerpt shapes are promoted to
  `docs/research/2026-06-cursor-acp-spike-findings.md`.

### Verification protocol

Each item records: request sent, frames received, verdict, excerpt.

1. **Handshake** — `initialize`/`authenticate`; record protocol version and advertised
   capabilities.
2. **Prompt round trip** — `session/new` → `session/prompt`; capture the full
   `session/update` vocabulary for text, thinking, and tool calls.
3. **Permissions** — trigger an unapproved write tool; verify `session/request_permission`
   semantics (allow-once / allow-always / reject-once) and what the agent does on reject.
4. **In-turn questions** — elicit `cursor/ask_question`; verify it blocks and the answer
   round-trips in-process (ADR 0002 criterion (a)).
5. **Session continuity (make-or-break)** — verify an ACP session lands in
   `~/.cursor/chats/<workspace-hash>/<session-id>/store.db` so the existing
   `cursorHistoryStore` hydration keeps working; verify `session/load` opens a session
   created by the one-shot CLI and vice versa; verify the session appears in `agent ls`
   (ADR 0002 criterion (b)).
6. **Subagents** — invoke a test `.cursor/agents/` definition (sync) and one with
   `is_background: true`; capture `cursor/task` / `session/update` shapes, nested tool
   events, agent IDs, and where background output lands.
7. **Plan mode** — run mode `plan`; capture `cursor/create_plan`; check interplay with the
   `.cursor/plans` path convention Claudian already exposes via `planPathPrefix`.
8. **MCP** — with a project `.cursor/mcp.json` present, verify servers load in an ACP
   session and how MCP tool approval surfaces (relevant to sub-project 3).
9. **Images** — send an ACP image content block in `session/prompt`; if accepted, this
   closes the current text-hint-only image gap as a side effect.
10. **Operational parity** — `session/cancel` behavior, model selection per session, and
    usage/token reporting compared to what `cursorStreamMapper` extracts today.

### Go/no-go criteria

GO requires all of:

- Items 3, 4, and 5 pass (interactive permissions, blocking ask_question, and session/
  history continuity — or, for 5, a clearly bounded migration story for history hydration).
- Item 2 event shapes are parseable by (or with bounded changes to) the shared
  `src/providers/acp/` update normalizer.
- No stability red flags (crashes, protocol drift between minor versions) during the spike.

Item 6's captures feed the subagent spec in either branch. ADR 0002 criterion (c) — adapter
trust/maintenance — is satisfied by first-party ownership; the spike only confirms the
protocol matches its documentation.

## Part B — Subagent foundation (transport-independent)

Mirrors the Codex/Opencode pattern on the shared seams; all paths below are new unless
noted.

- `src/providers/cursor/storage/CursorAgentStorage.ts` — load/parse/save markdown agent
  definitions with YAML frontmatter (`name`, `description`, `model`, `readonly`,
  `is_background`). Discovery roots in precedence order: `.cursor/agents/` (vault),
  `~/.cursor/agents/` (global), then compat roots `.claude/agents/` and `.codex/agents/`
  read-only (matching Cursor's own loading; `.cursor/` wins name conflicts). Built-in
  Explore/Bash/Browser entries are emitted as non-editable definitions.
- `src/providers/cursor/types.ts` (extend) — `CursorAgentDefinition`.
- `src/providers/cursor/agents/CursorAgentMentionProvider.ts` — extends
  `StorageBackedAgentMentionProvider<CursorAgentDefinition>`; source labels: `builtin`,
  `vault`, `global` (compat-root agents surface as `vault` with their origin noted in the
  description).
- `src/providers/cursor/app/CursorWorkspaceServices.ts` (edit) — instantiate storage +
  mention provider and return `agentMentionProvider` so the composer @-mention dropdown
  populates via the existing `ProviderWorkspaceRegistry` path.
- `src/providers/cursor/prompt/encodeCursorTurn.ts` (edit) — when a turn carries agent
  mentions, reference the agent by name in the encoded prompt (Cursor delegates natively
  via its Task tool from name/natural-language references; no special syntax required).
- `src/providers/cursor/ui/CursorAgentSettings.ts` — create/edit/delete modals for vault
  and global agents, registered in `CursorSettingsTab`; read-only listing for builtin and
  compat-root agents. Fields: name, description, model (inherit/picker), readonly,
  is_background, prompt body.
- Tests (TDD, mirrored paths): `tests/unit/providers/cursor/storage/`,
  `tests/unit/providers/cursor/agents/`, plus a capability/UI gating test per the parity
  tech-debt acceptance criteria ("assert both the flag and the visible UI behavior").

Out of scope for the foundation: async lifecycle adapter work
(`ProviderSubagentLifecycleAdapter`) until item 6 captures show whether background
subagents surface as lifecycle tools (Codex-style) or task results
(current `CursorTaskResultInterpreter` already detects `isBackground`).

## Part C — Transport-dependent layer (decided by the spike)

- **ACP branch (GO):** new `CursorAcpRuntime` built on `src/providers/acp/` (as Opencode
  does), keeping `cursorToolNormalization` for tool-name/SDK mapping where shapes overlap.
  `supportsPersistentRuntime` flips true; `setApprovalCallback`/`setApprovalDismisser`
  become real via `session/request_permission`; the AskUserQuestion auto-resume workaround
  (`cursorAskUserQuestion.ts`, `autoFollowUpText`) is retired; history hydration stays on
  `cursorHistoryStore` per item 5 evidence. The stream-json path remains for the read-only
  auxiliary runner (`CursorAuxCliRunner`) where one-shot is the right shape.
- **stream-json branch (NO-GO):** extend `cursorStreamMapper`/`cursorToolNormalization`
  with the subagent event shapes captured in item 6; everything else in Part B lands
  unchanged; one-shot limitations (auto-resume AskUserQuestion, `--trust` posture) remain
  and stay documented in the provider matrix.

## Roadmap impact

- Sub-project 2 (skills-first catalogs over `.cursor/skills/` + `.agents/skills/` with
  legacy compat) and sub-project 3 (project `.cursor/mcp.json` manager; `--approve-mcps`
  already wired) are transport-independent and follow this spec's outcome without rework.
- Sub-project 4 (unified safe-revert) is unaffected; spike incidentally confirms whether
  Cursor hooks (`afterFileEdit`) are usable as a snapshot trigger, but design happens in
  its own spec.
- Fork stays off the roadmap: Cursor has no fork (open feature request since Jan 2026) and
  the session store format is community-documented and unstable.

## Risks

- ACP server is new; protocol drift between Cursor releases. Mitigation: the spike harness
  is durable and re-runnable; pin findings to a recorded `cursor-agent` version.
- Session-store coupling: history hydration depends on the reverse-engineered `store.db`
  layout. The spike checks continuity, but Cursor may change the format; failure mode is
  degraded history reload, not data loss, since transcripts also exist under
  `~/.cursor/projects/*/agent-transcripts/`.
- Compat-root discovery may surprise users (Claude agents appearing under Cursor); the
  mention description labels the origin, and Cursor itself already loads them.

## Acceptance criteria

- [ ] Spike harness committed under `dev/spikes/cursor-acp/` with a run protocol a human
      can follow end-to-end.
- [ ] Findings doc in `docs/research/` with verdicts for all 10 items and sanitized shapes.
- [ ] New ADR recording the transport decision (supersedes or reaffirms ADR 0002).
- [ ] Subagent foundation lands per Part B with mirrored tests; Cursor agents are
      discoverable and @-mentionable at parity with Codex/Opencode UX.
- [ ] Live subagent runs render through the shared `SubagentRenderer` on the chosen
      transport, normalizing via the seam contracts (closes [[cursor-subagents]]
      acceptance criteria).
- [ ] Provider matrix in root `CLAUDE.md` updated to match actual flags.
