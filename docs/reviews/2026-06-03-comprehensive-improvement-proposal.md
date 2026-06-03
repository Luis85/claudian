---
title: Comprehensive Improvement Proposal
date: 2026-06-03
status: proposal
version: v3.2.0 (current ship)
scope: whole-product (strategy, architecture, security/privacy, UX/product, performance/reliability, provider-native capability, Obsidian store compliance, backlog reconciliation)
method: 6 parallel dedicated review passes (architecture/quality, security/privacy, UX/product, performance/reliability+backlog, market/competitive web research, provider-native-capability web research) against `main` at 252929d
supersedes: docs/reviews/2026-06-02-codebase-review-and-improvement-plan.md (incorporates remaining open items, corrects stale status)
related:
  - "[[docs/reviews/2026-06-02-codebase-review-and-improvement-plan.md]]"
  - "[[docs/adr/0001-transport-agnostic-provider-seam.md]]"
  - "[[docs/ideas/2026-05-28-plugin-improvement-research-proposal.md]]"
  - "[[docs/ideas/2026-05-28-standalone-product-vision.md]]"
  - "[[docs/issues/agent-board-evidence-review.md]]"
---

# Claudian — Comprehensive Improvement Proposal (2026-06-03)

Third consolidated review, after the 2026-05-31 and 2026-06-02 plans and the v3.2.0 ship. This one
adds two things the prior plans lacked: a **deep market/competitive read** and a **provider-native
capability audit**, both from fresh web research. The goal is no longer just "keep the codebase
robust" — that bar is being met — but to decide **where the next quarter of effort creates
defensible product value**.

## TL;DR

1. **The codebase is in good shape and the prior plans over-track open work.** Several items the
   2026-06-02 plan lists as P1/P2 (Q-4 untested security paths, Q-NEW-2 provider test parity,
   most of Q-1) have **shipped since**. Typecheck/lint clean, 0 `console.*`/`@ts-ignore`/`as any`,
   368 test suites, perf gates green.
2. **The "embed an agent CLI in Obsidian" category commoditized in early 2026.** Obsidian Copilot
   v4, Agent Client (~2.1k★, ACP multi-agent), Agentic Copilot, and Cortex all now embed coding
   agents. Claudian's defensible moat is **multi-provider depth + the Agent Board as a
   background/multi-agent orchestration surface**, hardened with **native secret storage** and a
   **best-in-class MCP safety UX**. Breadth alone is no longer differentiating.
3. **The single highest-value security fix is SEC-A: provider API keys and MCP auth headers are
   stored in plaintext inside the syncable/committable vault.** Obsidian shipped a native
   `SecretStorage` API (v1.11.4, Jan 2026) and now runs automated security review on *every*
   version. This is simultaneously the biggest privacy gap and a compliance risk.
4. **The open product work is the trust-UX layer the 2026-05-28 proposal called for** — provider
   health check, pre-send context preview, citations, unified safe-edit/revert — plus the
   **Agent Board Evidence & Review Gate** (the spine of the Specorator "review with evidence"
   thesis), and **provider-native capability parity** (Codex/Cursor MCP, Cursor subagents,
   Opencode plan mode).
5. **Two unstarted architecture moves remain from ADR-0001**: Phase 2b (`RuntimeHost` — currently
   dead code) and Phase 3 (shared `core/transport/`).

---

## Method

Six dedicated subagents reviewed `main` at `252929d` in parallel, then findings were cross-checked
against the live tree (every doc claim verified, conflicts resolved by direct inspection):

- **Architecture & code-quality** — large files, module cycles, ADR-0001 status, test parity, discipline.
- **Security & privacy** — secret-at-rest, MCP threat model, redaction, vault trust, spawn/path safety.
- **UX & product** — onboarding, context visibility, citations, edit review, settings IA, accessibility, Agent Board.
- **Performance/reliability & backlog reconciliation** — hydration, concurrency, lifecycle, perf gates; full `docs/` backlog audit.
- **Market/competitive & Obsidian ecosystem** (web) — competitors, store-readiness, agent/MCP trends, positioning.
- **Provider-native capability** (web) — latest Claude/Codex/Cursor/Opencode/ACP features vs Claudian's current support.

No production code was changed for this proposal.

---

## What shipped since 2026-06-02 (corrections to the prior plan)

The 2026-06-02 plan should be treated as **partially stale**. Verified against the tree:

| Prior-plan item | Prior status | **Verified now** | Evidence |
|---|---|---|---|
| **Q-4** four untested security paths | P1 open | ✅ **Done** — all four now tested | `ClaudeApprovalHandler.test.ts`, `AcpToolStreamAdapter.test.ts`, `HomeFileAdapter.test.ts`, `ClaudeRewindService.test.ts` |
| **Q-NEW-2** provider test parity | P2 open | ✅ **Largely done** — Claude 45 / Cursor 40 / Codex 32 / Opencode 24 / ACP 6 suites (Cursor 6→40) | `tests/unit/providers/` |
| **Q-1** Notice i18n | shipped + ESLint rule | ✅ Confirmed; ESLint boundary rule live | `eslint.config.mjs` |
| **PERF-5** sequential sidecar load | P2 open | ✅ **Already `Promise.all`** — stale finding | `ClaudeHistoryStore.ts:174-182` |
| Madge cycles | "52" | ⚠️ **58 now** — drifted up; worst are compile-erased `import type` round-trips (no runtime risk) | `npx madge --circular` |
| **PERF-1** mechanism | "bottom-anchor sentinel + IntersectionObserver" | ⚠️ **Mis-described** — actual fix is `scrollIntoView({block:'end'})`; zero `IntersectionObserver` in `src/`; streaming render is O(C)/tick (throttled), not O(1)/chunk | `scrollToBottom.ts:14-22`, `StreamController.ts:823-838` |
| **Q-7** settings registry port | "3/8 → finish" | ⚠️ **Still 3/8** — all 8 *registered* but only `{agentBoard, orchestrator, diagnostics}` feature-flagged on; other 5 fall back to imperative renderers (30+ fields missing on general) | `registry/featureFlag.ts:13-23` |

**Net:** the remaining quality backlog is smaller than the prior plan implies. Update that doc's
status rows; this proposal carries forward only what's genuinely open.

---

## Strategic context (web research)

### The category commoditized in ~6 months

| Competitor | Architecture | What they now ship | Implication for Claudian |
|---|---|---|---|
| **Obsidian Copilot v4** (logancyang) | RAG chat + "bring your own agent" | Embeds opencode / Claude Code / Codex natively; vault/web search; long-term memory; **paid Plus tier** | Now overlaps Claudian's exact pitch; proves freemium GTM. Claudian's edge: agent fidelity (rewind, plan, subagents, MCP control). |
| **Agent Client** (RAIT-09, ~2.1k★) | ACP | Claude/Codex/Gemini CLI + custom; @refs, images, slash, multi-session, resume/fork, floating window | Strongest direct rival. Claudian must match **Gemini CLI** + floating/multi-session ergonomics. |
| **Agentic Copilot** (Marx) | CLI child-process | Auto-detect agents, inline diff accept/reject, up to 5 parallel sessions, right-click actions | Learn: zero-config **auto-detect** + right-click context actions. |
| **Smart Composer** (glowingjade) | RAG (not agent) | @context, semantic search, MCP, 9+ providers incl. **local Ollama/LM Studio** | Now stale (single dev) — its privacy/local-model users are winnable. |
| **MCP Tools / MCPVault / Vault-as-MCP** | Vault *as* MCP server | Expose vault to external agents | Inverse pattern; Claudian could *also* expose vault-as-MCP to own the whole surface. |

Sources: github.com/logancyang/obsidian-copilot, github.com/RAIT-09/obsidian-agent-client,
andrew.ooo agentic-copilot review, github.com/glowingjade/obsidian-smart-composer,
github.com/jacksteamdev/obsidian-mcp-tools (all fetched 2026-06).

### The moat

> **Claudian is the agentic control plane for your vault — run, orchestrate, and supervise multiple
> real coding agents as long-running background workers over your notes, with first-class
> plan / rewind / approval safety and a unified MCP control plane.**

Breadth (four providers) is no longer enough — rivals are catching up on roster. The defensible
combination is **depth (rewind, plan, subagents) × the Agent Board as a background/multi-agent
orchestration surface × MCP safety × Obsidian-native trust (SecretStorage, citations, safe edits)**.
No single-provider rival can copy that quickly.

### Obsidian now reviews every version

As of ~May 2026, Obsidian runs automated security + code-quality + malware scanning on **every
release**, not just initial submission (obsidian.md/blog/future-of-plugins). Top automated-review
flags that map directly onto our findings: **plaintext secrets** (SEC-A; native `SecretStorage`
shipped v1.11.4 Jan 2026), any **`innerHTML`/`outerHTML`** on agent/markdown output, **`normalizePath()`**
coverage, and **deferred-view load time**. Compliance is now continuous, not one-time.

---

## Findings by perspective

Severity is product-impact-weighted (P0 = exploitable/blocking, P1 = high, P2 = medium, P3 = low).
"✅ already good" items are listed once so they are not re-litigated.

