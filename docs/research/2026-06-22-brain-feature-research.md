---
type: research
title: "The Brain: Research for a Self-Improving Memory Layer in Claudian"
date: 2026-06-22
status: draft
scope: product + architecture research feeding a future Brain feature design
tags:
  - research
  - brain
  - memory
  - self-improvement
related:
  - "[[docs/research/2026-06-03-competitive-landscape]]"
  - "[[src/features/tasks/CLAUDE.md]]"
sources:
  - https://arxiv.org/abs/2510.04618   # ACE: Agentic Context Engineering
  - https://arxiv.org/abs/2409.07429   # Agent Workflow Memory
  - https://arxiv.org/abs/2304.03442   # Generative Agents
  - https://arxiv.org/abs/2305.16291   # Voyager
  - https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
  - https://platform.claude.com/docs/en/build-with-claude/context-editing
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
  - https://docs.letta.com/guides/agents/memory-blocks/
  - https://docs.cline.bot/prompting/cline-memory-bank
  - https://cursor.com/docs/context/memories
  - https://github.com/logancyang/obsidian-copilot
---

# The Brain: Research for a Self-Improving Memory Layer in Claudian

> **One-line thesis.** Claudian already captures sessions, ledgers, and structured run handoffs. The opportunity is to add a *local, vault-native, multi-provider Brain* that distills "what worked / what didn't / what to keep" from those sessions into reviewable markdown, and re-injects the relevant lessons into future turns — a capability that, on the evidence below, **no installable Obsidian plugin currently ships**.

This document is research, not a design or a plan. It consolidates a fan-out of dedicated subagents that swept (1) the Claudian codebase, (2) the competitive product landscape, (3) the technical/academic literature on agent memory and self-improvement, and (4) product-discovery framing. A concrete design spec and implementation plan are deliberately out of scope and should follow this in `docs/superpowers/specs/` and `docs/superpowers/plans/`.

---

## 0. TL;DR for the impatient

- **"Memory" ≠ "Brain."** Simple memory recalls *facts* ("user prefers tabs", "project uses Postgres"). A Brain is **outcome-coupled**: it observes what the agent *did and whether it worked*, distills *lessons/procedures*, and feeds them back. The literature is unanimous that the distinguishing machinery is (i) an outcome signal, (ii) an asynchronous **consolidation/reflection pass**, (iii) a place to persist **procedures**, and (iv) relevance-bounded **re-injection**. Most shipping products have (iv) and weakly (i); very few have (ii)+(iii).
- **The market gap is real and citable.** Cloud tools (Perplexity Brain, Claude Memory, ChatGPT, Cursor/Windsurf/Copilot memory) are per-tool, server-resident, and partly opaque. In the *Obsidian plugin* ecosystem specifically, genuine session-learning is **rare-to-nonexistent** — the leader (Copilot for Obsidian) does RAG + saved-fact memory, not reflective self-improvement. The credible self-improvers (Hermes, Letta) are *external agents* exposed through thin plugins.
- **Claudian is unusually well-positioned.** It is local-first, vault-native, **multi-provider** (the only place memory can span Claude + Codex + Opencode + Cursor), and already owns the substrate: provider-neutral session metadata, a per-run **ledger**, and a four-field **handoff** (`summary / verification / risks / nextAction`). The Brain is a consolidation layer over data Claudian already captures.
- **Frame it honestly: a cost/consistency play, not a quality-magic loop.** The only *controlled* benchmark of memory in **coding** agents found persistent memory had **zero effect on code quality** (a hand-written static context file scored highest); memory's real win was **15–32% cost/exploration savings on complex tasks** — and it *hurt* on simple ones. Independent reproductions routinely deflate vendor "accuracy" numbers (the LoCoMo benchmark wars produced 84% / 58% / 75% for *the same system*). Design accordingly.
- **Markdown-in-vault is competitive, not a compromise.** Letta's own benchmark shows a *trivial filesystem baseline (74.0% LoCoMo) beats Mem0's graph variant (68.5%)*, concluding "memory is more about how agents manage context than the exact retrieval mechanism." A heavyweight vector/graph DB is **not** a prerequisite — and markdown wins decisively on the axes that matter most here (transparency, auditability, local-by-construction).
- **Recommended architecture archetype:** a **plain-markdown, in-vault memory bank** (Cline/Hermes/CoALA pattern) with **three separated stores** (semantic *facts* / procedural *lessons* / episodic *transcripts*), a **two-tier split** of committed *rules* vs. local *lessons*, **propose-then-approve** capture (Cursor/Hermes pattern), an **ACE-style itemized, append-only, deterministically-merged** lessons playbook (avoids context collapse), **bounded + self-pruning** stores with last-accessed decay, **outcome-coupled** capture **gated on external verification** (tests/lint/build/user-accept), and a generic **read-at-start / write-before-loss** protocol that works identically across all four providers.
- **Riskiest assumption (product):** users will *trust and leave on* a feature that reads all their sessions. It gates everything; the recommended MVP is a *manual* "Consolidate & Recall" slice that doubles as a live test of that trust.
- **Riskiest failure (technical) — self-conditioning.** The dominant risk is not "model collapse" but the agent **locking in its own unverified errors**: re-feeding a model its own prior mistakes measurably *raises* its future error rate, and models tend to agree with lessons already in context (self-sycophancy). LLMs do not reliably self-correct without *external* feedback. Therefore **external verification at the write gate is the feature's load-bearing wall** — never store self-judged lessons. Secondary failures (context poisoning, context collapse, stale facts, prompt bloat) are well-studied with clean mitigations (append-only deltas, deterministic recency, decay, size caps, secret-scanning).

---

## 1. What the user asked, and how we researched it

