---
title: "Ruflo vs. Claudian — Comparative Review and Feature-Adoption Study"
date: 2026-06-06
status: research
scope: competitive/architecture (multi-agent orchestration, swarms, memory, plugins, MCP) — what Claudian can adopt from ruvnet/ruflo and where it fits the plugin's provider + Agent Board model
method: three dedicated subagents in parallel — (1) web research on ruvnet/ruflo + claude-flow lineage, (2) Claudian feature/architecture inventory of the codebase, (3) deep technical dive into the Agent Board orchestration internals — synthesized into this note
related:
  - "[[2026-06-03-competitive-landscape]]"
sources:
  - https://github.com/ruvnet/ruflo
  - https://github.com/ruvnet/ruflo/blob/main/docs/STATUS.md
  - https://github.com/ruvnet/ruflo/blob/main/docs/USERGUIDE.md
  - https://github.com/ruvnet/ruflo/wiki/
  - https://github.com/ruvnet/claude-flow
  - https://dev.to/stevengonsalvez/claude-flow-the-multi-agent-swarm-orchestrator-before-it-got-a-new-name-4kd4
---

# Ruflo vs. Claudian — Comparative Review and Feature-Adoption Study

> **Bottom line.** Ruflo and Claudian solve adjacent but different problems. Ruflo is a **CLI-native, multi-agent meta-harness** that makes Claude/Codex agents *collaborate, learn, and persist* across machines. Claudian is an **Obsidian-native, multi-provider chat + autonomous-task product** that makes agent work *legible, recoverable, and human-gated* inside a vault. Claudian should **not** try to become ruflo. But three ruflo capability clusters — (1) a **task-dependency / sequencing layer** on the Agent Board, (2) a **persistent shared-memory / pattern store**, and (3) a **richer plugin-marketplace surface** — map cleanly onto seams Claudian already has, and would meaningfully extend the product without abandoning its identity.

---

## 1. The two systems at a glance

| | **Ruflo** (`ruvnet/ruflo`) | **Claudian** (`Luis85/claudian`) |
|---|---|---|
| Tagline | "The leading agent meta-harness for Claude." | Multi-provider AI chat + autonomous task runner embedded in Obsidian. |
| Surface | CLI (`npx ruflo`) + MCP server + beta web UI | Obsidian sidebar chat, inline edit, Agent Board, settings tabs |
| Core unit | A **swarm** of specialized agents under a queen | A **conversation** (provider-backed) and a **work order** (one autonomous run) |
| Providers | Claude, Codex, GPT, Gemini, Cohere, Ollama (routed, with failover) | Claude (full), Codex, Opencode, Cursor (opt-in, capability-gated) |
| Orchestration | Queen-led hive-mind, multiple topologies, BFT/Raft/CRDT consensus, work-stealing | Flat priority queue → N concurrency-capped independent runs; no DAG, no inter-run comms |
| Memory | AgentDB (HNSW vector), ReasoningBank, knowledge graph, pattern marketplace (IPFS) | Per-conversation transcripts + session metadata + run sidecars; **no shared/semantic memory** |
| Learning | SONA neural arch, MoE routing, EWC++, Thompson-sampling model bandit | None (static provider/model per task) |
| Plugins | 33-plugin marketplace, `/plugin marketplace add`, plugin creator | Reads **Claude Code** plugins from disk (agents only), no marketplace, restart to refresh |
| Security | Zero-trust federation (mTLS, ed25519), PII gating, AIDefence, encryption at rest, witness verification | Obsidian SecretStorage (keychain) for keys/MCP secrets, stdio env curation |
| Persistence model | SQLite (sql.js) + vector DB | Markdown notes + JSON/JSONL sidecars in the vault (Obsidian-native, git-friendly) |
| Maturity | v3.10.x, ~58k★, very active; heavy marketing-vs-audited count gaps | Mature focused product; fewer but deeper, well-tested primitives |

**Key framing.** Ruflo is **breadth + autonomy + scale** (100+ agents, cross-machine, self-improving). Claudian is **depth + legibility + recoverability** inside a single user's vault. Ruflo's primitives are impressive but its README counts are inflated (audited STATUS.md: ~45 agents not "100+", ~323 MCP tools, ~17 hooks not "27"). Claudian's primitives are fewer but every one is real, typed, and tested.

---

## 2. Ruflo — what it actually ships (audited)

Distilled from the README, `docs/STATUS.md`, `docs/USERGUIDE.md`, and the wiki. Where marketing and audited counts disagree, the audited number is used.

