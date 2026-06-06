---
type: quick-action
name: Deep Research
description: Dispatch parallel research subagents, run deep web research, and produce a cited Obsidian document in docs/research.
icon: microscope
tags:
  - research
  - agents
---

Run a deep research session on the topic or idea I just described. Follow these steps:

**1. Decompose**
Break the topic into 4–6 distinct research angles (e.g. prior art, technical feasibility, UX patterns, competitive landscape, risks, open questions). List them before starting.

**2. Dispatch subagents**
For each angle, dispatch a dedicated research subagent in parallel. Each subagent must:
- Focus exclusively on its angle.
- Search the web thoroughly (multiple queries, multiple sources).
- Return a structured summary with inline source citations `[Source: title](url)`.

**3. Synthesize**
Merge all subagent findings into a single comprehensive research document. Eliminate duplicates. Resolve contradictions explicitly (note both positions).

**4. Save to vault**
Write the document to `docs/research/YYYY-MM-DD-<slug>.md` where the slug is a short kebab-case title. Use this frontmatter:

```yaml
---
type: research
title: <full title>
tags:
  - research
related:
  - "[[<wikilink to related vault note if any>]]"
sources:
  - <url>
date: <YYYY-MM-DD>
status: draft
---
```

Body must include:
- **Executive summary** (3–5 sentences)
- One section per research angle with findings and inline citations
- **Open questions** section listing what remains unresolved
- **Sources** section at the bottom listing all cited URLs

Use Obsidian wikilinks `[[note]]` to cross-reference any related vault notes found during research (plans, issues, ideas, features).

**5. Follow-up**
After saving, print a short summary of the key findings (≤ 10 bullets). Then ask:
> "Which of these angles would you like to deepen, or is there a new angle to add?"

Wait for my response before doing any further research.
