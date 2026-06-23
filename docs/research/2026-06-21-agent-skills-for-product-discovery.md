---
title: Agent Skills for Product Discovery — a baseline for product, requirements, and UX
date: 2026-06-21
status: research
scope: practice/discovery (UX research, requirements engineering, product management) × agent skills (SKILL.md) — methodology synthesis + a baseline skill catalog
method: dedicated deep web-research pass (12 parallel research threads, ~80+ primary/near-primary source fetches — NN/g, IxDF, Product Talk/Torres, SVPG/Cagan, Strategyzer/Bland, Cooper/Goodwin, Jeff Patton, Gojko Adzic, IIBA/BABOK, IREB, Mountain Goat/Cohn, Ron Jeffries, Anthropic Agent Skills docs + agentskills.io), June 2026
related:
  - "[[2026-06-03-competitive-landscape]]"
  - "[[Product Refinement - Definition of Ready]]"
---

# Agent Skills for Product Discovery

> **Purpose.** Give a discovery team — a **product manager (PM)**, a **requirements engineer / business analyst (RE/BA)**, and a **UX designer** — a shared, evidence-grounded operating model for discovery, and a **baseline set of agent skills** (`SKILL.md` files) that encode the professional checklists for each step so the team gets expert-quality artifacts from the first sprint.
>
> This note has two halves. **Part I** is the synthesized methodology (a vendor-neutral pragmatic blend of the dominant discovery frameworks). **Part II** is the skill catalog: what each baseline skill does, who leads it, and where it sits in the discovery arc. The drafted `SKILL.md` files live under [`.claude/skills/`](../../.claude/skills/) and are surfaced in Claudian as `$` skills.

---

## Executive summary

- **Discovery is risk-reduction, not documentation.** Its job is to answer four questions *before* committing build capacity — Marty Cagan's four product risks: **value** (will they use/buy it?), **usability** (can they figure it out?), **feasibility** (can we build it?), and **business viability** (does it work for the business?). Each risk has a natural owner in the trio (value/viability → PM, usability → designer, feasibility → engineer). [Cagan/SVPG]
- **The unit of work is a cross-functional trio, not a relay of hand-offs.** Teresa Torres' "product trio" (PM + designer + engineer) decides *and* builds together, working from shared customer contact and externalizing thinking on an **opportunity solution tree**. The RE/BA is a valuable fourth seat (the "quad") for data-heavy, regulated, or enterprise work — but discovery is a team sport. [Torres; Cagan]
- **A pragmatic blend beats any single framework.** Use the **Double Diamond** as the macro-shape (diverge to understand the problem, converge to define it; diverge to explore solutions, converge to deliver), **Continuous Discovery** as the weekly cadence, **Lean/dual-track** to run discovery and delivery in parallel, and **Jobs-to-be-Done** as the lens for *what progress the customer is trying to make*. The four big risks are the running checklist throughout.
- **The biggest failure mode is the feature factory** — measuring output (features shipped) over outcomes (customer behavior changed that drives business results). Outcome-based roadmaps, OKRs, and assumption testing exist to replace opinion (the HiPPO) with evidence. [Cutler; Seiden; Doerr]
- **AI is a powerful discovery *accelerant* and a dangerous *shortcut*.** It is excellent at drafting, structuring, and critiquing artifacts and synthesizing notes — but **synthetic users**, **AI-generated personas**, and **fabricated interview quotes** are real, documented hazards. The non-negotiable rule, from NN/g: **treat every AI output as a hypothesis to be tested, never as a finding; keep real customer contact; trace every claim to evidence.** This guardrail is baked into the research skills.
- **Agent skills are the right delivery vehicle.** A `SKILL.md` is a small, on-demand reference an agent loads only when its `description` matches the task. That makes it ideal for encoding a professional's checklist (e.g., "how to run a non-leading discovery interview") so a non-specialist on the trio produces specialist-grade output — without bloating every conversation. [agentskills.io; Anthropic]

---

# Part I — The discovery operating model (pragmatic blend)

## 1. Who does what: the trio + the RE seat