- **Identity:** ruflo *is* claude-flow rebranded and expanded (v3.10.x), TypeScript/Node (`@claude-flow/cli`, run via `npx ruflo`). Not a Rust rewrite — the WASM/SIMD "neural" lineage comes from the sibling `ruv-swarm`.
- **Hive-mind / swarm:** a **queen** coordinator assigns tasks and aggregates results; **workers / specialists / scouts** execute and report via a `SendMessage` protocol. Topologies: hierarchical (preferred, ~6–8 agents, anti-drift), mesh (gossip), hierarchical-mesh, ring, star, adaptive. **Consensus:** BFT/PBFT, Raft, gossip, CRDT, quorum. Coordination primitives: `broadcast`, `consensus propose/vote`, shared-memory `memory set`.
- **Memory & learning:** **AgentDB** (HNSW vector store on sql.js SQLite), **ReasoningBank** (indexed trajectory/pattern memory, 384-dim ONNX `all-MiniLM-L6-v2` embeddings), **RVF** long-term memory, **knowledge graph** (PageRank + Graph RAG), **pattern marketplace** over IPFS (`transfer-store`). **SONA** self-optimizing neural arch selects agent type/model tier/temperature; 4-step pipeline RETRIEVE→JUDGE→DISTILL→CONSOLIDATE; EWC++ anti-forgetting; Thompson-sampling cost-adjusted model bandit.
- **MCP:** ~323 audited MCP tools across Core/Intelligence/Agents/Memory/DevTools server groups; full lifecycle CLI (`mcp start|stop|status|health|tools|toggle|exec|logs`); 10 MB stdin cap.
- **Hooks/automation:** ~17 hooks (pre/post-edit, pre/post-task, session, intelligence) + 12 auto-triggered background workers managed by a `daemon`; quality-gate pre-commit hooks.
- **Methodology plugins:** `ruflo-sparc` (Specification→Pseudocode→Architecture→Refinement→Completion, gated 5-phase TDD), `ruflo-adr`, `ruflo-ddd`.
- **Standout / unique:**
  - **Agent Federation ("Slack for agents")** — zero-trust cross-machine collaboration: mTLS + ed25519, **PII-gated data flow** (14-type detection, BLOCK/REDACT/HASH), **behavioral trust scoring**, budget circuit breaker (`maxHops`).
  - **Witness verification** — Ed25519-signed per-commit witness; `ruflo verify` re-derives and validates installed bytes.
  - **Work-stealing / issue handoff** (`issues steal/handoff/rebalance`) + human `claims` authorization.
  - **Goal Planner UI** — plain-English goal → GOAP A* planner → live agent dashboard with adaptive replanning.
  - **33-plugin marketplace** + `ruflo-plugin-creator`, `ruflo-cost-tracker`, `ruflo-observability`.
- **CLI surface:** ~45 top-level commands, 140+ subcommands (`init`, `agent`, `swarm`, `hive-mind`, `memory`, `neural`, `security`, `issues`, `claims`, `transfer-store`, `verify`, `daemon`, …).

---

## 3. Claudian — what it actually ships (relevant subset)

- **Provider boundary:** `ProviderRegistry` + `ProviderWorkspaceRegistry` are factory registries; `ChatRuntime` is the provider-neutral seam (`prepareTurn`/`query`/`cancel`/`rewind`). Four providers register through it; capabilities are flag-gated per provider. This is a genuinely clean, extensible plug-in point.
- **Chat:** send/stream/cancel/resume, fork, rewind (Claude/Codex), plan mode, history hydration, inline edit, `#` instruction mode, `/` commands, `$` skills, `@` agent/MCP mentions, image attachments.
- **Agents / subagents:** `AgentDefinition` sourced from builtin → plugin → vault (`.claude/agents`) → global (`~/.claude/agents`); Claude SDK can spawn background subagents (`SpawnAgent`/`WaitForTask`/`CloseTask`) with a `Stop`-blocking hook while subagents run. **This is the only real multi-agent execution in the product, and it is provider-internal (Claude SDK), not orchestrated by Claudian.**
- **Agent Board (the orchestration system):** Markdown work orders (`type: claudian-work-order`) with an 11-state machine and `LEGAL_TRANSITIONS`; `QueueRunner` drains a **flat priority-then-created queue** into free slots; concurrency bounded by `QueueSlotTracker` (`agentBoardQueueCap`) **and** free chat tabs. `TaskRunCoordinator` validates+wires; `RunSession` owns one run's lifecycle (heartbeat 30s, stale 5 min, debounced ledger, inline `<claudian_*>` block protocol). Crash recovery via sidecar `heartbeat.json` stamped with a per-load `runtimeId`; ledger snapshotted to the note at terminal then GC'd. Human-in-the-loop via `needs_input`/`needs_approval`/`review` gates.
- **MCP:** `McpServerManager` with per-server enable + **context-saving** (only inject when `@`-mentioned) + secret resolution from keychain + stdio env curation.
- **Plugins ("the plugins approach"):** `PluginManager` discovers **Claude Code** plugins from `~/.claude/plugins/installed_plugins.json`, reconciles enabled state with `.claude/settings.json` (project overrides global), and scans `{installPath}/agents/*.md` into the agent catalog (namespaced `plugin:agent`). **No proprietary plugin API, no marketplace, no MCP/command contributions from plugins, no dynamic load (restart to refresh).**
- **Skills/commands:** `ProviderCommandCatalog` per provider; vault skills/commands from `.claude/commands`, `.claude/skills`, `.codex/skills`, `.agents/skills`; `VaultSkillAggregator` with 3-layer freshness (TTL cache + disk index + EventBus invalidation).
- **Persistence:** session meta (`.claudian/sessions/*.meta.json`), conversation state (opaque `providerState`), native transcripts under `~/.claude` & `~/.codex`, run sidecars under `.claudian/runs/`. **No semantic/shared memory store.**
- **Events:** typed, synchronous, error-isolated `EventBus`; used for UI/telemetry only (runs do not subscribe).

---

## 4. The core comparison: orchestration models

This is where the two products are most different, and where the most interesting adoption decisions live.

