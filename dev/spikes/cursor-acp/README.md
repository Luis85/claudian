# Cursor ACP spike

Validates Cursor's first-party `agent acp` mode against the criteria in
`docs/superpowers/specs/2026-06-11-cursor-acp-spike-and-subagent-parity-design.md`
(Part A). Reopens ADR 0002.

## Prerequisites

- The Cursor CLI installed and authenticated (`agent status`). Since the
  Jan 2026 CLI release the binary is `agent`; older installs expose the
  `cursor-agent` alias instead — the harness auto-detects either, and the
  commands below say `agent` (substitute `cursor-agent` on older installs).
- Record the version next to every capture: `agent --version`.
- Run from a disposable test vault/workspace, not your real vault.
- **Windows:** PowerShell's `agent` command is `agent.ps1`; Node cannot spawn
  that directly. The harness auto-discovers `%LOCALAPPDATA%\cursor-agent\agent.cmd`
  (or pass `--bin` explicitly). It spawns the bundled `node.exe` + `index.js`
  when present, otherwise wraps `.cmd` shims through `cmd.exe` (avoids `spawn
  EINVAL` on Node 18+).
- Captures land in `.context/cursor-acp-captures/` (gitignored territory —
  never commit raw captures; promote sanitized excerpts to the findings doc).

## Harness

```bash
node dev/spikes/cursor-acp/spike.mjs --scenario <name> [--bin <agent-binary>] \
  [--cwd <workspace>] [--prompt "<text>"] [--resume <sessionId>] \
  [--mode plan|ask|agent] [--image <path>] [--cancel-after <ms>] \
  [--capture <dir>] [--as-notification]
```

Scenarios: `handshake`, `prompt`, `resume`, `raw` (ad-hoc JSON-RPC REPL).
Server-initiated requests pause for your answer in the terminal. Every frame is
captured to NDJSON. If Cursor's `initialize`/`session/new` parameter shapes
differ from the ACP defaults the script sends, use `--scenario raw` to probe
the correct shape, then adjust the script and note the delta in the findings.
`--capture <dir>` overrides the capture location; `--as-notification` sends raw-mode frames without an auto-assigned id. In `raw` mode, answer or `exit` the `raw>` prompt before triggering server-initiated requests — the prompt and request answering share one readline.

## Test agent fixtures

Before item 6, create these in the test workspace:

`.cursor/agents/spike-echo.md`
```markdown
---
name: spike-echo
description: Spike test agent. Summarizes a file in one sentence.
---
You are a test subagent. Read the file you are pointed at and reply with a
one-sentence summary prefixed with "ECHO:".
```

`.cursor/agents/spike-background.md`
```markdown
---
name: spike-background
description: Spike test background agent.
is_background: true
---
Count the markdown files in this workspace and report the number.
```

## Protocol (record verdict + capture file per item)

| # | Item | How |
|---|------|-----|
| 1 | Handshake | `--scenario handshake`. Record protocol version + advertised capabilities/auth methods from the response. If an `authenticate` step is required, probe it via `--scenario raw`. |
| 2 | Prompt round trip | `--scenario prompt --prompt "Reply with the single word: pong"`. Capture the full `session/update` vocabulary (text deltas, thinking, tool calls). |
| 3 | Permissions | `--scenario prompt --prompt "Create a file named spike-permission-test.txt containing the word ok"`. A `session/request_permission` must arrive; exercise allow-once, then re-run and exercise reject. Record what the agent does after reject. |
| 4 | In-turn question (ADR 0002 criterion a) | `--scenario prompt --prompt "Before doing anything, ask me which of two options I prefer: red or blue. Use a question, then wait."`. A blocking `cursor/ask_question` should arrive; answer it and confirm the same turn continues in-process. |
| 5 | Session continuity (make-or-break) | After item 2: (a) `agent ls` — does the ACP session appear? (b) check `~/.cursor/chats/<workspace-hash>/<sessionId>/store.db` exists and gains blobs; (c) `--scenario resume --resume <id> --prompt "What word did you reply with earlier?"` against the ACP session; (d) create a session with `agent -p "say hi" --output-format stream-json`, then `session/load` it via `--scenario resume`; (e) the reverse: resume the ACP session with `agent --resume <id> -p "continue"`. |
| 6 | Subagents | With fixtures in place: `--scenario prompt --prompt "Use the spike-echo subagent to summarize README.md"`. Then `--prompt "Run the spike-background subagent"`. Capture `cursor/task` / `session/update` shapes, nested tool events, agent ids, and where background output lands (`~/.cursor/subagents/`?). |
| 7 | Plan mode | `--scenario prompt --mode plan --prompt "Plan how you would rename a function used in 3 files"`. Capture `cursor/create_plan` / `cursor/update_todos` and whether a plan file lands under `.cursor/plans/`. |
| 8 | MCP | Add a trivial server to `<workspace>/.cursor/mcp.json`, re-run item 2's command, and capture how MCP tools surface and how their approval arrives. |
| 9 | Images | `--scenario prompt --image <png> --prompt "Describe this image in five words"`. If the prompt is rejected, record the error shape — that is itself the finding. |
| 10 | Operational parity | `--cancel-after 1500` on a long prompt (cancel semantics); `--scenario raw` probe for model selection on `session/new`; record any usage/token reporting frames seen across items 2–9. |

## Wrap-up

1. Findings → `docs/research/2026-06-cursor-acp-spike-findings.md` (frontmatter:
   `title`, `date`, `status`, `scope`), one verdict row per item + sanitized
   frame excerpts + the `agent --version` used.
2. GO/NO-GO per the spec's criteria (items 3, 4, 5 must pass for GO).
3. New ADR in `docs/adr/` superseding or reaffirming ADR 0002.
4. Part C implementation plan follows the verdict.