### A. Architecture & quality

**✅ Already good:** 0 `console.*`/`@ts-ignore`/`as any`; ESLint provider-boundary rule live and
clean; no `providerId === 'x'` branches in `core/`/`features/`; capability-gating works; ARCH-1..8
landed; Q-4/Q-NEW-2 closed.

| ID | Sev | Finding | Evidence | Action / effort |
|----|-----|---------|----------|-----------------|
| ARCH-1 | P1 | **ADR-0001 Phase 2b not started — `RuntimeHost` is dead code.** `RuntimeHost.ts` (51 LOC) imported by zero files; all 7 `set*Callback` setters still on the interface; Cursor & Opencode carry 7 no-op `{}` stubs each; the `set(null)` escape hatch remains. | `RuntimeHost.ts`; `ChatRuntime.ts:54-60`; `CursorChatRuntime.ts:330,338`; `tabControllers.ts:473-511` | Execute Phase 2b: pass `RuntimeHost` at construction, delete ~14 stubs + 7 members. **M** |
| ARCH-2 | P1 | **ADR-0001 Phase 3 not started — no shared transport.** `core/transport/` does not exist; Codex (`CodexRpcTransport` 171 LOC) & Opencode (`AcpJsonRpcTransport` 427 LOC) duplicate spawn + framing. CON-3 gate is cleared, so this is unblocked. | `core/transport/` absent | Extract `spawnAgentProcess()` + `JsonRpcStdioClient` per ADR Move 2; add the `JsonRpcStdioClient` perf gate. Sequence **after** cursor-hardening PR2. **M–L** |
| ARCH-3 | P2 | **`InputToolbar.ts` (1419 LOC) fuses 11 independent widget classes** (ModelSelector, ModeSelector, PermissionToggle, McpServerSelector, ContextUsageMeter, …). Strongest deletion-test pass in the tree — no shared state. | `InputToolbar.ts:69..1263` | Split into a `toolbar/` directory of ~100–150 LOC modules. **M** |
| ARCH-4 | P2 | **Targeted large-file splits** that pass the deletion test: `InputController.ts` (1482; resume-dropdown + plan-approval seams), `CodexHistoryStore.ts` (1630; legacy/modern/persisted parser families), `ClaudeChatRuntime.ts` (1864; persistent-query lifecycle seam). | `wc -l` | Split opportunistically; pair InputController with the Phase 2b churn. **M each.** **Do NOT split** StreamController/ToolCallRenderer/TabManager — deletion test fails. |
| ARCH-5 | P3 | 58 madge cycles; worst root in `core/providers/types.ts` `import type` round-trips (erased at compile time). Low value. | `types.ts:1-20` | Optional: split the type-hub. **S, low value.** |

### B. Security & privacy

**✅ Already good (verified, do not re-litigate):** SEC-1 safe permission defaults + one-time YOLO
warning; SEC-2 vault-trust gate (risk re-read from disk per decision); SEC-3 MCP default-untrusted;
SEC-4 env curation + proxy-credential stripping + Cursor/Opencode allowlist; Cursor sessionId
validation at all path sites; zero `eval`/`shell:true` injection surface; logger redaction on the
clipboard export path.

