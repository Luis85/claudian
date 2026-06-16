---
title: Cursor ACP spike findings — AskUserQuestion / permission delegation gap
date: 2026-06-15
status: complete
scope: src/providers/cursor, src/providers/acp (Cursor-over-ACP transport evaluation)
method: ran dev/spikes/cursor-acp/spike.mjs against an authenticated cursor-agent (agent acp) on Windows; aggregated 14 NDJSON captures; cross-checked against cursor.com/docs/cli/acp and Cursor community bug reports
cli-version: 2026.06.04-5fd875e
related:
  - "[[docs/adr/0002-cursor-askuserquestion-transport]]"
  - "[[docs/superpowers/specs/2026-06-11-cursor-acp-spike-and-subagent-parity-design]]"
---

# Cursor ACP spike findings

Evaluates whether Cursor's first-party `agent acp` server delivers the blocking
`cursor/ask_question` (and `session/request_permission`) JSON-RPC requests that
ADR 0002's decision gate requires. **It does not, on `2026.06.04-5fd875e`.**

The headline: **the `AskUserQuestion` capability is not available to us over ACP
on this CLI version.** The protocol *documents* it, but the running server never
emits it — it answers questions as plain assistant text and performs file edits
server-side without ever delegating back to the client.

## Environment

- Transport probed: `agent acp` (Cursor's first-party ACP server), launched via
  the bundled `node.exe` + `index.js` under
  `%LOCALAPPDATA%\cursor-agent\versions\2026.06.04-5fd875e\`. Confirmed real ACP
  (not the one-shot stream-json CLI): `spike.mjs` line 194 spawns `['acp']`.
- CLI version: `2026.06.04-5fd875e`.
- `~/.cursor/cli-config.json`: `approvalMode: "allowlist"`, `permissions.allow:
  ["Shell(**)"]`, `sandbox.mode: "disabled"`.

## Method note: client capabilities matter (but did not fix the gap)

Cursor's docs and a community report
([forum thread](https://forum.cursor.com/t/acp-support-session-list-method/156222))
show the server only behaves correctly when the client advertises real
capabilities on `initialize`. The spike originally sent
`clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } }`
(no `terminal`) — i.e. "client cannot do fs/terminal work". That is a plausible
reason a server would handle everything itself.

The spike was corrected to advertise the full set the docs use:

```json
{ "fs": { "readTextFile": true, "writeTextFile": true }, "terminal": true }
```

…plus non-interactive client-side handlers for `fs/read_text_file`,
`fs/write_text_file`, `terminal/*`, an `--auto-answer` mode for
permission/ask_question requests, and a `--prompt-file` option (PowerShell
`Start-Process -ArgumentList` silently truncates multi-word `--prompt` values on
spaces — an early "full caps" run sent only the word `Use`, invalidating it).

**With the corrected full-capability client, the gap persisted.** So the missing
delegation is a server-side / version behavior, not (only) a client
misconfiguration.

## Verdict table

| # | Item | Verdict | Evidence |
|---|------|---------|----------|
| 1 | Handshake | PASS | `initialize` → `protocolVersion: 1`; `agentCapabilities: { loadSession: true, mcpCapabilities, promptCapabilities.image: true, sessionCapabilities.list }`; `authMethods: [cursor_login]`. **No ask_question/permission capability advertised.** |
| 2 | Prompt round trip | PASS | `session/new` → `session/prompt`; streamed `agent_message_chunk`, `agent_thought_chunk`, `tool_call`/`tool_call_update`, `available_commands_update`, `session_info_update`, `user_message_chunk`. Parseable by the shared `src/providers/acp/` normalizer. |
| 3 | Permissions | **FAIL** | File-edit prompt with **full caps + auto-answer**: `tool_call(kind=edit)` → `in_progress` → `completed`, no `session/request_permission`, no `fs/write_text_file` delegation. Agent wrote `spike-perm-acp.txt` (content `ok`) **itself**, server-side. Shell auto-approves via the `Shell(**)` allowlist. |
| 4 | In-turn question (ADR 0002 criterion a) | **FAIL** | Four prompts across two CLI states (incl. explicit "use the AskUserQuestion tool" and full caps). Every run: plain `agent_message_chunk` text ("Which do you prefer: red or blue?") then `stopReason: "end_turn"`. **No `cursor/ask_question` server request, ever.** Model thought verbatim: *"I don't have a tool to ask the user a question directly, so I'll just pose it in my response instead."* |
| 5 | Session continuity | **PASS** | `session/load <id>` returns full `{ modes, models, configOptions }` and **replays prior turns** as `user_message_chunk`/`agent_message_chunk`; resumed prompt answered correctly ("pong"). Cursor's native session/history model survives ACP. |
| 6–10 | Subagents / plan / MCP / images / cancel | NOT RUN | Blocked: items 3 and 4 fail, so the GO gate already cannot be met. Item 1 confirms `promptCapabilities.image: true`, so ACP image input is plausible for later. |

## Aggregate evidence (14 captures)

Across **every** capture (handshake, prompt, resume; both capability states):

- **Server→client REQUEST methods observed: NONE.** Not `cursor/ask_question`,
  not `session/request_permission`, not `fs/*`, not `terminal/*`. The agent never
  initiated a single blocking request back to the client.
- `session/update` kinds seen: `agent_message_chunk` (139), `agent_thought_chunk`
  (19), `available_commands_update` (9), `session_info_update` (7),
  `tool_call_update` (6), `tool_call` (3), `user_message_chunk` (3).
- `initialize` `agentCapabilities` never lists any `cursor/*` extension or a
  permission/question capability.

Notably, the CLI's own `available_commands_update` advertises a
`multi-model-review` command described as *"Pick models via ask_question
(multi-select)…"* — so `ask_question` exists **internally** to Cursor, but is not
surfaced as an ACP server→client request to external clients on this version.

## Cross-check with Cursor docs and community

- [cursor.com/docs/cli/acp](https://cursor.com/docs/cli/acp) **documents**
  `session/request_permission` and the blocking extensions `cursor/ask_question`,
  `cursor/create_plan` as part of the protocol. So the spec author was not wrong
  about the *design*; the running server just doesn't emit them here.
- [Cursor community bug report](https://forum.cursor.com/t/acp-permission-rejection-not-reported-to-client/153825):
  *"`session/request_permission` is never sent, so the client can't present a
  permission dialog at all"* and *"`tool_call_update` reports `status:
  "completed"` even when the tool call is rejected internally."* This **matches
  our item 3 observation exactly** and indicates a known, still-open Cursor ACP
  defect, not a Claudian integration error.

## Decision-gate result

The spec's GO gate requires items **3, 4, and 5** to pass. Result: **5 passes;
3 and 4 fail.** → **NO-GO** on this CLI version.

Cross-referenced to ADR 0002's gate:

- Criterion (a) "AskQuestion round-trips in-process and the agent acts on the
  answer within the same turn" — **NOT MET** (item 4).
- Criterion (b) "native history/session model preserved" — **MET** (item 5),
  which is the encouraging part for a future migration.
- Criterion (c) adapter trust — **N/A / satisfied**: this is Cursor's first-party
  server, so there is no third-party dependency concern.

## What this means for our Cursor integration

1. **Keep the shipped resume-based AskUserQuestion path** (`cursorAskUserQuestion.ts`,
   `ChatTurnMetadata.autoFollowUpText`, `InputController.autoResumeWith()`).
   ADR 0002 stays in force; this spike **reaffirms** it with hard evidence rather
   than superseding it.
2. **Do not migrate Cursor to a `CursorAcpRuntime` yet.** Over ACP today we would
   *lose* the ability to (a) intercept AskUserQuestion at all and (b) gate tool
   permissions — both of which the current stream-json path handles (the CLI
   self-rejects AskUserQuestion, which we detect and convert to a resumed turn;
   permissions ride the `--trust` / allowlist posture). ACP would be a net
   regression on permission visibility right now.
3. **The subagent foundation (Part B) remains transport-independent** and is
   unaffected — it can land on the existing stream-json transport.
4. **Re-run trigger:** when a future `cursor-agent` actually emits
   `session/request_permission` and `cursor/ask_question` to an external ACP
   client (track the community bug above), re-run `spike.mjs` and revisit. The
   harness is durable and now correctly declares client capabilities.

## Reproduction

```powershell
$agent = Join-Path $env:LOCALAPPDATA "cursor-agent\agent.cmd"
$node  = "C:\Program Files\nodejs\node.exe"

# Item 4 — ask_question (expect: plain text, no cursor/ask_question)
# (prompt via file to dodge PowerShell arg-splitting)
Set-Content .context\ask-prompt.txt "Before doing anything else, you MUST ask me which of two options I prefer: red or blue. Use your AskUserQuestion / ask_question tool, then wait."
& $node dev/spikes/cursor-acp/spike.mjs --scenario prompt --bin $agent --auto-answer --prompt-file .context\ask-prompt.txt

# Item 3 — permissions (expect: edit completes, no session/request_permission)
Set-Content .context\perm-prompt.txt "Create a new file named spike-perm-acp.txt containing exactly the word: ok"
& $node dev/spikes/cursor-acp/spike.mjs --scenario prompt --bin $agent --auto-answer --prompt-file .context\perm-prompt.txt

# Compare under-declared caps (original behavior):
& $node dev/spikes/cursor-acp/spike.mjs --scenario prompt --bin $agent --minimal-caps --prompt-file .context\ask-prompt.txt
```

Note: on Windows, `&` with a space-containing exe path can swallow stdout in some
shells; the spike also writes every frame to
`.context/cursor-acp-captures/*.ndjson` (the canonical record) and you can
redirect with `Start-Process -RedirectStandardOutput`.