| Role | Primary risk owned (Cagan) | Discovery focus | Signature artifacts |
|------|----------------------------|-----------------|---------------------|
| **Product Manager** | **Value** + **Business viability** | Outcomes, opportunity selection, prioritization, business/stakeholder fit | Opportunity solution tree, outcome-based roadmap, OKRs, prioritization matrix |
| **UX Designer** | **Usability** (and desirability/experience) | Customer research, problem framing, modeling the user and the experience | Interview guides, personas, journey maps, service blueprints, empathy maps |
| **Engineer / Tech Lead** | **Feasibility** | What's newly possible, technical risk, cost of delay | Feasibility spikes, prototypes |
| **Requirements Engineer / BA** *(the "quad")* | Cross-cutting: rigor, traceability, testability | Elicitation, requirements quality, acceptance criteria, NFRs, traceability | User stories, acceptance criteria, story maps, impact maps, RTM |

**Key distinction to keep straight:** the **discovery trio** ("are we building the *right thing*?") is not the delivery-era **"three amigos"** (BA/PO + Dev + QA, "are we building the thing *right*?"). A healthy org runs both: the trio decides what is worth building; the three amigos sharpen how a chosen item gets built. The RE/BA's elicitation toolkit (interviews, observation, prototyping) overlaps heavily with UX research — contextual inquiry is *literally both* — so the two disciplines should plan research together, not in parallel silos. [Torres; Agile Alliance; NN/g; IIBA]

## 2. The macro-shape: Double Diamond + dual-track

```
        PROBLEM SPACE                         SOLUTION SPACE
   ◇ Discover ▷ Define ◇            ◇ Develop ▷ Deliver ◇
   diverge     converge             diverge    converge
   "design the right thing"         "design the thing right"
   ───────────────────────────────────────────────────────────
   DISCOVERY TRACK (continuous)  ║  DELIVERY TRACK (continuous)
   research · framing · assumption tests · prototypes  ║  build · ship · measure
```

- **Double Diamond** (UK Design Council) gives the rhythm of *divergent then convergent* thinking in two diamonds: first understand and define the **right problem**, then explore and deliver the **right solution**. The single most common discovery sin — **solution-jumping** — is collapsing the first diamond and starting in the solution space before the problem is understood.
- **Dual-track agile** (Lean UX / Cagan) runs the **discovery track** (what to build, de-risking with cheap experiments) continuously *alongside* the **delivery track** (building). Discovery feeds validated work into delivery; delivery feeds usage signal back into discovery. They are parallel, not sequential.
- **Continuous Discovery** (Torres) supplies the cadence: **at least weekly customer touchpoints**, with the trio interviewing together and maintaining an **opportunity solution tree** (desired outcome → opportunities → solutions → assumption tests) to keep the messy work structured.

## 3. The running checklist: the four big risks + the fifth

Throughout both diamonds, the trio continuously asks Cagan's four questions, mapped to Torres' five assumption categories:

| Risk (Cagan) | Question | Owner | Torres category |
|--------------|----------|-------|-----------------|
| **Value** | Will customers buy it / users choose it? | PM | Desirable + Viable (value) |
| **Usability** | Can users figure out how to use it? | Designer | Usable |
| **Feasibility** | Can engineers build it (time/skills/tech)? | Engineer | Feasible |
| **Business viability** | Does it work for legal, finance, sales, brand? | PM (+ stakeholders) | Viable (business) |
| *(Ethical — extension)* | *Should we build it at all?* | Whole trio | Ethical |

Cagan's warning: teams **over-index on feasibility** (engineers are comfortable with spikes) and under-test value and viability. Address the *biggest* risk first.

## 4. The discovery arc → method → artifact map

This is the spine the skill catalog follows. Each row is a step most discovery efforts move through (iteratively, not strictly linearly).