| ID | Sev | Finding | Evidence | Fix / effort |
|----|-----|---------|----------|--------------|
| SEC-A | **P1** | **Provider API keys, MCP HTTP auth headers, and env vars stored plaintext at rest** in in-vault `.claudian/claudian-settings.json` and `.claude/mcp.json` — both routinely committed/synced (Obsidian Sync, iCloud, git). `SecretStorage` is unused (0 hits). Anyone with the vault or its sync target gets every long-lived secret. **Highest-impact privacy gap for the target audience + an automated-review flag.** | `providerEnvironment.ts:180-185`; `McpStorage.save` → `.claude/mcp.json`; `core/types/mcp.ts:15,22` | Adopt Obsidian `SecretStorage` for keys + MCP auth headers; keep `.claude/mcp.json` as `${env:VAR}` references. **Stopgap (S):** move secrets to non-synced plugin `data.json` + loud warning + `.gitignore` guidance. Full: **L** |
| SEC-B | P2 | **Opencode main runtime `read/writeTextFile` has no vault-containment check** — `resolveSessionPath` passes absolute paths verbatim and resolves relative paths with no `..` rejection. The aux runner already enforces containment; the primary path doesn't. | `OpencodeChatRuntime.ts:1281-1320` vs `OpencodeAuxQueryRunner.ts:373-382` | Hoist the aux runner's `path.relative` containment check into `resolveSessionPath`. **S** |
| SEC-C | P2 | **Codex CLI spawned with full `process.env`**, bypassing the allowlist Cursor/Opencode use. A third-party CLI inherits every host secret. | `codexAppServerSupport.ts:24-33` | Route Codex through `buildAllowlistedSubprocessEnvironment` with `/^(OPENAI|CODEX)_/i` prefix; update the CLAUDE.md mandate. **S** |
| SEC-D | P2 | **No remote-MCP transport hygiene** — plaintext `http://` connected with no warning; no SSRF guard (`new URL` direct, custom fetch will hit `169.254.169.254`/localhost); no provenance/risk labels; tool descriptions treated as fully trusted. | `McpTester.ts:50-113,253`; MCP UI files | Warn on non-loopback `http://`; show destination host + provenance (vault vs user-added); render tool descriptions as untrusted; link-local/metadata SSRF notice. **M** |
| SEC-E | P3 | **Redaction is key-name-only** — secret-bearing *values* (`user:pass@` in URLs/commands) and home/absolute paths leak into diagnostics export. | `redact.ts:22-25` | Value-level scrub for `user:pass@`; normalize `os.homedir()` → `~` before clipboard. **M** |
| SEC-F | P3 | **No prompt-injection demarcation** — vault notes, browser selections, MCP outputs, OCR flow into prompts as fully trusted text. The approval gate is the real defense; meaningful for auto-approved/YOLO sessions. | `core/prompt/`, selection controllers | Doc + wrap externally-sourced content in labeled blocks in the prompt template. **M** |

### C. UX & product

**✅ Already good:** configure-first empty state with checklist + "Open settings"; multi-tab badges
with `needsAttention`/`aria-busy` (UX-1..4 shipped); inline-edit word-level diff + accept/reject;
Claude code-rewind with real file backup/restore; in-thread "Attached context" card + composer
pills; context-usage ring meter; MCP test modal (the most mature error surface); working
diagnostics copy/clear; settings search.

| ID | Sev | Finding | Evidence | Improvement / effort |
|----|-----|---------|----------|----------------------|
| UX-A | **P1** | **No CLI detection / health check / "Test connection" anywhere.** Failures surface only *after the first send* as inline stream text. The #1 onboarding journey has no validation gate; this is the largest support-ticket category (`spawn claude ENOENT`, login state). | `ClaudeChatRuntime.ts:1165`; provider settings tabs have no test button | Per-provider "Detect & Test" button reusing the existing `*CliResolver`; show resolved path + auth state. **M** |
| UX-B | **P1** | **No pre-send "what will be sent" preview.** The attached-context card renders *after* send; composer pills show basenames only — no token estimate, folder file-count, large-folder warning, or excluded/private indicator. The `ComposerContextBuilder` bet is unbuilt. | `FileChipsView.ts`, `MessageContextCard.ts` | Pre-send context drawer (token est., folder counts, warnings) + an "agent can also read your whole vault" workspace-access disclosure. **M–L** |
| UX-C | **P1** | **Zero citation rendering.** Agent answers never cite which note/selection grounded them; `ContextSourceHandle` does not exist. Market-map calls citations "table stakes." | grep: no citation/source-handle code | Phase A: cite explicitly attached files/selections via source handles (no embeddings). **L** |
| UX-D | **P1** | **Safe-edit/revert is fragmented and Claude-only for rewind.** In-chat Write/Edit tool calls render a display-only diff (already written, no undo); rewind-with-file-restore is Claude-only (`supportsRewind:false` for Codex/Opencode/Cursor). Chat edits via 3 of 4 providers have no in-app revert. | `WriteEditRenderer.ts`; `MessageRenderer.ts:96` | Unify a post-edit review/revert path; see provider-native rewind items (PN-5/PN-7). **M + provider work** |
| UX-E | **P1** | **Composer toolbar buttons are not keyboard-accessible** — clickable `div`s with no `tabindex`/`role`/keydown (plan mode, MCP, quick-actions, …). **Streaming has no live region** (only `aria-busy` on tab badges). Blocks keyboard/AT users and the a11y review bar. | `InputToolbar.ts:503,567,613,645`; one `aria-live`-adjacent attr in all of `src/` | Make toolbar controls real buttons; mark the stream `role="status"`/`aria-live`. **M, low risk** |
| UX-F | **P1** | **Runtime errors render as plain inline text with no recovery action** — no error card, no "Open settings / Fix CLI path", no retry. Every setup/auth failure dead-ends in chat. | `StreamProjection.ts:102-104` | Actionable error card with click-through to settings + retry. **M** |
| UX-G | P2 | **Agent Board has no drag-and-drop** (all lane moves are buttons) and **no ARIA roles/labels**. Violates the kanban mental model; board is keyboard/SR-inaccessible. | `AgentBoardRenderer.ts` (0 drag handlers, 0 `aria-`) | Lane drag-drop + ARIA roles. **M** |
| UX-H | P2 | **Settings IA is tab-heavy; General tab overloaded** (~25+ controls in one scroll across 10 sections). 4-bucket IA (Basic/Workflow/Integrations/Advanced) unbuilt. | `ClaudianSettings.ts:303-637` | Tied to Q-7 registry port; reorganize as part of finishing it. **M** |
| UX-I | P2 | **"YOLO"/"Safe" labels still ship in chat** and are marketed to a non-developer audience. | `ClaudeChatUIConfig.ts:23-25` | Rename to Review actions / Auto-approve / Plan first / Read-only (keep `yolo` internal value). **S** |
| UX-J | P3 | No "context too large" graceful handling; "unauthenticated" not a distinct guided state; reduced-motion minimal. | grep | Fold into UX-F error-card work. **S** |

