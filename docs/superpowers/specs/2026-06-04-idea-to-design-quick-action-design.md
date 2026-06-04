---
title: Idea to Design quick action
date: 2026-06-04
status: shipped
scope: docs/quick-actions
---

# Idea to Design quick action

## Problem

Users with a raw idea — a sentence, a half-written note, a thing they want to build — have no one-click way to kick off a structured brainstorming session inside Claudian. They can manually invoke the `superpowers:brainstorming` skill, but that requires remembering the skill name, opening a chat, and typing setup. The result is that the skill is underused for vault-resident ideas.

## Goal

A new quick action, **Idea to Design**, that fires the `superpowers:brainstorming` skill against an idea seed and produces a written design spec under `docs/superpowers/specs/`. The action terminates after spec write + user approval — it does NOT chain into `writing-plans` or any implementation skill. The terminal artifact is an approved, committed spec document.

## Design

### New file: `docs/quick-actions/idea-to-design.md`

Single markdown file. No code changes. The quick action loader (`QuickActionStorage`) picks it up automatically because the file lives in the configured quick actions folder (`docs/quick-actions/` in this vault) and carries `type: quick-action` in its frontmatter.

### Frontmatter

```yaml
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
```

- `type: quick-action` — required gate enforced by `parseQuickActionContent`.
- `icon: lightbulb` — Obsidian lucide icon name. Rendered by the quick actions picker.
- `tags` — surface the action under design/planning filters in the picker.

### Body

```markdown
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
```

### Behaviour

| Trigger path | Idea seed |
|---|---|
| Right-click a file → Quick actions → Idea to Design | File contents (attached as pill, also read by Claude) |
| Right-click a folder → Quick actions → Idea to Design | Folder contents (attached as pill, also explored by Claude) |
| Chat toolbar → Idea to Design | User types idea into chat after Claude prompts |

In all cases the action prompt is delivered to a chat tab via the existing `openContextMenuQuickAction` (right-click) or chat toolbar handler. No new code path.

### Output

- Spec file at `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` with brainstorming-skill standard frontmatter (`title`, `date`, `status`, `scope`).
- Spec committed to git by the brainstorming skill flow.
- Short chat summary message naming the spec wikilink and suggested next step.

### Non-goals

- No chaining into `writing-plans`. The action is intentionally scoped to spec production. Users who want an implementation plan can run a separate action or invoke `writing-plans` manually.
- No new quick action storage schema, picker UI, or runtime behaviour. Pure content add.
- No automatic PRD generation. The existing **To PRD** quick action handles that path.

## Testing

Manual verification:

1. Reload Claudian; open the quick actions picker. **Idea to Design** appears with the lightbulb icon and the description above.
2. Right-click a note containing an idea → Quick actions → Idea to Design. Confirm the chat tab opens, the note is attached as a pill, and Claude kicks off brainstorming using the attached note as the idea seed.
3. Click the action from the chat toolbar with no file context. Confirm Claude asks the user to describe the idea.
4. Run an end-to-end brainstorm to spec write. Confirm the spec lands under `docs/superpowers/specs/` and the chat summary references the wikilink. Confirm Claude does NOT auto-invoke `writing-plans`.

No automated tests — the quick action is content, not code. Existing `QuickActionStorage` and `parseQuickActionContent` unit tests already cover the load/parse paths.

## Risks

- **Skill drift** — if `superpowers:brainstorming` changes its terminal state or output path conventions, the spec path in the action body could go stale. Mitigation: the action body defers path conventions to the skill ("write the spec to `docs/superpowers/specs/...`") rather than re-stating its full checklist.
- **Termination override** — Claude may still invoke `writing-plans` if it ignores the "stop at spec" instruction. Mitigation: the instruction is explicit and uses NOT in caps. If observed in practice, escalate to a stronger guard (e.g. an `<HARD-GATE>` block).
