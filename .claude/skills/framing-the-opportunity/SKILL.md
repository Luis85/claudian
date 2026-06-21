---
name: framing-the-opportunity
description: Use when starting discovery on a problem, writing a problem statement, defining the outcome to pursue, turning research into "How Might We" questions or point-of-view statements, or when a team is jumping to solutions before the problem is understood. For product managers, UX designers, and requirements engineers framing the problem space.
---

# Framing the Opportunity

## Overview

Good discovery keeps the **problem space** (understand the problem) separate from the **solution space** (generate solutions). Fully exploring the problem first yields more creative, better-targeted solutions. The single most common failure is **solution-jumping** — starting in the solution space before the problem is understood.

This skill produces a tight **opportunity brief**: the outcome being pursued, the framed problem, and ideation-ready "How Might We" questions.

## When to use

- Kicking off a discovery effort or a new initiative.
- A request arrives pre-loaded with a solution ("build a dashboard") and the underlying problem is unstated.
- Translating research findings into a framing the team can ideate against.

## Workflow

**Guard:** If asked to "write requirements/specs" for a named solution, stop — produce the opportunity brief here and hand requirements to `writing-requirements` only *after* the outcome is agreed. Do not spec the named solution in this pass.

Create a task for each and complete in order:

1. **State the desired outcome.** An outcome is *a change in customer behavior that drives business results* — not a feature. Write it measurably — but take the **metric and target from a stakeholder or product data**; if none is supplied, leave the number `[TBD]` (or propose-and-confirm), **never invent it** (a made-up target anchors downstream assumption/impact maps to a fake goal). If the goal is phrased as an output ("ship X"), ask "what behavior change is X supposed to cause?" and reframe.
2. **Run the four-risk scan.** For value / usability / feasibility / business viability, note what you know and what is unknown. The biggest unknown drives research priority.
3. **Write the problem / point-of-view statement.** Format: **"[User] needs [need, as a verb] in order to [insight]."** The need is a *verb*, never a solution (users don't need "a dropdown"; they need *to compare options quickly*). Ground it in evidence; flag where it's assumption.
4. **Frame "How Might We" questions.** Derive each HMW directly from a real insight: **"How might we [desired outcome]?"** Scope it — not so narrow it embeds a solution, not so broad it loses the problem. Prefer positive framing ("increase/enable") over negative ("reduce/prevent").
5. **Hand off.** Surface assumptions next (`mapping-discovery-assumptions`) or plan research (`planning-discovery-interviews`).

## Quality bar

- [ ] The outcome is a behavior change, stated measurably — not an output; its metric/target is **sourced** from stakeholders/data or left `[TBD]`, not invented.
- [ ] The need is a verb, with no solution baked in.
- [ ] Every framing element is traceable to evidence, or explicitly labeled an assumption to test.
- [ ] HMW questions pass the checklist: based on a real insight? track the outcome? positively worded? broad enough for creativity? free of embedded solutions?

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Framing the output, not the outcome | Ask "what behavior must change?" |
| Need written as a feature | Rewrite as a user verb |
| HMW smuggles in the answer | Broaden until multiple solutions are possible |
| Framing from opinion | Tie each element to a finding or mark it as a hypothesis |

## Reference

`docs/research/2026-06-21-agent-skills-for-product-discovery.md` §5.1. Sources: NN/g user-need statements & How-Might-We; Stanford d.school; Josh Seiden *Outcomes Over Output*.
