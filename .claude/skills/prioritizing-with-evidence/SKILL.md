---
name: prioritizing-with-evidence
description: Use when prioritizing features, requirements, or a backlog/roadmap — applying MoSCoW, RICE, Kano, WSJF, or opportunity scoring, or choosing which prioritization method fits. For product managers and requirements engineers sequencing work by evidence and outcome rather than opinion.
---

# Prioritizing with Evidence

## Overview

Prioritization replaces the HiPPO (the loudest opinion) with a method grounded in real data, and ranks by **outcome and value**, not by who asked. Pick the method that fits the decision — don't force one.

## Choose the method

| Method | Best for | Formula / mechanism |
|--------|----------|---------------------|
| **MoSCoW** (DSDM) | Scope negotiation under fixed time/cost | Must / Should / Could / Won't. Keep Must ≤ ~60% effort; keep a ~20% Could contingency pool |
| **RICE** (Intercom) | Comparing roadmap ideas consistently | (Reach × Impact × Confidence) ÷ Effort = impact per time worked |
| **Kano** | Classifying features by satisfaction effect | Pair a *functional* + *dysfunctional* survey question → basic / performance / delighter / indifferent / reverse |
| **WSJF** (SAFe) | Sequencing for economic value | Cost of Delay ÷ Job Size — "if you quantify one thing, quantify cost of delay" |
| **Opportunity scoring** (Ulwick/Olsen) | Finding underserved needs | Importance + max(Importance − Satisfaction, 0) → important-but-unsatisfied wins |

## Workflow

1. Pick the method matching the decision (negotiating scope → MoSCoW; ranking ideas → RICE; understanding feature *type* → Kano; economic sequencing → WSJF; sizing unmet needs → opportunity scoring).
2. Ground inputs in real data — Reach and Effort from metrics, Importance/Satisfaction from a representative survey, Kano from customer responses (not internal opinion).
3. Prioritize **outcomes/jobs**, not pre-baked solutions.
4. Discount uncertainty honestly (RICE Confidence penalizes hand-wavy estimates). If an input has **no real data**, mark it as an assumption (lower Confidence) and name the cheapest test to get it — never invent a number to fill a cell.
5. Re-rank as evidence changes; tie the top items back to the outcome from `mapping-impact-to-outcomes`.

## Quality bar

- [ ] Method matches the decision type.
- [ ] Inputs are grounded in data, not opinion.
- [ ] Items are scored as outcomes/needs, not solutions.
- [ ] Top-ranked items trace to a measurable outcome.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Everything is a "Must" | Cap Must at ~60% effort; force trade-offs |
| Scoring from gut feel | Pull Reach/Importance/Satisfaction from real data |
| Kano classified internally | Run the functional/dysfunctional question pair on customers |
| Prioritizing features, not value | Score the outcome/job the feature serves |

## Reference

`docs/research/2026-06-21-agent-skills-for-product-discovery.md` §5.9. Sources: DSDM (MoSCoW); Intercom (RICE); Noriaki Kano; SAFe (WSJF); Ulwick / Dan Olsen (opportunity scoring).
