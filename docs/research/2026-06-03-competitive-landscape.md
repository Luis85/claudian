---
title: Competitive Landscape — embedded coding-agent plugins for Obsidian
date: 2026-06-03
status: research
scope: market/competitive (embedded agent runtimes, RAG copilots, vault-as-MCP bridges, adjacent IDE agents)
method: dedicated deep web-research pass (60+ source fetches — GitHub repos, community store/obsidianstats listings, official sites, changelogs, pricing pages, forum threads), June 2026
related:
  - "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]]"
  - "[[docs/ideas/2026-05-28-plugin-improvement-research-proposal.md]]"
  - "[[docs/ideas/2026-05-28-standalone-product-vision.md]]"
---

# Competitive Landscape — June 2026

Follow-up deep-dive to the market section of the 2026-06-03 improvement proposal. Where that proposal
established *that* the category commoditized, this note maps *who*, with momentum, pricing, and a
feature-parity matrix, and turns it into threat-ranked strategy.

> **Identity caveat (read first).** This note is for the **`Luis85/claudian`** fork. Public GitHub/star
> metrics below were collected against the **upstream `YishenTu/claudian`** repo (the canonical public
> listing) and are point-in-time (2026-06-03); treat them as category signal, not this fork's own numbers.
> The **feature claims for Claudian** (four providers incl. Cursor, plan mode, rewind, subagents, MCP
> management, Agent Board, inline edit) are verified against *this repo's* `CLAUDE.md`/code, not inferred.
> See also the unresolved upstream/fork naming defect in
> [[docs/issues/resolve-fork-naming-mismatch.md]].

## Executive summary

The "embedded coding-agent runtime inside Obsidian" category went from nonexistent to crowded in ~9 months
(Sept 2025 → June 2026), driven by Zed's open **Agent Client Protocol (ACP)** becoming the de-facto bridge
and by Claude Code / Codex / Gemini CLI exposing stable CLI/SDK surfaces. By raw momentum Claudian (upstream)
leads the category (~12.3K★ in ~6 months), but it is **not** the most-installed: that is logancyang's
**Copilot** (~1.43M downloads), whose v4 "bring your own agent" pivot makes it **the single most dangerous
rival** — it pairs the agent-runtime story with a proven freemium revenue engine. The defensible space is
**breadth and depth of provider-native features simultaneously** — plan mode + rewind + subagents + MCP
management + a kanban orchestration layer (Agent Board) — which no single rival matches; most are thin
ACP/CLI wrappers (Agent Client, NoClaw, Agentic Copilot) or single-provider terminals (Blackglass, Cortex).
Two market shifts dominate planning: (a) Obsidian's **May 2026 per-version automated plugin review** +
`SecretStorage` API raise the security/quality bar amid an active **PHANTOMPULSE** plugin-abuse campaign
that makes "spawns child processes" a trust liability; (b) single-agent chat is **commoditizing** as
background/async agents, subagents, and MCP become table stakes set by Cursor/Zed/Claude Code.

## Segment 1 — Embedded agent-runtime plugins (direct rivals)

