---
type: quick-action
name: To PRD
description: Turn the current conversation context into a PRD and save it to docs/issues.
icon: file-text
tags:
  - engineering
  - planning
  - documentation
---

Take the current conversation context and codebase understanding and produce a PRD. Do NOT interview me — synthesize what you already know.

Use the domain glossary in `CONTEXT.md` throughout. Respect any ADRs in `docs/adr/` that touch the area.

## Process

1. **Explore the codebase** if you haven't already. Identify the current state of the relevant code.

2. **Sketch modules** — outline the major modules to build or modify. Actively look for opportunities to extract deep modules: simple, testable interfaces that encapsulate a lot of functionality and rarely change. Check with me that the modules match expectations and confirm which ones need tests.

3. **Write the PRD** using the template below.

4. **Save to vault** as `docs/issues/YYYY-MM-DD-<slug>.md` with this frontmatter:

```yaml
---
type: prd
id: issue-YYYYMMDD-<slug>
title: <full title>
status: open
priority: <1 - high | 2 - normal | 3 - low>
triage: ready-for-agent
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
related:
  - "[[<wikilink to source idea or related doc>]]"
tags:
  - <relevant tags>
relations:
  - <feature area>
---
```

---

## PRD Template

### Problem Statement

The problem the user is facing, from the user's perspective.

### Solution

The solution to the problem, from the user's perspective.

### User Stories

A long, numbered list of user stories covering all aspects of the feature:

1. As a `<actor>`, I want `<feature>`, so that `<benefit>`.

### Implementation Decisions

- The modules that will be built or modified
- Interfaces that will change
- Technical clarifications
- Architectural decisions
- Schema changes, API contracts, specific interactions

Do NOT include specific file paths or code snippets unless a prototype snippet encodes a decision more precisely than prose (state machine, reducer, schema, type shape) — if so, inline it and note it came from a prototype. Trim to decision-rich parts only.

### Testing Decisions

- What makes a good test for this feature (test external behavior, not implementation details)
- Which modules will be tested
- Prior art in the codebase (similar existing tests)

### Out of Scope

What is explicitly not covered by this PRD.

### Further Notes

Any additional context, open questions, or follow-up pointers.
