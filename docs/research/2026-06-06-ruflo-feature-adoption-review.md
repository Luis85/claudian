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
Ruflo's biggest structural advantage is sequencing. Claudian can get 80% of the value with a tiny, Obsidian-idiomatic change: add `depends_on: [taskId]` to `TaskFrontmatter`, a `blocked` state in `taskStateMachine.ts`, and a `dependenciesSatisfied` predicate in `selectNextEligibleTask`. Because work orders are notes, dependencies are just wikilinks — they render in the graph view for free. This unlocks fan-out/fan-in pipelines (research → implement → review → commit) without any swarm machinery.
*Fit: excellent. Value: high. Effort: medium. Seam: #1 (selection chokepoint).*

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
Today Claudian already *reads* Claude Code plugins and already ships an enable/disable panel: `PluginSettingsManager` (`src/providers/claude/ui/PluginSettingsManager.ts`), mounted by `ClaudeSettingsTab`, lists project/user plugins, refreshes, and toggles each via the dual-write enabled-state path. What it does **not** do is (a) provide a **discovery/install UX** (ruflo's `/plugin marketplace add` + plugin creator), and (b) consume **non-agent** plugin contributions — today only `agents/*.md` are scanned, so plugin-contributed **commands, skills, and MCP servers** are ignored. Those two gaps are the real Tier 2 work; the toggle panel is done. This deepens the plugins approach the user specifically asked about, staying within the Claude Code plugin ecosystem rather than inventing a proprietary one.
*Fit: good (it's the user's stated angle). Value: medium-high. Effort: medium. Risk: keep it CC-compatible, don't fork the format.*

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

**(b) Claude Code plugins (external ecosystem).** Claudian already consumes Claude Code plugins (agents only) and already exposes an enable/disable panel (`PluginSettingsManager`). The highest-fit ruflo adoption *for the plugins angle specifically* is **2.3**: deepen consumption from "read agents" to "read agents + commands + skills + MCP," and add a discovery/install UX on top of the existing toggle panel. Crucially, ruflo itself ships **as Claude Code plugins** (`/plugin marketplace add ruvnet/ruflo`) — so a Claudian user who installs ruflo's plugins would benefit directly if Claudian surfaced plugin-contributed commands/MCP. This is the cleanest interoperability story: **don't reimplement ruflo, render it.** Claudian becomes a great GUI for Claude Code plugins (including ruflo's), inside the vault.

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
| Plugin marketplace / surfacing | ✅ 33 | reads CC plugin agents + toggle UI (no install UX, no commands/skills/MCP) | **Tier 2** (deepen) |
| Model-tier routing | ✅ bandit | ❌ | **Tier 2** (heuristic) |
| Background workers / daemon | ✅ | ❌ | Tier 3 (scheduled WOs) |
| Queen/hive-mind + consensus | ✅ | ❌ | **No** |
| Agent federation (cross-machine) | ✅ | ❌ | **No** |
| Neural self-learning (SONA/EWC++) | ✅ | ❌ | **No** |
| IPFS pattern marketplace | ✅ | ❌ | **No** |
| Self-hosted web UI + DB | ✅ beta | ❌ (is Obsidian) | **No** |

---

*Method note: counts and claims about ruflo are taken from its audited `STATUS.md`/`USERGUIDE.md` where they conflict with README marketing (e.g., ~45 agents not "100+", ~323 MCP tools, ~17 hooks not "27"). Claudian claims are grounded in the codebase (`src/features/tasks/`, `src/core/providers/`, `src/providers/claude/plugins/`).*
