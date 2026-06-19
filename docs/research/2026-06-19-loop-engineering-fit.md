---
type: research
title: "Loop Engineering / Loopcraft: Fit With Claudian's Agent, Work-Order, Tool & Skill Designs"
date: 2026-06-19
status: draft
scope: agents
tags:
  - research
  - loops
  - loop-engineering
  - agents
  - work-orders
related:
  - "[[docs/superpowers/specs/2026-06-17-ai-agents-roster-design]]"
  - "[[docs/superpowers/specs/2026-06-19-tool-and-skill-library-design]]"
  - "[[docs/research/2026-06-17-ai-agents-roster-frameworks]]"
  - "[[docs/research/2026-06-19-user-tools-and-mcp-transport]]"
  - "[[docs/superpowers/specs/2026-06-04-work-order-execution-design]]"
sources:
  - https://addyo.substack.com/p/loop-engineering
  - https://www.langchain.com/blog/the-art-of-loop-engineering
  - https://www.latent.space/p/ainews-loopcraft-the-art-of-stacking
  - https://www.anthropic.com/research/building-effective-agents
  - https://openai.github.io/openai-agents-python/running_agents/
  - https://code.claude.com/docs/en/agent-sdk/agent-loop
  - https://docs.langchain.com/oss/python/langgraph/durable-execution
  - https://arxiv.org/abs/2310.01798
  - https://arxiv.org/abs/2303.11366
  - https://arxiv.org/abs/2303.17651
  - https://betterstack.com/community/guides/ai/claude-code-loop/
  - https://developers.openai.com/codex/app/automations
  - https://docs.devin.ai/release-notes/2026
---

# Loop Engineering / Loopcraft: Fit With Claudian's Designs

## Question

The user asked whether the emerging "loop engineering / loopcraft / prompt loops"
ideas should be combined with the agent-roster + tool/skill-library designs, and
whether it makes sense to ingrain this **now**. This note answers from deep web
research (gathered 2026-06-19; see `sources`).

## TL;DR recommendation

**Yes, it fits — strongly — but do not add a new top-level "Loop" concept.**
Loop engineering is the *discipline of orchestrating the pieces Claudian already
has* (agents, work-orders, tools, skills, runs). The right move is to **ingrain
the loop vocabulary and reserve the data-model seams now**, while **deferring the
heavy machinery** (schedulers, auto-optimization) to later phases. Concretely:
add a **completion oracle** and **multi-axis budgets** to the Work-Order model,
a **verifier role** to the roster, and treat **tools as programmatic checks** —
because the one load-bearing research finding is that *loops converge only when
grounded in external truth and bounded by externally-enforced stops.*

---

## 1. What these terms actually are (honest read)

- **Loop engineering** is a genuine but **~2-week-old** coinage (June 2026),
  from Addy Osmani ("Loop Engineering" essay), Boris Cherny, and Peter
  Steinberger, formalized by LangChain ("The Art of Loop Engineering").
  Definition: *replace yourself as the person who prompts the agent — design the
  system that does it instead.* It **wraps** prompt- and context-engineering; it
  does not replace them.
- **Loopcraft** is swyx/Latent Space's synonym ("the art of stacking loops").
  Used interchangeably with loop engineering. (Beware name collisions: an
  unrelated `proofrail` runtime and a Maldivian design agency share the name.)
- **Prompt loops** is a fuzzy umbrella with no canonical definition — means
  chaining-loops, self-refine/reflection, or the agent run-loop depending on
  speaker.

**Substance vs. hype:** the engineering underneath (autonomous run-loops,
verification gates, scheduled runs, worktrees, sub-agent verifiers, on-disk
state) is real and well-grounded in prior art (ReAct, Reflexion, Self-Refine,
Anthropic/OpenAI agent loops). The *terminology* is new and heavily amplified by
SEO content. Weight the primary sources; ignore the explainer farms. **Adopt the
practices; be cautious about over-branding them in the product UI.**

## 2. The key finding (the design lesson)