### D. Performance & reliability

**✅ Already good:** OBS-1 (heavy work deferred to `onLayoutReady`) and OBS-4 (`vault.process`)
shipped; all `setInterval`/`addEventListener` sites have matching cleanup (no leaks found); CON-3
readline leak fixed; abort listeners use `{once:true}` + exit-cleanup; PERF-4 yielding hydration +
perf gate shipped.

| ID | Sev | Finding | Evidence | Action / effort |
|----|-----|---------|----------|-----------------|
| PR-1 | P2 | **`onunload` cannot await its process sweep** — `shutdownActiveRuntimes()` does `void cleanup()` + `void persistOpenTabStates()`. SIGTERM is initiated sync but async cleanup may not complete → orphaned CLI subprocesses / lost tab state on reload. | `main.ts:162-167`; `PluginLifecycle.ts:30-52` | Audit: confirm every provider `cleanup()` fires `child.kill()` **before** its first `await`. **S** |
| PR-2 | P2 | **No Agent Board / multi-tab / MCP scaling perf gates.** Board is first-class now; N-tab concurrent streaming shares the rAF scheduler with no guard — the highest real-world risk, exactly the kind of gap that masked PERF-4. | `tests/perf/` (8 files, none cover tasks/multitab/mcp) | Add `agentBoard.perf` + a `taskRunCoordinator` concurrency guard + multi-tab streaming gate. **M** |
| PR-3 | P3 | **Streaming text render is O(C)/tick** (full re-parse of accumulated block), bounded by PERF-3 throttle. Mis-documented as O(1)/chunk. | `StreamController.ts:823-838` | Document reality; only pursue delta-append if users report jank on long answers. **S doc / L code** |
| PR-4 | P3 | **PERF-4 F2/F3 deferred** — the 100/50 yield constants are empirically unvalidated (mocked-fs overstates overhead ~75×). | `sdkSessionPaths.ts:14`, `ClaudeHistoryStore.ts:64` | One production measurement (≥1000-msg vault, cold/warm), then tune. **S** |

### E. Provider-native capability gaps

The four runtimes have advanced; Claudian under-uses several now-available surfaces. Confidence:
**[DOCS]** confirmed from official docs/changelog; **[INFER]** reasoned / post-Jan-2026-cutoff.

