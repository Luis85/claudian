---
date: 2026-06-04
status: shipped
type: user-manual
parent: "[[sidepanel-chat]]"
---
# Specorator — Git commit & push button

This manual covers the **Commit & push** button in the chat panel header: a one-click way to ask the active chat agent to stage, commit, and push your vault's uncommitted changes with a Conventional Commits message it writes itself.

Specorator only detects whether the vault sits in a git repo and how many files have changed. All git work — `git status`, `git diff`, `git add`, `git commit`, `git push` — is performed by the active provider's chat agent through its own shell tool. The plugin never runs a mutation itself.

---

## Before you start

There are no dedicated settings for this feature. It uses what's already in your vault and the active chat tab.

| Requirement | What it means |
|-------------|---------------|
| **Vault is a git repo** | Your vault folder (or one of its ancestors) is initialized with `git init` and `git` is on `PATH`. |
| **`git` executable resolvable** | Specorator probes with the enhanced provider `PATH`, so the same `git` your terminal sees should be found. |
| **Working tree is dirty** | At least one tracked file is modified, staged, or untracked. A clean tree hides the button. |
| **Active chat tab can run shell commands** | The button is enabled for every shipped provider (Claude, Codex, Opencode, Cursor). A provider may opt out via `ProviderChatUIConfig.isGitActionsEnabled`; none currently do. |
| **Upstream branch (optional)** | If `git push` has nowhere to go, the agent commits anyway and reports that the push was skipped. |

Open the chat panel from the ribbon (`Open Specorator`) or the command palette (**Open chat view**). The button lives in the **panel header** (right side, next to the new-tab and history controls), not inside any single chat tab.

---

## Where the button lives

One button per chat panel — not one per tab. The same button reflects the **whole vault's** git state and dispatches the commit prompt to the **active tab's** agent.

- **Hidden** when the vault is not a git repo, when the working tree is clean, or when the active tab's provider has opted out of git actions.
- **Visible** as a pill labelled **Commit & push** with a count badge (e.g. `3`) showing how many files changed.
- **Tooltip:** *"Ask the active agent to commit and push N changes."*
- **Aria label:** *"Commit and push N changes"* (singular *change* when N is 1).

The badge count is the number of porcelain lines from `git status --porcelain` — staged, unstaged, and untracked files each count once.

---

## What a click does

Clicking **Commit & push** sends a fixed prompt to the active tab's chat as if you had typed it. The agent then performs the work.

The prompt asks the agent to:

1. Inspect the working tree with `git status` and `git diff` to understand what changed.
2. Stage the relevant changes.
3. Write a concise Conventional Commit message that accurately reflects the diff.
4. Create the commit.
5. Push to the upstream branch.
6. If there is no upstream branch or no remote configured, commit anyway and report that the push was skipped and why.
7. Report the commit subject, the short hash, and the push result back in the chat.

Because it's a normal chat turn, you can read the agent's reasoning, see the proposed commit message before it runs, and intervene if something looks wrong.

> **Streaming:** If a turn is already in progress, the click still routes through the normal send path and queues behind it. There is no separate "disabled while streaming" state.

---

## How the count stays accurate

Specorator polls `git status --porcelain` in the background and refreshes the badge whenever the result changes. Three triggers keep it fresh:

- **Interval poll** — every ~7 seconds while at least one chat panel is open.
- **Vault file events** — `modify`, `create`, `delete`, and `rename` events from Obsidian's vault, debounced to ~1.5 seconds so a burst of edits doesn't thrash the watcher.
- **Turn complete** — after every agent turn finishes (so the button disappears as soon as the agent's own commit lands).

A single shared watcher serves every chat panel and every tab; the per-panel button is only a subscriber. When no panel is subscribed, polling stops, so closed Specorator views cost nothing.

If `git` errors (not a repo, not installed, transient failure), Specorator treats the vault as "not a repo" for that tick and the button stays hidden — no notice is shown.

---

## Gotchas

- The button reflects the **vault root**, not your current note. If your vault sits inside a larger repo, the count comes from running `git status` at the vault path.
- The agent decides what to stage. The default prompt says "stage the relevant changes," not `git add -A`. If you want partial commits, edit the chat reply or stop the turn before it commits.
- The commit message is **generated from the diff**, not from the chat history. The agent does not know about discussion you had earlier in the conversation unless the diff reflects it.
- If the active tab's provider can't run shell commands (a hypothetical future provider opts out), the button hides even while the tree is dirty.
- The feature does not surface git errors as notices. If push fails (auth, no upstream, conflicting history), the agent reports it in the chat.
- There is no setting to change the prompt, the commit-message style, the polling interval, or the trigger keys. v1 is intentionally fixed.

---

## Command reference

This feature has no dedicated commands or palette entries. The button is the only entry point.

| Surface | What it does |
|---------|--------------|
| **Commit & push button** (chat panel header) | Sends the fixed commit-and-push prompt to the active tab's agent. Hidden when the tree is clean, not a repo, or the active provider opts out. |

---

## Typical flow

1. Make some edits in your vault (notes, settings, plugin source — anything tracked by git).
2. Within a few seconds the **Commit & push** button appears in the chat panel header with a count of changed files.
3. Open the chat tab you want to commit from (its provider's agent does the work).
4. Click **Commit & push**. The fixed prompt is sent as a new turn in that tab.
5. The agent runs `git status` / `git diff`, drafts a Conventional Commits message, stages, commits, and pushes. Watch the chat for the commit hash and push result.
6. Once the working tree is clean again, the button hides on its own — no further action needed.

For richer multi-step workflows (e.g. running tests, opening a PR), drive the agent in chat directly. The button is a fast path for the common "commit what's there and push" case; see [[agent-board-chat-interop-and-capture]] when a change is bigger than a single commit and deserves a tracked work order.