Across every authoritative source (Anthropic, OpenAI, the ReAct/Reflexion/
Self-Refine papers, and Huang et al. 2024 "LLMs Cannot Self-Correct Reasoning
Yet"):

> **Loops converge only when grounded in external truth (tools/tests/judges/
> humans) and bounded by externally-enforced stopping conditions. Letting the
> model self-judge completion or correctness is the recurring failure mode.**

Corollaries: *"the verifier is the bottleneck, not the model"* (Osmani), and
unaided intrinsic self-correction can *degrade* output (Huang). This points
Claudian's design squarely at **verifiable acceptance criteria** and
**externally-enforced budgets**, not at clever self-reflection prompts.

## 3. Osmani's "anatomy of a loop" ≈ Claudian's existing stack

The most striking result: loop engineering's component list is nearly the stack
we have already designed.

| Loop-engineering component | Claudian equivalent (existing or specced) |
|---|---|
| Automations (scheduled/triggered runs) | Work-Order runs; remote triggers; recurrence (to add) |
| Worktrees (isolation) | `isolation: worktree` subagents; workspace-isolation spec |
| Skills (durable project knowledge) | **Skill Library** (`2026-06-19` spec) |
| Plugins/Connectors (**MCP**) | **Tool Library over MCP** (`2026-06-19` spec) |
| Sub-agents as **verifiers** | Roster `composedAgentRefs`; provider subagents |
| External state on disk | `.claudian/runs/<runId>/ledger.jsonl` + `heartbeat.json`; vault notes |

So Claudian is *already* a loop-engineering substrate. The gap is not new
machinery — it is making the **loop control surfaces first-class and verifiable.**

## 4. The loop primitives a platform should expose (synthesis)

From the framework/product survey, three concerns are **orthogonal** and should
be configured separately on a Work-Order (frameworks that conflate them into a
single `max_iter` are the ones whose users report runaway cost / infinite loops):

1. **Run-loop budgets — multi-axis.** Not just "max iterations." Real frameworks
   converge on three axes:
   - **max turns/steps** — Claude `maxTurns`, OpenAI `max_turns` (default 10),
     LangGraph `recursion_limit` (25), CrewAI `max_iter` (20), Mastra `maxSteps`
     (5), VoltAgent `maxSteps` (10×subagents).
   - **max cost** — Claude `maxBudgetUsd` (the most-cited *right* production
     default).
   - **max wall-clock** — CrewAI `max_execution_time`.
   Terminate on whichever fires first.
2. **Completion oracle — separate from the budget.** The budget is the *safety*
   stop; *success* must be an acceptance check: tests green, a programmatic check
   (a Tool!), or an LLM-judge over a rubric/threshold. Make "what counts as done"
   a first-class Work-Order field, not implicit in the prompt. Prefer
   programmatic/verifiable checks; treat LLM-judge as a signal, not ground truth
   (judge error rates exceed 50% on complex tasks).
3. **Recurrence scheduler — a separate primitive.** Cron-style re-runs (Claude
   Code `/loop`, Codex Automations) with **mandatory auto-expiry** (3–7 days) and
   **crash circuit-breakers** (auto-stop after N consecutive failures) — the
   universal "no runaway API bills" guards. Distinguish session-scoped from
   durable.

Plus the cross-cutting machinery (mostly already in Claudian):

4. **Explicit, inspectable terminal states** — mirror Claude's
   `ResultMessage.subtype`: `success` vs `error_max_turns` /
   `error_max_budget_usd` / `error_during_execution`. A board card must tell
   "done" from "stopped at budget" (resumable) from "crashed."
5. **Per-iteration hook** — progress update, early-stop, feedback injection
   (Mastra `onIterationComplete`/`bail`, Claude `Stop`/`PreToolUse` hooks).
6. **Checkpoint + resume + fork** — Claudian's `ledger.jsonl` + `heartbeat.json`
   sidecars already are this substrate; align terminal states so a run resumes
   from a higher budget.
7. **Human-in-the-loop as pause, not exit** — approval cards should pause-and-
   resume the *same* run (LangGraph `interrupt()`; Cursor's resumed-turn pattern,
   which Claudian already implements for AskUserQuestion).
8. **No-progress / oscillation detection** — exact-repeat (hash of
   `(tool, args)`; 2 identical calls = suspicious, 3 = decisive) and semantic
   (embedding cosine over recent steps). Documented catastrophes: a broken tool
   called 400× in 5 min; a 25-hour / 13M-token run.

## 5. The four-loop maturity ladder (LangChain) → Claudian phases

LangChain's nested loops give a clean adoption order matched to what Claudian
already has:

1. **Agent loop** (model + tools until done) — **exists** in every provider
   runtime. Nothing to build.
2. **Verification loop** (output scored vs. criteria, feedback-driven retry) —
   **near-term, highest value.** Built from a Work-Order completion oracle +
   verifier tools/subagents. This is where the "verifier is the bottleneck"
   lesson pays off.
3. **Event-driven loop** (agents triggered by events, running continuously) —
   **later.** Ties to the recurrence scheduler and remote triggers.
4. **Hill-climbing loop** (analyze production traces to auto-improve the agent's
   own config/prompts) — **future.** Claudian's `ledger.jsonl` is the trace
   substrate; this is where an "improve this agent from its run history" feature
   would live. High risk (self-optimization); defer until 2 is solid.

## 6. Recommendation: ingrain the seams now, defer the machinery

**Ingrain now (cheap, prevents rework):**
- **Work-Order model** — reserve fields for a **completion oracle**
  (`acceptanceCheck`: `manual | tests | tool:<id> | judge:<rubric>`) and
  **budgets** (`maxTurns`, `maxCostUsd`, `maxWallClock`). Today acceptance
  criteria are prose; making them *optionally verifiable* is the single biggest
  loop-engineering win and fits the existing `TaskSections` (objective /
  acceptanceCriteria).
- **Roster Agent** — add a lightweight **role** notion so an agent can be marked
  a **verifier** (used as the completion oracle's judge or a composed verifier
  sub-agent), plus default iteration budgets. Reuses `composedAgentRefs`.
- **Tool Library** — recognize that a user tool is the ideal **programmatic
  check** (it returns a result the oracle can assert on). No new mechanism — just
  document tools-as-verifiers in the spec.
- **Run coordinator** — ensure terminal states are the explicit, resumable set
  (success / stopped-at-budget / crashed) and that the ledger records per-iteration
  progress so no-progress detection is possible later.

**Defer (build when the verification loop is solid):**
- The **recurrence scheduler** (cron + TTL + circuit-breaker). High value but a
  distinct subsystem; aligns with the remote-trigger work, not the roster.
- **No-progress/oscillation detection** as automated guards (record the data now,
  enforce later).
- The **hill-climbing / auto-optimization** loop. Most hype-prone and riskiest;
  needs the trace + eval foundation first.

**Do not:**
- Introduce a top-level "Loop" noun in the UI alongside Agents / Work-Orders /
  Tools / Skills. It would be concept overload. Loops are **properties of
  work-orders and agents**, expressed as budgets + a completion oracle +
  (later) a schedule — exactly how the frameworks model them.
- Lean on model self-reflection as the quality mechanism. Anchor to tools/tests/
  judges/humans per the research.

## 7. Net

Loop engineering is less a new feature than a **lens that validates and sharpens**
the roster + tool/skill direction: it says the value is in *verifiable
acceptance + bounded, resumable runs + reusable skills/tools/verifiers* — all
things already on Claudian's roadmap. Ingraining the **completion-oracle and
budget seams now** (and the verifier role) is low-cost and future-proofs the
Work-Order and roster models; the schedulers and auto-optimization loops are
genuine later phases, not now.

## Open questions
- Completion oracle surface: how much to expose in the Work-Order UI (a simple
  "done when: tests pass / tool X returns true / a verifier agent approves /
  manual") vs. keeping it advanced.
- Whether the verifier role is a flag on a roster Agent or a distinct
  "verifier" agent kind.
- Where recurrence lives: a Work-Order property vs. a separate "Automations"
  surface tied to remote triggers.