| ID | Sev | Capability | Provider(s) | Source |
|----|-----|-----------|-------------|--------|
| PN-1 | P1 | **Codex MCP management** — app-server already exposes MCP server status, resource reading, and OAuth login flows; `[mcp_servers.*]` config. Brings Codex to Claude parity. | Codex | developers.openai.com/codex/app-server + /mcp **[DOCS]** |
| PN-2 | P1 | **Cursor MCP support** — CLI auto-detects `.cursor/mcp.json`; `agent mcp list/list-tools`, `--approve-mcps`, in-session `/mcp`. | Cursor | cursor.com/docs/cli/mcp **[DOCS]** |
| PN-3 | P1 | **Cursor subagents** (first-class in Cursor 2.4, Jan 2026) — parallel isolated context, custom prompts/tools/models. Currently gated in Claudian. | Cursor | cursor.com/changelog/2-4 **[DOCS]** |
| PN-4 | P1 | **Opencode plan mode** — Plan is a native restricted primary agent (edits/bash → `ask`); switch via ACP `session/set_mode`. Currently gated. | Opencode | opencode.ai/docs/agents + ACP modes **[DOCS]** |
| PN-5 | P2 | **Codex rollback/rewind** — app-server can "interrupt turns and roll back recent history"; native `/rewind` landing. Wire to Claudian's rewind UI → closes UX-D for Codex. | Codex | developers.openai.com/codex/app-server **[DOCS]** |
| PN-6 | P2 | **Claude lifecycle hooks** — `PreToolUse`/`PostToolUse`/`Stop`/`Session*` as in-process callbacks; feeds audit/gating (and the evidence gate). | Claude | code.claude.com/docs/en/agent-sdk/hooks **[DOCS]** |
| PN-7 | P2 | **Verify Claude file-checkpointing API** — ensure rewind uses official `enableFileCheckpointing`+`rewindFiles()` (handles created files + NotebookEdit) vs a custom impl. | Claude | code.claude.com agent-sdk/file-checkpointing **[DOCS]** |
| PN-8 | P2 | **ACP slash commands + modes for Opencode** — `available_commands_update` gives runtime-discovered `/commands`; `current_mode_update` for plan/build. | Opencode | agentclientprotocol.com **[DOCS]** |
| PN-9 | P3 | **Compaction surface** — `/compact` (Claude) / `/compress` (Cursor); surface auto-compaction + token budget to the user. | Claude, Cursor | platform.claude.com compaction; cursor.com/docs/cli/using **[DOCS]** |
| PN-10 | P3 | **Gemini CLI provider** (+ pluggable custom binary) — roster parity with Agent Client / Agentic Copilot. | new | competitor analysis |

**Caveats:** ACP has **no rewind primitive** — Opencode `/undo` is unsupported over ACP (CLI/TUI
only), so Opencode rewind would need to bypass ACP. **Cursor is diverging from ACP**, not
converging (it doubled down on stream-json + native subagents/skills/hooks in 2.4).

### F. Obsidian store-compliance audit (continuous review)

| ID | Sev | Item | Why |
|----|-----|------|-----|
| OBS-A | P1 | **Plaintext secrets** → adopt `SecretStorage` | = SEC-A; now a flaggable anti-pattern |
| OBS-B | P1 | **Audit all rendering for `innerHTML`/`outerHTML`/`insertAdjacentHTML` on agent/markdown output** — must route through `MarkdownRenderer`/`createEl` | #1 security-review risk for a streaming chat UI |
| OBS-C | P2 | **`normalizePath()` coverage** on every user/agent-constructed path | explicit top review flag |
| OBS-D | P2 | **Confirm chat view defers** (`isDeferred`/`loadIfDeferred`) and no child process spawns at load | startup-bloat flag |
| OBS-E | P3 | Manifest hygiene + naming: `manifest.json` id `claudian-cursor` / author `YishenTu`, README links `YishenTu/claudian`, release script targets `Luis85/claudian` — **three-way mismatch** to resolve before any release-facing work | confirmed defect |

---

## Backlog reconciliation

| Item | Doc | Claimed | Verified | Action |
|------|-----|---------|----------|--------|
| Long-chat freeze (PERF-4) | issues/Loading a long chat… | shipped | ✅ shipped; F2/F3 deferred | run F3 opportunistically |
| Missing EventBus | issues/Missing Eventbus… | done | ✅ shipped | — |
| Insufficient logging | issues/insufficient logging | done | ✅ shipped | — |
| Pasted images | issues/Pasted images… | open | ✅ likely shipped (`ImageContext.ts:174-204`) | verify agent-side, close |
| UX polishing UX-1..4 | issues/UX polishing… | open | ✅ **shipped** | **flip frontmatter → done** |
| Agent Board MVP | issues/agent-board-mvp | done | ✅ shipped | — |
| **Agent Board Evidence & Review Gate** | issues/agent-board-evidence-review | open | 🔴 **genuinely open** — no run leases, structured evidence, changed-file attribution, or evidence-gated completion (0 grep hits) | **top open product PRD** |
| Architecture deepening | issues/architecture-deepening | done | ✅ shipped → ADR-0001 | — |
| Settings registry port (Q-7) | issues/settings-registry-port | open | 🔴 open — 3/8 tabs, 5 placeholders | keep open |
| Validator helper translation | issues/translate-validator-helper | open | 🟡 Phase A shipped; Phase B open (~25 `parseOptional*`) | → partially-shipped |
| Specorator standalone vision | ideas/…standalone-product-vision | open | 🔵 open (strategic; Agent Board prereq done, migration not started) | keep; see §"Specorator question" |
| Agent Board Symphony | ideas/agent-board-symphony | open | 🟡 MVP+lanes shipped; orchestration layer open | umbrella for evidence-gate + orchestrator-integration |
| Better Git integration | ideas/Better Git integration | — | 🔴 open — commit button + status watcher only, no changed-files view | keep; high QoL |
| Work-Order Templates | ideas/Work-Order Templates | done | ✅ shipped | — |
| Integrate Orchestrator w/ Agent Board | ideas/Integrate the Orchestrator… | — | 🔴 open — Orchestrator is chat-only, not board-integrated | keep |
| Work-Orders w/ specialized Agents | ideas/Work-Orders with specialized Agents | — | 🔴 open — no agent attach in work-order schema | keep |
| Custom Actions per Lane | ideas/Custom Actions per Lane… | — | 🔴 open | keep |
| Capture prompt as Quick Action | ideas/Create a new Quick-Action… | — | 🔴 open | keep |
| Append docs system-prompt in plan mode | ideas/Append docs creation… | — | 🔴 open | keep |
| "ComposerContextBuilder" / "audit center" naming | (proposal) | — | context pills/cards shipped under other names; **audit center unbuilt** (subsumed by evidence gate) | reconcile naming |

