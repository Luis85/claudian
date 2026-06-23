---
type: feature
name: Agent Loops
tagline: Reusable playbooks your assistant follows. Attach one to a work order and it works the steps the same way every time.
status: shipped
personas:
  - knowledge-worker
  - pm
cta_url: https://github.com/Luis85/specorator
related:
  - "[[Agent Kanban Board]]"
  - "[[Quick Actions]]"
parent: "[[Agent Kanban Board]]"
---

# Agent Loops

You have a way you like things done. Bugs get reproduced before they get fixed. Research ends in a written recommendation, not a pile of tabs. Refactors stay behind a test so nothing breaks. But every time you hand a job to the assistant, you retype that approach from scratch — and if you forget a step, the result drifts.

**Agent Loops** lets you save that approach once and reuse it. A loop is a small playbook — *Use when, Approach, Steps, Verify, Notes* — that you attach to a work order on the [[Agent Kanban Board]]. When the card runs, the loop's guidance travels with it, so the assistant works the same disciplined steps every time instead of improvising a new method on each run.

Use a loop when you have a repeatable shape of work — a bug-fix loop, a refactor loop, a research-spike loop — and you want every run of that kind to follow it.

---

Loops live in a folder in your vault, just like your work orders and templates. Each loop is an ordinary Markdown note you can read, edit, sync, and share. Specorator ships a starter set you can install with one click — curated and adapted from the [Forward-Future loop library](https://github.com/Forward-Future/loop-library) — and you can write your own.

Attaching is one step. Open a work order, click the **Loop** chip, and pick a loop from the list — or set a **default loop** on a work-order template so every card made from that template starts with it already attached. From then on, when the card runs, the loop's approach, steps, and verify check fold into the instructions the assistant follows.

![[agent-loops-overview.png]]
<!-- screenshot: work-order detail panel with the Loop chip open, the loop picker listing a few loops with their "Use when" lines, and a loop note open as Markdown alongside -->

The loop and the run stay readable. The *Use when* line helps you pick the right loop, and the *Approach, Steps, Verify, Notes* are what the assistant actually works through. The folder is yours, so you can version it, back it up, or hand a teammate your house style as a handful of notes.

A loop might be "reproduce, then fix, then verify", "characterize with a test, then refactor", or "time-box the research and end with a recommendation". The work changes; the discipline stays the same.

---

### What it does

- Save a reusable playbook as a Markdown note in a loop folder you choose
- Structure each loop as Use when / Approach / Steps / Verify / Notes
- Install a starter set of common loops from settings, or write your own
- Attach one loop to a work order from the **Loop** chip in the card's detail panel
- Set a **default loop** on a work-order template so new cards start with it attached
- Fold the loop's approach, steps, and verify check into the run so the assistant follows it
- Browse, create, edit, and delete loops from an in-app picker, or edit the notes directly

### When to use a loop

- You have a kind of work you do the same way every time and want runs to match it
- You keep restating the same method in a card's instructions and want it saved once
- You want every card made from a template to start with a known approach
- You want a verify step the assistant aims for before it hands the work back
- You want your house style to live in your vault as notes you can share

### What it doesn't do

- A loop does not re-run the card on its own. It guides a single run; it does not loop the assistant until the verify check passes.
- One loop per work order. Loops are not stacked or chained on a single card.
- The *Use when* line is for picking the loop. It is shown in the picker and is not sent to the assistant.
- A loop does not change the engine, the model, or the permissions. It only adds guidance to the run.
- Loops are not templates. A template seeds a card's body once; a loop is guidance that rides along every time the card runs.

### Goes well with

- [[Agent Kanban Board]]: attach a loop to any card, or set a default loop on a template so every card from it inherits the approach
- [[Quick Actions]]: a quick action fires a one-off prompt; a loop is the saved method a tracked work order follows

---

## Get Specorator

Install via BRAT or the Obsidian community plugins directory.

**→ [GitHub — Luis85/specorator](https://github.com/Luis85/specorator)**

Already installed? Find loops on any work order's **Loop** chip, and install the starter set from **Settings → Specorator → Agent Board → Install common loops**.
