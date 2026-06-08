---
title: Workspace Isolation — copy-first, git-enhanced workspaces
date: 2026-06-07
status: approved
scope: workspace-isolation
parent: "[[Better integration of isolated worktrees]]"
related:
  - "[[Co-Worker - Chat]]"
  - "[[Agent Kanban Board]]"
  - "[[Multi Provider Support]]"
  - "[[agent-board-evidence-review]]"
---

# Workspace Isolation — copy-first, git-enhanced workspaces

## Summary

Workspace Isolation gives every agent run a place to work before it touches the user's active vault or project. The feature is intentionally **git agnostic at the core**: users without git get isolated copy workspaces and whole-file review, while users with git get enhanced status, diff, native worktree, and merge actions on top of the same workspace model.

The product concept is **one isolated workspace**, not two separate git and non-git modes. Git is recommended because it improves review and recovery, but it is never required. The upgrade path is natural: start with copy workspaces, add git later, and gain better review/merge affordances without changing the mental model.

This foundation later powers three surfaces:

- [[Co-Worker - Chat]] tab isolation.
- [[Agent Kanban Board]] work-order isolation.
- A Workspace Isolation list/review surface for opening, reviewing, applying, merging, archiving, and deleting isolated workspaces.

## Goals

- Create isolated workspaces programmatically for agents.
- Support users without git through copy workspaces.
- Enhance git users with native git worktrees, git status/diff, and optional branch merge.
- Keep Chat, Agent Board, and review UI on one shared workspace foundation.
- Default to an isolation root outside the vault/project, while allowing advanced inside-project roots with warnings.
- Reconcile v1 changes through selected whole-file replacements.
- Make conflicts visible when both source and isolated files changed.
- Add a user-facing feature note at [[Workspace Isolation]].

## Non-goals

- Hunk-level patch selection.
- Automatic deletion apply by default.
- Treating copy workspaces or git worktrees as security sandboxes.
- Auto-push, auto-PR, or auto-merge.
- A separate git-only product surface.
- Provider-specific workspace allocation inside provider runtimes.
- Full workflow automation or dependency scheduling.

## Locked decisions from brainstorming

| Question | Decision |
|---|---|
| Foundation shape | One git-agnostic Workspace Isolation feature; git enhances it. |
| First slice | Foundation first, then Chat, Agent Board, and management UI. |
| Non-git isolation | Copy workspace: full or future scoped copy, then reconcile back. |
| Default storage | Configurable; recommend outside vault/project by default. |
| V1 reconciliation | Whole-file replacement after review. |
| Git merge-back | Both paths: whole-file apply by default, explicit branch merge for git-backed workspaces. |
| Worktree terminology | User-facing feature is Workspace Isolation; git worktree is an implementation detail/capability. |

## Product model

An **isolated workspace** is a durable record that maps a source workspace to an isolated folder where an agent can work. Every workspace has:

- a stable ID and human-readable name;
- a source path;
- an isolated path;
- an owner such as chat tab, work order, manual workspace, or review;
- a lifecycle status;
- an allocation detail such as copy or git worktree;
- reconciliation state;
- optional git metadata.

The core flow is:

1. User creates isolation from Chat, Agent Board, or the Workspace Isolation surface.
2. Specorator creates an isolated workspace under the configured isolation root.
3. The agent runs with the isolated workspace path as its working directory.
4. Specorator scans for changes relative to the source baseline.
5. User accepts selected whole-file replacements back into the source workspace.
6. User archives/deletes the isolated workspace, or keeps it for later review.

Git-backed workspaces use the same flow. Git can improve allocation and review, but it does not replace the core apply path.

## Architecture

Workspace Isolation should live behind a shared feature boundary, for example `src/features/workspaces/`. Chat and Agent Board consume it through interfaces; provider runtimes do not allocate workspaces themselves.

### Components

| Component | Responsibility |
|---|---|
| `WorkspaceIsolationService` | Orchestrates creation, listing, attachment, scanning, applying, archiving, deletion, and lifecycle transitions. |
| `WorkspaceRegistry` | Persists workspace records under `.claudian/workspaces/`. |
| `WorkspaceAllocator` | Git-agnostic allocation interface. |
| `CopyWorkspaceAllocator` | Default allocator for non-git and copy-only users. |
| `GitWorkspaceEnhancer` / git adapter | Detects git, creates native git worktrees when requested, reads status/diff, and exposes merge eligibility. |
| `WorkspaceDiffService` | Computes changed/new/deleted/conflicted files at whole-file granularity. |
| `WorkspaceApplyService` | Replaces accepted source files with isolated versions and records apply results. |
| Workspace list/review UI | Lists workspaces and drives review/apply/merge/archive/delete actions. |
| Chat integration | Attaches a workspace to a tab and routes future turns through the isolated working directory. |
| Agent Board integration | Allocates per-run workspaces when configured and stores workspace references on work orders. |

### Core interface