**Forward-looking plans still active:** `superpowers/plans/2026-05-30-cursor-integration-hardening.md`
(PR2 T-items open — gates ADR-0001 Phase 3) and `…specorator-standalone-migration.md` (strategic).

---

## The proposal: two tracks

The open work splits cleanly into a **Hardening track** (must-do hygiene/security/compliance that
protects the existing audience and store standing) and a **Differentiation track** (product bets
that build the moat). Run them in parallel — they touch different files and reviewers.

### Track 1 — Hardening (protect what exists)

| Phase | Items | Why first | Size |
|-------|-------|-----------|------|
| **H1 — Secrets & store compliance** | SEC-A (`SecretStorage`), OBS-B (`innerHTML` audit), OBS-C (`normalizePath` sweep), OBS-D (deferred-view confirm), OBS-E (resolve the 3-way naming defect), UX-I (YOLO rename) | Continuous automated review + biggest privacy gap. Ship the SEC-A **stopgap** (non-synced storage + warning + `.gitignore`) immediately; full `SecretStorage` follows. | S→L |
| **H2 — Security follow-through** | SEC-B (Opencode path containment), SEC-C (Codex env allowlist), SEC-D (remote-MCP hygiene), SEC-E (value-level redaction) | Cheap, high-confidence closes. SEC-B/C are **S** each. | S–M |
| **H3 — Reliability gates** | PR-1 (`onunload` kill audit), PR-2 (Agent Board + multi-tab perf gates) | Prevent orphaned processes + catch the untested scaling surface. | S–M |
| **H4 — ADR-0001 finish** | ARCH-1 (Phase 2b `RuntimeHost`), then ARCH-2 (Phase 3 transport, after cursor-hardening PR2) | Deletes dead code + the interface-width tax; last unstarted ADR moves. | M / M–L |
| **H5 — Quality follow-through** | Q-7 registry port (+ UX-H IA reorg), validator Phase B, ARCH-3 InputToolbar split | Opportunistic; H4's churn amortizes some test rewrites. | M each |

### Track 2 — Differentiation (build the moat)

| Phase | Items | Why | Size |
|-------|-------|-----|------|
| **D1 — Trust UX layer** | UX-A (provider Detect & Test), UX-F (actionable error cards), UX-E (composer a11y + stream live region) | Fixes the #1 onboarding journey + the largest support category; low-risk, broad reach. Start here — cheapest high-leverage product win. | M |
| **D2 — Visible context & citations** | UX-B (pre-send preview + workspace disclosure), UX-C (explicit-context citations) | The 2026-05-28 proposal's designated #1 bet; closes the "table stakes" competitive gap. Formalize as the `ComposerContextBuilder` envelope + `ContextSourceHandle`. | M–L / L |
| **D3 — Provider parity (MCP unification)** | PN-1 (Codex MCP), PN-2 (Cursor MCP), PN-4 (Opencode plan mode), PN-3 (Cursor subagents) | A **unified MCP control plane across all 4 providers** is a concrete differentiator (rivals punt MCP to each CLI). Plan/subagent parity deepens the "depth" moat. | M each |
| **D4 — Agent Board as orchestration surface** | Evidence & Review Gate PRD (run leases, structured evidence, changed-file attribution, evidence-gated completion); **background/long-running runs** streaming into cards; Orchestrator↔Board integration; UX-G (drag-drop + ARIA) | The headline moat: nothing else in the Obsidian space runs work orders as background/multi-agent workers with evidence review. Spine of the Specorator thesis. | L (multi-PR) |
| **D5 — Unified safe-edit/revert** | UX-D + PN-5 (Codex rollback), PN-7 (verify Claude checkpointing), PN-6 (Claude hooks → snapshot-before-edit) | "Approve changes like a writer" across all providers, not just Claude. | M + provider work |

