---
type: quick-action
name: To Issues
description: Break a plan, spec, or PRD into independently-grabbable vertical-slice issues and save them to docs/issues.
icon: list-checks
tags:
  - engineering
  - planning
---

Break the current plan into independently-grabbable issues using tracer-bullet vertical slices.

Use the domain glossary in `CONTEXT.md` throughout. Respect any ADRs in `docs/adr/` that touch the area.

## Process

### 1. Gather context

Work from whatever is in the conversation. If I pass an issue path or wikilink as context, read that file first.

### 2. Explore the codebase (if needed)

Understand the current state of the relevant code before drafting slices.

### 3. Draft vertical slices

Break the plan into **tracer bullet** issues. Each is a thin vertical slice through ALL integration layers end-to-end — NOT a horizontal layer slice.

Slices are either **HITL** (requires human input, e.g. architectural decision or design review) or **AFK** (can be implemented and merged without human interaction). Prefer AFK where possible.

Rules:
- Each slice delivers a narrow but complete path through every relevant layer (schema, logic, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones

### 4. Quiz me

Present the proposed breakdown as a numbered list. For each slice show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Blocked by**: which other slices must complete first (if any)
- **User stories covered**: which stories this addresses (if the source has them)

Ask:
- Does the granularity feel right?
- Are the dependency relationships correct?
- Should any slices be merged or split?
- Are HITL / AFK labels correct?

Iterate until I approve.

### 5. Publish issues

For each approved slice, save a new file to `docs/issues/YYYY-MM-DD-<slug>.md` with this frontmatter:

```yaml
---
type: issue
id: issue-YYYYMMDD-<slug>
title: <short title>
status: open
priority: <1 - high | 2 - normal | 3 - low>
triage: ready-for-agent
created: <YYYY-MM-DD>
related:
  - "[[<parent PRD or source doc>]]"
tags:
  - <relevant tags>
relations:
  - <feature area>
---
```

Publish in dependency order (blockers first) so you can reference real file paths in "Blocked by". Use this body template:

---

#### Parent

Wikilink to the parent PRD or source document (omit if no parent).

#### What to build

Concise description of this vertical slice — end-to-end behavior, not layer-by-layer steps.

No specific file paths or code snippets unless a prototype snippet encodes a decision more precisely than prose (state machine, reducer, schema, type shape). Trim to decision-rich parts only.

#### Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

#### Blocked by

Wikilink to blocking issue, or "None — can start immediately".

---

Do NOT modify any existing issue files.