| Dimension | Ruflo | Claudian Agent Board |
|---|---|---|
| Unit of work | Agent in a swarm | Work order = one chat-tab run |
| Topology | Queen → workers; hierarchical/mesh/ring/star/adaptive | **Flat queue → N independent workers** |
| Sequencing | Implicit via queen + GOAP planner; work-stealing | **None** — no `depends_on`, no DAG, no fan-in/out |
| Inter-agent comms | `SendMessage`, broadcast, shared `memory set`, consensus | **None** — runs share only coordination primitives (slot tracker, control state), never data |
| Coordinator | A real **queen agent** | `TaskRunCoordinator`/`QueueRunner` are *wiring/scheduling objects*, not agents |
| Role specialization | 45 typed agent roles | **None** at board level (one top-level agent per run) |
| Consensus/voting | BFT/Raft/CRDT/quorum | **None** |
| Result passing | Automatic (queen aggregates) | **Manual** — human reads handoff/ledger, creates/​reworks a card |
| Recovery | daemon, peer state machine | **Strong** — sidecar heartbeat + `runtimeId` orphan detection, stale sweep, ledger snapshot |
| Human gating | `claims` authorization, HITL | **Strong** — `needs_input`/`needs_approval`/`review`, session starts paused |
| Persistence substrate | SQLite + vector DB | **Markdown + JSONL in the vault** (git-friendly, Obsidian-native) |

**Read of the gap.** Claudian's run *lifecycle* is arguably more robust than ruflo's for a single-user, durability-critical setting: crash recovery, stale detection, human gates, and an auditable ledger snapshotted into a note are first-class. What Claudian lacks is everything *above* a single run: a task graph, role specialization, automatic result-passing, and shared memory. Ruflo is the inverse — strong on the swarm layer, lighter on the per-run durability/legibility that matters in a notes vault.

**The Agent Board's three highest-leverage seams** (from the deep dive) are exactly where ruflo-style capability would attach:
1. `execution/selectNextEligibleTask.ts` — the single chokepoint for *which task runs next*. A `dependenciesSatisfied(task)` predicate here turns the flat queue into a DAG scheduler with minimal blast radius.
2. `execution/TaskExecutionSurface.ts` — swap the chat-tab surface for a headless/parallel surface or a coordinator that spawns sub-runs.
3. `execution/ClaudianBlockParser.ts` + `ProviderStreamAdapter` — new inline blocks (`<claudian_spawn>`, `<claudian_message>`) are where dynamic spawning / agent-to-agent messaging would surface from the model.

A shared **blackboard** and a **graph-capable data model** (`depends_on?: string[]` in `TaskFrontmatter` + a `blocked` state) are the net-new substrate a swarm would require.

---

## 5. Feature-adoption candidates — ranked by fit

