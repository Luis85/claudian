# Docs taxonomy reference

## Scaffolded structure

When `docs.scaffold: true`, the engine writes four files (all `skip-if-exists` — never clobbers user content):

| Path | Purpose |
|------|---------|
| `CONTEXT.md` | Project glossary: canonical terms, definitions, avoid-list. Pure glossary — no specs or implementation details. The grill interview fills it. |
| `docs/adr/0000-template.md` | ADR template. Copy and rename for each architectural decision. |
| `docs/quality-integration-guide.md` | Human-readable guide to the installed quality harness. Auto-rendered from the active guardrails so it only documents what is actually installed. |
| `CONTRIBUTING.md` | Quality evidence checklist for contributors. |

## Frontmatter convention

All durable docs (ADRs, specs, plans, research, reviews, handoffs) carry YAML frontmatter:

```yaml
---
title: "Short title"
date: YYYY-MM-DD
status: proposed | accepted | superseded | deprecated
scope: optional narrowing label
---
```

## Folder conventions

| Folder | Contents |
|--------|---------|
| `docs/adr/` | Architecture Decision Records. One file per decision; number sequentially (e.g. `0001-use-vitest.md`). |
| `docs/specs/` | Design specs for planned features. |
| `docs/plans/` | Implementation plans (task breakdowns, step-by-step). |
| `docs/research/` | Background research and comparison notes. |
| `docs/reviews/` | Code review notes and post-mortems. |
| `docs/handoffs/` | Context handoffs between agents or sessions. |

## Glossary discipline

`CONTEXT.md` is the single canonical source of domain terms. Rules:
- One entry per term.
- Define the term precisely; include an avoid-list of synonyms that must not appear in code or docs.
- Never include implementation details or specs — those belong in `docs/specs/`.
- Update the glossary when the grill interview surfaces a new term; challenge any term that is ambiguous or overloaded.
