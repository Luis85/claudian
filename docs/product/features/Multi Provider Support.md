---
type: feature
name: Multi Provider Support
tagline: Use the AI providers you already have, side by side in one workspace.
status: draft
personas:
  - knowledge-worker
  - pm
cta_url: https://github.com/Luis85/specorator
related:
  - "[[Chat]]"
  - "[[docs/product/features/Orchestrator]]"
user_manual: "[[docs/product/user-manuals/multi-provider]]"
parent: Infrastructure
---

# Multi Provider Support

You may already have access to one or more AI providers. Claude through Anthropic, Codex or ChatGPT through OpenAI, Cursor through your IDE subscription, Opencode running locally. Most plugins make you pick one and live inside that vendor's UI for as long as you use them.

**Multi Provider Support** is the side of Specorator that refuses that trade. Use whichever providers you have, inside the same Obsidian workspace, with your notes underneath. If you have one, you have one. If you have all four, all four are there.

---

This is not a model picker that swaps engines behind a single chat. Each provider keeps its own settings, its own commands, and its own saved record on disk. A chat tab belongs to the provider you opened it with until you close it. To switch, open a new tab and pick a different provider.

Point Specorator at the providers you have once, and each gets its own chat tab and its own settings page under **Settings → Specorator**. If you only have one subscription, use that one. If you have several, open them in parallel. The tabs run side by side; your work stays in your vault whichever provider runs it.

<!-- screenshot: chat tab header showing the provider switcher with the four options, transcripts panel visible -->

Specorator keeps its own record of every conversation under `.specorator/sessions/`. You can leave one open for weeks and pick it back up tomorrow without losing where you were. Sessions stay inside Specorator; the plugin does not read or write to other tools' chat histories on disk.

---

### What it does

- Run any new chat on Claude, Codex, Opencode, or Cursor, depending on which ones you have access to
- Give every provider its own chat tab and its own settings page under **Settings → Specorator**
- Save every conversation as a Specorator session under `.specorator/sessions/` so it survives whichever provider ran it
- Run several tabs on different providers in parallel

### Provider support

| Capability | Claude | Codex | Opencode | Cursor |
|------------|--------|-------|----------|--------|
| Send, stream, stop | Full | Full | Full | Full |
| Pick up earlier sessions | Full | Full | Full | Full |
| Reload past Specorator sessions | Full | Full | Full | Full |
| Split a conversation (fork) | Full | Full | Not supported | Not supported |
| Attach images | Full | Full | Full | Full |
| Inline edit (rewrite a passage in place) | Full | Full | Full | Full |
| Plan mode (see the plan before running) | Full | Full | Partial, mode runs but no approval card | Full |
| `#` instruction mode (facts the helper should always know) | Full | Full | Full | Not supported |
| `/` commands (saved shortcuts) | Full | Not supported | Partial, runtime-discovered | Not supported |
| `$` skills (saved workflows) | Full | Full | Not supported | Not supported |
| Helpers running sub-tasks (subagents) | Full | Full | Full | Not supported |
| Rewind (jump back to an earlier point in the conversation) | Full | Not supported | Not supported | Not supported |
| MCP from inside the app (connect external tools) | Full | Not supported | Partial, provider-managed | Not supported |
| Claude plugin integration | Full | Not supported | Not supported | Not supported |

Claude is wired up the most fully today. Codex covers most of the same ground. Opencode handles its own external tool connections, so Specorator stays out of the way there. Cursor focuses on chat and inline edits. Check the row you care about before you commit to a provider for a given job.

### What it doesn't do

- A chat tab cannot change provider mid-conversation. Each tab stays on the provider it was opened with. To work with a different one, open a new tab.
- There is no single combined account that hides the providers. Each chat talks to its own provider directly.
- If a provider does not offer something like rewind or external tool connections, Specorator does not pretend it does. The matrix above is the honest answer.

### Goes well with

- [[Chat]]: the chat surface looks and feels the same across all four providers; the matrix shows what actually differs

---

## Get Specorator

Install via BRAT or the Obsidian community plugins directory.

**→ [GitHub — Luis85/specorator](https://github.com/Luis85/specorator)**

Already installed? Open this feature from **Settings → Specorator**.