Each candidate is scored on **value** (to Claudian users) and **fit** (with Claudian's Obsidian-native, provider-neutral, human-legible identity). Ordered by adopt-priority.

### Tier 1 — Adopt (high value, high fit, builds on existing seams)

**1.1 — Work-order dependencies / lightweight DAG.**
Ruflo's biggest structural advantage is sequencing. Claudian can get 80% of the value with a tiny, Obsidian-idiomatic change: add `depends_on: [taskId]` to `TaskFrontmatter` (storing **stable work-order IDs** as the source of truth) and a `dependenciesSatisfied` predicate in `selectNextEligibleTask`. Blockedness stays **derived** in that predicate — *no new `blocked` lifecycle state* — so a dependency change never churns note status writes (see §10.1 for why). The IDs can still render as wikilinks in the note body for the graph view. This unlocks fan-out/fan-in pipelines (research → implement → review → commit) without any swarm machinery.
*Fit: excellent. Value: high. Effort: medium. Seam: #1 (selection chokepoint). Full design: §10.1.*

**1.2 — Persistent shared memory / "pattern" store (scoped, vault-native).**
Ruflo's ReasoningBank/AgentDB is its self-learning engine. Claudian doesn't need HNSW or neural distillation, but a **shared, queryable memory** that runs can read/write — even a structured Markdown/JSON store under `.claudian/memory/` — would let one run's findings reach another. Start non-semantic (tags + frontmatter), optionally add embeddings later. This is also the substrate that makes 1.1's pipelines actually share results instead of re-deriving them. **Injection-path caveat:** to be genuinely provider-neutral the read/write surface cannot be an MCP server — only Claude sets `supportsMcpTools: true` (`src/providers/claude/capabilities.ts`); Codex, Opencode, and Cursor all set it `false`. The portable path is a **`@memory` mention / prompt-context injection** that every provider can consume; MCP exposure can be an additive Claude-only optimization layered on top.
*Fit: good (Obsidian is literally a memory tool). Value: high. Effort: medium-high. Seam: net-new store + prompt-context injection (not MCP, for cross-provider reach).*

**1.3 — Cost / usage observability surfaced like ruflo's `cost-tracker`.**
Ruflo packages cost into a first-class observability plugin with a budget circuit breaker. Claudian could surface per-work-order and per-pipeline cost rollups on the Agent Board, plus a cost cap that pauses the queue. **Caveat on effort:** the two existing usage subsystems are distinct and neither is a cost ledger yet. `.claudian/usage.json` / `UsageEventMap` (`src/core/usage/`) is a *per-entry invocation counter for quick-actions and skills* (`kind`/`name`/`providerId`, count/lastUsedAt) — no tokens or dollars. Token/cost data lives separately as per-conversation `UsageInfo` (`src/core/providers/usage/`), where `costUsd` is only populated when a provider emits it and is **not persisted as a roll-up-able ledger**. So this item requires building a persisted, per-work-order cost ledger (capturing `UsageInfo`/`costUsd` per run) before any cap or rollup is possible — not merely surfacing existing data.
*Fit: excellent. Value: medium-high. Effort: medium (needs a new cost-ledger substrate; `costUsd` is provider-dependent).*

### Tier 2 — Adopt selectively (real value, needs scoping to fit)

**2.1 — Role specialization via templates → a "team" of agents.**
Ruflo's 45 typed agents (planner/coder/reviewer/security/docs) are mostly **prompt + tool-scope presets**. Claudian already has vault agents (`.claude/agents/*.md`) and work-order templates. The adoptable idea is a curated **agent role library** (review-bot, test-writer, doc-writer, security-auditor) shipped as templates/agents, plus the ability for a DAG pipeline (1.1) to assign a different role per stage. This is "swarm roles" without a queen — sequential specialists, human-gated.
*Fit: good. Value: high. Effort: medium (mostly content + template wiring).*

**2.2 — SPARC-style gated methodology as a work-order template chain.**
`ruflo-sparc` (Spec→Pseudocode→Architecture→Refinement→Completion with gates) maps almost 1:1 onto a Claudian DAG of work orders with `review` gates between phases. Ship it as a preset template chain that auto-creates linked work orders. Pure composition of 1.1 + 2.1; no new engine.
*Fit: good. Value: medium-high. Effort: low-medium (depends on 1.1).*

**2.3 — Plugin-marketplace surface for the existing "plugins approach."**
The deep-dive (§10.4) corrected the framing here: the Claude Agent SDK **already loads enabled plugins' commands, skills, MCP servers, and agents** at the agent level (Claudian passes `settingSources`/`cwd`; the SDK reads `~/.claude/plugins/` + `enabledPlugins` itself). So plugin commands/skills already appear in the `/` dropdown via `supportedCommands()`, plugin MCP tools already execute, and plugin agents already surface in `@`-mentions. Claudian also already ships the enable/disable panel (`PluginSettingsManager`). The *real* remaining gaps are therefore **observability and discovery**, not agent plumbing: (a) **provenance** — plugin commands render as anonymous `sdk:` entries with no "which plugin shipped this" badge; (b) a **cold-start gap** — plugin commands vanish from the dropdown when no runtime is active; (c) a read-only **plugin-MCP inventory** so users can see SDK-launched plugin servers; and (d) an in-app **install/discover UX** that shells out to the `claude plugin` CLI. This deepens the plugins approach the user asked about, staying within the Claude Code plugin ecosystem — host, don't fork.
*Fit: good (it's the user's stated angle). Value: medium-high. Effort: medium (skewed to UI/observability, not plumbing). Risk: never route plugin MCP into `.claude/mcp.json` — the SDK already runs them; doing so double-launches.*

**2.4 — Secret-aware, model-aware routing (a tiny bandit, not SONA).**
Ruflo's Thompson-sampling model bandit and three-tier ($0 codemod → Haiku → Sonnet/Opus) routing is overkill, but the *idea* — pick a cheaper model for trivial work orders — is sound. A simple heuristic ("priority 3 / short objective → Haiku tier") on the Agent Board's default-model resolver captures most of the cost win without ML.
*Fit: ok. Value: medium. Effort: low-medium.*

### Tier 3 — Watch / partial (interesting, weaker fit for a vault plugin)

**3.1 — Background workers / daemon.** Ruflo's 12 auto-triggered workers (test-gap detection, audit, optimize) are powerful but assume an always-on daemon. Obsidian plugins are session-bound; the closest fit is **scheduled work orders** (cron-like triggers that enqueue a card when the vault is open). Worth a small experiment, not a port.

**3.2 — Witness verification / supply-chain integrity.** Ed25519-signed install verification is excellent engineering hygiene for a CLI distributed via npm. Less relevant for an Obsidian plugin shipped through the community store, though the *concept* (verify plugin integrity) could inform release tooling.

**3.3 — Observability/telemetry export.** Ruflo's `observability` plugin exports metrics. Claudian's `EventBus` + ledger could feed an optional export (e.g., a dashboard note or OpenTelemetry), but only if users ask.

### Tier 4 — Do NOT adopt (misaligned with Claudian's identity)

- **Queen-led hive-mind + BFT/Raft/CRDT consensus.** Massive complexity for a single-user vault with no Byzantine actors. Claudian's human-in-the-loop *is* its consensus.
- **Agent Federation ("Slack for agents", mTLS, cross-machine).** Out of scope: Claudian runs in one Obsidian instance on one machine; federation solves a problem Claudian doesn't have.
- **SONA / EWC++ / MoE neural self-learning.** Enormous surface, opaque behavior, and at odds with Claudian's "provider-native first, legible to the user" principle. The provider models already do the reasoning.
- **IPFS pattern marketplace.** Distribution mechanism with privacy and trust costs that don't fit a personal-vault tool.
- **Self-hosted web UI with embedded MongoDB/Docker.** Claudian *is* the UI (Obsidian). Adding a server contradicts the embedded model.
- **Mass agent scale ("100+ agents").** Claudian's value is a few legible, recoverable runs, not throughput. The concurrency cap is a feature, not a limitation.

---

## 6. The "plugins approach" — how ruflo fits Claudian's model

The user asked specifically what fits Claudian's *plugins approach*. Two distinct readings, both relevant:

**(a) Claudian's provider/plugin extensibility (internal).** Claudian's `ProviderRegistry` + `ProviderWorkspaceRegistry` + capability flags are a strong, real plug-in architecture. The ruflo features that fit this seam are the ones expressible as **provider-neutral capabilities or auxiliary services**: dependency scheduling (board-level, provider-agnostic), shared memory (injected via prompt context / a `@memory` mention so non-Claude providers reach it — *not* MCP, which only Claude supports), cost routing (a model-resolver policy). These respect the boundary — they don't leak ruflo's Claude-specific swarm assumptions across providers.

**(b) Claude Code plugins (external ecosystem).** Because the Claude Agent SDK already loads enabled plugins' commands/skills/MCP/agents (§10.4), the agent-side interop for *plugin-bundled* contributions is **already live**: a user who runs `claude plugin marketplace add ruvnet/ruflo` and installs the `ruflo-*` plugins gets ruflo's slash commands in Claudian's `/` dropdown and its subagents in `@`-mentions today. **Caveat on MCP (don't overstate it):** ruflo's *plugin* path does **not** register ruflo's MCP server — per ruflo's README, the swarm/memory MCP tools (`memory_store`, `swarm_init`, …) come from the **separate CLI/MCP setup** (`claude mcp add ruflo …` / `npx ruflo init`, "Path B"), not from a marketplace add. So a marketplace add alone yields commands/skills/agents, not ruflo's MCP tools; those require the user to register the MCP server (which Claudian could then surface). The highest-fit ruflo adoption *for the plugins angle specifically* is therefore **2.3** scoped to *legibility and reach*: provenance badges on plugin commands, a cold-start scan so they show without a live runtime, a read-only plugin-MCP inventory panel, and an in-app install flow that shells the `claude plugin` CLI. This is the cleanest interoperability story: **don't reimplement ruflo, render it.** Claudian becomes a great GUI for Claude Code plugins (including ruflo's), inside the vault.

