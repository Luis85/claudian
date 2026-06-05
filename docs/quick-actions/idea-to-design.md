---
type: quick-action
name: Idea to Design
description: Brainstorm an idea into a written design spec using the superpowers brainstorming skill.
icon: lightbulb
tags:
  - design
  - brainstorming
  - planning
favorite: true
favoriteRank: 1
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
