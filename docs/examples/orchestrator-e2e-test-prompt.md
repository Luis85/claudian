# Orchestrator end-to-end test prompt

Use this example to manually sanity-check **Orchestrator mode** with the **Cursor** provider inside Claudian’s Obsidian chat sidepanel. The goal is read-only: it exercises plan approval, worker tab spawning, Cursor stream/tool rendering, AskUserQuestion, structured worker output, and orchestrator synthesis without modifying the repo.

## Prerequisites

1. **Orchestrator enabled** — Settings → Orchestrator → *Enable orchestrator mode* is on.
2. **Cursor provider selected** — Active chat tab uses Cursor (CLI installed and authenticated).
3. **Orchestrator toggle on** — Click the orchestrator toolbar control, paste the goal below into the modal, and submit.

Workers spawned from the plan have **no vault context**. Each worker prompt in the orchestrator plan must be self-contained; the primary goal below is written so the orchestrator can split it into 2–5 independent, read-only tasks.

---

## Primary orchestrator goal

Copy everything inside the fence and paste it into the **Orchestrator goal** modal.

```text
Run a read-only orchestrator smoke audit of the Claudian repository at the workspace root. Decompose this into 2–5 independent worker tasks (no task may depend on another task’s output). Every worker must use read-only tools only: Read, Grep, Glob, and Task with readonly=true if available. Do not Write, Edit, Delete, run Shell commands that change files, commit, or upgrade dependencies.

Worker coverage requirements (one task per bullet, or combine only when still independent):

1. **npm scripts probe** — Read or Grep `package.json` at the repo root and report the exact script commands for `typecheck`, `test`, and `lint` (names and command strings).

2. **Architecture Q&A** — Read the Architecture section in `CLAUDE.md` at the repo root. Use AskUserQuestion to ask the human which layer they want summarized: app, core, features, or providers. After the human answers, return a short markdown checklist (3–5 `- [ ]` items) naming key folders/files in that layer with one-line descriptions. Do not write files.

3. **Orchestrator file map** — Grep or Glob under `src/features/chat/` for files matching orchestrator-related names (Orchestrator, orchestrator, InlineOrchestratorPlan). Return a markdown checklist of paths with a one-line purpose each. Read-only.

4. **StreamController test audit** — Grep `tests/unit/features/chat/controllers/` for references to `StreamController`. If Task/subagent is supported, you may spawn a readonly explore subagent to double-check; otherwise Grep alone is fine. Return a bullet list of matching test file paths.

5. **Worker tab discipline** — Each worker finishes in its own tab. End every worker turn with a single-line summary prefixed `DONE:` so the orchestrator can report back clearly.

When all workers finish, synthesize a combined QA report: table or bullet list mapping each worker to its finding, plus one sentence on whether orchestrator tab isolation and report-back looked healthy.
```

---

## How to run

1. Open Claudian chat → select **Cursor** provider.
2. Enable **Orchestrator mode** (toolbar) → paste the goal above → **Start orchestrator**.
3. Wait for the orchestrator tab to emit a fenced `orchestrator_plan` JSON block (no tools before approval).
4. Review tasks in the inline plan card → **Spawn workers**.
5. Switch to each worker tab as needed; answer any **AskUserQuestion** card when it appears.
6. Return to the orchestrator tab for worker finish messages and final synthesis.

---

## Expected observations

Use this checklist after a full run:

- [ ] Orchestrator tab responds with **only** a fenced JSON plan (`type: orchestrator_plan`, 2–5 tasks) before any tool use.
- [ ] Inline plan UI shows task labels and **Spawn workers** / **Cancel** actions.
- [ ] Approving the plan opens **one worker tab per task**; worker titles reflect task descriptions.
- [ ] At least one worker shows **Read** or **Grep** tool activity against repo files (e.g. `package.json`, `CLAUDE.md`).
- [ ] No worker performs destructive edits (no Write/Edit/Delete or mutating Shell in the stream).
- [ ] One worker surfaces an **AskUserQuestion** card with selectable options; answering lets the worker continue.
- [ ] At least one worker returns a **markdown checklist** (`- [ ]` items) in its final message.
- [ ] Optional: a worker uses **Task** / subagent tooling for a read-only audit (visible in tool stream or subagent renderer).
- [ ] Orchestrator tab receives `Worker '…' finished: …` messages as workers complete.
- [ ] After all workers report, orchestrator receives **“All workers have reported. Please synthesize.”** and produces a combined summary.

---

## Optional variants

### Shorter smoke test (1–2 workers)

Paste this instead when you only need a quick pass:

```text
Read-only smoke test with two workers: (1) Grep package.json for the test script command and report it; (2) Read the first 40 lines of CLAUDE.md and return a 3-item markdown checklist of project layers mentioned. No writes, no shell. Each worker ends with DONE: and a one-line summary.
```

### Cancel / failure notes

- **Cancel plan** — Click **Cancel** on the inline plan card. Expect no worker tabs and no spawn.
- **Close a worker tab early** — Orchestrator should receive `Worker '…' was closed before completing.` and still wait for remaining workers (or synthesize when the fleet is done).
- **Skip AskUserQuestion** — If the UI allows skip/decline, worker should continue or exit gracefully without hanging the orchestrator fleet.

If the orchestrator emits prose instead of JSON, or uses tools before plan approval, check Settings → Orchestrator system prompt and that orchestrator mode is on for the tab.
