# Specorator

> Plan the work, run it, review what came back, keep the record. All in your vault.

![GitHub stars](https://img.shields.io/github/stars/Luis85/specorator?style=social)
![GitHub release](https://img.shields.io/github/v/release/Luis85/specorator)
![License](https://img.shields.io/github/license/Luis85/specorator)

![Preview](Preview.png)

You're already using AI for serious work. Drafting emails. Planning trips. Comparing options. Reading the long report you don't want to read yourself. The conversations help, but the moment you close the tab, the work is gone. Tomorrow you start again from scratch.

**Specorator** brings that work inside your Obsidian vault. The drafts, plans, summaries, and edits land in notes you keep. Conversations are saved too, so you can pick one up tomorrow instead of starting fresh. It runs real provider-native agents — Claude Code, Codex, Opencode, Cursor Agent — with your vault as their working directory: file read/write, search, bash, and multi-step workflows all work out of the box.

## What it solves

- Typing the same prompts every day. Save any prompt as a vault note and fire it from a one-tap picker.
- Being locked into one tool's UI for one provider. Use whichever providers you have access to, in one workspace.
- AI work scattering across thirty open tabs. A board tracks every handoff from inbox to done.
- The agent quietly changing your notes. Preview every edit before it lands, or flip on YOLO mode when you trust the run.

## What's inside

| Feature | What it is |
| --- | --- |
| [Co-Worker — Chat](docs/product/features/Co-Worker%20-%20Chat.md) | A workspace beside your notes that already knows what you're looking at and what you've highlighted. |
| [Multi Provider Support](docs/product/features/Multi%20Provider%20Support.md) | Different engines for different jobs. Pick the one that fits the moment. |
| [Quick Actions](docs/product/features/Quick%20Actions.md) | Your most-used prompts, one tap away. Stored as vault notes you own. |
| [Agent Kanban Board](docs/product/features/Agent%20Kanban%20Board.md) | A board for things you have handed off. Inbox to done, never lost in chat history. |

Start in chat for fast foreground work, then move durable handoffs to the board when they need priority, acceptance criteria, background-style running, or review.

Everyday surfaces:

- **Inline Edit** — Select text or start at the cursor + hotkey to edit directly in notes with word-level diff preview.
- **Slash Commands & Skills** — Type `/` or `$` for reusable prompt templates or Skills from user- and vault-level scopes.
- **`@mention`** — Type `@` to mention vault files, subagents, MCP servers, or files in external directories.
- **Plan Mode** — Toggle via `Shift+Tab`. The agent explores and designs before implementing, then presents a plan for approval.
- **Instruction Mode (`#`)** — Refined custom instructions added from the chat input.
- **MCP Servers** — Connect external tools via Model Context Protocol (stdio, SSE, HTTP).
- **Multi-Tab & Conversations** — Multiple chat tabs, conversation history, fork, resume, and compact.

## What this is not

- Not a code-only tool. The plugin is for anyone who works in notes — writers, planners, researchers, students, small-business owners, anyone keeping track of thinking in their vault.
- Not a hosted service. Your notes live on your computer. No account is required.
- Not a single-provider lock-in. Use whichever providers you have access to. If you only have one, that is fine.
- Not magic. You decide the level of oversight. Preview every change before you accept it, or flip on YOLO mode and let the agent run on its own.
- If you leave Specorator, your notes are still ordinary Markdown.

## Requirements

- **Claude provider**: [Claude Code CLI](https://code.claude.com/docs/en/overview) installed (native install recommended). Claude subscription/API or a compatible provider.
- **Optional providers**: [Codex CLI](https://github.com/openai/codex), [Opencode](https://opencode.ai/), [Cursor Agent CLI](https://docs.cursor.com/en/cli/overview).
- Obsidian v1.11.5+
- Desktop only (macOS, Linux, Windows)

## Install

Install via the [Beta Reviewers Auto-update Tool (BRAT)](https://github.com/TfTHacker/obsidian42-brat):

1. Install BRAT from the Obsidian community-plugin directory.
2. In BRAT, **Add Beta Plugin** → `Luis85/specorator`.
3. Enable Specorator in Obsidian → Settings → Community plugins.

Submission to the official Obsidian community-plugin registry is planned once v1.0.x stabilises.

Already installed? Open **Settings → Specorator** to point it at the providers you have, then open the chat sidebar from the ribbon or the command palette.

## Where it's heading

**Specorator v1.0.0** is today's feature set — Chat, Multi-Provider, Quick Actions, Agent Board — shipped as a standalone plugin. The post-1.0 roadmap layers an agent harness on top: terminal-free setup, one-click revert, a vault-aware assistant, and tap-to-configure workflows. The plan is the [Specorator Agent Harness PRD](docs/product/Specorator%20Agent%20Harness%20PRD.md).

## Origins

Specorator combines two project lines: an evolved provider-native agent plugin that began as a fork of the original Claudian Obsidian plugin by Yishen Tu, and earlier Specorator work around spec-driven Obsidian workflows. See [CREDITS.md](CREDITS.md) for the full provenance and acknowledgements.
