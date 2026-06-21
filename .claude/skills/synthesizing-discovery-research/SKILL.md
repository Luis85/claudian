---
name: synthesizing-discovery-research
description: Use when turning raw interview notes, transcripts, or field observations into themes and insights — affinity mapping, thematic analysis, coding qualitative data, building a research repository, or using AI to help analyze research, especially when AI assistance risks fabricated quotes or synthetic findings. For UX designers and requirements engineers.
---

# Synthesizing Discovery Research

## Overview

Synthesis turns a pile of raw qualitative data into a small set of **evidence-linked insights** the team can act on. The discipline that matters most when AI assists: **every insight must trace back to something a real person actually said or did.**

## AI guardrails (read first)

When using AI to code or summarize research:

- **Never invent quotes.** ~8% of LLM-generated "quotes" can't be found in the source transcript — often subtle rewordings that distort meaning. Verify every quote against the raw text before it reaches a deck.
- **No synthetic users / synthetic findings.** AI participants are sycophantic, one-dimensional, and report idealized behavior. Do not present AI output as real-user findings.
- **Treat AI clusters/themes as a first draft to verify**, not as conclusions.
- **Seek disconfirming evidence** — ask the model "what in the data contradicts this theme?"
- **Cite the source** for every nugget; strip PII.

## Methods

**Affinity mapping (KJ method)** — for making sense of a large pile fast:
1. One observation/quote per note.
2. Each person writes notes independently first (5–10 min) to avoid groupthink; cluster in silence.
3. Cluster by **meaning, not shared keywords**; let labels emerge.
4. Keep a **focus question** visible (e.g., "Why aren't users logging in?").
5. Don't discard outliers — small clusters hold value.

**Thematic analysis (Braun & Clarke, 6 phases)** — for rigor: familiarize → code (descriptive labels, no interpretation yet) → search for themes (cluster codes) → review → name → report with supporting quotes. Codes describe; themes interpret. Prefer inductive/open coding in discovery (you're discovering, not confirming). Maintain a **codebook**; watch for "definitional drift."

**Atomic research (nuggets)** — for reuse: capture each finding as **"We did X, saw Y, which means Z"** (experiment → fact → insight → recommendation). Facts are unbiased single observations; insights come only *after* facts. Store tagged nuggets in a searchable **research repository** so insight isn't locked in one-off decks.

## Workflow

1. Choose method (affinity for speed, thematic for rigor, nuggets for reuse).
2. Code/cluster against a visible focus question.
3. For each theme, attach 2+ pieces of real, verified evidence — verbatim quotes **or** observed behaviors/diary entries/artifacts (observation and field studies count, not only quotes).
4. Time-box it — stop when no new themes emerge (saturation), to avoid analysis paralysis.
5. Output evidence-linked insights → feed `building-evidence-based-personas`, `mapping-customer-journeys`, or `framing-the-opportunity`.

## Quality bar

- [ ] Every insight links to a real, verified observation/quote.
- [ ] No fabricated quotes, participants, or synthetic findings.
- [ ] If the data can't supply real support for each theme, **reduce the number of themes and flag insufficient evidence** — never pad a requested theme/quote count.
- [ ] Clustering is by meaning, not keyword.
- [ ] Synthesis is time-boxed with a saturation stop rule.

## Reference

`docs/research/2026-06-21-agent-skills-for-product-discovery.md` §5.4, §7. Sources: NN/g (affinity, repositories, synthetic users, genAI research agenda); IxDF & getthematic (thematic analysis/coding); User Interviews (atomic nuggets); uintent (LLM hallucination).
