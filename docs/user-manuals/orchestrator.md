# Claudian — Orchestrator

**Orchestrator mode** turns a chat tab into a coordinator that decomposes a goal into independent worker tasks, proposes them as an inline plan, and — once you approve — spawns one background **worker tab** per task. The orchestrator tab waits for each worker to finish, then synthesizes a combined report.

Use it when a goal splits cleanly into 2-5 parallel tracks that don't depend on each other's output (audits, multi-area reads, parallel write-ups). For a single linear task, plain chat is faster. For a plan you want to review before implementation but with no parallelism, use [[plan-mode]] instead.

---

## Before you start

Set these once in **Settings → Claudian → Orchestrator**:

| Setting | What it does | Default |
|---------|--------------|---------|
| **Enable orchestrator mode** | Shows the orchestrator toolbar toggle and allows worker tabs to spawn from approved plans. | On |
| **Orchestrator system prompt** | Instructions appended to the main system prompt while orchestrator mode is on. The built-in default is pre-filled; edit it to customize, or restore that text to reset to the default. | Built-in |

The built-in prompt tells the main agent to emit a single fenced `orchestrator_plan` JSON block and then stop — no tools, no prose — until you approve. Override it only if you understand that contract; the inline plan widget parses that exact shape.

> Orchestrator mode is a wrapper around the active provider's normal turn. It works with any provider, but workers run as independent chat tabs and reuse the **Task** / subagent tool only when the provider supports it (Claude and Codex offer subagents; Opencode and Cursor do not). Without subagent support, workers can still complete read-only audits via Read / Grep / Glob and report back; they just can't fan out further.

---

## Turning orchestrator mode on

Each chat tab has its own orchestrator toggle in the input toolbar (the fork-shaped icon, **Orchestrator mode — parallel worker tabs**). Click it to open the **Orchestrator goal** modal.

The modal walks you through:

- **What orchestrator does** — main tab stays in charge, breaks work into parallel tracks, spawns worker tabs after approval.
- **Write your goal** — one clear outcome, scope boundaries, constraints the workers must respect (files, providers, tests).
- **Tips** — prefer independent workstreams, mention deliverables, keep it short.
- **What happens next** — your goal is sent in orchestrator mode, the agent drafts a plan, you approve to spawn workers.

Type your goal in **Your goal** and press **Start orchestrator**. The modal closes and the goal is sent as a normal user message — but this turn (and every later turn in this conversation) runs with the orchestrator system prompt appended.

If orchestrator mode is already on for the tab, the modal opens with an **Orchestrator mode is on for this chat** banner and an extra **Turn off orchestrator** button. Submit a new goal to steer the workers, or turn it off to revert to plain chat. An empty goal shows *"Enter a goal before starting orchestrator mode."*

> The toggle is hidden on worker tabs and when **Enable orchestrator mode** is off. Turning the global setting off also hides the toggle on every existing tab.

---

## What changes when it's on

Three things flip together for the active conversation.

| Change | Effect |
|--------|--------|
| **Prompt prefix** | The orchestrator system prompt is appended to the main system prompt for every turn. By default it instructs the agent to plan and delegate, never to do work itself, and to emit one fenced JSON block before stopping. |
| **Plan detection** | After each assistant turn ends, the rendered text is scanned for an `orchestrator_plan` JSON block. If found, the inline plan widget renders inside the assistant message. |
| **Tab role** | The conversation is flagged `orchestratorMode: true`. Its tab is treated as a parent for any worker tabs spawned from approved plans. Worker tabs cannot themselves enter orchestrator mode. |

The flag is per-conversation, so it survives reload, history switches, and forks. On a brand-new (blank) tab it's held in `pendingOrchestratorMode` until the first send creates the conversation, at which point it's promoted onto the conversation.

---

## The inline plan widget

When orchestrator mode is on and the assistant turn ends with a parseable plan block, the message renders an inline **plan card** below the assistant text. This is your approval surface.

The card contains:

- A header — **Spawn N worker tab(s)?** where `N` is the task count.
- A short list of tasks. Each task shows its **description** in bold (the human-readable label). The full per-worker prompt is hidden — workers receive it when you approve.
- Two action buttons in a footer:
  - **Spawn workers** (primary, call-to-action) — approves the plan.
  - **Cancel** — dismisses without spawning. Both buttons disable themselves on click so a plan can't be double-approved.

