---
type: quick-action
name: Grill Me (with Docs)
description: Stress-test a plan against the domain model, sharpen terminology, and update CONTEXT.md and ADRs inline as decisions crystallise.
icon: sword
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing.

If a question can be answered by exploring the codebase, explore the codebase instead.

## Domain awareness

Domain language lives in `CONTEXT.md` (root glossary) and any architecture docs under `CLAUDE.md` files or `docs/`. ADRs live in `docs/adr/` — create the folder lazily if it does not exist yet.

### Challenge against the glossary

When I use a term that conflicts with language in `CONTEXT.md`, call it out immediately. "The glossary defines 'X' as Y, but you seem to mean Z — which is it?"

### Sharpen fuzzy language

When I use vague or overloaded terms, propose a precise canonical term aligned with the existing domain language.

### Discuss concrete scenarios

Stress-test domain relationships with specific scenarios that probe edge cases and force precision about concept boundaries.

### Cross-reference with code

When I state how something works, check whether the codebase agrees. If you find a contradiction, surface it explicitly.

### Update CONTEXT.md inline

When a term is resolved, update `CONTEXT.md` right there — do not batch. Keep `CONTEXT.md` as a pure glossary: terms, definitions, and avoid-lists only. No implementation details, no specs, no scratch-pad content.

### Offer ADRs sparingly

Only propose an ADR when all three are true:
1. **Hard to reverse** — changing later has real cost.
2. **Surprising without context** — a future reader would wonder "why?".
3. **Real trade-off** — genuine alternatives existed and one was chosen for specific reasons.

If any condition is missing, skip the ADR. Write ADRs to `docs/adr/NNNN-<slug>.md`.