> **Strategic note:** This reframes ruflo from "competitor to out-feature" to "ecosystem Claudian can host." Claudian's differentiator — Obsidian-native legibility, human gating, crash-recoverable runs — is orthogonal to ruflo's swarm engine. The strongest move is to make Claudian the **best place to run and observe Claude Code plugins (ruflo included) from a vault**, while adding the small set of orchestration primitives (DAG + shared memory) that make multi-step work first-class.

---

## 7. Recommended roadmap

A staged path that compounds — each tier enables the next.

1. **Foundation (Tier 1).** Add `depends_on` + `blocked` state + dependency predicate (1.1). Add a vault-native shared memory store exposed via MCP (1.2). Surface per-work-order cost + a queue cost cap (1.3).
2. **Composition (Tier 2).** Ship a curated agent-role library and let DAG stages assign roles (2.1). Ship a SPARC-style template chain on top (2.2). Build the plugin enable/disable + commands/skills/MCP surfacing panel (2.3). Add heuristic model routing (2.4).
3. **Polish (Tier 3, on demand).** Scheduled/triggered work orders (3.1), optional observability export (3.3).

Everything in Tiers 1–2 is achievable through the three identified seams plus modest data-model and content work. None requires a queen, consensus, neural learning, or a server.

---

## 8. Open questions for the maintainer

1. **Dependency UX:** should work-order dependencies be authored as wikilinks in the note body (graph-view-native) or as a `depends_on` frontmatter array (machine-clean)? (Recommendation: frontmatter as source of truth, render as links.)
2. **Shared memory scope:** vault-wide, per-board, or per-pipeline? Semantic (embeddings) from day one, or start with tag/frontmatter retrieval?
3. **Plugins surface:** is the goal to consume more of the Claude Code plugin ecosystem (incl. ruflo's plugins), or to define a Claudian-specific plugin format? (Recommendation: stay Claude-Code-compatible; host, don't fork.)
4. **Multi-provider parity:** dependencies/memory/cost are provider-neutral and belong at the board/core layer — confirm they should *not* be Claude-only.
5. **Concurrency philosophy:** keep the hard cap (legibility) or allow opt-in higher parallelism for pipeline fan-out?

---

## 9. Appendix — capability matrix (condensed)

| Capability | Ruflo | Claudian | Adopt? |
|---|:---:|:---:|---|
| Multi-provider chat | ✅ routed | ✅ registry | — (Claudian already strong) |
| Streaming/cancel/resume/fork/rewind | ✅ | ✅ | — |
| Plan mode + HITL gates | partial | ✅ strong | — |
| Autonomous task runner | ✅ | ✅ | — |
| Crash recovery / heartbeat | daemon | ✅ sidecar+runtimeId | — (Claudian strong) |
| Task DAG / dependencies | ✅ | ❌ | **Tier 1** |
| Inter-agent shared memory | ✅ AgentDB/ReasoningBank | ❌ | **Tier 1** (scoped) |
| Cost tracking + budget cap | ✅ | ❌ (invocation counter only; no cost ledger) | **Tier 1** |
| Role-specialized agents | ✅ 45 | ❌ board-level | **Tier 2** |
| Gated methodology (SPARC) | ✅ | ❌ | **Tier 2** (as template chain) |
| Plugin marketplace / surfacing | ✅ 33 | SDK already loads plugin commands/skills/MCP/agents + toggle UI; gaps are provenance, cold-start, MCP inventory, install UX | **Tier 2** (deepen — observability + install UX) |
| Model-tier routing | ✅ bandit | ❌ | **Tier 2** (heuristic) |
| Background workers / daemon | ✅ | ❌ | Tier 3 (scheduled WOs) |
| Queen/hive-mind + consensus | ✅ | ❌ | **No** |
| Agent federation (cross-machine) | ✅ | ❌ | **No** |
| Neural self-learning (SONA/EWC++) | ✅ | ❌ | **No** |
| IPFS pattern marketplace | ✅ | ❌ | **No** |
| Self-hosted web UI + DB | ✅ beta | ❌ (is Obsidian) | **No** |