| # | Step | Lead | Core methods | Output artifact |
|---|------|------|--------------|-----------------|
| 1 | **Frame the opportunity** | PM | Outcome vs output, problem statement, "How Might We", point-of-view statement, four-risk scan | Problem/opportunity brief, framed HMW questions |
| 2 | **Surface & rank assumptions** | Trio | Assumption mapping (desirability/usability/feasibility/viability), 2×2 importance × evidence, riskiest-assumption test (RAT) | Assumptions map, prioritized test backlog |
| 3 | **Plan & run research** | UX (+ RE) | Discovery interviews, contextual inquiry, diary/field studies, surveys (sparingly) | Interview guide, raw transcripts/notes |
| 4 | **Synthesize** | UX | Affinity/thematic analysis, atomic nuggets, coding | Themes, evidence-linked insights |
| 5 | **Model the user** | UX | Personas (proto → research-based), empathy maps | Persona set, empathy maps |
| 6 | **Model the problem/need** | UX (+ PM) | Jobs-to-be-Done (job stories, forces of progress, job map) | Job statements, forces diagram |
| 7 | **Model the experience** | UX | Journey/experience maps, service blueprints | Journey map, blueprint |
| 8 | **Connect to outcomes** | PM/RE | Impact mapping (goal→actors→impacts→deliverables), OKRs, opportunity solution tree | Impact map, outcome-based roadmap |
| 9 | **Shape the solution** | Trio | User story mapping (backbone, walking skeleton, slices) | Story map, sliced releases |
| 10 | **Specify** | RE | User stories (INVEST, 3 C's, SPIDR splitting), acceptance criteria (Given/When/Then), NFRs (ISO 25010) | Stories + acceptance criteria + quality attributes |
| 11 | **Prioritize** | PM/RE | MoSCoW, RICE, Kano, WSJF, opportunity scoring | Prioritized backlog / roadmap |

## 5. Method deep-dives (the evidence base)

The following condenses the research backing each skill. Citations are at the end.

### 5.1 Problem framing (step 1)
Keep the **problem space** (understand the problem) separate from the **solution space** (generate solutions); fully exploring the former yields more creative, better-targeted solutions. Tools: **problem statements**, **point-of-view (POV) statements** ("[user] needs [need] because [insight]"), and **"How Might We" (HMW)** questions that reframe a problem as an invitation to ideate without smuggling in a solution. Anchor framing to a measurable **outcome** (a change in customer behavior that drives business results — Seiden), not an output. [d.school; NN/g; Seiden]

### 5.2 Assumptions & risk (step 2)
David Bland / Strategyzer **Assumptions Mapping**: write each belief as a falsifiable **"We believe that…"** statement (one per note), color-coded by **desirability / usability / feasibility / viability** (Cagan's four product risks; + optional adaptability/ethical — Strategyzer's classic set is desirability/feasibility/viability, but track usability explicitly so the map is a complete risk inventory), then plot on a **2×2 of importance × evidence** (Strategyzer's convention: have-evidence on the left, no-evidence on the right, important at the top). The **top-right quadrant — important + no evidence — is where near-term experimentation goes.** Test the single largest unknown first with a **Riskiest Assumption Test (RAT)** — learn before you build, the inverse of jumping straight to an MVP. Eric Ries' value vs. growth **leap-of-faith assumptions** are the conceptual ancestor. [Strategyzer/Bland; Higham; Ries; NN/g]

### 5.3 Research: interviews, context, surveys (step 3)
- **Discovery interviews** explore attitudes/motivations, not UI specifics ("users are not designers"). Use **open questions** and the **funnel technique** (broad → specific); avoid **leading questions** (neutral "how/what", not "did/was/is"); use the **critical-incident method** ("tell me about the last time…") over hypotheticals; **ladder / 5 Whys** to reach root motivations. Sample to **saturation** — start ~5–6 and continue until no new themes (often ~12; ~20–30 for ~90–95% of needs). The "5 users" rule is for usability *tests*, **not** interviews. [NN/g; IxDF]
- **Contextual inquiry** (master–apprentice; context/partnership/interpretation/focus) and **field/diary studies** give ecological validity — what people *do*, not just *say*.
- **Surveys** are quantitative+attitudinal and are "the hardest method to do well, the easiest to launch in 10 minutes" — use to *quantify* qualitative findings, never as a substitute for talking to users; never to ask people to predict future behavior. [NN/g; Erika Hall]

### 5.4 Synthesis (step 4)
**Affinity mapping** (the KJ method): one observation per note, cluster by *meaning* (not keyword), with a visible focus question; silence groupthink during clustering. **Thematic analysis** (Braun & Clarke's six phases): codes are descriptive labels, themes are interpretive; prefer inductive/open coding in discovery. **Atomic research** (Pidcock's nuggets — experiment → fact → insight → recommendation, "We did X, saw Y, which means Z") feeds a searchable **research repository**. [NN/g; IxDF; getthematic; User Interviews]

### 5.5 Modeling the user (steps 5–6)
- **Personas:** the Cooper/Goodwin tradition treats a persona as a **behavioral model** built from research via a repeatable sequence (group by role → list behavioral variables → map interviewees → find clusters → synthesize goals → designate primary/secondary/etc.). Distinguish **goals** (stable end-states) from **tasks** (changeable steps). **Proto-personas** are legitimate when research isn't done yet — *but only when sourced from a named human team's stated assumptions (never the model's own invention), explicitly labeled hypotheses to validate; with neither research nor team assumptions, ask rather than generate.* NN/g's qualitative personas (5–30 interviews) are the sweet spot. **Empathy maps** (Says/Thinks/Does/Feels, or Gray's updated canvas) build shared understanding per user type. [Cooper/Goodwin; NN/g; IxDF; Gray]
- **Jobs-to-be-Done** is three schools, kept distinct: **Christensen** (progress in a circumstance; functional/emotional/social dimensions — the milkshake), **Klement/Moesta** (demand-side **switch interview** + **forces of progress**: push + pull > anxiety + habit), and **Ulwick/ODI** (functional **job map** of 8 universal steps + measurable **desired-outcome statements** + the Opportunity Algorithm). Use Christensen to reframe, Klement to understand switching, Ulwick to quantify unmet needs. JTBD and personas are complementary (JTBD = *what progress*; personas = *who, and which trade-offs*). [Christensen; Klement; Ulwick; NN/g]

### 5.6 Modeling the experience (step 7)
**Journey maps** (chronological, per persona/scenario): zones = the **lens** (actor + scenario), the **experience** (actions, mindsets, an emotion curve across phases), and **insights** (pain points → opportunities + ownership). **Experience maps** are the product-agnostic, generic-human variant. **Service blueprints** are the "sequel" — they add frontstage/backstage/support lanes split by the **line of interaction**, **line of visibility**, and **line of internal interaction**, for omnichannel/cross-functional services. Prefer research-informed maps; a **hypothesis map** must be built from a named human team's stated assumptions (never invented by the model — that is a synthetic user), labeled as such and validated, and if no research or assumptions exist, ask rather than fabricate. [NN/g]

### 5.7 Connecting to outcomes (step 8)
**Impact mapping** (Adzic): a mind map from a **measurable goal (Why)** → **actors (Who)** → **impacts (How — behavior changes, *not* features)** → **deliverables (What)**; every deliverable traces up to the goal, and orphans get cut. **OKRs** (Doerr): "I will [Objective] as measured by [Key Results]" — Key Results are outcome metrics. **Outcome-based roadmaps** (Pichler's GO roadmap: Date/Name/Goal/Features/Metrics, goals first) replace feature-list roadmaps. [Adzic; Doerr; Pichler; Cagan]

### 5.8 Shaping & specifying (steps 9–10)
- **User story mapping** (Patton): a **backbone** of user activities ordered left-to-right by narrative flow, with detail hanging below by priority; the top horizontal slice is the **walking skeleton** (smallest end-to-end system — Cockburn); release slices span the *whole* backbone so each release is a complete journey.
- **User stories**: "As a / I want / so that" (Connextra → Cohn); **INVEST** quality (Independent, Negotiable, Valuable, Estimable, Small, Testable); a story is "a placeholder for a conversation"; the **3 C's** (Card, Conversation, Confirmation — Jeffries); split vertically with **SPIDR** (Spike, Paths, Interfaces, Data, Rules — Cohn).
- **Acceptance criteria**: **Given/When/Then** (Gherkin, from Dan North's BDD); rule-oriented vs. scenario-oriented; **Specification by Example** → living documentation (Adzic). **Definition of Ready** (clear/feasible/testable — Pichler; ~3–5 criteria/story) gates entry; **Definition of Done** (Scrum Guide) gates exit.
- **Non-functional requirements** (Wiegers' "quality attributes"): organize with **ISO/IEC 25010** (2011: 8 characteristics; 2023: adds Interaction Capability, Flexibility, Safety); make each **measurable** (SMART / Gilb's Planguage scale+meter+target); **WCAG 2.2 AA** for accessibility. Elicit early — NFRs are architectural drivers, expensive to retrofit. [Patton; Cockburn; Cohn; Jeffries; North; Adzic; Pichler; Scrum Guide; Wiegers; ISO; W3C]

### 5.9 Prioritization (step 11)
- **MoSCoW** (DSDM): Must/Should/Could/Won't; keep Must ≤ ~60% effort, keep a ~20% Could contingency pool.
- **RICE** (Intercom): (Reach × Impact × Confidence) ÷ Effort.
- **Kano** (functional + dysfunctional questions): basic / performance / delighter / indifferent / reverse.
- **WSJF** (SAFe): Cost of Delay ÷ Job Size — "if you only quantify one thing, quantify cost of delay."
- **Opportunity scoring** (Ulwick/Olsen): Importance + max(Importance − Satisfaction, 0) — surfaces important-but-underserved needs.
Ground Reach/Effort and importance/satisfaction in real data, and prioritize *outcomes*, not pre-baked solutions. [DSDM; Intercom; Kano; SAFe; Ulwick]

## 6. Pitfalls the operating model is designed to prevent

| Pitfall | Symptom | Countermeasure baked into the skills |
|---------|---------|--------------------------------------|
| **Feature factory** | Measuring features shipped, roadmap = feature list | Outcome framing, impact mapping, OKRs |
| **Solution-jumping** | Discussing solutions before the problem is understood | Problem-space framing gate before ideation |
| **HiPPO decisions** | Loudest/most-senior opinion wins | Assumption tests, evidence traceability |
| **Confirmation bias** | Research "confirms" what we hoped | Neutral questions, seek disconfirming evidence, triangulate |
| **Leading questions** | Participants mimic the interviewer | Question-quality checklist in the interview skill |
| **Analysis paralysis** | Endless synthesis, no decision | Time-boxed synthesis with a saturation stop rule |
| **Ambiguous/untestable requirements** | "fast", "user-friendly", "support" | Measurability + verifiability checks, Given/When/Then |
| **Gold-plating / scope creep** | Work with no requirement / unapproved additions | Backward traceability, MoSCoW, outcome linkage |

---

# Part II — The AI layer and the skill catalog

## 7. AI in discovery: accelerant, not oracle

**Where AI genuinely helps (and the skills lean in):** drafting interview guides and survey questions; structuring and *first-pass* coding of research notes; generating affinity-cluster candidates; drafting persona/journey/empathy-map *scaffolds* for the team to correct; reformatting findings into stories and acceptance criteria; critiquing the team's own drafts for leading questions, untestable requirements, or solution-jumping. NN/g's reframing is useful: for a team doing **no** research, the comparison is "AI-assisted vs. nothing" — AI raises the floor. But it is not a substitute for studies with real users.

**Where AI is dangerous (and the skills hard-gate against it):**
- **Synthetic users / AI "participants."** NN/g ran identical studies with synthetic and real users: synthetic users are **sycophantic** ("every idea is a good one"), **one-dimensional**, and report **idealized** rather than actual behavior; aggregate correlations can look high while **variance collapses**, hiding edge cases and polarized opinions. Verbatim NN/g ethics warning: *"Do not present synthetic-user research findings as real-user research findings."*
- **AI-generated personas** are "a generic stereotype based on averaged internet content" — blind to context of use and B2B relational complexity; rated as more stereotypical and unrealistic in studies.
- **Hallucinated/fabricated quotes.** In one analysis, **7.7% of LLM-generated quotes could not be found in the source transcripts** — often subtle "regenerations" that distort meaning. *"Hallucinations don't look like mistakes — they look like insight."*
- **Confirmation-bias amplification.** "AI supercharges your research productivity, but it supercharges confirmation bias as well. It will find what you're looking for, and if it doesn't exist, it will make it up." Sycophancy is a design choice, not a bug.
- **Over-reliance / deskilling** and **PII/privacy** exposure when raw research data flows through models.

**The five non-negotiable AI guardrails (embedded in the research skills):**
1. **Treat every AI output as a hypothesis to be tested, never as a finding.**
2. **Keep real customer contact** — AI complements research with real users; it never replaces it. "UX without user research isn't UX."
3. **Trace every claim to evidence** — every insight links back to a real transcript/observation; never invent quotes or participants.
4. **Actively seek disconfirming evidence** — instruct the model to find what contradicts the hypothesis, not just support it.
5. **Protect participant data** — no raw PII into prompts without consent and a defined, non-repurposed scope.

[NN/g synthetic-users + AI-research-agenda; IxDF; uintent; Bernoff; ACM Interactions]

## 8. What an "agent skill" is (and why it fits)

A **skill** is a directory whose required file is **`SKILL.md`** — YAML frontmatter (`name`, `description`) plus a Markdown body. The agent loads them by **progressive disclosure**: only the ~100-token metadata of every skill is always in context; the full body loads **only when the `description` matches the task**; bundled reference files/scripts load on demand. This is exactly why skills suit discovery — a trio can install a dozen discovery skills with negligible context cost, and the right checklist surfaces *just-in-time* when the task calls for it.

Authoring rules the catalog follows (Anthropic / agentskills.io):
- **`description` = WHEN to use it** (triggering conditions, symptoms, keywords), third person — *not* a summary of the workflow or what the skill does, because a metadata summary lets the agent follow the description instead of loading the skill body. (This repo's `writing-skills` rule is stricter than the general Anthropic/agentskills.io "what + when" guidance — under the active `.claude/skills/` path, keep descriptions trigger-only and put what-it-does in the body and this catalog.)
- **Concise body** (target < 500 lines / < 5k tokens); assume the agent is already smart; move heavy reference to bundled files.
- **Encode the workflow as steps + a checklist + feedback loops** ("draft → validate against criteria → fix → repeat") — this is the mechanism that turns a non-expert into an expert-grade operator.
- **Match degrees of freedom to fragility** — prose where many paths work; exact steps where consistency is critical.

## 9. The baseline skill catalog

Twelve skills: one **router/overview** plus eleven **workflow skills**, one per major discovery step. They live in [`.claude/skills/`](../../.claude/skills/). Each has been through one **RED/GREEN cycle** (baseline a subagent without the skill, confirm the skill closes the gap, close residual loopholes) — see the verification artifact: [`2026-06-21-discovery-skills-evaluations.md`](2026-06-21-discovery-skills-evaluations.md).

| Skill (`name`) | Lead | Arc step | What it gives the team |
|----------------|------|----------|------------------------|
| **`running-product-discovery`** | PM | router | The operating model, roles, the four risks, the AI guardrails, and an index that routes to the other skills |
| **`framing-the-opportunity`** | PM | 1 | Problem-space framing: outcome vs output, problem statement, POV, HMW, four-risk scan; gates against solution-jumping |
| **`mapping-discovery-assumptions`** | Trio | 2 | Assumptions map (desirability/usability/feasibility/viability), 2×2 importance×evidence, riskiest-assumption test, experiment design |
| **`planning-discovery-interviews`** | UX | 3 | Discovery interview guide: open/funnel questions, leading-question check, critical-incident, laddering, sample-to-saturation |
| **`synthesizing-discovery-research`** | UX | 4 | Affinity + thematic analysis + atomic nuggets, with the AI anti-fabrication/evidence-traceability guardrails |
| **`building-evidence-based-personas`** | UX | 5 | Goal-directed persona construction; proto-persona-as-hypothesis; anti AI-stereotype guardrail; empathy maps |
| **`defining-jobs-to-be-done`** | UX/PM | 6 | The three JTBD schools, job stories, forces of progress, job map + desired outcomes — picking the right one |
| **`mapping-customer-journeys`** | UX | 7 | Journey/experience maps (lens/experience/insights, emotion curve) and when to escalate to a service blueprint |
| **`mapping-impact-to-outcomes`** | PM/RE | 8 | Impact mapping (goal→actors→impacts→deliverables), OKRs, outcome-based roadmap; cuts orphan features |
| **`story-mapping-the-solution`** | Trio | 9 | Backbone + walking skeleton + release slices; keeps each slice an end-to-end journey |
| **`writing-requirements`** | RE | 10 | User stories (INVEST, 3 C's, SPIDR), acceptance criteria (Given/When/Then, SBE, DoR/DoD), NFRs (ISO 25010, measurable) |
| **`prioritizing-with-evidence`** | PM/RE | 11 | MoSCoW / RICE / Kano / WSJF / opportunity scoring — choosing and applying the right method |

### How the team uses it
- Start a discovery effort by invoking **`running-product-discovery`**; it orients the trio and routes to the next skill.
- Each workflow skill produces a concrete artifact and ends by pointing to the next step, so the suite "walks" the trio through the arc without anyone needing to hold the whole methodology in their head.
- The research skills (`planning-discovery-interviews`, `synthesizing-discovery-research`, `building-evidence-based-personas`, `mapping-customer-journeys`) carry the AI guardrails so the accelerant never becomes a fabrication engine.

## 10. Adoption notes & next steps

- **RED/GREEN verified, but keep hardening.** Each skill has been through one RED/GREEN cycle (see [`2026-06-21-discovery-skills-evaluations.md`](2026-06-21-discovery-skills-evaluations.md)) — all twelve closed their baseline failure mode, and one residual loophole per skill was fixed. The `writing-skills` discipline treats hardening as ongoing: as the skills are used, capture any new rationalizations (especially fabrication-to-satisfy-structure) and add explicit counters.
- **Tune to your context.** Replace the generic prioritization/JTBD guidance with whichever method your org has standardized on; thin the catalog if a step doesn't apply to your product.
- **Pair with templates.** The natural next iteration is to bundle artifact templates (interview-guide skeleton, journey-map table, story+AC template) as `assets/` beside each `SKILL.md`, and a `references/` file for the heavier method detail — keeping each `SKILL.md` body lean.
- **Keep the human in the loop.** Every skill assumes the trio reviews and owns the output; the agent drafts and checks, it does not decide.

---

## Sources

A consolidated, deduplicated list of the primary and near-primary sources behind this note. (Several vendor pages — svpg.com, some IIBA/BABOK and Wiegers PDFs — block automated fetching; where noted in the research threads, claims were corroborated via search extraction and secondary sources, with the canonical book cited.)

**Frameworks, trio & risks**
- Teresa Torres / Product Talk — https://www.producttalk.org/2021/07/product-discovery/ ; https://www.producttalk.org/confirmation-bias/
- Marty Cagan / SVPG — https://www.svpg.com/four-big-risks/ ; https://www.svpg.com/product-vs-feature-teams/ ; https://www.svpg.com/missionaries-vs-mercenaries/
- John Cutler — https://cutle.fish/blog/12-signs-youre-working-in-a-feature-factory/
- Josh Seiden, *Outcomes Over Output* — https://medium.com/@jseiden/getting-started-with-outcomes-9b136178eb07
- John Doerr / OKRs — https://www.whatmatters.com/faqs/okr-meaning-definition-example
- Double Diamond — UK Design Council; Design Thinking — Stanford d.school / IDEO
- Three amigos — https://agilealliance.org/glossary/three-amigos/

**UX research & synthesis**
- NN/g — interviewing: https://www.nngroup.com/articles/interviewing-users/ ; open vs closed: https://www.nngroup.com/articles/open-ended-questions/ ; leading questions: https://www.nngroup.com/articles/leading-questions/ ; sample size: https://www.nngroup.com/articles/interview-sample-size/ ; which methods: https://www.nngroup.com/articles/which-ux-research-methods/ ; contextual inquiry: https://www.nngroup.com/articles/contextual-inquiry/ ; field/diary: https://www.nngroup.com/articles/context-methods-field-diary-studies/ ; surveys: https://www.nngroup.com/articles/should-you-run-a-survey/ ; affinity: https://www.nngroup.com/articles/affinity-diagram/ ; affinity pitfalls: https://www.nngroup.com/articles/affinity-diagramming-pitfalls/ ; repositories: https://www.nngroup.com/articles/research-repositories/ ; confirmation bias: https://www.nngroup.com/articles/confirmation-bias-ux/
- IxDF — 5 Whys: https://ixdf.org/literature/topics/5-whys ; thematic analysis: https://ixdf.org/literature/article/how-to-do-a-thematic-analysis-of-user-interviews ; affinity: https://ixdf.org/literature/topics/affinity-diagrams
- Erika Hall, *Just Enough Research* (surveys) — https://uxpodcast.com/229-erika-hall-just-enough-research/
- Indi Young — mental models: https://indiyoung.com/method/
- getthematic — coding: https://getthematic.com/insights/coding-qualitative-data/
- User Interviews — atomic nuggets: https://www.userinterviews.com/ux-research-field-guide-chapter/atomic-research-nuggets

**Modeling: personas, empathy, journeys, blueprints, JTBD**
- NN/g — persona types: https://www.nngroup.com/articles/persona-types/ ; personas study guide: https://www.nngroup.com/articles/personas-study-guide/ ; empathy mapping: https://www.nngroup.com/articles/empathy-mapping/ ; journey 101: https://www.nngroup.com/articles/journey-mapping-101/ ; journey maps: https://www.nngroup.com/articles/customer-journey-mapping/ ; mapping cheat sheet: https://www.nngroup.com/articles/ux-mapping-cheat-sheet/ ; service blueprints: https://www.nngroup.com/articles/service-blueprints-definition/ ; personas vs JTBD: https://www.nngroup.com/articles/personas-jobs-be-done/
- Cooper / Kim Goodwin — https://articles.centercentre.com/goal_directed_design/ ; *About Face* (Cooper, Reimann, Cronin, Noessel) — Ch. "Modeling Users: Personas and Goals"
- Dave Gray — updated empathy map canvas: https://medium.com/@davegray/updated-empathy-map-canvas-46df22df3c8a
- JTBD — Christensen *Competing Against Luck*; Klement *When Coffee and Kale Compete* (https://jtbd.info/the-forces-of-progress-4408bf995153) ; Ulwick/Strategyn ODI (https://strategyn.com/jobs-to-be-done/ ; https://www.marketingjournal.org/how-to-map-a-customer-job-anthony-ulwick/) ; Intercom job stories (https://www.intercom.com/blog/accidentally-invented-job-stories/)

**Requirements engineering**
- Jeff Patton — story mapping: https://jpattonassociates.com/the-new-backlog/ ; *User Story Mapping* (O'Reilly)
- Alistair Cockburn — walking skeleton (*Crystal Clear*); Martin Fowler — https://martinfowler.com/bliki/
- Mike Cohn — user stories: https://www.mountaingoatsoftware.com/agile/user-stories ; SPIDR: https://www.mountaingoatsoftware.com/blog/five-simple-but-powerful-ways-to-split-user-stories ; backlog iceberg: https://www.mountaingoatsoftware.com/blog/why-your-product-backlog-should-look-like-an-iceberg
- Bill Wake — INVEST: https://en.wikipedia.org/wiki/INVEST_(mnemonic)
- Ron Jeffries — 3 C's: https://ronjeffries.com/articles/019-01ff/3cs-revisited/
- Dan North — BDD/Given-When-Then: https://dannorth.net/blog/introducing-bdd/ ; Gherkin: https://cucumber.io/docs/gherkin/reference/
- Gojko Adzic — Specification by Example: https://www.manning.com/books/specification-by-example ; Impact Mapping: https://www.impactmapping.org/ ; https://www.impactmapping.org/drawing.html
- Roman Pichler — Definition of Ready: https://www.romanpichler.com/blog/the-definition-of-ready/ ; GO Roadmap: https://www.romanpichler.com/tools/the-go-product-roadmap/
- Scrum Guide (DoD) — https://scrumguides.org/scrum-guide.html
- Karl Wiegers — *Software Requirements* / "Writing Good Requirements": https://www.cs.bgu.ac.il/~elhadad/se/requirements-wiegers-sd-may99.html ; traceability: https://www.jamasoftware.com/blog/requirements-traceability-links-in-the-requirements-chain-part-1
- IREB CPRE — https://cpre.ireb.org/en/concept/foundationlevel ; IIBA BABOK Guide v3
- ISO/IEC 25010 — https://iso25000.com/index.php/en/iso-25000-standards/iso-25010/ ; WCAG 2.2 — https://www.w3.org/TR/WCAG22/

**Assumptions, prioritization & lean**
- Strategyzer / David Bland — https://www.strategyzer.com/library/how-assumptions-mapping-can-focus-your-teams-on-running-experiments-that-matter ; *Testing Business Ideas* (Bland & Osterwalder)
- Rik Higham — RAT: https://medium.com/hackernoon/the-mvp-is-dead-long-live-the-rat-233d5d16ab02
- Eric Ries — *The Lean Startup* (leap-of-faith assumptions)
- MoSCoW (DSDM) — https://www.agilebusiness.org/dsdm-project-framework/moscow-prioritisation.html ; RICE (Intercom) — https://www.intercom.com/blog/rice-simple-prioritization-for-product-managers/ ; Kano — https://www.productplan.com/glossary/kano-model/ ; WSJF (SAFe) — https://framework.scaledagile.com/wsjf

**AI in discovery**
- NN/g — synthetic users: https://www.nngroup.com/articles/synthetic-users/ ; AI simulations: https://www.nngroup.com/articles/ai-simulations-studies/ ; genAI research agenda: https://www.nngroup.com/articles/genai-ux-research-agenda/
- IxDF — AI vs researched personas: https://ixdf.org/literature/article/ai-vs-researched-personas
- uintent — LLM hallucination in qualitative analysis: https://www.uintent.com/case-studies-und-blog/the-hallucination-problem
- Josh Bernoff — AI confirmation bias: https://bernoff.com/blog/what-to-do-about-the-ai-confirmation-bias-problem

**Agent Skills mechanism**
- agentskills.io specification — https://agentskills.io/specification
- Anthropic — Agent Skills overview: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview ; best practices: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices ; engineering blog: https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