| Competitor | Version / date | Momentum | Architecture | Providers | Pricing | Distribution | Edge / weakness |
|---|---|---|---|---|---|---|---|
| **Claudian** (this fork) | — | upstream ~12.3K★, created Dec 2025 (fastest-growing in category) | Real runtime; provider-native CLI/SDK + ACP | Claude, Codex, OpenCode, **Cursor** | Free, MIT | Community store + GitHub | Deepest feature set (plan, rewind, subagents, MCP mgmt, inline edit, slash/skills, multi-tab fork/resume) **+ Agent Board**; desktop-only; depends on user-installed CLIs; broad surface = QA burden |
| **Copilot** (logancyang/Brevilabs) | v3.3.3, May 2026 | ~7.1K★, **~1.43M downloads** (#1 AI plugin) | Hybrid free RAG/embeddings + Plus agentic backend; **v4 BYO-agent** runs Claude Code/Codex/OpenCode | OpenAI, Anthropic, Gemini, Cohere, OpenRouter, BYO + CLIs | **Free / Plus $14.99-mo ($139.99-yr) / Self-host $349.99 lifetime** | Community store | Massive base + real revenue + RAG *and* agent; **AGPL-3.0** (copyleft); best agent features paywalled; backend touches Brevilabs servers |
| **Agent Client** (RAIT-09) | v0.10.6, May 2026 | ~2.1K★, **~206K downloads** | Pure **ACP** | Claude, Codex, Gemini CLI + custom (OpenCode, Qwen, Kiro, Mistral) | Free, Apache-2.0 | Store + BRAT | Clean ACP multi-session, floating window; thinner depth — no plan/rewind/orchestration |
| **NoClaw** (yungho) | v2.4.8, Jun 2026 | new, very active | **ACP** + persistent agents w/ memory ledgers | Claude, Codex, Gemini, OpenCode, Qwen, Kimi | Free, MIT | **BRAT only** | Memory system, cron jobs, knowledge-graph ingestion, fallback chains; subagent orchestration still "planned"; tiny adoption |
| **Blackglass** (humantorch) | v1.5.1, May 2026 | small | **Real xterm.js PTY terminal** + bundled vault MCP server | Claude Code | Free, MIT | Store | Terminal purists get every CLI feature; single-provider; not knowledge-worker-friendly |
| **Cortex** (ScottKirvan) | beta, Mar 2026 | new | Wraps `claude` binary; side-panel chat | Claude Code (Pro/Max sub, no API key) | Free, MIT | BRAT | "No API key" via sub; safety modes (readonly→full); single-provider, beta |
| **Agentic Copilot** (spencermarx) | v1.5.3, Apr 2026 | ~42★ | Thin `child_process.spawn` orchestration | Claude Code, OpenCode (Gemini planned) | Free, MIT | Store + BRAT | Zero-config auto-detect, inline diffs; very thin; low adoption |
| **Claude IDE** (petersolopov) | v0.2.4, May 2026 | ~77★ | **MCP-over-WebSocket** editor-context bridge | Claude Code (external) | Free, MIT | Store | Zero-dep, localhost-only; read-only context bridge — not an in-app agent |

**Adjacent "no-plugin skill packs"** (steal the same users without a plugin): **kepano/obsidian-skills**
(~34K★ — the Obsidian founder's own agent-skills repo; a major signal), claude-obsidian (~6K★),
obsidian-mind (~2.8K★), obsidian-second-brain (~2.1K★). These run Claude Code *against* the vault folder
from a terminal using `SKILL.md` files — arguing no plugin is needed. *(Note: "Codeian" from prior notes
could not be confirmed as a real plugin — likely a misremembering of "Claudian.")*

## Segment 2 — RAG / writing copilots

| Competitor | Momentum | Architecture | Local models | Notes |
|---|---|---|---|---|
| **Smart Composer** (glowingjade) | ~2.3K★ | RAG (semantic vault index) + one-click edits | **Ollama / OpenAI-compat** | Best OSS RAG-chat; @file/folder/web context; strong local story; single-dev cadence |
| **Copilot** (RAG mode) | (see seg 1) | Lexical + optional embeddings Vault QA | via self-host | Default RAG benchmark |
| **Smart Connections** (brianpetro) | ~5.1K★ | Embeddings chat + related-notes | Local + API | High installs; embeddings-first |
| **Text Generator** (nhaouari) | established | In-editor template generation | Local | Editor-centric, not agentic |
| **Local LLM Helper** (manimohans) | smaller | Text-process + chat + search | **Ollama / LM Studio / vLLM** | Privacy/local niche |

These don't run a real agent runtime — Claudian wins on agency; **they win on local-model privacy and
semantic search, which Claudian lacks.**

## Segment 3 — Vault-as-MCP bridges (inverse pattern)

| Project | Momentum | Notes |
|---|---|---|
| **MCP Tools** (jacksteamdev) | established | Signed local MCP server + Local REST API; semantic search, Templater prompts |
| **Local REST API** (coddingtonbear) | ~2.4K★ | Foundational dependency for most bridges |
| **mcp-obsidian** (MarkusPfundstein) | ~3.8K★ | Most-starred bridge (via Local REST API) |
| cyanheads / aaronsb / MCPVault | varied | REST vs filesystem vs native-plugin camps |

These are the **inverse** of Claudian (vault as data source for an *external* agent) — complementary, but
they **cap Claudian's TAM**: a power user already running Claude Code + an MCP bridge may not want an in-app
runtime. Claudian's counter is the integrated UX (inline edit, plan mode, kanban) bridge users don't get.
**Opportunity:** Claudian could *also* expose vault-as-MCP to own both directions.

## Segment 4 — Adjacent IDE/agent runtimes (set expectations)

| Tool | 2026 state | Table-stakes patterns it sets |
|---|---|---|
| **Cursor** | Pro $20 / Pro+ $60 / Ultra $200; Agent Mode, **Background Agents**, **Subagents** (2.4) | background/async agents, subagents, checkpoints |
| **Windsurf** | Pro $15-20 / Max $200; **parallel agents via Git worktrees** | parallel worktree agents |
| **Zed 1.0** (Apr 2026) | open **ACP**; runs Claude + Codex + Gemini + Copilot **concurrently**; **ACP Agent Registry** w/ JetBrains (Jan 2026) | ACP as universal bridge; concurrent multi-agent |
| **Claude Code / Codex** | subagents, hooks, background tasks, plan, skills, MCP, plugins, automations | the feature *vocabulary* Claudian inherits |

**Table stakes now:** plan mode, checkpoints/rewind, subagents, MCP, **background/async agents**. Claudian
has the first four; **background/async agents are the gap** — and exactly where Agent Board can become the
differentiator (see [[docs/issues/agent-board-background-runs.md]]).

## Feature parity matrix — Claudian vs top 5 direct rivals

| Capability | Claudian | Copilot v4 | Agent Client | NoClaw | Blackglass | Agentic Copilot |
|---|---|---|---|---|---|---|
| Multi-provider | ✅ (4) | ✅ | ✅ (5+) | ✅ (6) | ❌ | ◐ |
| Real agent runtime | ✅ | ✅ (Plus/v4) | ✅ ACP | ✅ ACP | ✅ terminal | ✅ spawn |
| Plan mode | ✅ | ◐ | ❌ | ❌ | ◐ | ❌ |
| Rewind / checkpoints | ✅ (Claude) | ❌ | ❌ | ◐ | ❌ | ❌ |
| Subagents | ✅ (3/4) | ◐ | ❌ | ⏳ | ◐ | ❌ |
| MCP management (in-app) | ◐ (Claude only) | ✅ (Plus) | ◐ (agent cfg) | ◐ | ✅ | ◐ |
| Background/async agents | ◐ (bg tab) | ❌ | ❌ | ◐ (cron) | ❌ | ❌ |
| Citations | ❌ | ✅ (RAG) | ❌ | ◐ | ❌ | ❌ |
| RAG / semantic search | ❌ | ✅ | ❌ | ◐ | ◐ | ❌ |
| Local models (Ollama) | ◐ (via provider) | ✅ | ◐ | ◐ | ❌ | ◐ |
| Kanban / orchestration | ✅ (Agent Board) | ❌ | ❌ | ◐ | ❌ | ❌ |
| Inline edit | ✅ | ✅ | ◐ | ◐ | ❌ | ✅ |
| Multi-session / tabs | ✅ | ◐ | ✅ | ✅ | ◐ | ✅ |
| Mobile | ❌ | ◐ (chat) | ❌ | ❌ | ❌ | ❌ |
| Pricing | Free/MIT | Freemium | Free/Apache | Free/MIT | Free/MIT | Free/MIT |

✅ full · ◐ partial · ❌ none · ⏳ planned. (MCP in-app and background-runs downgraded to ◐ per the
2026-06-03 review corrections: only Claude has in-app MCP management; runs use a non-activated bg tab but
don't stream into cards / aren't provider-native-detached.)

**Takeaway:** Claudian leads the agentic-depth columns and uniquely has Agent Board; it **trails on
RAG/semantic search, citations, local models, and mobile** — exactly the columns Copilot and Smart Composer
own.

## Momentum read

- **Surging:** Claudian (upstream, category velocity leader); kepano/obsidian-skills (~34K★ — validates the
  "agent-on-vault" thesis from the platform owner himself); the no-plugin skill packs (2–6K★, all 2026).
- **Steady leader by installs + only one monetizing:** Copilot (~1.43M downloads; v4 BYO-agent keeps it live).
- **Solid mid-tier:** Agent Client (~2.1K★) — the clean ACP reference everyone benchmarks.
- **New / unproven:** NoClaw, Blackglass, Cortex, Agentic Copilot — active cadence, tiny bases, several BRAT-only.
- **Stalling/niche:** Text Generator, SystemSculpt, Local LLM Helper — pre-agentic, not pivoting fast.
- **Watch:** the ACP registry (Jan 2026) lowers the bar for any editor to host agents → expect more Obsidian
  ACP wrappers. The real threat is a **funded** entrant (Brevilabs/Copilot), not another hobby wrapper.

## Moat & threats

**Defensible:**
1. **Breadth at depth simultaneously** — the only plugin with plan + inline edit + slash/skills + MCP mgmt +
   multi-tab fork/resume **and** rewind + subagents + Agent Board. Rivals each have 1–2 of these.
2. **Agent Board / kanban orchestration** — genuinely differentiated (Markdown work orders), maps onto the
   2026 multi-agent-orchestration trend; no Obsidian rival has it.
3. **MIT license** — vs Copilot's AGPL-3.0; friendlier for forks/contributors.
4. **Momentum/brand** (upstream) — a contributor + trust flywheel rivals can't quickly match.

**Commoditizing (not defensible):** single-provider/single-agent chat, ACP plumbing, slash commands, basic
inline edit — given away by Agent Client/NoClaw/Zed. "We support N agents" is no longer special.

**Threats (ranked):**
1. **Copilot v4 — most dangerous.** ~1.43M users + a working $15/mo model; bolting BYO-agent onto that
   distribution + RAG is the one combination Claudian can't out-grow on features alone. If it adds
   plan/rewind/orchestration UX, it eats Claudian's differentiation from scale + money.
2. **No-plugin skill packs** (kepano ~34K★ et al.) — argue users need no plugin, just Claude Code + `SKILL.md`
   against the vault. Caps Claudian's power-user TAM.
3. **Obsidian security regime** — per-version automated review (May 2026) + the active **PHANTOMPULSE** RAT
   campaign abusing process-spawning plugins make Claudian's `child_process`/CLI-spawn architecture a trust +
   review-pass liability. A failed scorecard or security scare could stall installs. Directly reinforces
   [[docs/issues/adopt-secretstorage-for-secrets.md]], [[docs/issues/audit-innerhtml-rendering.md]],
   [[docs/issues/normalizepath-coverage.md]], [[docs/issues/confirm-deferred-view-load-time.md]].
4. **Cursor/Zed** raising expectations to background/async + parallel-worktree agents a desktop Obsidian
   plugin can't easily replicate.

## Strategic recommendations (ranked)

1. **Make Agent Board the headline + lean into multi-agent/background orchestration.** The one feature no
   Obsidian rival has, riding the strongest 2026 trend. Tie it to background/async runs (queued work orders
   executing while the user works) to close the biggest table-stakes gap. → [[docs/issues/agent-board-background-runs.md]].
2. **Add RAG / semantic vault search + citations.** Clearest feature hole vs Copilot/Smart Composer, and what
   knowledge-workers (not coders) actually want. Even lexical+embeddings grounding for `@mention` would
   neutralize Copilot's core advantage. → builds on [[docs/issues/explicit-context-citations.md]];
   **recommend a new issue: "RAG / semantic vault search (Phase B retrieval)."**
3. **First-class local-model + privacy story.** Smart Composer/Copilot-self-host own "private/offline."
   Smooth Ollama/LM Studio via OpenCode/compatible providers and market "your notes never leave your
   machine" — a direct contrast to Copilot Plus's backend caveat. **Recommend a new issue: "Local-model
   (Ollama/LM Studio) provider path + privacy positioning."**
4. **Get ahead of the security regime proactively.** Adopt `SecretStorage`, publish a permissions/safety-mode
   model (Cortex-style readonly→full), aim for a clean automated-review scorecard, and turn "we spawn agents
   safely" into a trust *feature* before it becomes a liability. → the H1 hardening cluster.
5. **Be the best home for skills** to defend against no-plugin packs — curate/host kepano-style `SKILL.md`
   packs in-app and make the plugin the easiest place to manage skills/subagents/MCP.
6. **Consider sustainable monetization now, while #1 in mindshare.** Copilot proves freemium works
   ($14.99/mo, $349.99 lifetime). A Claudian "Pro" (Agent Board orchestration, hosted async runs, priority
   support) or GitHub Sponsors tier could fund the 4-provider QA burden without compromising the MIT core.
   (Interacts with the Specorator standalone-product direction.)
7. **Stake a claim on ACP interop** so "add any agent" stays cheap as the ACP registry grows — but compete on
   the orchestration/UX layer *above* the plumbing, not on the plumbing.

## Follow-up issues this note recommends filing

- **RAG / semantic vault search** (Phase B retrieval) — the top un-tracked product gap.
- **Local-model provider path** (Ollama/LM Studio) + privacy positioning.
- **Safety-mode model + automated-review scorecard** (extends the H1 security cluster; ties to PHANTOMPULSE risk).
- **(Strategic) monetization model** — decision note, sequenced with the Specorator migration.

## Sources

Direct rivals: github.com/YishenTu/claudian · github.com/logancyang/obsidian-copilot ·
obsidiancopilot.com/en/pricing · obsidianstats.com/plugins/copilot · github.com/RAIT-09/obsidian-agent-client ·
obsidianstats.com/plugins/agent-client · github.com/yungho/obsidian-noclaw · github.com/humantorch/blackglass ·
forum.obsidian.md (Blackglass, Cortex threads) · github.com/ScottKirvan/Cortex ·
github.com/spencermarx/obsidian-ai · andrew.ooo/posts/agentic-copilot-obsidian-claude-code-plugin-review ·
github.com/petersolopov/obsidian-claude-ide.
No-plugin / adjacent: github.com/kepano/obsidian-skills · github.com/topics/obsidian-claude-code.
RAG: github.com/glowingjade/obsidian-smart-composer · github.com/brianpetro/obsidian-smart-connections ·
github.com/nhaouari/obsidian-textgenerator-plugin · github.com/manimohans/obsidian-local-llm-helper ·
blogs.nvidia.com/blog/ai-decoded-obsidian.
MCP bridges: github.com/jacksteamdev/obsidian-mcp-tools · github.com/coddingtonbear/obsidian-local-rest-api ·
github.com/MarkusPfundstein/mcp-obsidian · github.com/cyanheads/obsidian-mcp-server · morphllm.com/obsidian-mcp-server.
Adjacent IDEs: zed.dev/acp · zed.dev/docs/ai/external-agents · blog.jetbrains.com/ai/2026/01/acp-agent-registry ·
aiproductivity.ai/blog/cursor-pricing · tech-insider.org/windsurf-vs-cursor-2026.
Trends: resources.anthropic.com/2026-agentic-coding-trends-report · morphllm.com/best-ai-coding-agents-2026 ·
firecrawl.dev/blog/agentic-ai-trends.
Obsidian platform / security: obsidian.md/blog/future-of-plugins · obsidian.md/changelog/2026-01-07-desktop-v1.11.4 ·
alternativeto.net/news/2026/5/obsidian-launches-community-hub-with-automated-plugin-reviews-and-enhanced-safety ·
help.obsidian.md/plugin-security · elastic.co/security-labs/phantom-in-the-vault (PHANTOMPULSE) ·
thehackernews.com/2026/04/obsidian-plugin-abuse-delivers.html.

All fetched 2026-06; star/download counts are point-in-time (2026-06-03) and reflect the upstream repo (see
identity caveat).