```ts
interface WorkspaceIsolationService {
  createWorkspace(request: CreateWorkspaceRequest): Promise<IsolatedWorkspaceRecord>;
  listWorkspaces(): Promise<IsolatedWorkspaceRecord[]>;
  attachToOwner(workspaceId: string, owner: WorkspaceOwner): Promise<void>;
  scanChanges(workspaceId: string): Promise<WorkspaceReview>;
  applyFiles(workspaceId: string, relativePaths: string[]): Promise<ApplyResult>;
  archiveWorkspace(workspaceId: string): Promise<void>;
  deleteWorkspace(workspaceId: string): Promise<void>;
}
```

### Provider/runtime boundary

Provider runtimes should only receive a resolved working directory through existing launch/session preparation seams. They should not know whether the directory came from a copy workspace, native git worktree, or current workspace.

If a provider cannot change working directory mid-session, Chat must require a new isolated tab or apply isolation from the next provider session only. Agent Board runs allocate before the run starts, so they always know the working directory before provider launch.

## Data model

Workspace records are small JSON files under `.claudian/workspaces/<workspace-id>.json`. The isolated workspace contents live under the configured isolation root, not inside `.claudian`.

```ts
interface IsolatedWorkspaceRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: 'creating' | 'ready' | 'running' | 'needs_review' | 'applied' | 'archived' | 'failed';
  owner: {
    kind: 'chat' | 'work_order' | 'manual' | 'review';
    id: string | null;
    title: string | null;
  };
  source: {
    path: string;
    type: 'vault' | 'repo' | 'folder';
    baselineFingerprint: WorkspaceFingerprint;
  };
  isolated: {
    path: string;
    strategy: 'copy' | 'git_worktree';
    createdBy: 'copy' | 'git';
  };
  reconciliation: {
    changedFiles: WorkspaceFileChange[];
    acceptedFiles: string[];
    rejectedFiles: string[];
    lastScannedAt: string | null;
    appliedAt: string | null;
  };
  git?: {
    repoPath: string;
    branch: string;
    baseRef: string;
    baseSha: string;
    headSha: string | null;
    worktreePath: string | null;
  };
}
```

`isolated.strategy` is an allocation detail. The product should still label both variants as isolated workspaces.

## Fingerprints and conflict detection

On creation, Specorator records a baseline fingerprint for files included in the isolated workspace. For v1, fingerprints can combine path, size, modified time, and content hash for changed candidates.

During reconciliation:

| Condition | Classification | V1 behavior |
|---|---|---|
| Isolated file changed; source still matches baseline | Safe change | User may accept whole-file replacement. |
| Isolated file changed; source also changed | Conflicted | Do not apply by default; require explicit inspection/confirmation. |
| New file exists only in isolated workspace | New file | User may accept as a new source file. |
| File deleted in isolated workspace | Deletion | Show separately; do not auto-apply in v1. |
| File deleted in source after allocation | Conflicted | Skip blind apply; require manual inspection. |
| Binary file changed | Binary change | Show file-level replacement only, with a binary warning. |

This gives non-git users a safe review model without requiring version control.

## Allocation strategies

### Copy workspace

Copy allocation is the default baseline. It creates a full copy in v1, with room for scoped copies later. The allocator should exclude known generated/heavy folders by default when safe, and make the exclude list visible/configurable before broad rollout.

Recommended default root: an app/user-data workspace folder outside the active vault/project.

Advanced option: allow an inside-project root such as `.worktrees/` or `.claudian/workspaces-data/`, with clear warnings about nested vaults, plugin loaders, indexers, and recursive tooling.

### Git-enhanced workspace

When git is available and the source is a git repo, Specorator can:

- create a native git worktree for the isolated workspace;
- record branch, base ref, base SHA, head SHA, and repo path;
- use git status/diff for review;
- show branch movement and conflict warnings;
- offer **Merge branch** where valid.

Git is recommended but not required. The default review/apply path remains whole-file apply so users keep one consistent model.

## User flows

### Chat tab isolation

Every chat tab gets an **Isolate workspace…** action. Selecting it creates or attaches an isolated workspace to the tab. The tab header shows an isolated badge and workspace name.

If the tab already has messages, isolation applies from the next turn onward. The UI should show a short notice that previous context came from the source workspace and future file writes happen in the isolated copy.

If the active provider cannot safely switch working directories mid-session, the action creates a new isolated chat tab instead of mutating the existing session.

### Agent Board isolation

Agent Board gets a setting: **Run work orders in isolated workspaces**. When enabled, each work-order run allocates a workspace before the agent starts. Work-order frontmatter stores a compact workspace reference such as `workspace_id`, not the whole workspace record.

Per-card actions:

- **Run in current workspace**
- **Run in isolated workspace**
- **Open isolated workspace**
- **Review changes**

This keeps cautious and fast workflows available side by side.

### Workspace list and review surface

The Workspace Isolation surface lists:

- name;
- source path;
- isolated path;
- owner;
- status;
- provider/run/conversation links when available;
- changed-file count;
- git badge when git metadata exists;
- actions: open, reveal in file explorer, review, apply accepted files, merge branch, archive/delete.

Copy and git-backed workspaces should look like one feature. Git appears as extra capability badges and actions.

### Reconciliation flow