---

## 10. Worth deepening — implementation-ready design deep-dives

A second wave of dedicated subagents turned the top adoption candidates into concrete, codebase-grounded designs (each read-only, no code changed). The value of this pass is as much in the **corrections** it surfaced as in the designs: several of §5's assumptions were too optimistic once the code was read. Each subsection below is a distilled, implementation-ready sketch — seam, design, effort, the gotchas that bite, and open questions. Full per-design notes can be regenerated from these prompts.

> **Cross-cutting correction:** more capability already exists than §5 assumed. The Claude SDK already loads plugin contributions (§10.4); `core/context/` is still only a spec, not wired (§10.2); and three of four providers emit no cost at all (§10.3). The designs are scoped to *what the code actually is today*, not the headline.

### 10.1 Work-order dependencies / lightweight DAG (deepens Tier 1.1)

- **Seam:** `src/features/tasks/execution/selectNextEligibleTask.ts` — the single chokepoint for "which task runs next." Blast radius is almost entirely here + `taskTypes.ts`.
- **Data model:** add one optional field `depends_on?: string[]` to `TaskFrontmatter`, holding **work-order IDs** (not wikilinks/paths — IDs are stable across rename/archive and already the join key everywhere). `schema_version` stays `1`; the field is absent on every existing note, so **no migration**. Reader/writer already round-trip unknown frontmatter losslessly; reuse `utils/frontmatter` `extractStringArray` to normalize.
- **State machine: do *not* add a `blocked` status.** Blockedness is a *derived* property of the graph, not a run lifecycle state. Gate purely in the selection predicate — a blocked card stays `ready` and is filtered out until its deps are `done`. This avoids the note-write churn a real `blocked` state would force (every dep change would rewrite status — exactly what the sidecar split was designed to avoid). Unblocking is then automatic and free: the dep completing fires `task:status-changed` → `QueueRunner.tick()` → re-select (existing wiring, **already sufficient**).
- **Gating:** add `dependenciesSatisfied(task)` to `EligibilityPredicates` and call it **inside `taskIneligibilityReason`** (not just in `selectNextEligibleTask`). This matters: `QueueRunner.runAcquired()` reloads the note and re-runs `taskIneligibilityReason(fresh, …)` as a pre-launch re-check immediately before starting the run — today that only covers provider/model, so a task whose dependency was edited/reworked *between selection and launch* would still run unless the dependency check lives in the shared `taskIneligibilityReason`. Putting it there closes that race (and the predicate must read the **live** `getTasks()` so the reloaded dep statuses are current). The pure core `dependencyBlockReason(task, byId)` returns `null` when all deps are `done` else `"blocked by 'X' (running)"`. Fan-in = AND over all deps; fan-out falls out for free. Recommend **only `done` satisfies** (preserves the human review gate); `failed`/`canceled` upstream permanently block downstream (safe default). The reason embeds the blocker's status so the existing skip-chip updates as the blocker advances.
- **Cycle detection:** `detectCycles(tasks)` (DFS) at index time in `TaskIndexer`; annotate members with a stable "dependency cycle" reason rather than hiding them. Safe even if skipped (only `done` satisfies, so a cycle just never resolves) — but **mandatory** if transitive satisfaction is ever added.
- **UX:** author in frontmatter; render deps as wikilinks → Obsidian graph view shows the DAG for free; a "depends on N / blocked" badge on the card. No new lane.
- **Effort:** medium-small (~1–2 days core + ~1 day UX). New file `execution/dependencyGraph.ts`. **Open Qs:** does `review` also unblock (recommend no); soft-skip on `canceled` upstream?; direct vs transitive (recommend direct).

### 10.2 Provider-neutral shared memory (deepens Tier 1.2)

