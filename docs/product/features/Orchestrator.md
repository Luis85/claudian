---
type: feature
name: Orchestrator
tagline: Split a goal into independent tasks, run them in parallel, get one answer that brings them all together.
status: draft
personas:
  - knowledge-worker
  - pm
cta_url: https://github.com/Luis85/specorator
related:
  - "[[Chat]]"
  - "[[Multi Provider Support]]"
  - "[[Agent Kanban Board]]"
user_manual: "[[docs/product/user-manuals/orchestrator]]"
---

# Orchestrator

Some goals split into three or four pieces that don't depend on each other. *Compare four vacation rentals on price, location, and reviews. Read these three contracts and tell me what to ask about. Draft four versions of this difficult email. Summarize the last six articles I bookmarked.* Running them one chat at a time is doing in series what could happen at the same time.

**Orchestrator** takes a goal, breaks it into independent pieces, runs them at the same time, and folds the results into one combined answer when they're all done.

---

Running four chat tabs side by side is not the same thing. Each tab is still a person at a keyboard, deciding when to start the next one. Orchestrator dispatches workers that each take one piece of the job, watches them stream, and combines the results for you.

You write the goal. Orchestrator proposes a way to split it into parallel pieces. You can edit the list before anything runs, or send it back for a re-plan. Each piece runs as its own session, with full access to the vault and whatever context you attached to the parent.

<!-- screenshot: orchestrator view with a goal at the top, a tree of 4 workers streaming live, and a combined-answer panel ready to render -->

When every worker finishes, a final pass reads all of their outputs and writes the answer you actually wanted. The whole run, including the goal, the pieces, the worker outputs, and the combined answer, is saved as a vault note you can re-read or re-run.

---

### What it does

- Takes a goal and proposes a way to split it into independent parallel pieces
- Lets you edit the plan before any worker starts
- Dispatches each piece as its own session on the engine you choose
- Streams live progress for every worker on a single tree view
- Stops any worker without stopping the rest of the run
- Combines all worker outputs into one answer once every piece has finished
- Saves the full run as a vault note: goal, plan, worker outputs, combined answer

### What it doesn't do

- Step-by-step work where each step needs the previous step's output is not supported. Run those in one chat tab.
- Workers do not talk to each other during the run. Write the plan so they do not need to.
- Background runs are not supported. A run lives only until the combined answer is written or you stop it.
- Scheduled or repeating runs are not supported. Orchestrator dispatches once when you start the run.

### Goes well with

- [[Multi Provider Support]]: assign each worker to a different engine; one engine can handle research while another drafts the email
- [[Agent Kanban Board]]: send a long orchestrator run to the board so you can step away while it works
- [[Chat]]: when a worker's answer needs follow-up, open it as a chat tab and continue interactively

---

## Get Specorator

Install via BRAT or the Obsidian community plugins directory.

**→ [GitHub — Luis85/specorator](https://github.com/Luis85/specorator)**

Already installed? Open this feature from **Settings → Specorator → Orchestrator**.
