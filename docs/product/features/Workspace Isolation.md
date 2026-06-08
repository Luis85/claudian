---
type: feature
name: Workspace Isolation
tagline: Give every agent its own workspace before it touches yours.
status: draft
personas:
  - knowledge-worker
  - pm
cta_url: https://github.com/Luis85/specorator
related:
  - "[[Co-Worker - Chat]]"
  - "[[Agent Kanban Board]]"
  - "[[Multi Provider Support]]"
user_manual:
image:
---

# Workspace Isolation

Sometimes you want help, but you do not want the helper working directly on your desk. You want a copy of the desk first: somewhere safe to draft, edit, run commands, make mistakes, and show you what changed before anything lands back in your real workspace.

**Workspace Isolation** gives every agent co-worker its own place to work before it touches yours. A chat tab, a board card, or a review run can move into an isolated workspace. The agent works there. You review the changed files. You decide what comes back.

---

You do not need git to use it. Specorator can create an isolated copy of your vault, repo, or folder in a separate workspace root. The agent works in that copy. When it is done, Specorator shows the files that changed and lets you accept whole-file replacements back into the original workspace.

If you already use git, Workspace Isolation gets stronger. Specorator can use native git worktrees, show git-backed status and diffs, and offer an explicit branch merge when that is the right move. Git is recommended because it makes review and recovery easier, but it is not required.

The important part is that this is one feature. Copy workspaces and git worktrees are not separate worlds. They are both isolated workspaces, with git adding extra review and merge tools when it is available.

---

### What it does

- Creates isolated workspaces for chat tabs, Agent Board work orders, and manual review flows
- Works without git by copying the selected workspace into a separate folder
- Shows changed, new, deleted, conflicted, and binary files before apply
- Applies accepted changes back as whole-file replacements
- Keeps conflicted files from being overwritten silently
- Lets git users create native worktrees when available
- Adds git-enhanced status, diff, and branch merge actions for git-backed workspaces
- Lists isolated workspaces so you can open, review, apply, archive, or delete them later

### What it doesn't do

- Not a security sandbox. Isolation keeps agent work away from your active files, but it does not contain an untrusted process like a VM would.
- Not a hunk-by-hunk patch tool yet. The first review model accepts or rejects whole files.
- Not automatic publishing. Pushes, pull requests, and merges stay explicit user actions.
- Not git-only. Git improves the workflow, but the core feature works without it.

### Goes well with

- [[Co-Worker - Chat]]: move a conversation into an isolated workspace before asking for file changes
- [[Agent Kanban Board]]: run work orders in separate workspaces and review the result before accepting it
- [[Multi Provider Support]]: use the same isolation model whichever provider runs the work

---

## Get Specorator

Install via BRAT or the Obsidian community plugins directory.

**→ [GitHub — Luis85/specorator](https://github.com/Luis85/specorator)**

Already installed? Open this feature from **Settings → Specorator → Workspace Isolation**.
