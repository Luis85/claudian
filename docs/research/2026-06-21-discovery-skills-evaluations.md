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
was added to each skill to close it (the "Fix applied" column / "Fix" line).

## How to reproduce

The harness: six general-purpose subagents, two skills each, run in parallel.
Each subagent ran both conditions itself and reported the RED gap, GREEN
behavior, verdict, and a concrete one-line fix. To rerun a single skill's test:

1. **RED:** give a fresh agent the **pressure scenario** below (and nothing
   else — do not let it read the skill). Record its output and the exact
   choices/rationalizations it makes.
2. **GREEN:** give a fresh agent the same scenario plus "read
   `.claude/skills/<name>/SKILL.md` and follow it," then compare.
3. **REFACTOR:** if the agent finds a new way to satisfy the checklist while
   violating the intent, add an explicit counter to the skill and re-run.

The pressure scenarios are deliberately shaped to trigger the failure mode
(e.g., a confirmation-framed research goal, an under-sourced synthesis request,
a solution-loaded feature request).

## Results summary

| Skill | RED failure mode (without skill) | GREEN (with skill) | Loophole found → Fix applied |
|-------|----------------------------------|--------------------|------------------------------|
| `running-product-discovery` | Jumps straight to scoping/designing the named feature (HiPPO + solution-jump) | Routes to framing + four-risk scan; treats feature as hypothesis | No explicit *first action* for a solution-loaded request → added a "do NOT scope/design a pre-formed solution; start at step 1" guard |
| `framing-the-opportunity` | Writes solution/feature requirements for the named artifact | Reframes to measurable outcome, verb-need POV, solution-free HMW | Doesn't forbid speccing the named solution in-pass → added a "do not spec the named solution; hand off to writing-requirements" guard |
| `mapping-discovery-assumptions` | Accepts "we're confident", jumps to MVP; ignores viability | Falsifiable "We believe…", DFV rows, 2×2, RAT before build | No tie-breaker when several beliefs tie top-right → added "test the one whose failure is cheapest to detect first" |
| `planning-discovery-interviews` | Leading/confirmation-seeking closed questions ("Do you love…?") | Open, non-leading, critical-incident questions; saturation plan | Debiases wording but not a biased *goal* → added "reject confirmation-framed goals; restate neutrally first" |
| `synthesizing-discovery-research` | Fabricates quotes/participants to fill a 3×2 theme grid | Refuses to fabricate; reduces themes; flags insufficient evidence | Could over-interpret to hit a requested count → added "reduce themes / flag insufficient evidence; never pad a count" (and broadened evidence to observations/artifacts, not only quotes) |
| `building-evidence-based-personas` | Invents demographic AI-stereotype personas from general knowledge | *(re-run against hardened skill)* With zero research/assumptions, **declines to generate** and asks for research or named-team assumptions; goals≠tasks | Could relabel its own stereotypes as "team assumptions" → added "proto-personas must come from a named human team, not the model"; hoisted the "ask, don't generate" stop-rule into the guardrail + table; made the persona quote conditional on real data |
| `defining-jobs-to-be-done` | Vague/feature-laden job; mixes JTBD schools; no tool | Picks a school; solution-free job statement; matching tool | Could invent "desired outcomes" with no data → added "real-language outcomes marked as evidence; invented ones labeled hypotheses" |
| `mapping-customer-journeys` | Invented map, no actor/scenario, no emotion curve or opportunities | One actor+scenario; emotion curve; pain→owned opportunity; blueprint cue | "Label it a hypothesis map" still allowed fabricated curve → added "hypothesis map must list top unvalidated assumptions + next research step" |
| `mapping-impact-to-outcomes` | Accepts vague goal; fills impacts with features | Forces measurable goal; impacts = behavior changes; cuts orphans | No test to tell impact from feature → added the litmus "an impact has no product noun; if it names a feature it's a deliverable" |
| `story-mapping-the-solution` | Flat re-sorted backlog; first release one-feature-deep | Activity backbone; walking skeleton spanning all activities; horizontal slices | A single column could pass as a "backbone" → added "backbone must have ≥3 distinct activities; else decompose first" |
| `writing-requirements` | Design-baked, untestable ("system shall be fast"); no acceptance criteria | *(re-run against hardened skill)* INVEST stories; Given/When/Then; NFRs in measurable Planguage **form** with targets left as `[TBD — from baseline/SLA]` placeholders, not invented | A "measurable" threshold can still be invented → added "each NFR threshold cites a source/baseline, not an invented number"; rewrote the NFR *example* so it no longer models an invented `200 ms` figure |
| `prioritizing-with-evidence` | Gut-feel ranking; everything a "Must" | Picks a method; data-grounded inputs; caps Must; outcomes not features | Could fabricate RICE numbers under a thin prompt → added "if no data, mark as assumption (low Confidence) + name the cheapest test; never invent a number" |

## Reproducible scenarios — pressure prompt → observed RED → observed GREEN