1. User opens **Review changes**.
2. Specorator scans the isolated workspace.
3. UI groups files as changed, new, deleted, conflicted, and binary.
4. User selects changed/new files to accept.
5. Specorator replaces the matching source files or creates new files.
6. Record accepted/rejected files and apply timestamp.
7. Workspace moves to `applied` when all selected files apply successfully.

Conflicted files are skipped by default. Deleted files are shown but not auto-applied in v1.

### Git merge flow

For git-backed workspaces, **Merge branch** appears only when:

- the workspace has git metadata;
- the source repo and branch are still available;
- the isolated branch exists;
- preflight checks can determine merge eligibility.

The action warns if the source branch moved since allocation, if the isolated branch has uncommitted changes, or if a merge would conflict. Merge is explicit and separate from whole-file apply.

## Settings

Add a **Workspace Isolation** settings section:

| Setting | Default | Notes |
|---|---|---|
| Enable Workspace Isolation | off or feature-gated initially | Controls Chat/Agent Board entry points while foundation stabilizes. |
| Default isolation root | outside vault/project | Recommended safe default. |
| Allow inside-project roots | off | Advanced option with warnings. |
| Default allocation strategy | automatic | Use git worktree when valid and requested by strategy; otherwise copy. |
| Copy only | available | For users who do not want git integration. |
| Git worktree when available | available | Falls back to copy with explanation when invalid. |
| Agent Board default isolation | off initially | User can opt in to per-run isolation. |
| Chat default isolation | ask/manual | Do not surprise users by moving tabs automatically. |
| Retention policy | manual cleanup | Auto-cleanup can come later. |

Settings copy should say: git is recommended for easier review and merge, but not required.

## Safety model

Workspace Isolation is a safety boundary for workflow hygiene, not a security sandbox.

Required invariants:

1. Source and isolated paths are canonicalized before use.
2. Source and isolated paths must not be equal.
3. Created isolated paths must stay under the configured isolation root.
4. Apply writes only to source-relative paths mapped from the workspace record.
5. Path traversal and unsafe symlink cases are rejected or treated conservatively.
6. The source path must not be inside the isolated path.
7. The isolated path must not be inside the source path unless the user explicitly enabled inside-project roots.
8. Conflicted files are not silently overwritten.
9. Git merge actions require explicit user action and preflight checks.
10. Workspace records are durable, but high-volume file contents are not stored in JSON metadata.

## Product feature note

[[Workspace Isolation]]

## Testing strategy

### Unit tests

| Area | Coverage |
|---|---|
| Path validation | canonical roots, outside/inside root rules, traversal, source/isolated overlap. |
| Copy allocator | creates workspace, preserves relative paths, honors excludes, records baseline. |
| Registry | create/list/update/archive/delete records without corrupting unrelated records. |
| Fingerprints | detects unchanged, changed, new, deleted, conflicted, and binary candidates. |
| Apply service | whole-file replacement, new-file apply, conflicted skip, deletion skip. |
| Git adapter | git unavailable, non-repo, dirty repo warnings, worktree metadata, merge eligibility. |
| Lifecycle | legal transitions for creating/ready/running/needs_review/applied/archived/failed. |
| Chat seam | mocked workspace service sets next-turn working directory. |
| Agent Board seam | mocked workspace service allocates before run and stores workspace reference. |

### Integration tests

- Create copy workspace → mutate isolated file → scan → apply selected file.
- Source changed after allocation → conflict.
- New isolated file → apply as new file.
- Deleted isolated file → shown but not auto-applied.
- Agent Board run receives isolated working directory when setting is on.
- Chat tab uses isolated working directory on next turn.
- Existing git repo with copy allocation still works.
- Existing git repo with git worktree allocation records git metadata and exposes merge eligibility.

### Manual smoke

- Non-git folder isolation.
- Git repo using copy allocator.
- Git repo using git worktree allocator.
- Whole-file review and apply.
- Conflict display after source file changes.
- Merge branch action visible only for valid git-backed workspaces.
- Inside-project root warning.

## Rollout

This spec is the foundation. Implementation can land in phases:

1. Core service, registry, copy allocator, path validation, scan/apply.
2. Workspace list and review UI.
3. Chat tab **Isolate workspace…** action.
4. Agent Board setting and per-work-order override.
5. Git enhancement: detection, native worktree allocation, git diff/status.
6. Explicit git branch merge action.

The first useful slice should prove non-git copy isolation end to end before depending on git.

## Open risks

| Risk | Mitigation |
|---|---|
| Large vault copies are slow or storage-heavy. | Start with clear progress UI and excludes; add scoped copy later. |
| Nested workspaces confuse Obsidian or provider CLIs. | Recommend outside root; make inside-project roots advanced and warned. |
| Whole-file replacement overwrites human edits. | Baseline fingerprints and conflict classification block silent overwrites. |
| Git and copy semantics split into two products. | Keep one workspace record and one review UI; git only adds badges/actions. |
| Provider sessions cannot switch working directory. | Apply isolation only before the next run/session or create a new isolated tab. |
| Users mistake isolation for security. | Product copy and UI state that this is not a sandbox. |
