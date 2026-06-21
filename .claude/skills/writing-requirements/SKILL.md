---
name: writing-requirements
description: Use when writing user stories, acceptance criteria, or non-functional requirements — applying INVEST, splitting a large story, writing Given/When/Then scenarios, defining Definition of Ready/Done, or specifying measurable quality attributes. For requirements engineers and product owners turning validated discovery into buildable, testable specs.
---

# Writing Requirements

## Overview

Turns validated discovery into **buildable, testable** specifications. The core discipline: a requirement states the *what/why* (the need), not the *how* (the design), and every requirement must be **verifiable** — if no test or observation can confirm "done," it's at the wrong level of detail.

## User stories

- **Template:** "As a [user], I want [goal], so that [reason]." The "so that" captures value and guides prioritization.
- **INVEST** quality: **I**ndependent, **N**egotiable, **V**aluable, **E**stimable, **S**mall, **T**estable.
- **A story is a placeholder for a conversation** — the **3 C's**: **Card** (brief written token), **Conversation** (where the real detail emerges), **Confirmation** (acceptance criteria/tests).
- **Split vertically** (each slice still delivers end-to-end value) with **SPIDR**: **S**pike (research), **P**aths (one user path per story), **I**nterfaces (progressive UI), **D**ata (limit data scope first), **R**ules (relax a business rule, add later).

## Acceptance criteria

- **Given/When/Then** (Gherkin): *Given* a context, *When* an action, *Then* an observable outcome. ~3–5 criteria per story; assert observable behavior, not internal state.
- **Rule-oriented** (a checklist of behaviors that must always hold) vs. **scenario-oriented** (concrete examples). Use rules for general constraints, scenarios for end-to-end flows; iterate from rules toward scenarios.
- **Specification by Example** (Adzic): collaboratively-derived key examples become executable acceptance tests *and* living documentation.
- **Definition of Ready** (Pichler — clear, feasible, testable; ~3–5 acceptance criteria) gates entry into a sprint; **Definition of Done** (Scrum Guide — team/org quality bar) gates exit. DoR is optional and shouldn't become a rigid gate.

## Non-functional requirements (quality attributes)

- Organize with **ISO/IEC 25010** (2011: functional suitability, performance efficiency, compatibility, usability, reliability, security, maintainability, portability; 2023 adds Interaction Capability, Flexibility, Safety).
- Make each **measurable** — bad: "the system shall be fast." Good: a metric + scale + threshold whose target is **set from a real baseline/SLA/benchmark, not invented** — e.g. "95th-percentile API response ≤ *[current p95 baseline − agreed regression budget]* at *[expected peak concurrency]*"; leave the number as a sourced `[TBD]` placeholder until it exists. Use Gilb's **Planguage** (Scale + Meter + Must/Plan/Wish) for fuzzy qualities.
- **Accessibility:** WCAG 2.2, commonly **AA**.
- Elicit NFRs **early** — they are architectural drivers, expensive to retrofit.

## Workflow

1. Write stories from validated needs; check each against INVEST.
2. Split oversized stories vertically with SPIDR.
3. Attach Given/When/Then acceptance criteria (observable, ~3–5).
4. Capture relevant NFRs (ISO 25010 categories), each measurable and verifiable.
5. Confirm DoR before sprint entry; DoD before "done."

## Quality bar

- [ ] No solutioning: requirements state what/why, not how (no UI controls/tech named in the need).
- [ ] Every story passes INVEST; large stories split vertically.
- [ ] Every story has observable, testable acceptance criteria.
- [ ] No ambiguous terms ("fast", "user-friendly", "support") — each NFR is measurable.
- [ ] Each NFR threshold cites a source or baseline (current measurement / SLA / benchmark) — not an invented number.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Design baked into the requirement | State the need; move the "how" to design |
| Untestable / ambiguous wording | Add a metric or a Given/When/Then |
| Horizontal split (by tech layer) | Split vertically — each slice delivers value |
| NFRs deferred to "later" | Elicit early; they drive architecture |

## Reference

`docs/research/2026-06-21-agent-skills-for-product-discovery.md` §5.8. Sources: Cohn (user stories, SPIDR); Bill Wake (INVEST); Ron Jeffries (3 C's); Dan North/Cucumber (Given/When/Then); Adzic (Specification by Example); Pichler (DoR); Scrum Guide (DoD); Wiegers (quality attributes); ISO/IEC 25010; W3C WCAG 2.2.