### Sequencing rationale

- **H1 is non-negotiable and first** — secrets-at-rest + automated review is a live exposure for
  every synced-vault user, and the naming defect blocks any release-facing work.
- **D1 is the cheapest product win** — one Test button + actionable errors + a11y collapses the
  biggest support category and unblocks keyboard users. Run it alongside H1.
- **D2 → D3 → D4** is the moat-building order: make context trustworthy, reach MCP/parity, then turn
  the Agent Board into the orchestration surface that no rival can copy quickly.
- **H4 (ADR finish) is opportunistic** — `RuntimeHost` (Phase 2b) is self-contained; transport
  (Phase 3) must wait for cursor-hardening PR2 to avoid the documented file collision.
- **PN items feed both tracks** — D3/D5 are provider-native parity; verify Claude
  checkpointing/hooks (PN-6/7) before building the unified revert UX.

### Provider capability matrix (target state)

| Capability | Claude | Codex | Opencode | Cursor | Action |
|---|---|---|---|---|---|
| MCP management | ✅ | ❌→PN-1 | ✅ | ❌→PN-2 | unify control plane (D3) |
| Plan mode | ✅ | ✅ | gated→PN-4 | ✅ | ungate Opencode (D3) |
| Subagents | ✅ | ✅ | ✅ | gated→PN-3 | ungate Cursor (D3) |
| Rewind / checkpoint | ✅ | ❌→PN-5 | ACP-blocked | ❌ (auto only) | Codex via app-server (D5) |
| Hooks | ❌→PN-6 | — | permissions | 2.4 (post-cutoff) | Claude first (D5) |
| Citations | ❌ | ❌ | ❌ | ❌ | all via D2 |
| Secret storage | plaintext | plaintext | plaintext | plaintext | all via H1 |

---

## The Specorator question (explicit decision needed)

`docs/ideas/2026-05-28-standalone-product-vision.md` proposes renaming/migrating Claudian into
`Luis85/specorator` as a "spec-driven agent workspace." Its stated gate — **Agent Board MVP must
land first** — is now **met** (MVP + configurable lanes + templates shipped). The migration is the
next logical strategic step, *but* it is a product/identity decision, not a code task, and it
interacts with the naming defect (OBS-E). **Recommendation:** resolve OBS-E now in the
Claudian-identity direction (cheap, unblocks releases), and treat the Specorator migration as a
separate, explicitly-approved initiative sequenced **after** D4 (the Evidence & Review Gate is what
makes the "review every change with evidence" pitch real). Do not begin a broad rename mid-flight.

---

## Recommended next 3 PRs

1. **H1 secrets stopgap + store-compliance sweep** — move secrets out of synced paths + loud
   warning + `.gitignore` guidance (SEC-A stopgap); `innerHTML`/`normalizePath` audit (OBS-B/C);
   resolve the 3-way naming defect (OBS-E); YOLO→clear-label rename (UX-I). *Verification:* build +
   manual settings check + grep audits.
2. **D1 trust UX** — per-provider "Detect & Test" button (UX-A) + actionable runtime-error cards
   (UX-F) + composer keyboard a11y & stream live region (UX-E). *Verification:* targeted UI tests,
   keyboard/focus pass, manual provider check.
3. **H4 Phase 2b `RuntimeHost`** — pass host at construction, delete 7 setters + ~14 no-op stubs,
   add the cancel-dismiss invariant test for Claude + Codex and the typed `createMockRuntime` drift
   guard. *Verification:* `typecheck && lint && test && build`.

Keep each PR to one concern; capture provider runtime traces in `.context/` and promote only durable
fixtures.

## Out of scope

- New embeddings/RAG platform before explicit-context citations (D2 Phase A is the bound).
- Transport homogenization (ADR-0001 explicitly rejects it; keep four native transports).
- Cursor→ACP convergence (Cursor is diverging; do not chase).
- The Specorator rename itself (separate approved initiative — see §"The Specorator question").
- Re-opening closed-by-design items (SEC-1..6, CON-1..5, ARCH-1..8, OBS-1..5).

## Verification baseline (this proposal)

`npm run typecheck` ✅ · `npm run lint` ✅ (0 warnings) · 58 madge cycles (type-only, no runtime
risk) · 16 files >800 LOC · 368 test suites · perf gates green. Captured at `252929d`.