- **Grounding correction:** `core/context/` (`buildContextEnvelope`, `ContextEnvelope`) is a *planned spec*, not live — the design cannot depend on it. The real provider-neutral seam **today** is `ChatTurnRequest.text`, which every provider encoder builds from, and which **is** the rendered task prompt for Agent Board runs. So appending a memory section in `TaskPromptRenderer.renderTaskPrompt` reaches all four providers with no MCP.
- **Storage:** vault-native frontmatter-tagged Markdown under `.claudian/memory/` (one note per entry: `type: claudian-memory`, `scope`, `tags`, `source_run_id`, body). Graph-visible, diffable, human-editable — the whole reason to do this in Obsidian rather than a CLI. New `src/core/memory/{memoryTypes,MemoryStore}.ts` mirroring `RunSidecarStore`.
- **Write path:** (a) a new non-pausing `<claudian_memory>` block added to `ClaudianBlockParser` (`'memory'` kind + `REQUIRED_FIELDS`/`KNOWN_FIELDS`), dispatched in `RunSession` like `progress`; **plus** (b) automatic capture from the existing `TaskHandoffParser` summary at terminal, so even providers that never emit a block leave a trail. Not a tool — a tool would be Claude-only (`supportsMcpTools`).
- **Read/inject:** resolve entries via `MemoryStore.query({scope, tags})` and inject a `## Relevant Memory` section in `renderTaskPrompt` (reaches all providers); an `@memory` chat mention modeled on the `@mcp` string-rewrite (`transformMentions`), not a capability-gated tool. Apply `escapeClaudianMarkers` to injected bodies (anti-impersonation).
- **Retrieval:** start non-semantic (scope hard-filter + tag intersection + keyword + recency); optional later embeddings attach behind the same `query` signature (mirrors ruflo's ReasoningBank shape without HNSW/distillation).
- **Scope:** default **board** (the existing implicit folder grouping); `vault` opt-in; `pipeline` becomes meaningful once the DAG lands. **This is the substrate that makes 10.1's pipelines actually share results** — resolve a dependent's memory from `source_task_id ∈ depends_on`.
- **Effort:** medium. **Risks:** prompt bloat (cap + token budget), scope leakage (hard-filter + tests), protocol impersonation (escape). **Open Qs:** Markdown vs JSONL; `.claudian/` is graph-hidden by default (visible folder if graph-visibility wanted); auto-capture default-on?

### 10.3 Per-work-order cost ledger + queue budget cap (deepens Tier 1.3)

- **Grounding correction (the big one):** only **Opencode** emits `costUsd` on the wire. **Claude, Codex, Cursor emit tokens only** — and **Claude has no `getModelPricing` at all**, Codex's catalog has no pricing populated. The run-side stream bridge also currently **drops the `usage` chunk** (`ChatTabStreamAdapter` `default: break`). So Tier 1.3 needs three net-new pieces: usage capture, a token→cost derivation layer, and persistence+cap.
- **Capture:** add `onUsage?(usage: UsageInfo)` to `StreamHandlers`; handle the `'usage'` case in `ChatTabStreamAdapter` instead of dropping it; accumulate in `RunSession` (accumulate on *cost*, take per-turn max within a turn, sum across turns — token semantics differ delta-vs-snapshot per provider).
- **Derivation:** new `src/core/providers/usage/resolveTurnCost.ts` — passthrough `costUsd` when present (`source: 'provider'`), else derive `tokens × getModelPricing` (`source: 'derived'`), else `'unavailable'`. **The single highest-leverage provider change is adding a Claude pricing table** (`ClaudeChatUIConfig.getModelPricing`: Opus 4.8 $5/$25, Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5 per 1M, cache-aware) — without it the default provider shows no cost.
- **Persistence:** `.claudian/runs/<id>/cost.json` (`RunCostRecord`) via `RunSidecarStore`, snapshotted to `TaskFrontmatter` (`cost_usd`, `cost_source`, `tokens_in/out`) at terminal so it survives sidecar GC and is git-visible. Board roll-up = pure sum over indexed `TaskSpec`s (per lane / per pipeline once DAG lands).
- **Cap:** add `accumulatedCostUsd` to the shared `QueueControlState`; in `QueueRunner.onSettle` (same seam as auto-halt-after-failures) call `setHalted("budget cap reached …")` when the threshold is crossed — reuses the existing halt banner + "Start queue" resume verbatim. Global session cap (matches the shared control model); post-hoc circuit-breaker (in-flight runs finish). New setting `agentBoardBudgetCapUsd` (0 = off).
- **Effort:** medium, skewed to the provider pricing tables. **Risks:** provider cost gaps (ship Claude+Opencode real, Codex/Cursor `unavailable` honestly with a `~` estimate marker), pricing drift (centralize + date-comment), `costUsd:0` ≠ unavailable (explicit `cost_source` enum). **Open Qs:** does resume reset the budget window; per-session vs persisted; live `task:cost-updated` event vs terminal-only.

### 10.4 Deepen Claude Code plugin integration (deepens Tier 2.3)

- **Grounding correction (reframes the task):** the Claude Agent SDK **already loads enabled plugins' commands, skills, MCP servers, and agents** — Claudian passes `settingSources`/`cwd` and the SDK reads `~/.claude/plugins/` + `enabledPlugins` itself (Claudian only tracks `pluginsKey` for restart detection). So plugin slash commands/skills are *already* in the `/` dropdown via `supportedCommands()`, MCP servers a plugin *bundles* (its own `.mcp.json`) *already* execute, and plugin agents *already* appear in `@`-mentions. (Plugins that register MCP out-of-band rather than bundling it — like ruflo, §6b — are the exception: their MCP isn't loaded by the plugin path.) Tier 2.3 is therefore **observability + discovery, not agent plumbing.**
- **Commands/skills:** the gaps are (a) **provenance** — SDK commands flatten to anonymous `sdk:` entries; add a `'plugin'` `ProviderCommandScope` + `pluginName` and parse the `plugin:command` namespace for a dropdown badge; (b) a **cold-start scan** (`PluginContributionScanner`, manifest-aware: honor `plugin.json` `commands`/`skills` path overrides) as a catalog fallback so plugin commands show even with no live runtime. SDK list stays the source of truth; scan only fills the cold-start hole (dedup by namespaced id).
- **MCP — the trap to avoid:** do **not** import plugin `.mcp.json` into `.claude/mcp.json`/`McpServerManager` — the SDK already runs them, so re-hosting **double-launches**, corrupts the dual-namespace, and breaks `${CLAUDE_PLUGIN_ROOT}` substitution. Instead ship a **read-only inventory panel** listing SDK-launched plugin servers (show `${CLAUDE_PLUGIN_ROOT}` literally). Note honestly: context-saving can't apply (plugin MCP is always-on while the plugin is enabled).
- **Install/discover UX:** **host, don't fork** — shell out to the resolved `claude plugin install/uninstall/update`, `plugin list --json --available`, `marketplace add` (reuse the existing CLI-path + custom-spawn machinery), behind an explicit confirm modal (arbitrary marketplace code). Graceful copy-the-command fallback when the CLI is absent/old.
- **Dynamic load:** not worth it — the SDK exposes no `reloadPlugins()` on `Query`, so a toggle still needs a runtime restart (already implemented and history-preserving). Only extend the *UI-side* refresh (commands/agents) post-toggle.
- **Interop dividend:** the ruflo *commands/skills/agents* interop is **already free** once a user installs the `ruflo-*` plugins; this work just makes it legible (provenance badge) and one-click (install flow). **Note:** ruflo's MCP tools (`memory_store`, `swarm_init`, …) are **not** part of its plugin path — they require the separate `claude mcp add ruflo` / CLI setup (see §6b). The read-only MCP inventory panel only surfaces MCP servers that are actually registered (plugin-bundled `.mcp.json` *or* user-registered), so it won't falsely advertise ruflo's swarm tools from a marketplace add alone. **Effort:** medium, UI-weighted. **Open Qs:** dedicated `'plugin'` scope vs metadata-only; subprocess install vs deep-link only.

