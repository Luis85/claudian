---
name: mapping-discovery-assumptions
description: Use when an idea or solution rests on untested beliefs, when deciding what to research or test next, when prioritizing risks by importance and evidence, or when running an assumptions, desirability/feasibility/viability, or riskiest-assumption-test workshop. For product managers, UX designers, and requirements engineers de-risking before building.
---

# Mapping Discovery Assumptions

## Overview

Every idea is a stack of beliefs. This skill makes them **explicit, falsifiable, and prioritized**, so experimentation targets what actually matters — and so the team learns *before* it builds, not after.

## When to use

- You have a candidate solution, value proposition, or initiative with many unknowns.
- The team disagrees about what is "true," or is about to build on an untested premise.
- You need to decide what to research or test next.

## Workflow

1. **Surface assumptions.** Write each belief as a falsifiable statement: **"We believe that…"** One belief per note. Phrasing it this way forces the mindset that you might be wrong.
2. **Categorize by risk** (color-code):
   - **Desirability** — do customers want it? (owner: design/UX)
   - **Feasibility** — can we build/scale it? (owner: engineering)
   - **Viability** — does it work for the business? (owner: PM)
   - *(optional)* **Adaptability** — can it survive a changing environment?
3. **Plot on the 2×2.** Axes: **Importance** (Y: if this is wrong, does the idea fail? — important at the top) × **Evidence** (X: known / have-evidence on the **left**, unknown / no-evidence on the **right**). Place fast and binary; don't debate coordinates.
4. **Pick the riskiest.** The **top-right quadrant — important + unknown (no evidence)** — is where near-term experiments go. Don't waste effort validating the already-supported (top-left) or the unimportant (bottom). If several beliefs tie in the top-right, test the one whose failure is **cheapest to detect** first.
5. **Design a Riskiest Assumption Test (RAT).** Build only the minimum needed to learn — often no code and no UI. Learn and measure *first*; build only if the assumption holds. Define what result would *disprove* the belief.
6. **Run, re-plot, repeat.** Move tested assumptions left (now they have evidence) and pick the next riskiest.

## Quality bar

- [ ] Each assumption is one falsifiable "We believe that…" statement.
- [ ] Assumptions are categorized across desirability AND feasibility AND viability (not just feasibility — the common blind spot).
- [ ] The chosen test attacks the most important, least-evidenced belief.
- [ ] The test has a pre-stated disconfirming result.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Only listing feasibility risks | Force desirability + viability rows |
| Vague, unfalsifiable beliefs | Rewrite so a test could prove them wrong |
| Building an MVP before testing | Run the RAT first — learn before build |
| Designing tests that can only confirm | State the result that would kill the belief |

## Reference

`docs/research/2026-06-21-agent-skills-for-product-discovery.md` §5.2. Sources: Strategyzer / David Bland (*Testing Business Ideas*); Rik Higham (RAT); Eric Ries (*The Lean Startup*); NN/g discovery-phase.
