---
name: mapping-impact-to-outcomes
description: Use when connecting features or deliverables to business goals, building an impact map, writing OKRs, creating an outcome-based roadmap, or cutting features that don't serve a measurable outcome. For product managers and requirements engineers linking work to results and avoiding the feature factory.
---

# Mapping Impact to Outcomes

## Overview

The defining product failure is the **feature factory** — measuring output (features shipped) over outcomes (customer behavior changed that drives business results). This skill keeps every deliverable tied to a measurable outcome, and cuts the ones that aren't.

## When to use

- A roadmap is becoming a list of features with no stated goals.
- You need to decide which deliverables actually move a metric.
- Setting OKRs or an outcome-based roadmap.

## Impact mapping (Adzic)

A mind map from a measurable goal outward, four levels — each answering one question:

1. **Goal — Why?** The single, specific, **measurable** business objective at the root (e.g., "increase active players to 1M," not "improve engagement").
2. **Actors — Who?** People who can produce or obstruct the effect.
3. **Impacts — How?** The **behavior changes** in actors that move the goal — **not features.** (The #1 mistake is writing features here.) Litmus: an impact must be an actor *doing something differently*, with **no product noun in it**; if it names a feature, it belongs in level 4.
4. **Deliverables — What?** Features/activities that *support* an impact.

Every deliverable must trace up through an impact and actor to the goal. **Orphan deliverables get cut.** Each branch is a hypothesis ("if we ship this, this actor's behavior changes, which moves the goal") — deliver the smallest set for the highest-leverage impact, measure, then stop or pivot.

## Outcomes vs. outputs

- **Output** = the stuff you make. **Outcome** = a change in customer behavior that creates value. **Impact** = the higher-level business result.
- **OKRs** (Doerr): *"I will [Objective] as measured by [Key Results]."* The Objective is qualitative/inspirational; Key Results are measurable outcome metrics with no gray area.
- **Outcome-based roadmap** (Pichler's GO roadmap: Date / Name / **Goal** / Features / Metrics): goals first, then a few coarse features that serve each goal.

## Workflow

1. State the measurable goal (an OKR Key Result or roadmap goal).
2. Map actors → behavior-change impacts → candidate deliverables.
3. Cut any deliverable that doesn't trace to an impact and the goal.
4. Pick the highest-leverage impact; deliver the minimum, measure, decide.

## Quality bar

- [ ] The goal is specific and measurable.
- [ ] Impacts are behavior changes, never features.
- [ ] Every deliverable traces up to the goal; orphans removed.
- [ ] Outcomes (behavior/result), not outputs, define success.

## Reference

`docs/research/2026-06-21-agent-skills-for-product-discovery.md` §5.7. Sources: Gojko Adzic (Impact Mapping); John Doerr (OKRs / *Measure What Matters*); Roman Pichler (GO roadmap); Josh Seiden (*Outcomes Over Output*); Cagan/SVPG; John Cutler (feature factory).