### 10.5 Agent-role library + SPARC gated template chain (deepens Tier 2.1 / 2.2)

- **Grounding correction:** there is **no portable on-disk agent format** — `AgentDefinition` is Claude-shaped, and Codex (`.toml`), Opencode (boolean-record `tools`), and Cursor (no vault store) all diverge. A role library that wrote provider-native agent files would need 3 serializers and drift. The portable unit must be **Claudian-owned and rendered into the prompt**, not written into provider agent stores.
- **Role library:** new provider-neutral `RoleDefinition` (`id`, `name`, `systemAddendum` — the load-bearing portable field, `toolScope?` advisory-everywhere/enforced-on-Claude, `recommendedModel.tier`). Ship `BUILTIN_ROLES` in code (mirrors `PRESET_TEMPLATES`) + optional `.claudian/roles/*.md` vault overrides — **not** `.claude/agents/` (that's the Claude-only mention path). Starter set: planner, architect, coder, test-writer, reviewer, security-auditor, doc-writer, refactorer.
- **Injection seam:** `renderTaskPrompt` — append `## Role: {name}` + `systemAddendum`; resolve `tier → model` via a helper beside `defaultModelResolver` (only as a default; template model still wins). Tool-scope enforced on Claude, rendered as prose for the others (mirrors the `supportsMcpTools` asymmetry).
- **Per-stage assignment:** add `role?: string` to `TaskFrontmatter` and `WorkOrderTemplate`; precedence task > template > none.
- **SPARC chain:** a new `claudian-work-order-chain` template declaring ordered stages (Spec→Pseudocode→Architecture→Refinement→Completion), each with a role + a `review` gate. `createWorkOrderChain` auto-creates N linked work orders with `depends_on` edges (Tier 1.1) and a shared `chain_id`. **The gate *is* the existing `review`→`done`/`needs_fix` transition — no new gate primitive.** Carry prior-phase context forward by reading upstream notes' handoff regions via `TaskHandoffParser` into a `## Upstream Handoffs` prompt section (the chain's human-legible data-passing channel; 10.2 memory generalizes it).
- **Effort:** medium, content+wiring heavy, no new engine. Depends on 10.1. **Risks:** tool-scope unenforceable off Claude (document), prompt bloat from upstream handoffs (direct deps only + cap), mid-chain failure leaves successors blocked (surface chain grouping). **Open Qs:** `.claudian/roles/` confirmed; tool-scope enforced vs advisory in v1; TDD fan-out (test-writer + coder) in Refinement now or later.

### 10.6 Suggested sequencing of the deep-dives

1. **10.1 DAG** first — it's the smallest-blast-radius foundation and 10.2/10.5 build on `depends_on`.
2. **10.2 shared memory** alongside/just after — turns the DAG from "sequenced" into "result-passing."
3. **10.3 cost ledger** in parallel (independent), but bundle the **Claude pricing table** into the same slice or the feature is empty for the default provider.
4. **10.5 role library + SPARC** once 10.1 lands — pure composition, high demo value.
5. **10.4 plugin observability/install** independent of the above; smallest agent-side change because the SDK already does the heavy lifting.

---

*Method note: counts and claims about ruflo are taken from its audited `STATUS.md`/`USERGUIDE.md` where they conflict with README marketing (e.g., ~45 agents not "100+", ~323 MCP tools, ~17 hooks not "27"). Claudian claims — including §10's design deep-dives — are grounded in the codebase (`src/features/tasks/`, `src/core/providers/`, `src/providers/claude/`) via dedicated read-only subagent passes; §10 corrects three §5 assumptions (SDK already loads plugins; `core/context/` is unbuilt; only Opencode emits cost).*
