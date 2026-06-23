---
type: feature
name: Agent Roster
tagline: Build the specialist once. Give it a brief, the right tools, and a name. Then hand work to it by name.
status: shipped
personas:
  - knowledge-worker
  - pm
cta_url: https://github.com/Luis85/specorator
related:
  - "[[Co-Worker - Chat]]"
  - "[[Agent Kanban Board]]"
  - "[[Multi Provider Support]]"
user_manual: "[[agent-roster]]"
image: "[[agent-roster-overview.png]]"
---

# Agent Roster

You keep explaining the same thing. "You're my research analyst — only read, never write, pull from these notes, and give me the sources." Next session you say it again. And again. Every helper starts as a blank slate that forgets who it was supposed to be the moment you close the tab.

**Agent Roster** is where you build a helper once and keep it. You give it a name, a short brief, the instructions it should always follow, and the exact set of tools it's allowed to touch. From then on you call it by name instead of describing it from scratch.

Use it when you have a recurring kind of work that deserves a dedicated specialist: a research analyst that only reads and cites, an editor that rewrites in your voice, a planner that drafts work orders. Define it in the roster, then put it to work in chat or on the board.

---

An agent is a small, saved profile. You pick a name and a colour, write the brief that says what it's for, and write the instructions it carries into every conversation. You grant it tools — and only those tools, so a read-only analyst can never write to your vault by accident. You can suggest the skills it should reach for, and pin a preferred model if you want it to always run on a particular one.

![[agent-roster-overview.png]]
<!-- screenshot: the Agent Roster view with a grid of agent cards (each with avatar, name, description), one card's "Start chat" action highlighted, and the detail editor open on the right showing name, instructions, granted tools, skills, and model -->

There are three ways to put an agent to work. Start a chat straight from its card and the conversation opens already bound to it — a chip in the header shows who you're talking to. Type `@` in any chat to pull an agent in by name. Or assign one to a card on the [[Agent Kanban Board]] so the work order runs as that specialist.

When a conversation is bound to an agent, its brief and instructions lead the conversation, it sees only the tools you granted it, and — if you pinned one — it runs on its preferred model. Switch that conversation to a provider the agent's model doesn't belong to, and it quietly falls back to that provider's default instead of sending a model id that doesn't fit.

Your agents are plain JSON files under `.specorator/agents/`, one per agent. The folder is yours to sync, back up, version, or hand-edit.

---

### What it does

- Build named agents with a brief, instructions, a colour and avatar, granted tools, suggested skills, and an optional pinned model
- Scope each agent to the tools you grant it — a bound conversation only sees those, so a read-only specialist can't write
- Start a chat already bound to an agent, with a header chip showing who you're chatting with
- Pull any agent into a chat by name with an `@` mention
- Assign an agent to an [[Agent Kanban Board]] work order so the run executes as that specialist
- Pin a preferred model per agent; it applies on its own provider and steps aside for the default on others
- Use agents across every engine — Claude, Codex, Opencode, and Cursor
- Sync agents out to your providers so they show up as @-mentionable subagents there too
- Keep everything as editable JSON under `.specorator/agents/`

### When to use an agent instead of a one-off chat

- You do the same kind of work often enough that re-describing the helper is a chore
- You want a helper locked to a safe, specific set of tools every time
- You want a consistent persona and instructions you don't have to retype
- You're handing work to the board and want the run to behave like a known specialist
- You want the same specialist available on whichever provider you open

### What it doesn't do

- Not a swarm or an autopilot. Agents are specialists you call on; they don't recruit each other or run unattended.
- Granted skills are a strong suggestion, not a hard wall — providers can still discover other skills in your vault.
- Tool grants apply when you start a chat from the roster or run a work order as the agent. An agent you sync out to a provider for `@`-mentioning gets that provider's default tools instead.
- A pinned model only takes effect on its own provider; on others the conversation uses that provider's default.
- Not a replacement for provider-native subagent files. The roster is the source of truth; syncing writes the native files for you.

### Goes well with

- [[Co-Worker - Chat]]: bind an agent to a sidebar session and work alongside it
- [[Agent Kanban Board]]: assign an agent to a work order and let it run the card
- [[Multi Provider Support]]: keep one roster and use it on whichever engine you have

---

## Get Specorator

Install via BRAT or the Obsidian community plugins directory.

**→ [GitHub — Luis85/specorator](https://github.com/Luis85/specorator)**

Already installed? Open the **Agents** view from the sidebar to build your roster.
