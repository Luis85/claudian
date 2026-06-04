---
type: product
name: Specorator
tagline: Plan the work, run it, review what came back, keep the record. All in your vault.
status: shipped
features:
  - "[[Chat]]"
  - "[[Multi Provider Support]]"
  - "[[Quick Actions]]"
  - "[[Orchestrator]]"
  - "[[Agent Kanban Board]]"
roadmap: "[[Specorator Agent Harness PRD]]"
cta_url: https://github.com/Luis85/specorator
date: 2026-05-30
revised: 2026-06-04
---

# Specorator

You're already using AI for serious work. Drafting emails. Planning trips. Comparing options. Reading the long report you don't want to read yourself. The conversations help, but the moment you close the tab, the work is gone. Tomorrow you start again from scratch.

**Specorator** brings that work inside your Obsidian vault. The drafts, plans, summaries, and edits land in notes you keep. Conversations are saved too, so you can pick one up tomorrow instead of starting fresh.

<!-- screenshot: Specorator open in Obsidian, showing the chat sidebar beside a note, the board in a tab, and the settings panel on the right -->

---

## What it solves

- Typing the same prompts every day. Save any prompt as a vault note and fire it from a one-tap picker.
- Being locked into one tool's UI for one provider. Use whichever providers you have access to, in one workspace.
- Goals too big for a single chat. Split the work into pieces that run at the same time and get one combined answer.
- AI work scattering across thirty open tabs. A board tracks every handoff from inbox to done.
- The agent quietly changing your notes. Preview every edit before it lands, or flip on YOLO mode when you trust the run.

## What you get

- Hours back on the work that wears you down. Summaries, comparisons, first drafts, and long reads happen while you do the next thing.
- A workspace where every chat, plan, and draft lands as a note you can find again, not a tab you close and forget.
- The right level of oversight, set by you. Read every change before it lands, or hand the run to YOLO mode.
- Use of whatever AI access you already pay for. One workspace, no separate login per tool.
- A clear record of how a decision got made. Useful when the email lands a week later, when the contract needs a second look, when someone asks how you settled on it.

---

## What's inside

| Feature                    | What it is                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| [[Chat]]                   | A workspace beside your notes that already knows what you're looking at and what you've highlighted.     |
| [[Multi Provider Support]] | Different engines for different jobs. Pick the one that fits the moment.                                 |
| [[Quick Actions]]          | Your most-used prompts, one tap away. Stored as vault notes you own.                                     |
| [[Orchestrator]]           | Split a goal into independent tasks, run them in parallel, get one answer that brings them all together. |
| [[Agent Kanban Board]]     | A board for things you have handed off. Inbox to done, never lost in chat history.                       |

## What this is not

- Not a code-only tool. The plugin is for anyone who works in notes. Writers, planners, researchers, students, small-business owners, parents, anyone keeping track of thinking in their vault.
- Not a hosted service. Your notes live on your computer. No account is required.
- Not a single-provider lock-in. Use whichever providers you have access to. If you only have one, that is fine; the workspace works the same.
- Not magic. You decide the level of oversight. Preview every change before you accept it, or flip on YOLO mode and let the agent run on its own. The setting is yours.
- Specorator sits inside Obsidian and respects how Obsidian works. If you leave Specorator, your notes are still ordinary Markdown.

---

## Who it's for

If you keep your thinking in a vault and you want help with the mechanical parts of that thinking, this is for you. You don't need to know what an API is. You don't need to write code. You need a folder of notes and a willingness to treat the AI provider less like a search bar and more like a co-worker you give work to. Start with one chat in the sidebar. When you catch yourself typing the same prompt twice, save it as a Quick Action your co-worker can run on tap. When one question turns into four, hand all four to the Orchestrator and let it split the load. When the list of things you've handed off starts to slip, open the board and treat it like a shared backlog between the two of you.

---

## Where it's heading

Specorator is the v1 name for the plugin built on the Claudian codebase, shipped once the foundation underneath it is stable and safe enough to hand to someone who has never opened a terminal. The plan that gets us there is the **[[Specorator Agent Harness PRD]]**.

The short version of that plan: keep the depth Specorator already has — real AI engines, working side by side, with your notes underneath — and close the three things that today still ask too much of a non-technical person.

- **Setup without a terminal.** Install, paste one key, ask your first question. No command line, no hunting for where a program lives, no error you can't read.
- **Trust you can see and take back.** Every change shown before it lands, and a single "undo everything" that works no matter which engine made the change — not just one of them.
- **An assistant that actually knows your vault.** It follows your links, reads your tags and properties, finds the note you half-remember, and carries what it learns about your work from one day to the next — instead of treating your vault as a plain folder of files.
- **Set it up by tapping, not by editing files.** The things that shape your assistant — saved workflows, connected tools, and standing rules like "always cite sources" — live in the same one-tap surface as Quick Actions. No config files, no JSON, no provider-specific folders. Set a rule once and every engine follows it.

Underneath those, the same plan adds sensible spending limits and a security model designed so a booby-trapped web clip or PDF can't quietly turn your assistant against your own notes.

The goal behind all of it: bring the power of frontier AI coding tools to anyone who keeps their thinking in a vault — without the terminal, the setup, or the jargon.

---

## Get Specorator

Install via BRAT or the Obsidian community plugins directory.

**→ [GitHub — Luis85/specorator](https://github.com/Luis85/specorator)**

Already installed? Open **Settings → Specorator** to point it at the providers you have, then open the chat sidebar from the ribbon or the command palette.
