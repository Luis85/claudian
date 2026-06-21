---
name: planning-discovery-interviews
description: Use when planning or writing a discovery interview guide, preparing to talk to users or customers, designing a contextual inquiry or field/diary study, deciding how many people to interview, or reviewing interview questions for bias. For UX designers and requirements engineers running generative research. Also covers when a survey is the wrong tool.
---

# Planning Discovery Interviews

## Overview

Discovery interviews explore **attitudes, motivations, and lived experience** — not UI preferences ("users are not designers; don't ask them to predict reactions to things they haven't used"). A good interview guide is the main defense against the two killers: **leading questions** and **solution-jumping**.

## When to use

- Before any round of generative customer research.
- Planning contextual inquiry, field studies, or diary studies.
- Reviewing draft questions for bias before fielding.

## The question-quality rules

- **Open over closed.** Open questions surface the unexpected. Prefer narrative prompts: "Walk me through a typical day," "Tell me about the last time you…"
- **Funnel.** Start broad and open, then narrow to specifics.
- **No leading questions.** Don't embed the answer. Neutral questions start with *how/what*; leading ones often start with *did/was/is*. "Was the checkout hard?" → "What was easy or difficult about checking out?" Never name an interface element or assume an emotion.
- **Critical-incident over hypothetical.** Ask about real past events ("the last time you…"), not predictions ("would you use…?"). People are bad at predicting their own behavior.
- **Ladder / 5 Whys.** Follow answers down to root motivation ("Why does that matter to you?") — but insert facts, not assumptions, and stop at the real driver.
- **One idea per question.** No compound/double-barreled questions.

## Workflow

1. **Set research goals.** What decision will this inform? What are the unknowns (pull from `mapping-discovery-assumptions`)?
2. **Draft the guide** — a few well-designed open questions with planned probes, not a long list of closed items. Open with easy rapport-building questions.
3. **Self-review for bias.** First, **reject confirmation-framed goals** ("confirm users love X") — restate the goal neutrally ("understand how users experience X") before drafting. Then scan every question: leading? closed where it should be open? hypothetical? names a solution? Fix inline. (This is the highest-value step — do it even under time pressure.)
4. **Pilot** with one person; tighten wording.
5. **Plan sample size to saturation.** Start ~5–6 participants and continue until no new themes emerge (often ~12; ~20–30 for ~90–95% of needs). The "5 users" rule is for usability *tests*, not interviews — interview data varies far more. Add *groups*, not just people, when audiences are distinct.
6. **Choose the method.** For *what people do* (not just say), prefer **contextual inquiry** (master–apprentice: observe + ask in their real environment) or **field/diary studies**. Reserve surveys for quantifying findings at scale — see below.

## When NOT to survey

Surveys are "the hardest method to do well, the easiest to launch in 10 minutes." Don't survey to answer *why/how* questions (interview instead), to capture behavior (observe instead), to avoid talking to customers, or to ask people to predict the future. Use them only to *quantify* something you already understand qualitatively.

## Quality bar

- [ ] Guide is mostly open, narrative questions with probes.
- [ ] Zero leading questions; no interface elements named; no assumed emotions.
- [ ] Questions ask about real past behavior, not hypotheticals.
- [ ] Sample plan is "interview to saturation," not a fixed tiny number.

## Reference

`docs/research/2026-06-21-agent-skills-for-product-discovery.md` §5.3. Sources: NN/g (interviewing, open vs closed, leading questions, sample size, contextual inquiry, surveys); Erika Hall *Just Enough Research*; IxDF 5 Whys.
