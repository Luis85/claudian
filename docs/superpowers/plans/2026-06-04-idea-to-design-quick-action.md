---
status: done
---
# Idea to Design quick action — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an **Idea to Design** quick action that fires the `superpowers:brainstorming` skill against an idea seed and terminates at a written, committed design spec under `docs/superpowers/specs/`.

**Architecture:** Single Markdown file at `docs/quick-actions/idea-to-design.md`. No code changes. The existing `QuickActionStorage` (`src/features/quickActions/QuickActionStorage.ts`) discovers the file at vault load and surfaces it in both the chat-toolbar picker and the right-click context-menu picker. The action body delegates the brainstorming flow to the existing `superpowers:brainstorming` skill and explicitly instructs Claude to stop at the spec — no `writing-plans` chain.

**Tech Stack:** Markdown + YAML frontmatter. Obsidian quick actions infrastructure (already present). No new dependencies, no schema changes.

**Spec:** `docs/superpowers/specs/2026-06-04-idea-to-design-quick-action-design.md`

---

## File Structure

- **Create:** `docs/quick-actions/idea-to-design.md` — the quick action definition (frontmatter + prompt body).

No other files are touched. The plan has a single task because the spec is content-only and the existing quick-action loader is already wired to this folder.

---

### Task 1: Create the `Idea to Design` quick-action file

**Files:**
- Create: `docs/quick-actions/idea-to-design.md`

- [ ] **Step 1: Confirm the quick-actions folder and existing siblings**

Run: `ls docs/quick-actions/`

Expected: A list that includes existing actions such as `to-prd.md`, `plan-review.md`, `deep-research.md`. The folder must exist; if it does not, stop and confirm with the user — the vault's `quickActionsFolder` setting may differ.

- [ ] **Step 2: Create `docs/quick-actions/idea-to-design.md`**

Write the file with this exact content:

````markdown
---
type: quick-action
name: Idea to Design
description: Brainstorm an idea into a written design spec using the superpowers brainstorming skill.
icon: lightbulb
tags:
  - design
  - brainstorming
  - planning
---

Kick off a brainstorming session that turns the idea below into a written design spec.

**1. Identify the idea seed**

- If the user attached a file or folder, treat its contents as the idea description. Read it before asking anything.
- Otherwise, ask the user to describe the idea in one or two sentences.

**2. Invoke the brainstorming skill**

Use the `superpowers:brainstorming` skill. Follow it exactly: explore project context, ask clarifying questions one at a time, propose 2–3 approaches, present the design in sections, then write the spec to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and commit it.

**3. Terminate at the spec**

Stop after the user approves the written spec. Do NOT invoke `writing-plans` or any implementation skill. The terminal state for this action is an approved, committed spec document.

End with a short summary:
- Spec path (as `[[wikilink]]`)
- Title
- Key decisions captured
- Suggested next step (e.g. "run /to-prd or the Plan Review action when ready").
````

Notes:
- `type: quick-action` is the gate enforced by `parseQuickActionContent` (`src/features/quickActions/quickActionParse.ts:19-22`). Without it the file will not load.
- `icon: lightbulb` is a lucide icon name; Obsidian renders it automatically.
- The body intentionally defers path conventions ("write the spec to `docs/superpowers/specs/...`") to the brainstorming skill rather than re-stating its full checklist. This keeps the action thin and resilient to skill updates.

- [ ] **Step 3: Verify the file parses correctly (no Obsidian reload yet)**

Run: `npm run test -- --selectProjects unit --testPathPattern quickActions`

Expected: All existing quick-actions unit tests pass. (They do not assert on this specific file but they exercise `parseQuickActionContent`, so a smoke run confirms nothing in the new file breaks the parser at the module level. If they were already passing before this task, they should still pass — no behaviour changed.)

- [ ] **Step 4: Reload Obsidian and confirm the action appears in the picker**

Manual verification (cannot be automated):

1. In Obsidian, run **Reload app without saving** (or restart the plugin).
2. Open a chat tab → click the quick-actions picker button in the chat toolbar.
3. Confirm **Idea to Design** appears in the list with the lightbulb icon and the description "Brainstorm an idea into a written design spec using the superpowers brainstorming skill."
4. Confirm it is sorted alphabetically among the other actions (`QuickActionStorage.loadAll` sorts by `name` via `localeCompare` — `src/features/quickActions/QuickActionStorage.ts:38`).

If the action does not appear:
- Check `plugin.settings.quickActionsFolder` matches `docs/quick-actions` (settings → Quick actions tab).
- Check the file has `type: quick-action` exactly.
- Check the Obsidian developer console for parse errors.

- [ ] **Step 5: Smoke-test the right-click path**

Manual verification:

1. In the vault file tree, right-click any note that contains a short idea (one or two sentences).
2. Choose **Quick actions** → **Idea to Design**.
3. Confirm a chat tab opens (reused blank or newly created), the note is attached as a visible pill, and Claude begins by reading the attached note as the idea seed and then invokes the `superpowers:brainstorming` skill.
4. Walk the brainstorming flow to spec write. Confirm the spec lands under `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
5. Confirm Claude does NOT auto-invoke `writing-plans` after the user approves the spec.

- [ ] **Step 6: Smoke-test the chat-toolbar path (no file context)**

Manual verification:

1. Open a fresh chat tab with no file context.
2. From the chat toolbar, fire **Idea to Design**.
3. Confirm Claude asks the user to describe the idea in one or two sentences (per body step 1), then proceeds into the `superpowers:brainstorming` flow.

- [ ] **Step 7: Commit**

```bash
git add docs/quick-actions/idea-to-design.md docs/superpowers/specs/2026-06-04-idea-to-design-quick-action-design.md docs/superpowers/plans/2026-06-04-idea-to-design-quick-action.md
git commit -m "$(cat <<'EOF'
feat(quick-actions): add Idea to Design action

Adds docs/quick-actions/idea-to-design.md, a thin wrapper that fires the
superpowers:brainstorming skill against an attached file/folder or a
user-described idea, and terminates at a written design spec under
docs/superpowers/specs/. No code changes — the existing QuickActionStorage
loader picks up the file at vault load.

Spec: docs/superpowers/specs/2026-06-04-idea-to-design-quick-action-design.md
Plan: docs/superpowers/plans/2026-06-04-idea-to-design-quick-action.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Expected: Single commit on the current branch, three files staged, no other modifications.

---

## Self-review

**Spec coverage:**
- Problem and Goal — covered by the action body (Steps 1-3) and the lightbulb icon framing the entry point.
- File location `docs/quick-actions/idea-to-design.md` — Task 1 Step 2.
- Frontmatter (`type`, `name`, `description`, `icon`, `tags`) — Task 1 Step 2.
- Body with three numbered steps and explicit termination — Task 1 Step 2.
- Behaviour table (right-click file/folder vs chat-toolbar) — Task 1 Steps 5 and 6.
- Output (spec path, wikilink summary, no `writing-plans` chain) — Task 1 Steps 5 and 6.
- Non-goals (no `writing-plans`, no new code, no PRD generation) — body Step 3 instructs Claude explicitly; plan has no code tasks.
- Testing (manual verification path) — Task 1 Steps 3-6.
- Risks (skill drift, termination override) — addressed by the spec; no plan task needed because they are observation-only.

**Placeholder scan:** None. All steps have exact paths, exact file content, exact commands.

**Type consistency:** N/A — no types are introduced. The single field name referenced (`type: quick-action`) matches `QUICK_ACTION_FRONTMATTER_TYPE` in `src/features/quickActions/types.ts:2`.
