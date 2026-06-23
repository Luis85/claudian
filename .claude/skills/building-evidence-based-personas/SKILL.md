---
name: building-evidence-based-personas
description: Use when creating personas, proto-personas, or empathy maps, deciding whether a persona is research-based or an assumption, separating user goals from tasks, or when tempted to generate a persona with AI. For UX designers and product managers modeling who the user is.
---

# Building Evidence-Based Personas

## Overview

A persona is a **behavioral model** of a user type, built from research — not a demographic profile and not a fictional character. Its value is capturing **goals** (stable end-states and motivations) distinct from **tasks** (the changeable steps to reach them). Design for goals.

## AI guardrail

**Do not generate personas from an AI's general knowledge.** AI personas are "a generic stereotype based on averaged internet content" — blind to real context of use and B2B complexity, and they describe idealized rather than actual behavior. AI may help *structure* a persona *from your own research data*; it must not be the source of the user. **If you have neither research nor a named human team's stated assumptions, STOP and ask for them — never generate personas (not even labeled "proto") from your own knowledge.**

## Choose the right rigor

| Type | Built from | Use when |
|------|-----------|----------|
| **Proto-persona** | A **named human team's** stated assumptions (never the model's), no new research | Aligning beliefs fast / low maturity — **label it a hypothesis and validate later**; if no human assumptions exist, ask rather than generate |
| **Qualitative persona** (sweet spot) | ~5–30 interviews, coded into patterns | Most teams, most decisions |
| **Statistical persona** | Qual + large survey (100–500+), clustered | Large orgs with statistical expertise and need for population proportions |

Proto-personas *start a conversation*; qualitative personas *make decisions*.

## Workflow (goal-directed construction)

1. **Group** interviewees by role.
2. **List behavioral variables** — the ways interviewees differed (usually a range with two ends).
3. **Map** each interviewee onto those ranges.
4. **Find clusters** — people who clump across multiple variables signal a pattern → a persona.
5. **Synthesize** each pattern's behaviors and **goals** (life / experience / end goals); add context and environment, plus a representative **verbatim quote only if one exists in the data** (otherwise cite an observed behavior or artifact — never fabricate a quote to fill the slot).
6. **Designate types** — primary (must be satisfied by their own UI), secondary, supplemental, customer, served, negative (anti-persona).
7. **Check** for redundancy and completeness.

## Empathy maps (companion artifact)

One per user type: **Says** (verbatim quotes), **Thinks**, **Does**, **Feels** (or Dave Gray's canvas: Goal in the center, See/Say/Do/Hear outside the head, Think & Feel / Pains & Gains inside). The tension between *Says/Thinks* and *Does/Feels* is the insight. Fuel with real qualitative data.

## Quality bar

- [ ] Built from research data (or explicitly tagged a proto-persona/hypothesis).
- [ ] Goals separated from tasks; design targets goals.
- [ ] No demographics-only personas; no AI-sourced stereotypes.
- [ ] Proto-personas come from a **named human team's stated beliefs** — never the model's own knowledge; if no human assumptions exist, ask for them (or for research) rather than generating personas.
- [ ] Persona types designated (at least one primary).

## Reference

`docs/research/2026-06-21-agent-skills-for-product-discovery.md` §5.5, §7. Sources: Cooper/Goodwin (*About Face*, goal-directed design); NN/g (persona types, empathy mapping); Dave Gray (empathy map canvas); IxDF (AI vs researched personas).
