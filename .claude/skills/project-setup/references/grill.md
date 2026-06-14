# Grill interview protocol

The grill is a structured requirements interview that fills `CONTEXT.md`, seeds ADRs, and produces a first requirements document. Run it when the user opts in during setup (or independently at any time).

## Protocol

**One question at a time.** Do not front-load a list of questions. Listen to the answer, update the glossary if a new term surfaces, then ask the next question.

### Opening question
"What is this project trying to do, in one sentence?"

Record the answer as the project's purpose statement at the top of `CONTEXT.md`.

### Domain interview (repeat until the domain is clear)
For each noun or verb that appears in the answers:
1. Ask what it means precisely in this project's context.
2. Ask what synonyms exist and which should be avoided (the avoid-list).
3. Ask whether it maps to an existing concept in the codebase or must be introduced.
4. Update `CONTEXT.md` with the term, definition, and avoid-list entry.

**Challenge vague terms.** If the user says "data", "entity", "object", "item", or any term that is overloaded across the industry, push for the project-specific meaning before moving on.

### Decision identification
For each constraint or trade-off that surfaces:
1. Ask: "Is this decision hard-to-reverse, surprising, or a real trade-off?" (all three must be yes to warrant an ADR)
2. If yes: draft an ADR stub in `docs/adr/NNNN-<slug>.md` with `status: proposed`. Do NOT fill in the Decision section — that belongs to the team.
3. If no: note it as a context item in `CONTEXT.md` only.

### Requirements capture
Once the domain is stable (no new terms in the last two rounds), ask:
- "What must the system do? (functional requirements)"
- "What must it never do? (constraints and non-goals)"
- "What quality bar must it meet? (performance, reliability, security, etc.)"

Record answers in `docs/specs/requirements.md` with `status: draft`.

## Glossary update rule
After every exchange, scan the new text for any term that is not yet in `CONTEXT.md`. If found, immediately ask for a definition before proceeding. The glossary must be complete before requirements are written — an undefined term in a requirement is a latent bug.

## When to stop
Stop the grill when:
- The user says "that's enough" or explicitly moves on.
- The last two rounds produced no new terms or decisions.
- A requirements doc has been written and reviewed.

Do not generate code, configs, or plans during the grill. The output is `CONTEXT.md`, zero or more ADR stubs, and `docs/specs/requirements.md`.