### What "Spawn workers" does

For each task, in order:

1. A new background worker tab is created. Worker tabs **bypass the Maximum tabs limit** — orchestrator runs are not throttled by the chat-tab cap.
2. The worker is registered against the orchestrator tab and labelled with the task description.
3. The task's `prompt` is auto-sent into the worker tab as its first user message.

The worker tab opens in the background — focus stays on the orchestrator tab. Tab badges in the tab bar are colored by role: workers carry a worker badge and the orchestrator carries an orchestrator badge.

### Plan JSON shape

The parser accepts either a fenced ```json ... ``` block or a bare object with the right `type`. The shape is:

```json
{
  "type": "orchestrator_plan",
  "tasks": [
    { "id": "1", "description": "Short task label", "prompt": "Full self-contained worker instructions." },
    { "id": "2", "description": "Another task", "prompt": "Full self-contained worker instructions." }
  ]
}
```

Each task needs all three string fields (`id`, `description`, `prompt`). Workers receive **no other vault context**, so every `prompt` must be self-contained — paths, files, expected output, read-only constraints, all spelled out.

> If the assistant emits prose or skips the JSON, no plan card appears. Re-prompt, or check the orchestrator system prompt under **Settings → Orchestrator**.

---

## Subagent delegation

The orchestrator delegates by spawning **chat-tab workers**, not by using the provider's `Task` / subagent tool from inside its own turn. Each worker is a real chat tab with its own runtime, its own session, its own model, and its own tool stream — visible in the tab bar, switchable, and cancellable like any other tab.

A worker tab:

- Shows in the tab bar as `Worker N · <task description>`. The orchestrator tab shows as `Orchestrator · <title>`.
- Streams its own response inline, with normal tool rendering — Read, Grep, Write, Edit, Task (when supported), Ask user question, etc.
- Has its conversation linked back to the orchestrator tab via `tab.orchestratorTabId`. Closing the orchestrator tab does not auto-close workers; closing a worker before it finishes is treated as an early exit (see below).

When the provider supports the `Task` tool (Claude, Codex), a worker can fan out further by spawning its own subagents inside its turn. This is provider-native subagent use, not a second orchestrator level — the orchestrator only watches the top-level worker turn.

---

## Reading orchestrator output

The orchestrator tab does not stream worker output. Instead, the **OrchestratorService** posts a short status message into the orchestrator tab each time a worker finishes:

| Event | Message posted to the orchestrator |
|-------|------------------------------------|
| Worker turn ends successfully | `Worker '<description>' finished: <final assistant text>` |
| Worker turn ends with an error (tool error or `Error:` in the response) | `Worker '<description>' failed: <final assistant text>` |
| Worker tab is closed before finishing | `Worker '<description>' was closed before completing.` |
| All workers in the fleet have reported | `All workers have reported. Please synthesize.` |

These are normal user messages on the orchestrator tab — the main agent sees them in the same conversation and responds in-thread, so its final synthesis follows the normal assistant render path.

The text used to report back is the worker's final assistant message body (from `collectAssistantReportText`). If the worker stream contained an `Error:` marker or any tool ended in `error`, the report is flagged as a failure. Each worker only reports **once**; duplicates are suppressed.

---

## Typical flow

1. Open a chat tab on a provider you trust for the task. Click the orchestrator toggle in the toolbar.
2. In the **Orchestrator goal** modal, write one clear outcome and any constraints (read-only? specific folders? tests required?). Press **Start orchestrator**.
3. The main agent responds with **only** a fenced `orchestrator_plan` JSON block. Claudian renders the **Spawn N worker tab(s)?** card beneath that reply.
4. Read the task descriptions. If they look right, press **Spawn workers**. One background worker tab opens per task and the per-task prompt is auto-sent. If they look wrong, press **Cancel** and reply with a correction; the agent will emit a new plan.
5. Switch into worker tabs as they stream. Answer any **Ask user question** cards. Workers can run tools, write files, and (on supporting providers) spawn their own subagents.
6. As each worker finishes, a status line lands in the orchestrator tab: `Worker '…' finished: …` or `… failed: …`. When the fleet is done, the orchestrator tab receives `All workers have reported. Please synthesize.` and the main agent writes a combined summary.
7. To run another fleet on the same conversation, click the orchestrator toggle again and submit a new goal. To stop using orchestrator mode, open the modal and press **Turn off orchestrator**.