The request: envision a Brain that "uses past sessions to consolidate on what worked, what didn't, what should be kept" and lets the system "learn and self-improve over time" — referencing Perplexity Brain, Hermes Agent, and Claude Memory as prior art. We dispatched parallel subagents:

| Stream | Focus | Status |
|--------|-------|--------|
| Codebase seams | How Claudian captures sessions today; insertion points | ✅ delivered |
| Competitive landscape | Perplexity, Claude, ChatGPT, Hermes, coding tools, note tools | ✅ delivered |
| Technical / academic | ACE, AWM, Generative Agents, Voyager, Letta, mem0, reflection loops | ✅ core papers delivered (deep-dives) |
| Product framing | Personas, JTBD, riskiest assumptions, scope, ethics | ✅ delivered |

Evidence labeling used throughout: **[DOCUMENTED]** = verifiable in official docs; **[OFFICIAL-BLOG]** = first-party but marketing-toned; **[SECONDARY]** = third-party/community; **[MARKETING]** = vendor claim, unverified.

---

## 2. The competitive landscape

### 2.1 Cloud assistant memory

**Perplexity "Brain" (June 2026)** — the closest analog to the user's vision, and notably **agent-centric** rather than user-centric. [MARKETING/SECONDARY — primary blog access-blocked]
- Remembers *what the agent did*: which projects/connectors/sources produced the best outputs, where it hit dead ends, what corrections the user made. Materialized as an auto-loading "LLM wiki" / context graph.
- The distinctive bit: capture is continuous, but an **overnight batch synthesis** converts raw logs into reusable *lessons*. **That offline consolidation step is the literal difference between a log and a brain.**
- Re-injection is automatic into every subsequent task. User-facing review/edit/delete of the graph is thinly documented — a control gap. First-party metrics (treat as marketing): +25% correctness on repeated tasks, +16% recall, −13% cost.

**Claude Memory (Anthropic)** — two distinct things:
- *Consumer Claude.ai* [DOCUMENTED]: auto-extracts facts from chat history; **global + per-Project isolated** memory; every item is editable/pausable/deletable; "Clear all" permanent; cross-tool Memory Import (Mar 2026).
- *API memory tool* (`memory_20250818`) + *context editing* (`clear_tool_uses_20250919`) [DOCUMENTED] — **the most architecturally relevant primitive for a dev-assistant**. Claude gets file CRUD (`view/create/str_replace/insert/delete/rename`) over a `/memories` directory that is **entirely client-side: "you control where and how the data is stored through your own infrastructure."** The documented multi-session pattern: an initializer bootstraps a progress log + checklist; later sessions read them to recover state in seconds; each session updates before ending; "only mark a feature complete after end-to-end verification." Security guidance is explicit: path-traversal protection (reject `../`), size caps + pagination, periodic expiration of stale files, strip sensitive info. Context editing clears oldest tool results server-side once input crosses ~100k tokens, warning Claude to **write state to memory before results are cleared.**