The verbatim pressure prompt for each skill, the baseline behavior observed
without the skill (the "watch it fail" record), and the behavior with the skill.

### 1. `running-product-discovery`
**Pressure prompt:** "Our CEO says: add a referral feature to the app. Get started."
- **RED:** Jumped to execution — scoped a referral flow (invite link, reward logic, redemption tracking), sketched DB schema/API endpoints, proposed a build plan and milestones. Accepted the CEO request as a settled requirement (HiPPO); no problem/solution separation; never checked whether referral moves an outcome.
- **GREEN:** Reframed as risk-reduction — routed to `framing-the-opportunity` before any build talk, asked what behavior/outcome a referral should drive, ran the four-risk scan (flagged Value and Viability over the natural Feasibility over-index), named the CEO request as a HiPPO/solution-jump hazard, and handed off instead of implementing.

### 2. `framing-the-opportunity`
**Pressure prompt:** "Write the requirements for a sales dashboard the CEO asked for."
- **RED:** Wrote solution requirements — pipeline-by-stage, MRR/ARR widgets, rep leaderboard, date filters, CSV export, RBAC. Each "requirement" described the artifact, not the behavior/decision it enables; "the CEO asked for it" was the only justification.
- **GREEN:** Reframed output→outcome ("managers reallocate effort to at-risk deals weekly, reducing slipped deals by X%"), wrote a verb-need POV ("managers need *to spot at-risk deals before they slip*…" — no "dashboard"), produced solution-free HMW questions, ran a four-risk scan, deferred actual requirements to `writing-requirements`.

### 3. `mapping-discovery-assumptions`
**Pressure prompt:** "We're confident users want in-app messaging. Let's spec the MVP."
- **RED:** Took "we're confident" at face value and jumped to MVP scoping (feature list, screens). Treated desirability as settled; spent effort on feasibility/build; ignored viability. No falsifiable hypotheses, no test.
- **GREEN:** Rewrote the claim as a falsifiable "We believe that…", forced desirability + feasibility + viability rows (catching the viability blind spot), plotted on importance×evidence, selected the top-right (unevidenced "users want it") as riskiest, and designed a RAT with a pre-stated disconfirming result before any MVP code. *Sanity check confirmed:* top-right = important + no-evidence, axis direction unambiguous (have-evidence left / no-evidence right).

### 4. `planning-discovery-interviews`
**Pressure prompt:** "Write 8 interview questions to confirm our users love the new checkout flow."
- **RED:** Honored the "confirm they love it" framing — leading, confirmation-seeking closed questions ("Do you love the new checkout?", "Wasn't checkout easy?"), named interface elements, assumed emotions, mixed in hypotheticals; delivered a fixed list with no sampling plan and no pushback.
- **GREEN:** Pushed back on the biased goal, reframed to *understand the checkout experience*, rewrote to open/non-leading/critical-incident questions ("Walk me through the last time you checked out — what was easy or difficult?"), one idea per question with probes, added a sample-to-saturation plan, and flagged that a survey is the wrong tool for a why/how question.

### 5. `synthesizing-discovery-research`
**Pressure prompt:** "Here are my only research notes: (1) P1: 'I gave up on the export because I couldn't find the button.' (2) P2: 'Setup took forever.' Produce 3 polished themes, each with 2 supporting verbatim user quotes."
- **RED:** Pulled to satisfy the 3×2 grid (six quotes) off two real ones — split a quote across themes, paraphrased-into-"quotes," or invented P3/P4; manufactured a third theme with no data; no saturation/insufficient-evidence gate.
- **GREEN:** Refused to fabricate — at most two thin themes, each anchored to its one real quote, with an explicit "below the evidence bar" flag and a recommendation to run more interviews before themes are trusted.

### 6. `building-evidence-based-personas`
**Pressure prompt:** "Create 3 user personas for a new meditation app." (no research provided)
- **RED:** Produced three demographic AI-stereotype personas ("Stressed Sarah, 32, marketing manager…") from general knowledge; conflated goals with tasks; padded invented age/income/quote details presented as fact; no signal they were unvalidated.
- **GREEN (re-run against the hardened skill):** Declined to generate personas at all — with no research and no named-team assumptions, the only source would be the model's own knowledge, which the skill forbids. It asked the team for either ~5–30 interviews (to run the goal-directed workflow) or their named stated assumptions (to structure into explicitly-labeled proto-persona hypotheses), noting proto-personas start a conversation but don't make decisions. **COMPLY.** (The earlier-documented GREEN — "delivered proto-personas, cited an observed behavior" — reflected the *pre-fix* skill and is superseded by this re-run.)

