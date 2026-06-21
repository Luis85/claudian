---
title: Discovery skills — RED/GREEN evaluations
date: 2026-06-21
status: research
scope: verification artifact for the twelve product-discovery skills under .claude/skills/ (writing-skills RED/GREEN methodology)
related:
  - "[[2026-06-21-agent-skills-for-product-discovery]]"
---

# Discovery Skills — RED/GREEN Evaluations

Verification artifact for the twelve discovery skills, per the repo's
`writing-skills` Iron Law ("no skill without a failing test first"). Each skill
was evaluated with a subagent in two conditions:

- **RED (baseline):** the subagent attempts a realistic discovery task **without**
  the skill — capturing the natural failure mode.
- **GREEN:** the subagent reads the `SKILL.md`, follows it, and redoes the task —
  confirming the skill closes the RED gap.

Every skill **passed** (GREEN closes the RED gap). Each evaluator surfaced one
residual loophole — almost all the same class: *an agent can satisfy an
artifact's structure with fabricated content*. A one-line discriminating clause
was added to each skill to close it (the "Fix applied" column).

## Results

| Skill | RED failure mode (without skill) | GREEN (with skill) | Loophole found → Fix applied |
|-------|----------------------------------|--------------------|------------------------------|
| `running-product-discovery` | Jumps straight to scoping/designing the named feature (HiPPO + solution-jump) | Routes to framing + four-risk scan; treats feature as hypothesis | No explicit *first action* for a solution-loaded request → added a "do NOT scope/design a pre-formed solution; start at step 1" guard |
| `framing-the-opportunity` | Writes solution/feature requirements for the named artifact | Reframes to measurable outcome, verb-need POV, solution-free HMW | Doesn't forbid speccing the named solution in-pass → added a "do not spec the named solution; hand off to writing-requirements" guard |
| `mapping-discovery-assumptions` | Accepts "we're confident", jumps to MVP; ignores viability | Falsifiable "We believe…", DFV rows, 2×2, RAT before build | No tie-breaker when several beliefs tie top-right → added "test the one whose failure is cheapest to detect first" |
| `planning-discovery-interviews` | Leading/confirmation-seeking closed questions ("Do you love…?") | Open, non-leading, critical-incident questions; saturation plan | Debiases wording but not a biased *goal* → added "reject confirmation-framed goals; restate neutrally first" |
| `synthesizing-discovery-research` | Fabricates quotes/participants to fill a 3×2 theme grid | Refuses to fabricate; reduces themes; flags insufficient evidence | Could over-interpret to hit a requested count → added "reduce themes / flag insufficient evidence; never pad a count" (and broadened evidence to observations/artifacts, not only quotes) |
| `building-evidence-based-personas` | Invents demographic AI-stereotype personas from general knowledge | Refuses AI-sourced personas; labels proto-personas as hypotheses; goals≠tasks | Could relabel its own stereotypes as "team assumptions" → added "proto-personas must come from a named human team, not the model" |
| `defining-jobs-to-be-done` | Vague/feature-laden job; mixes JTBD schools; no tool | Picks a school; solution-free job statement; matching tool | Could invent "desired outcomes" with no data → added "real-language outcomes marked as evidence; invented ones labeled hypotheses" |
| `mapping-customer-journeys` | Invented map, no actor/scenario, no emotion curve or opportunities | One actor+scenario; emotion curve; pain→owned opportunity; blueprint cue | "Label it a hypothesis map" still allowed fabricated curve → added "hypothesis map must list top unvalidated assumptions + next research step" |
| `mapping-impact-to-outcomes` | Accepts vague goal; fills impacts with features | Forces measurable goal; impacts = behavior changes; cuts orphans | No test to tell impact from feature → added the litmus "an impact has no product noun; if it names a feature it's a deliverable" |
| `story-mapping-the-solution` | Flat re-sorted backlog; first release one-feature-deep | Activity backbone; walking skeleton spanning all activities; horizontal slices | A single column could pass as a "backbone" → added "backbone must have ≥3 distinct activities; else decompose first" |
| `writing-requirements` | Design-baked, untestable ("system shall be fast"); no acceptance criteria | INVEST stories; Given/When/Then; measurable ISO-25010 NFRs | A "measurable" threshold can still be invented → added "each NFR threshold cites a source/baseline, not an invented number" |
| `prioritizing-with-evidence` | Gut-feel ranking; everything a "Must" | Picks a method; data-grounded inputs; caps Must; outcomes not features | Could fabricate RICE numbers under a thin prompt → added "if no data, mark as assumption (low Confidence) + name the cheapest test; never invent a number" |

## Notes

- This was a single RED→GREEN→REFACTOR cycle. The `writing-skills` discipline
  treats hardening as ongoing: as these skills are used, capture any new
  rationalizations and add explicit counters.
- The dominant loophole class — **fabricated content satisfying a structural
  checklist** — is the same hazard the research note's AI guardrails warn about
  (§7). The fixes push every skill toward *evidence-or-explicit-hypothesis*,
  never silent invention.
- Method: six subagents, two skills each, run in parallel; each performed both
  conditions itself and reported the RED gap, GREEN behavior, verdict, and a
  concrete one-line fix. Fixes were applied and re-read for consistency.