**ChatGPT Memory (OpenAI)** [DOCUMENTED] — two layers: explicit user-editable **saved memories** (add/view/delete/clear, version history) and implicit **reference chat history** (opaque, toggle-only — users can't see *what* it inferred). Temporary Chat is ephemeral. The opaque layer is the cautionary design (documented prompt-injection paths into saved memory).

**Hermes Agent (Nous Research)** — the cleanest *local, file-backed, consent-gated reflective brain* spec, and the most directly transferable. [DOCUMENTED vendor docs]
- Two files in `~/.hermes/memories/`: `MEMORY.md` (≤2,200 chars — environment facts, conventions, learned lessons) and `USER.md` (≤1,375 chars — preferences), injected as a **frozen snapshot at session start**.
- Capture is automatic + agent-curated: a **self-improvement review runs after each turn**; stale sessions are reviewed at **4 AM** to capture learnings before context expires.
- **Consent loop (the key UX):** with `write_approval: true`, every save is **staged** → `/memory pending` → `/memory approve|reject <id>`.
- **Self-improvement → skills:** solving a task can emit a reusable `SKILL.md` (also gated, with `/skills diff`). Vendor claim: 20+ self-created skills → ~40% faster.
- **Bounded by design:** hard char limits, **enforced** — on overflow the tool *errors* and the agent must consolidate (no silent drop). FTS5 full-text search over a SQLite session history for recall. No auto-compaction (deliberate).

### 2.2 AI coding tools — the markdown "rules / memory bank" pattern

Two cleanly separable mechanisms, and the design doc must keep them apart:

| Dimension | **Rules / instruction files** | **Auto-memory** |
|---|---|---|
| Authoring | User-written markdown | Model-generated from chat |
| Storage | Version-controlled in repo | Out-of-band (local/server) |
| Injection | Deterministic (always-on / glob / manual / model-decision) | Retrieval- or rule-based, often opaque |
| Maturity | Stable everywhere | Beta/preview, churny |

**Auto-memory comparison** (the design-tension surface):

| Tool | Capture | Approval gate | Edit/Delete | Scope | Status |
|---|---|---|---|---|---|
| **Cursor** | Auto (sidecar proposes) | **YES — approve before save** | Settings; file delete (v3.8) | per-project, per-user | Beta; reportedly churny ~v2.1 |
| **Windsurf** | Auto **or** "create a memory" | **NO** | Customizations panel (edit; delete undocumented) | per-workspace, local, uncommitted | GA, no credits |
| **Copilot** | Auto/implicit | **NO** | user/owner/admin delete; **28-day auto-expiry** | per-user prefs / per-repo facts | Public preview |
| **Cody** | — none — | — | — | — | Consumer Cody sunset 2025 |
| **Aider** | — none (explicit) — | — | conventions file only | — | N/A |
| **Cline/Roo** | Agent writes MD files | User reviews like code | Plain files in `memory-bank/` | per-repo (committed) | Community prompt pattern |

Key takeaways:
1. **Approval is the maturity differentiator.** Only Cursor documents a propose→approve→save gate; Hermes adds a staged pending queue. Windsurf/Copilot capture silently.
2. **Every vendor steers durable, shared knowledge to version-controlled rule files, not auto-memory.** Auto-memory is positioned as low-friction/ephemeral; `AGENTS.md`/rules are the reliable path.
3. **`AGENTS.md` is converging as a cross-tool standard** (Cursor, Windsurf, Copilot, Cline all read it) — relevant if Claudian wants memory it authors to be portable to the user's other tools.
4. **Claude Code itself now auto-distills** (Auto memory, on by default v2.1.59+: "Claude saves notes for itself as it works… decides what's worth remembering," stored as `MEMORY.md` + topic files, disable via `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`). Since Claude is Claudian's default provider, the Brain must *complement* rather than fight this — and the cross-provider angle is exactly what Claude Code's per-project memory can't do. The lone production efficacy number in the whole field is GitHub Copilot Memory's self-reported **90% vs 83% PR-merge A/B** — un-replicated, no methodology; treat as suggestive only.
5. **The Cline/Roo "Memory Bank" is the most "product-able" idea for Claudian:** a `memory-bank/` of hierarchical markdown (`projectbrief → productContext/systemPatterns/techContext → activeContext/progress`), with a **mandatory read-at-session-start** ritual and an **"update memory bank"** command. It needs no special runtime support, is fully transparent (committed markdown the user reviews like code), and survives context resets by design. Its weakness: discipline-dependence and the token cost of reading several files per task.

### 2.3 Note / "second brain" tools, and the Obsidian ecosystem specifically

- **Mem.ai** is RAG + AI auto-organization over your notes — **not** session-learning. The only durable "memory" is the note corpus. (Distinct from **Mem0**/mem0.ai, an unrelated agent memory-layer company.)
- **Notion AI / Reflect** — recall/action over manually-authored notes; no autonomous lesson extraction.
- **Obsidian plugins:** **Smart Connections** (local-first on-device embeddings, associative recall) and **Copilot for Obsidian** (Vault QA RAG + a v3.1.0 **saved-fact** Long-Term Memory stored as `.md` under `copilot/memory/`, hybrid capture, CRUD via `@memory`) are *recall*, not reflection.

**The headline ecosystem finding (strong, citable differentiation):** *no mainstream, store-published Obsidian plugin is documented to have an agent that reviews its own past-session transcripts and autonomously rewrites its memory/skills to get measurably better over time.* The closest credible self-improver (Hermes' 10-turn + 4 AM reflection loop) is an **external** agent; the most rigorous self-editing memory (Letta/MemGPT) is an **external service** behind a thin plugin. Plugin-native claims of "continuous learning" reduce, on inspection, to RAG over a growing human-curated note base. **That gap is the opportunity space for Claudian.**

---

## 3. Technical & academic foundations

Five landmark systems define the design space. All store distilled experience as *text or code outside the model weights* and inject it back into the prompt — none touch weights.

### 3.1 Generative Agents (Park et al., 2023) — the retrieval-scoring template
A **memory stream** of natural-language records (observations, plans, **reflections**), each with a timestamp, last-access time, and an LLM-rated **importance (1–10)**. Retrieval ranks by a normalized weighted sum of:
- **Recency** — exponential decay (factor **0.995**) over time since last access,
- **Importance** — the LLM's poignancy rating,
- **Relevance** — cosine similarity to the query embedding.

**Reflection trigger:** when summed importance of recent events exceeds **150** (~2–3×/day), the agent generates salient questions → extracts insights → stores them as reflection nodes **with pointers to the evidence** (a reflection tree). Ablations show memory + planning + reflection each contribute monotonically to believability. **Lesson for us:** weighted retrieval (recency + importance + relevance) + periodic self-reflection with evidence pointers is a proven, simple recipe.

### 3.2 Voyager (Wang et al., 2023) — verified, executable skill memory
Memory = a **skill library of executable programs**, key-value indexed (key = embedding of an NL description, value = the code). **A skill is written only after a self-verification critic confirms success.** New tasks retrieve top-k skills by cosine similarity and compose them. The clean result: lending Voyager's library to a weaker agent transfers its capability — **the memory, not just the model, drives generalization.** **Lesson for us:** the highest-value memory is *procedural and verified before it's written* — which maps directly onto Claudian's `$` skills + verification signals.

### 3.3 Agent Workflow Memory (AWM, 2024) — reusable parameterized routines
Induces **workflows** (NL description + parameterized action steps) from past trajectories, offline (from annotated data) or **online** (after each evaluator-verified success). Gains widen as the train/test gap widens (helps most where transfer is hardest). **Honest negative results:** online-induced workflows can be *wrong* and degrade performance; agents sometimes ignore newly-added workflow actions (18.5% adoption). **Lesson for us:** induced lessons must be verified and are only as good as the success signal behind them.

### 3.4 ACE — Agentic Context Engineering (2025) — the anti-collapse playbook
The most directly relevant recent work. A **Generator / Reflector / Curator** loop maintains an **itemized "playbook"** — bullets with unique IDs, **helpful/harmful counters**, and content, under sections like *STRATEGIES & INSIGHTS* and *COMMON MISTAKES TO AVOID*. New lessons arrive as **delta entries** merged by **deterministic, non-LLM logic** (not a wholesale LLM rewrite); a grow-and-refine step de-dupes via embeddings.

ACE names and attacks the two failure modes a naive Brain would hit:
- **Context collapse** — asking an LLM to *rewrite* accumulated context compresses it and loses detail (their example: 18,282 → 122 tokens, accuracy 66.7% → 57.1% in one rewrite).
- **Brevity bias** — optimization collapsing toward short, generic prompts.

Results: matches a GPT-4.1 production agent on AppWorld using an open model; large cost/latency wins from append-only context (KV-cache reuse). **Crucial caveat (a real negative result):** without a reliable ground-truth/execution signal, ACE *degrades* (FiNER no-labels: −3.4 pts vs baseline). **Lesson for us:** itemized, append-only, deterministically-merged memory beats LLM-rewritten memory — and the value of any self-improvement loop is capped by the quality of its outcome signal.

### 3.5 The heuristic-distillation lineage — the on-thesis works
This is exactly the user's loop (episodic logs → distilled lessons → injected context). Three works do it *well* with defensible evidence:
- **ExpeL** (AAAI 2024) — the clean academic archetype: run a ReAct agent over training tasks, then distill transferable NL **insights**, maintained with ADD / UPVOTE / DOWNVOTE / EDIT / REMOVE (count-based voting "because even successful trajectories can mislead insights"); inject the insight list + kNN-retrieved successful trajectories. *Inter-test-time*, no fine-tuning. The closest published analog to the ask.
- **AutoGuide** (NeurIPS 2024) — the sharpest *injection* mechanic: **contrastive, state-conditional** guidelines (`[CONTEXT] → [ACTION]`) mined from success-vs-failure pairs, retrieved by *current state* rather than dumped wholesale. Beats ExpeL on WebArena-Reddit (47% vs 22%).
- **ReasoningBank** (Google, ICLR 2026) — the strongest 2025–26 realization: distills **strategy-level** memory from **both successes and failures** (failures contribute "counterfactual signals"), evaluated on **SWE-Bench-Verified** (34.2%→38.8%) with memory-aware test-time scaling. Learning-from-both beats success-only (49.7% vs 46.5%).

**The taxonomy to structure stores by — CoALA** (Sumers et al.): **semantic** (facts/preferences) · **episodic** (past interactions as examples — "what worked before") · **procedural** (skills/instructions that *evolve*). The clearest mental model in the space; the Brain should keep these three separate.

**The memory-layer family** (stores *facts*, not heuristics — useful but adjacent):
- **Letta/MemGPT** [DOCUMENTED]: OS-inspired tiers (core / recall / archival) with **self-editing memory blocks** and **"sleep-time" agents** that reflect during idle periods — the between-sessions reflection pattern the user wants. Caveat: the headline DMR benchmark is saturated and trivially beaten by full-context.
- **mem0**: extraction → consolidation pipeline (ADD / UPDATE / DELETE / NOOP in the paper; the shipping SDK has **drifted to add-only**, since a bad destructive DELETE silently loses wanted facts). Honest pitch is *cost/latency traded for accuracy* — its own paper concedes full-context is *more* accurate (~73% vs ~67%). Distinct from the unrelated note-app Mem.ai.
- **Reflexion / CRITIC**: verbal self-reflection on failure → episodic buffer conditioning the next attempt. **Crucial corrective:** Reflexion/Self-Refine/CRITIC are *intra-task retries*, routinely mischaracterized as cross-session learning. CRITIC carries the field's key negative result — remove the external tool and self-correction collapses: **LLMs cannot reliably self-correct without external feedback.**

### 3.6 Cross-cutting design principles (what the literature agrees on)

1. **Outcome-couple the capture.** Store lessons tied to verified success / failure / user correction, not speculative facts. (Voyager critic, AWM evaluator, Hermes self-review, Claude's "verify before marking complete".)
2. **Consolidate asynchronously.** A distillation pass — periodic, on-failure, or overnight — is what makes a brain vs. a log. (Perplexity overnight synthesis, Generative Agents reflection trigger, Hermes 4 AM pass, Letta sleep-time.)
3. **Itemize and append; merge deterministically.** Avoid wholesale LLM rewrites (context collapse). Bullets with IDs + helpful/harmful counters + dedupe. (ACE.)
4. **Retrieve, don't dump.** Rank by recency + importance + relevance; cap the injection budget. (Generative Agents, Voyager top-k.)
5. **Bound and decay.** Hard size caps, last-accessed timestamps, expire/forget the unused. (Hermes char limits, Copilot 28-day expiry, Anthropic expiration guidance.)
6. **Prefer procedural memory where possible.** A reusable verified skill beats a recalled fact. (Voyager, Hermes SKILL.md.)
7. **Local-first is viable without a cloud vector DB.** Markdown + on-device embeddings (Smart Connections) or even lexical FTS (Hermes) is enough for a privacy-first dev assistant. A heavyweight vector store is *not* a prerequisite — and a filesystem baseline is *competitive* on benchmarks (§0).
8. **Use deterministic code, not the LLM, for recency/conflict.** LLM-driven "which fact is newer" fails two ways (training-prior override; judgment drift as context grows). Have the LLM *extract* candidates and let `max(timestamp)` code pick the winner (+10.8 pts in the source study). Prefer **invalidate-don't-delete** (Graphiti bi-temporal) so history and provenance survive.
9. **Keep injected memory small and high-signal.** "Lost in the middle" (U-shaped attention) and "context rot" (degradation well before the window fills) mean more memory ≠ better. Hard token budgets per tier; JIT retrieval over always-on dumping.
10. **Prove it against baselines, or it isn't earning its complexity.** Always ablate against (a) no-memory and (b) a *hand-written static context file*; measure **quality and cost/turns separately** (memory may help one, hurt the other); split by task complexity. If the Brain can't beat a hand-written `CLAUDE.md`/`AGENTS.md`, it isn't worth its weight.

---

## 4. How Claudian captures sessions today (codebase seams)

Claudian already owns most of the substrate a Brain needs. Key facts (file:line):

- **Provider-neutral conversation model.** `Conversation` (`src/core/types/chat.ts:90-115`) carries `providerId`, `messages: ChatMessage[]`, timestamps, and **`lastResponseAt`** — the natural "turn finished" marker. Every provider's history service hydrates into the *same* `ChatMessage[]` shape — the uniform target a cross-provider Brain consumes.
- **Session persistence.** Only `SessionMetadata` is written by Claudian (`.claudian/sessions/<id>.meta.json` via `SessionStorage`, `src/core/bootstrap/SessionStorage.ts`); message bodies live in provider-native transcripts (`~/.claude/projects/`, `~/.codex/sessions/`, `~/.cursor/chats/`, Opencode SQLite) and are hydrated on demand. Storage shell: `SharedStorageService` + `ClaudianSettingsStorage` in `src/app/`, atop `VaultFileAdapter` / `HomeFileAdapter`.
- **The closest existing "what happened" record — Tasks ledger + handoff.** `TaskLedgerEntry` (`{timestamp, status, message}`, `src/features/tasks/model/taskTypes.ts:73`) is an append-only audit trail at `.claudian/runs/<runId>/ledger.jsonl` (`RunSidecarStore`). Terminal runs snapshot a **`HandoffSections`** report — `summary / verification / risks / nextAction` (`model/handoffSections.ts:19-24`) — into the work-order note. **This four-field self-report is the single most "learning-ready" artifact in the codebase today.**
- **Event bus.** `EventBus<ClaudianEventMap>` (`src/core/events/EventBus.ts`) is plugin-wide. Tasks already emit rich lifecycle events (`task:run-finished`, `task:ledger-appended`, `task:needs-handoff`). **Gap:** ad-hoc chat has **no** `conversation:turn-completed` event today — completion surfaces only as a `lastResponseAt` write + `saveMetadata` call in `ConversationStore` (`src/app/conversations/ConversationStore.ts:129/191/213`, where the `EventBus` is already plumbed and a "future store-owned events" comment anticipates exactly this).
- **Prompt injection points.** `buildSystemPrompt()` (`src/core/prompt/mainAgent.ts:184-199`) has an **`appendices` slot that is wired but currently unused**, plus `settings.customPrompt`. Per-turn encoders build a trust-tagged **`ContextEnvelope`** (`src/core/context/contextEnvelope.ts:85-133`) whose comments already flag file/MCP as planned pluggable sources — a clean place to inject *trust-tagged* learned context.
- **Proven learning-extraction precedent.** The `#` instruction mode already does *model summarizes → user accepts → persist to settings → inject later* via `QueryBackedInstructionRefineService` (`src/core/auxiliary/`). This is a working template for "distill a lesson, persist it, inject it."
- **Registries.** A Brain is **provider-neutral**, so it belongs at the **app-shell composition layer** (alongside `SharedStorageService` / `ConversationStore`), subscribing to the `EventBus` — *not* in the provider-keyed `ProviderRegistry` / `ProviderWorkspaceRegistry`. Per-provider injection rides the shared `appendices` / context-envelope seam.
- **Settings.** Add a feature-flagged **Brain tab** via `SettingsRegistry` (`src/features/settings/registry/`), defaults through `buildDefaultsFromRegistry`, parity tests in `tests/integration/settings/`.

### Best insertion points (seam summary)
1. **A new `conversation:turn-completed` event at the `ConversationStore` save seam** — the highest-leverage, provider-neutral observation hook. **Prerequisite** for learning from ordinary chat (Tasks already has its events).
2. **The `appendices` + `ContextEnvelope` injection seam** — where lessons re-enter prompts, cross-provider, trust-tagged.
3. **Tasks ledger + handoff as the ready-made outcome corpus** — timestamped, status-tagged events + a four-field verified self-report, with almost no new capture plumbing.
4. **The instruction-refine pattern as the extraction engine** — reuse, don't reinvent.
5. **An app-shell Brain service + `.claudian/brain/` store + feature-flagged settings tab.**

### Constraints any implementation must respect
No `innerHTML`/`console.*`; build DOM via Obsidian `createEl`/`MarkdownRenderer`; secrets via `SecretStorage` (never vault config); TDD with mirrored tests; **a perf guard** (anything reading transcripts scales with length → blocking `tests/perf/` gate); LOC ratchet + fallow quality gate; `UsageInfo` through `buildUsageInfo`; provider-native first; `providerState` opaque in feature code.

---

## 5. Product framing

### 5.1 Who it's for (proto-personas — hypotheses)
- **Dax, the multi-tool builder** *(primary)* — runs Claude + Codex/Cursor in one vault; re-pastes the same "here's how this repo works / don't do X" preamble every session; loses continuity when switching providers. Hires the Brain to **carry forward what worked across sessions and tools.**
- **Rae, the second-brain keeper** *(primary, the Obsidian-native job)* — hundreds of chat sessions whose insights never make it back into notes. Hires the Brain to **consolidate sessions into recallable, editable vault knowledge.**
- **Mor, the privacy-first gatekeeper** *(secondary)* — chose a local-first tool deliberately; cloud memory is a non-starter. The Brain is **the only memory feature they're allowed to use** — *if* it clears the trust bar.
- **Anti-persona:** the one-off user who wants stateless chat and would find accumulated memory creepy. The Brain must be **off by default**.

### 5.2 Jobs To Be Done (job stories)
1. *When* I start a session on a known project, *I want* its conventions/gotchas/decisions already in play, *so I can* stop re-pasting preambles and skip solved problems.
2. *When* a run fails or goes down a wrong path, *I want* that remembered as "don't do this again," *so I can* avoid re-hitting the wall.
3. *When* I switch providers mid-project, *I want* the accumulated context to cross the boundary, *so I can* keep continuity.
4. *When* I dispatch a work order, *I want* "last time you did something like this, here's what worked," *so I can* start from prior success.
5. *When* a chat produces a good decision/pattern, *I want* it consolidated into a durable, linkable vault note, *so I can* reuse it later.
6. *When* I review my week, *I want* a "what I learned / what worked" digest, *so I can* turn scattered AI work into compounding knowledge.

The core job (Christensen framing): **make progress compound across sessions.** The competing alternatives today are a manual gotchas note, re-pasting preambles, and forgetting. The Brain wins only if it beats "manual note + re-paste" on *both* effort and trust.

### 5.3 How Might We
- HMW let accumulated session knowledge re-enter future sessions *automatically and relevantly*, without hand-management?
- HMW turn raw transcripts into a *trustworthy* "what worked / what to avoid" the user can read, edit, and correct?
- HMW make memory *feel safe and in-control* — visible, scoped, deletable — so a privacy-first user leaves it on?
- HMW make remembered knowledge *flow across providers and into the vault graph*, so it compounds rather than fragmenting per tool?

### 5.4 Riskiest assumptions (DVF)

| # | Belief | Risk | Importance | Evidence |
|---|--------|------|-----------|----------|
| 1 | Users will trust & leave on a feature that reads all sessions | Desirability/Ethics | **High** | **None** |
| 2 | Consolidated memory measurably beats a manual gotchas note | Value | **High** | None |
| 3 | We can auto-extract usable "what worked/avoid" from messy transcripts | Feasibility | High | Partial (ledger/handoff exist) |
| 4 | Injected memory helps more than it hurts (no poisoning/staleness) | Feasibility | High | None |
| 5 | Users will review/correct memory rather than ignore it | Usability | Medium | None |
| 6 | Worth building vs. providers' native memory eating the need | Viability | Medium | Low |

**The single feature-sinking assumption is #1** — even a memory that demonstrably improves outcomes is dead if it gets disabled at the privacy wall. **Cheap test:** a 1–2 week Wizard-of-Oz diary study — give ~6–10 power users a plain `brain.md` they curate manually and prepend at session start; measure retention, whether they edit/prune it (trust + control signals), and whether they'd want an auto-version *on* and under what scoping. Pre-stated kill signal: they abandon it within days, or will only accept a manual, off-by-default version — which would mean the *autonomous* framing is wrong.

### 5.5 Differentiation & positioning
Four defensible differentiators, in priority order:
1. **Cross-provider consolidation (the moat).** Every cloud memory is a per-tool silo — Cursor's memory can't see your Claude sessions. The Brain sits *above* all four providers via the unified conversation model. It is the only place memory can span tools.
2. **It's *your* file, not their server.** Vault-resident markdown — inspectable, diffable, git-versionable, deletable. The only memory a privacy-first user can adopt.
3. **Knowledge, not just code.** Living in Obsidian, memory can feed the graph/backlinks and become real second-brain knowledge — no coding tool can do this.
4. **Already-captured substrate.** The ledger/handoff/session-metadata machinery exists; the Brain is a consolidation layer, a feasibility head-start.

Positioning line: **"Your AI memory, in your vault, across every tool — owned by you, not rented from a provider."**

### 5.6 Trust, control & ethics (the precondition, not a feature)
- **Off by default; opt-in, never opt-out.** Explicit plain-language consent stating exactly what is read/stored, *before* first capture. Per-project/folder scoping with an honored exclude list.
- **Transparency:** memory is a human-readable vault file; every injected memory is **attributable** ("from session X on date Y") and visible in-context when used — no invisible priming.
- **Control:** first-class edit / pin / prune / **delete** ("forget this" = real deletion), **undo** for any auto-consolidation, one-switch **pause** and **wipe-all**.
- **Hard guardrails on what NOT to remember:** secrets/keys/tokens (active redaction + secret-scanning), PII, excluded paths, throwaway sessions. Low-confidence/contradicted claims should **decay, not harden**.
- **Distrust triggers to design against:** surfacing something private the user forgot it saw; silent behavior change with no traceable source; **context poisoning** the user can't find/remove; vault clutter; any hint of network egress from a "local" feature.

### 5.7 Success & failure signals
- **Working (leading → lagging):** users keep it enabled past week 1; they *edit/curate* brain notes (curation = trust + value); declining share of known-project sessions needing manual re-priming; primed sessions show fewer repeated failures than cold ones (compare run ledgers); brain notes get linked into the vault graph.
- **Making things worse:** rising disable/pause rate (the #1 guardrail); edit-to-delete ratio skewing toward delete; primed sessions performing *worse* than cold (poisoning); "forget this"/undo spikes; trust-breach reports; consolidated-but-never-read memory (effort, no value).
- **Measurement caveat:** for a privacy-first product, success measurement must itself be local/opt-in — prefer in-vault, user-visible signals (curation, disable, undo) over phone-home telemetry. All numeric targets are TBD and must come from product data, not invented.

---

## 6. Synthesis — a recommended architecture archetype for the Claudian Brain

Combining the literature's principles (§3.6), the competitive patterns worth stealing (§2.2), and Claudian's seams (§4):

### 6.1 Storage: plain-markdown memory bank, in the vault, two-tier
A `.claudian/brain/` (or vault-visible) tree of **human-readable, git-diffable markdown** — the Cline/Hermes model. Two tiers, explicitly separated (the universal coding-tool pattern):
- **Rules** (durable, committable, shareable): conventions/decisions → align with the converging **`AGENTS.md`** standard so Claudian-authored knowledge is *portable to the user's other tools*.
- **Lessons** (local, auto-captured, machine-bound): outcome-coupled "what worked / what to avoid," kept local and gitignorable.

Structure lessons as **itemized bullets with IDs + helpful/harmful counters** (ACE), not monolithic prose — this enables localized updates, dedupe, and decay without context collapse. Optionally scope per-project (Cursor/Windsurf default) to avoid cross-contamination.

### 6.2 Capture: outcome-coupled, propose-then-approve
- **Trigger on outcomes, not every turn:** verified success, failure, or user correction. Ride Claudian's existing signals — the Tasks **handoff** (`verification` field) and **ledger** are ready-made; for ad-hoc chat, add the `conversation:turn-completed` event (§4 seam #1).
- **Propose → review card → approve/edit/reject** (Cursor + Hermes pending-queue). Route proposed writes through a **diff card** (Claudian already has approval-card + inline-edit infra) before anything touches the vault. **Default-on review** for a dev tool, because of the secret-capture risk.
- **Secret-scan every proposed write** (Hermes blocks injection/invisible-Unicode patterns) and confine writes to the brain dir (Anthropic traversal guidance).

### 6.3 Consolidation: asynchronous, deterministic merge
- A **distillation pass** — manual at first (an "update brain" command, Cline-style), later optionally periodic/idle (Hermes 4 AM / Letta sleep-time / Perplexity overnight). This async step is what makes it a *brain*.
- **Merge with deterministic logic, append-only deltas, embedding-dedupe** — never a wholesale LLM rewrite (ACE anti-collapse).
- **Bound + decay:** hard size caps with consolidate-on-overflow (Hermes), last-accessed timestamps, surface/expire the unused (Copilot 28-day, Anthropic guidance).

### 6.4 Retrieval & injection: bounded, trust-tagged, attributable
- **Read-at-session-start / write-before-loss**, implemented generically so it works identically across Claude/Codex/Opencode/Cursor — turning Anthropic's Claude-specific memory protocol into a **multi-provider** capability via the shared `appendices`/`ContextEnvelope` seam.
- **Rank by recency + importance + relevance** (Generative Agents), cap the injection budget, and **trust-tag** injected memory in the context envelope so it's attributable and overridable.

### 6.5 The "brain" move and the ceiling: procedural memory + honest signal
- **Promote repeatedly-useful lessons into `$` skills** (with approval + diff) — Claudian already owns `.claude/skills` / `.codex/skills`. This converts passive recall into *executable procedure*, the highest-value memory form (Voyager/Hermes).
- **Respect the ceiling:** ACE/AWM both show self-improvement degrades without a reliable outcome signal. Claudian's `verification` handoff field and Tasks status are exactly that signal — lean on them, and be conservative where the signal is weak (ad-hoc chat with no verification).

---

## 7. Recommended scope ladder

**Walking-skeleton MVP — "Consolidate & Recall, manually"** (also the live trust/value test):
- `Consolidate this session into the Brain` → extracts a short "what worked / what to avoid / decisions" into a visible, editable `brain.md` (reuse ledger/handoff + instruction-refine machinery).
- `Prime this session from the Brain` → user-triggered injection into a new session.
- Off by default. **The MVP is explicitly NOT:** automatic/continuous watching, cross-session auto-merge, embeddings/vector store, cross-provider unification, always-on injection, or autonomy.

**v1 — "Assisted memory":** auto-*suggest* consolidation at session end (propose → approve, never silent); project-scoped notes with relevance selection; cross-provider read; review UI (edit/prune/pin/delete/forget); scoping + secret redaction.

**v2 — "Self-improving Brain":** consented continuous consolidation with confidence scores + decay; relevance-ranked (capped, visible) auto-injection; participation in the Obsidian graph; cross-project meta-patterns + learning digest; an **outcome feedback loop** (track whether primed sessions actually did better, weight memory accordingly).

**Sequencing discipline:** the "watches everything and self-improves" framing is seductive — build the autonomy *last*, only after the MVP proves users trust manual consolidation.

---

## 8. Top risks & mitigations

| Risk | Source evidence | Mitigation |
|------|-----------------|-----------|
| **Self-conditioning / self-sycophancy** (the load-bearing risk) | arXiv 2509.09677; Sharma 2310.13548; CRITIC/2310.01798 | **Gate every write on external verification** (tests/lint/build/user-accept); store *contrasting* worked-vs-failed lessons, not raw error traces; use a *different* model as critic; never trust self-judgment |
| **Trust wall / silent capture** (feature gets disabled) | Riskiest assumption #1; ChatGPT opaque layer | Off by default; propose→approve; everything a visible/editable vault file; attribution on injection |
| **Memory injection as a security boundary** (poisoned "lessons" from untrusted repo content) | MINJA, arXiv 2503.03704 (>95% injection success) | Treat repo-derived content as untrusted; validate-before-write; markdown source-of-truth makes injected entries human-visible + git-revertable |
| **Context poisoning / wrong lessons** auto-injected forever | AWM negative results; ACE no-signal degradation | Outcome-couple capture; helpful/harmful counters + decay; conservative where signal is weak; easy "forget this" |
| **Context collapse / brevity bias** from LLM rewrites | ACE (18k→122 tokens) | Itemized append-only deltas, deterministic merge, embedding-dedupe — never wholesale rewrite |
| **Staleness** (lesson outlives the code it was about) | Hermes frozen-snapshot; Anthropic expiry guidance | Last-accessed timestamps; expire unused; re-validate against current state (Copilot-style) |
| **Secret capture** (a key leaks into memory from a debug session) | Anthropic security docs; Hermes scanning | Secret-scan every write; redaction; path confinement; SecretStorage never in brain files |
| **Prompt bloat / cost** | Hermes hard caps; ACE token concerns | Bounded stores; retrieval budget; perf guard in `tests/perf/` |
| **Self-improvement does nothing** (no reliable signal) | ACE/AWM ceiling | Anchor capture to `verification` handoff + Tasks status; measure primed-vs-cold outcomes before trusting autonomy |

---

## 9. Open questions for the design phase

1. **Storage shape:** single per-project `brain.md` vs. an itemized bullet store with IDs/counters (ACE) — likely start with the former for MVP, evolve to the latter for v2.
2. **Embeddings or not:** lexical/FTS (Hermes) is enough for MVP; on-device embeddings (Smart Connections precedent) for v2 relevance ranking — confirm we never *require* a cloud vector DB.
3. **`AGENTS.md` interop:** should the durable rules tier *be* `AGENTS.md` for portability, or a Claudian-owned file that exports to it?
4. **Ad-hoc chat outcome signal:** without a `verification` field, how conservative should capture be? (Probably: only on explicit user "remember this" + light heuristics.)
5. **Event seam:** confirm `conversation:turn-completed` is the right place and payload (full `Conversation`).
6. **Measurement without telemetry:** which local, user-visible signals (curation rate, disable rate, primed-vs-cold ledger comparison) can we surface in-vault?
7. **Provider parity:** which providers get write-before-loss vs. read-only priming in v1?

## 10. Recommended next steps

1. **Validate trust/value first** with the §5.4 Wizard-of-Oz `brain.md` diary study before committing engineering.
2. Promote this research into a **design spec** (`docs/superpowers/specs/`) and a **`conversation:turn-completed` event + app-shell Brain service** plan (`docs/superpowers/plans/`).
3. Ship the **manual "Consolidate & Recall" MVP** behind a feature flag; instrument local success/failure signals.
4. **Evaluate honestly:** before trusting any autonomy, ablate the Brain against no-memory *and* a hand-written `AGENTS.md`/`CLAUDE.md`, measuring quality and cost/turns separately and splitting by task complexity (§3.6 principle 10). Anchor lesson-capture to the `verification` handoff signal.
5. Only after the MVP earns trust *and* beats the baselines, layer in suggestion, decay, cross-provider injection, skill-promotion, and (last) autonomy.

---

## Appendix — primary sources

**Self-improvement / memory architectures:** ACE (arxiv.org/abs/2510.04618, github.com/ace-agent/ace) · AWM (arxiv.org/abs/2409.07429) · ExpeL (arxiv.org/abs/2308.10144) · AutoGuide (arxiv.org/abs/2403.08978) · ReasoningBank (arxiv.org/abs/2509.25140) · CoALA (arxiv.org/abs/2309.02427) · Generative Agents (arxiv.org/abs/2304.03442) · Voyager (arxiv.org/abs/2305.16291, voyager.minedojo.org) · Letta/MemGPT (arxiv.org/abs/2310.08560, docs.letta.com) · mem0 (arxiv.org/abs/2504.19413, mem0.ai) · A-MEM (arxiv.org/abs/2502.12110) · Zep/Graphiti (arxiv.org/abs/2501.13956) · Reflexion (arxiv.org/abs/2303.11366).

**Self-evolving-agents survey:** arxiv.org/abs/2507.21046 (TMLR 2026) + github.com/EvoAgentX/Awesome-Self-Evolving-Agents.

**Eval & failure-mode evidence:** controlled coding-agent memory benchmark (Sandelin) · Letta filesystem-baseline benchmark (letta.com/blog/benchmarking-ai-agent-memory) · self-conditioning (arxiv.org/abs/2509.09677) · LLMs can't self-correct (arxiv.org/abs/2310.01798) · deterministic recency (arxiv.org/abs/2606.01435) · lost-in-the-middle (arxiv.org/abs/2307.03172) · context rot (trychroma.com/research/context-rot) · MINJA memory injection (arxiv.org/abs/2503.03704) · LoCoMo critique + Zep/mem0 reproduction dispute.

**Products:** Claude memory tool (platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) + context editing (platform.claude.com/docs/en/build-with-claude/context-editing) + anthropic.com/news/context-management · Claude.ai consumer memory · ChatGPT memory (help.openai.com/en/articles/8590148-memory-faq) · Perplexity Brain (marktechpost.com/2026/06/18/perplexity-launches-brain/) · Hermes (hermes-agent.nousresearch.com/docs/user-guide/features/memory) · Cursor memories/rules (cursor.com/docs/context/memories, cursor.com/docs/context/rules) · Windsurf/Cascade (docs.devin.ai/desktop/cascade/memories) · GitHub Copilot (docs.github.com/copilot — custom instructions + copilot-memory concept) · Cline Memory Bank (docs.cline.bot/prompting/cline-memory-bank) · Aider conventions (aider.chat/docs/usage/conventions.html).

**Obsidian ecosystem:** Copilot for Obsidian (github.com/logancyang/obsidian-copilot, obsidiancopilot.com/en/docs/vault-qa) · Smart Connections (smartconnections.app) · Letta Obsidian (github.com/letta-ai/letta-obsidian) · Mem.ai (get.mem.ai).

**Codebase:** `src/core/types/chat.ts`, `src/core/bootstrap/SessionStorage.ts`, `src/app/conversations/ConversationStore.ts`, `src/features/tasks/model/{taskTypes,handoffSections}.ts`, `src/features/tasks/storage/RunSidecarStore.ts`, `src/core/events/EventBus.ts`, `src/core/prompt/mainAgent.ts`, `src/core/context/contextEnvelope.ts`, `src/core/auxiliary/QueryBackedInstructionRefineService.ts`, `src/features/settings/registry/`.