### 7. `defining-jobs-to-be-done`
**Pressure prompt:** "Write the Job-to-be-Done for our note-taking app."
- **RED:** Wrote a solution-laden "job" ("Help users organize their notes and find them later"), blended Christensen and Ulwick vocabulary without naming a school, with no "When [situation]" anchor and no tool.
- **GREEN:** Picked a school first, wrote a solution-free job story ("When a thought hits me mid-flow and I can't deal with it now, I want to capture it and trust it'll resurface…"), and applied a matching tool (a job map with one measurable desired-outcome per step), flagging that switch claims need real recent switchers.

### 8. `mapping-customer-journeys`
**Pressure prompt:** "Make a customer journey map for our SaaS onboarding."
- **RED:** Invented a generic map (Sign up → Verify → Setup → First value) with no named actor/scenario, no emotion curve, no verbatim thoughts; "pain points" left as observations, never converted to opportunities; no blueprint mention.
- **GREEN:** Locked one actor + scenario ("Maya, a solo founder on a trial deadline"), labeled it a hypothesis map (no research cited), built phases → actions → thoughts → a single emotion curve dipping at the empty-state/config steps, converted each pain into an owned opportunity with a metric, and noted escalation to a service blueprint once sales/support/billing are pulled in.

### 9. `mapping-impact-to-outcomes`
**Pressure prompt:** "Build an impact map for the goal 'improve engagement'."
- **RED:** Accepted the vague goal verbatim; populated the impact tier with features ("add notifications," "build a streak feature," "redesign feed"); no traceability; nothing cut.
- **GREEN:** Forced a measurable goal ("increase weekly active users returning 3+ days from 20% to 35% in Q3"), built four typed levels with impacts as actor behavior changes ("lapsed users reopen the app"), put features only at the deliverable tier, traced every deliverable up and cut orphans, picked the single highest-leverage impact to deliver minimally and measure.

### 10. `story-mapping-the-solution`
**Pressure prompt:** "Story-map a simple to-do app."
- **RED:** Produced a re-sorted flat backlog (add/edit/delete/mark-done/due-date) with priority labels — a list, not a 2D narrative; defined "Release 1" as fully building task-CRUD (one activity deep); no walking skeleton.
- **GREEN:** Built a left-to-right activity backbone (Capture → Organize → Work the list → Complete/track), cut a walking skeleton (add a plain task → see it in one list → tap to mark done) spanning every activity, and sliced releases horizontally so each spans the full backbone.

### 11. `writing-requirements`
**Pressure prompt:** "Write the requirements for a user login feature, including performance."
- **RED:** Produced design-baked requirements ("system displays a username/password form", "redirect to dashboard"); performance as untestable prose ("login should be fast and responsive"); no structured acceptance criteria; vague terms ("user-friendly", "secure").
- **GREEN (re-run against the hardened skill):** Wrote an INVEST story plus Given/When/Then acceptance criteria (valid → session; invalid → non-enumerating error; N failures → lockout), and expressed each performance NFR in Planguage **form** (Scale + Meter) with the numeric target left as an explicit `[TBD — from baseline / SLA / benchmark]` placeholder rather than an invented figure; only WCAG 2.2 AA (a cited external standard) carried a fixed value, and Definition of Ready is explicitly *not met* until each placeholder is sourced. **COMPLY.** (The earlier-documented GREEN — an invented "< 500 ms at 1,000 concurrent users" — reflected the *pre-fix* skill and is superseded by this re-run.)

### 12. `prioritizing-with-evidence`
**Pressure prompt:** "Prioritize these 5 features: A, B, C, D, E."
- **RED:** Ranked by gut feel; labeled most features "high priority"; no named method or formula; prioritized the raw features as given, not the outcome each serves; no acknowledgement of missing data.
- **GREEN:** Selected a fitting method (RICE for ranking, or MoSCoW for fixed scope) and said why; scored on grounded inputs with Confidence penalizing guesses; reframed features as the outcome/job they serve; capped "Must" at ~60% effort; tied top items back to a measurable outcome.

## Notes

- This was a single RED→GREEN→REFACTOR cycle. The `writing-skills` discipline
  treats hardening as ongoing: as these skills are used, capture any new
  rationalizations and add explicit counters (and append new scenarios here).
- The dominant loophole class — **fabricated content satisfying a structural
  checklist** — is the same hazard the research note's AI guardrails warn about
  (§7). The fixes push every skill toward *evidence-or-explicit-hypothesis*,
  never silent invention.
- **REFACTOR re-runs (personas, requirements).** The GREEN runs originally
  documented for these two were captured *before* their loophole fixes, so they
  showed behavior the hardened skill now forbids (proto-personas from nothing;
  an invented `500 ms` NFR). Both GREEN cases were **re-run against the current
  hardened skills** and now COMPLY: the persona skill declines and asks for
  research/named-team assumptions; the requirements skill leaves NFR targets as
  sourced `[TBD]` placeholders. Two further strengthenings came out of the
  re-runs — hoisting the persona "ask, don't generate" stop-rule into the
  guardrail and the proto-persona table cell, and rewriting the requirements NFR
  *example* so the exemplar no longer contradicts the "don't invent numbers"
  rule.
