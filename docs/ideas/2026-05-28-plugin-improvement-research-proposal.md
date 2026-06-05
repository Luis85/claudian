---
tags:
  - deferred
priority: 3 - low
relations:
  - Quality
status: open
---
# Plugin improvement research proposal

Date: 2026-05-28
Revised: 2026-06-01 (status reconciliation against work landed since the original draft)
Branch: `docs/plugin-improvement-proposal`
Scope: Claudian Obsidian plugin, with emphasis on provider-backed agent chat, vault context, safety, MCP, reliability, and market positioning.
Related: [`docs/reviews/2026-05-31-codebase-review-and-improvement-plan.md`](../reviews/2026-05-31-codebase-review-and-improvement-plan.md), [`docs/adr/0001-transport-agnostic-provider-seam.md`](../adr/0001-transport-agnostic-provider-seam.md)

## Executive summary

Claudian already has a strong differentiator: it embeds real coding-agent runtimes (Claude Code, Codex, OpenCode, Cursor) directly inside an Obsidian vault, rather than reimplementing a shallow chat client. The next improvement wave should make that power understandable and trustworthy for Obsidian users.

The top product bet should be:

> **First trusted successful edit:** setup validation -> visible context -> cited response -> safe diff -> audit/revert.

The top architecture bet behind that product experience is a deep **`ComposerContextBuilder` Module** that normalizes context sources and source handles before provider prompt Adapters format them for Claude, Codex, OpenCode, or Cursor.

The first implementation wave should prioritize:

1. **Trust baseline gate:** safe action-review defaults, explicit danger-mode opt-in, provider setup health, and clear data-flow disclosure.
2. **Visible context and citations foundation:** context pills, send preview, attached-vs-workspace distinction, and source handles for cited answers.
3. **Audit and diagnostics foundation:** observe-only runtime audit events, redacted diagnostics, and release/support guardrails.
4. **Provider stream/history fixtures:** golden tests that protect provider-native stream and replay behavior before deeper refactors.

This is more strategically useful than starting with broad internal runtime refactors because it improves activation, trust, supportability, and competitive positioning immediately.

## Status reconciliation (revised 2026-06-01)

This proposal was drafted 2026-05-28. In the days since, two companion documents drove work that overlaps large parts of it, so this section records what now **holds**, what is **done**, and what is **superseded** — and the rest of the document is annotated inline to match.

- [`docs/reviews/2026-05-31-codebase-review-and-improvement-plan.md`](../reviews/2026-05-31-codebase-review-and-improvement-plan.md) — a seven-pass whole-codebase review. Its Phase 0 (CI green + lifecycle), Phase 1a (security defaults), Phase 1b (long-chat perf), Phase 1c (Obsidian conformance), Phase 2 (architecture de-coupling), and Phase 3 (guardrails) have **largely landed** across PRs #9–#19. It executed most of this proposal's Wave 0 trust/security defaults and its architecture-deepening items.
- [`docs/adr/0001-transport-agnostic-provider-seam.md`](../adr/0001-transport-agnostic-provider-seam.md) (proposed, 2026-06-01) — **supersedes** this proposal's "runtime capability resolver before splitting `ChatRuntime`" framing (Wave 3 §9) with a concrete, agreed seam design: a slim `ChatRuntimeCore` plus opt-in capability mixins, a declarative nested capability **descriptor**, a single `RuntimeHost` replacing the seven `setXxxCallback()` setters, a declarative tool manifest, and optional shared transport helpers.

**Net effect:** the trust-baseline and most of the internal architecture work this proposal called for is now done or governed by a more specific document. The **product/UX trust layer this proposal uniquely owns — visible context envelope, citations, Obsidian-safe edit routing, the audit/diagnostics center, the MCP workspace, the invocation catalog, and onboarding — is the still-open, highest-leverage remainder.** Build/release hygiene (CI build, Node alignment, repo naming, contributor docs) also remains open and is cheap.

### Initiative status

| Initiative | Section | Status (2026-06-01) | Evidence / cross-reference |
| --- | --- | --- | --- |
| Safe permission defaults (Claude `normal`, Codex `workspace-write`) | 0.1 | **Done** | `src/app/settings/defaultSettings.ts:11`; review SEC-1. Bypass/danger now require explicit `yolo` opt-in. |
| One-time danger-mode warning before YOLO | 0.1 | **Done** | `src/features/chat/tabs/tabUi.ts:484-490`; `yoloModeWarningShown` flag. |
| Per-vault trust gate for risky project settings + vault MCP default-disabled | 0.1 (implied) | **Done (stronger than proposed)** | `src/core/security/vaultTrust.ts`; review SEC-2/SEC-3. |
| Curated child env for stdio MCP spawns | 0.1 / 2.6 | **Done** | `McpServerManager.getActiveServers` (`curateStdioMcpEnv`); review SEC-4; proxy-URL credential stripping. |
| Replace user-facing "YOLO" label with clearer terms | 0.1 | **Open** | `*ChatUIConfig.ts` still show the `YOLO`/`Safe` toggle label. |
| Per-tab safety summary card | 0.1 / 4 | **Open** | No `SafetySummary` surface; data exists but is not assembled into a per-tab card. |
| CI runs `npm run build` | 0.2 | **Open** | `.github/workflows/ci.yml` runs lint/typecheck/test/coverage only. |
| Align CI/release Node versions | 0.2 | **Open** | CI Node 22 vs release Node 20. |
| Package allowlist / `npm pack` guard | 0.2 | **Open (low priority)** | No `files` field / `.npmignore` (1070 files in a dry run) — but this package is never published to npm, so the bloat is theoretical. |
| Release-artifact smoke (version sync, size, `minAppVersion`) | 0.2 | **Partial** | `scripts/release.mjs` + `scripts/test-build.mjs` assert the three assets exist; no size/version-sync check and not wired into CI. |
| `CONTRIBUTING.md` / `SECURITY.md` / PR template | 0.2 | **Open** | All absent. |
| Resolve fork/upstream repo naming | 0.2 / Risks | **Open (confirmed defect)** | `manifest.json` id `claudian-cursor`, author `YishenTu`; `README.md` links to `YishenTu/claudian`; `scripts/release.mjs` targets `Luis85/claudian`. Three-way mismatch. |
| `ComposerContextBuilder` normalized context envelope | 1.1 | **Open** | Not present; context still assembled across `InputController`, file-context state/view, selection controllers, and prompt encoders. |
| Explicit-context citations via `ContextSourceHandle` | 1.2 | **Open** | No `ContextSourceHandle` type. |
| `VaultEditRouter` / Markdown-safe edit routing | 1.3 | **Open (partial)** | OBS-4 moved work-order note writes to `vault.process()`; no general edit router. |
| Agent Safety & Audit Center | 2.4 | **Partial (scaffolded)** | `src/core/logging/` (leveled logger + redaction + ring buffer) and a diagnostics settings tab exist; copy/clear are stubbed (`diagnostics.ts` `TODO Phase F`). No `RuntimeAuditSink` / `RuntimeAuditEvent` / `RuntimeDiagnosticsSnapshot`. |
| Secret references / Obsidian `SecretStorage` | 2.5 | **Done (2026-06-05)** | PR #27 + follow-up fixes shipped Phases 0–4. API keys, MCP auth headers, and MCP env vars now persist via `app.secretStorage` (keychain). Substrate: `src/core/security/secretStore.ts`, `secretIds.ts`, `src/core/mcp/mcpSecrets.ts`, `src/features/settings/ui/SecretEnvVarsSection.ts`. `minAppVersion` bumped to 1.11.5. |
| MCP threat-model controls (risk labels, health, provenance, HTTPS/SSRF) | 2.6 | **Partial** | SEC-3/SEC-4 hardening done; per-server/per-tool enablement metadata exists; risk labels, health panel, provenance UI, and non-HTTPS/SSRF warnings open. `supportsMcpTools` is `true` only for Claude (Codex/Opencode/Cursor `false`). |
| `ExternalPathGrant` + network egress policy | 2.7 | **Partial** | External paths are a flat string list; SEC-5 added ACP vault containment; Codex has reactive per-session network approval. No grant model or configurable egress policy. |
| Provider stream/history golden fixtures | 3.8 | **Open** | No `ProviderStreamFixtureHarness`; the perf monitoring suite is a separate concern. |
| Runtime capability resolver / split `ChatRuntime` | 3.9 | **Superseded (Phase 2 partial, 2026-06-05)** | See ADR 0001. `RuntimeHost` interface designed and exported at `src/core/runtime/RuntimeHost.ts`. `ChatRuntime` still carries the seven `setXxxCallback()` setters; capability mixins, nested descriptor, and setter migration deferred to roadmap slices 4.3 / 4.4 in [[2026-06-05-plugin-improvement-roadmap]]. |
| `ConversationSessionEnvelope` | 3.10 | **Open (partial)** | `ConversationStore` extracted (ARCH-3) moved session/conversation CRUD out of `main.ts`; the envelope itself is unbuilt. |
| Provider setup / onboarding wizard + comfort profiles | 4.11 | **Partial** | A first-run banner exists; the wizard, comfort profiles, and instruction viewer/validator are open. |
| `ProviderInvocationCatalog` facade | 4.12 | **Open** | Not present. |
| Settings IA reorg + accessibility audit | 4.13 | **Open (partial)** | A diagnostics tab exists; the four-bucket IA reorg and a11y audit are open. Q-3 added `no-explicit-any` warn + coverage thresholds. |

### Corrections to the original findings

- **`Tab.ts` is no longer a god file.** It is now a 45-line re-export barrel; tab coordination was split into `src/features/chat/tabs/tabControllers.ts`, `tabFactory.ts`, `tabLifecycle.ts`, `tabUi.ts`, and `tabInputWiring.ts` (review ARCH-5a). `InputController.ts` (~1463 lines) and `StreamController.ts` (~1694 lines) remain large, but `QueuedMessageController` was extracted from the former and a provider-neutral stream-projection layer (ARCH-6) from the latter; only `ApprovalPromptController` is still pending.
- **"No central diagnostics/logging Module" was inaccurate.** `src/core/logging/` (a leveled, namespaced logger with redaction and a bounded ring buffer) and a typed `EventBus` already existed, and a "Diagnostics" settings tab with copy/clear log actions is scaffolded. Wave 2's diagnostics work is therefore an *extension* (audit events + redacted snapshot export), not greenfield.
- **The Phase 0 "baseline caveat" is resolved.** The file-context typecheck/test failures seen during research were not a real source defect — the review traced them to platform-coupled tests (win32 assertions running on POSIX CI), fixed them, and added a win32 + ubuntu CI matrix (review S0-1). The "re-run the targeted file-context suite before claiming a baseline failure" step is now moot.
- **The `core/` → `main.ts` coupling is being closed.** ARCH-1 extracted a narrow `PluginContext` interface and ARCH-2 routed provider defaults through registration; `madge` circular dependencies dropped 184 → 52.

## Status reconciliation (revised 2026-06-05)

Four days past the 2026-06-01 reconciliation. One major item shipped; one architecture item moved from design to partial implementation. The phase order in this proposal is now governed by a parent roadmap that decomposes the remaining open work into ordered child slices.

- **Secret references / Obsidian `SecretStorage` (§2.5):** **Done.** PR #27 and follow-up fixes merged Phases 0–4. Provider API keys, MCP auth headers, and MCP env vars now persist via `app.secretStorage` (keychain), not in vault config files. Substrate: `src/core/security/secretStore.ts`, `secretIds.ts`, `src/core/mcp/mcpSecrets.ts`, `src/features/settings/ui/SecretEnvVarsSection.ts`. Manifest `minAppVersion` bumped to 1.11.5.
- **ADR 0001 transport-agnostic provider seam (§3.9 — superseded):** **Partial.** `RuntimeHost` interface designed and exported at `src/core/runtime/RuntimeHost.ts`. `ChatRuntime` still carries the seven `setXxxCallback()` setters at lines 54-60; capability mixins, the nested capability descriptor, and the setter migration are deferred to roadmap slices **4.3** / **4.4**.

Forward planning now lives in:

- [`docs/superpowers/specs/2026-06-05-plugin-improvement-roadmap.md`](../superpowers/specs/2026-06-05-plugin-improvement-roadmap.md) — parent index over 26 ordered child slices across five tracks (release hygiene, context-trust UX, safety/audit/diagnostics, MCP + external/network, provider reliability + architecture, workflow expansion + accessibility).
- [`docs/superpowers/specs/2026-06-05-composer-context-builder-substrate-design.md`](../superpowers/specs/2026-06-05-composer-context-builder-substrate-design.md) — first child spec; the `ComposerContextBuilder` substrate (this proposal's named highest-leverage next bet, §1).

This proposal remains the canonical record of intent and rationale; the roadmap owns slice-level status.

## Decision framing

This proposal is intentionally not a grab bag. It separates **what should become visible to users now** from **what should be deepened internally after the visible trust loop exists**.

| Horizon | Primary question | Recommended focus |
| --- | --- | --- |
| Now | Can a new user connect a provider and safely get one useful edit? | Setup health, safe defaults, context preview, citations, diff/apply/revert, redacted diagnostics |
| Next | Can power users trust repeated agent work? | Audit events, MCP risk labels, external path grants, stream/history fixtures, workflow onboarding |
| Later | Can the architecture keep adding providers without getting shallow? | Runtime capability resolver, invocation catalog facade, session envelope, selective runtime Seams |

The practical test for every initiative should be: **does this reduce time-to-first-trusted-success, reduce support burden, or create a deeper Module with real Leverage and Locality?**

## Research method

This proposal combines:

- local repository exploration by dedicated architecture and quality subagents;
- web research against official Obsidian, MCP, Claude Code, and Codex sources;
- competitor research across Obsidian AI-chat, vault-MCP, and embedded-agent plugins;
- a second polishing wave with product/UX, security/privacy, engineering/architecture, and market/GTM reviews.

No product code was changed for this proposal.

## Local repository findings

Dedicated subagents inspected the repository without editing files and found these recurring friction points. *(See [Status reconciliation](#status-reconciliation-revised-2026-06-01) for what has since changed; corrections are noted inline below.)*

- `src/features/chat/controllers/InputController.ts` (~1463 lines) and `src/features/chat/controllers/StreamController.ts` (~1694 lines), plus provider runtimes, are large coordination Modules with many ordering constraints. *(Update: `Tab.ts` is no longer one of these — it is now a 45-line barrel after the ARCH-5a split; `QueuedMessageController` and a stream-projection layer have already been extracted.)*
- Context assembly is scattered across the composer, `src/features/chat/ui/FileContext.ts`, file-context state/view submodules, selection controllers, provider prompt encoders, MCP mention handling, image handling, and session persistence. *(Still holds — no `ComposerContextBuilder` exists.)*
- The `ChatRuntime` Interface is broad enough that newer provider Adapters implement no-op or unsupported methods (confirmed: Opencode/Cursor `rewind()` return `canRewind: false`). *(Now governed by ADR 0001.)*
- Provider stream projection is powerful but brittle: live provider events, history replay, renderer expectations, and tool/subagent normalization need golden parity tests. *(Still holds — no fixture harness exists.)*
- CI runs lint/typecheck/test (and now a coverage job) but does not run `npm run build`; release uses Node 20 while CI uses Node 22. *(Both still hold.)*
- A package dry run includes far more files than the Obsidian release needs (no `files`/`.npmignore`). *(Still holds, but low priority — the package is not published to npm.)*
- There is no automated accessibility audit, no CI-wired release-artifact smoke test, and no contributor-facing `CONTRIBUTING.md`/`SECURITY.md`. *(Correction: a central logging Module **does** exist — `src/core/logging/` with a leveled logger, redaction, and a ring buffer — plus a scaffolded Diagnostics settings tab; the original "no central diagnostics/logging Module" claim was inaccurate.)*
- Repository naming is inconsistent across the fork: `manifest.json` id `claudian-cursor` (author `YishenTu`), `README.md` links to `YishenTu/claudian`, and `scripts/release.mjs` targets `Luis85/claudian`. This is a concrete defect to resolve before release-facing work.

Baseline caveat *(resolved)*: the file-context typecheck/test failures one explorer saw were traced by the 2026-05-31 review to platform-coupled tests (win32 path assertions running on POSIX CI), not a source defect. They were fixed and a win32 + ubuntu CI matrix was added (review S0-1), so there is no current baseline failure to re-confirm.

## Web research themes

The web research reinforces six product constraints:

1. **Obsidian users expect local vault ownership and explicit sharing.** Obsidian positions vault data as local, while warning that community plugins can access files, network, and other system capabilities. Claudian should avoid vague “everything is local” phrasing and instead state what stays local, what is sent to providers, and what MCP/tooling can access.
2. **Obsidian plugin review favors disclosure and native UI discipline.** Official guidance emphasizes release assets, semantic versioning, no unnecessary telemetry, CSS-variable-friendly styling, sentence case, safe file APIs, and minimized production builds.
3. **MCP tools are now a mainstream agent integration seam.** The MCP specification models tools, resources, prompts, roots, sampling, and elicitation. Tool UX should keep humans in the loop, visibly show what tools are exposed/running, and treat tool metadata and outputs as untrusted unless the server is trusted.
4. **Claude Code and Codex normalize extensible agent workflows.** Current docs emphasize instructions (`CLAUDE.md` / `AGENTS.md`), skills, MCP, subagents, hooks, approval modes, local CLI workspaces, image inputs, and long-running tasks.
5. **Competitors converge on contextual vault chat.** Smart Composer, Copilot, Local LLM Hub, MCPVault, Vault as MCP, and similar tools emphasize `@` references, RAG/search, citations, one-click edits, MCP, local/private mode, and clear data-flow claims.
6. **Network and tool safety are differentiators.** Codex internet-access guidance warns about prompt injection, secret exfiltration, malware, vulnerable dependencies, and license risks. These risks map directly to a vault agent that can run commands or call MCP servers.

## 2026 market map

| Segment | Examples | Table stakes | Claudian implication |
| --- | --- | --- | --- |
| Vault RAG / writing copilots | Smart Composer, Copilot, Local LLM Hub/Helper | `@` context, citations, local/private models, one-click edits, multimedia inputs | Claudian must not look weaker on context/citations even if it is agent-first. |
| Vault-as-MCP bridges | Vault as MCP, MCP Connector, MCPVault | local server, auth token, semantic search, safe writes, Obsidian command tools | Claudian should become the UI/control plane over MCP risk, not just another MCP config editor. |
| Embedded agent runtimes | Claudian, Agent Client, NoClaw, Blackglass, Codeian, Claude Code IDE | Claude Code/Codex/Gemini/OpenCode inside Obsidian, sessions, modes, current-note context | Claudian’s edge is provider-native depth plus Obsidian-safe workflow, not merely launching a CLI. |
| IDE/agent runtimes outside Obsidian | Claude Code, Codex, Cursor, Windsurf | modes, MCP marketplaces, tool approvals, rules/memories, checkpoints, long-running tasks | Claudian should borrow expected agent UX patterns: setup validation, modes, tool visibility, checkpoints, and audit trails. |

Direct embedded-agent competitor implications:

- **Agent Client** shows that ACP-style multi-agent Obsidian plugins can compete on note mentions, images, slash commands, multi-session, floating chat, and mode/model switching.
- **NoClaw** points toward multi-engine agents, fallback chains, vault-stored identity/memory/skills, concurrent sessions, and permission guards.
- **Blackglass** owns a simpler “actual Claude Code terminal plus vault MCP” mental model.
- **Codeian** narrows to Codex-only `/`, `$`, `@`, and current-note confirmation.
- **Claude Code IDE** competes with a minimal read-only real-time editor-context bridge.

Strategic implication:

> Claudian should not compete by adding “more engines” alone. It should compete by making powerful engines safer, more inspectable, more Obsidian-native, and easier to support.

## Strategic positioning

Recommended positioning statement:

> **Claudian is the trusted agent runtime control plane for Obsidian: provider-native Claude Code/Codex/OpenCode behavior, wrapped in vault-native context, safety, citations, and reversible Markdown workflows.**

This positions Claudian against three alternatives:

- generic RAG chat plugins, where Claudian must match context/citation trust while offering deeper agent capability;
- vault-MCP bridges, where Claudian should be the user-facing safety and workflow layer;
- raw embedded terminals or thin CLI launchers, where Claudian should win through context UX, safe diffs, provider-neutral sessions, and diagnostics.

### Messaging pillars

- **Use the agents you already trust:** Claude Code, Codex, OpenCode, and compatible runtimes inside your vault.
- **Know what leaves your vault:** visible context preview, source pills, and citations.
- **Approve changes like a writer, not a developer:** Markdown-aware diffs, frontmatter/wiki-link preservation, undo/revert.
- **Make MCP safe enough for personal knowledge:** server health, tool toggles, approvals, and audit trail.
- **Keep workflows as files:** instructions, skills, agents, prompts, and memories stay as Markdown/TOML/JSONL in the vault or provider-native locations.

### Do-not-chase guidance

- Do not build a full embeddings platform before explicit-context citations and local search.
- Do not build a generic terminal clone; that simple mental model is already covered by other tools.
- Do not rely on unofficial subscription OAuth flows as a core differentiator.
- Do not hide provider differences behind a lowest-common-denominator layer; provider-native depth is the advantage.
- Do not introduce tiny Seams unless the deletion test shows real Leverage and at least two Adapters make the Seam real.

## Product principles for the next waves

1. **Make context visible before it is sent.** The user should see the current note, selections, files/folders, images, browser/canvas context, MCP resources, and external paths as inspectable pills/cards.
2. **Separate attached context from workspace access.** “Attached context” is sent with the next message; “available workspace” is what tools may read later; “external/tool context” may involve network, MCP, shell, or provider runtime behavior.
3. **Make agent power reversible or auditable.** Every write, shell command, MCP call, network action, external-path grant, approval, and denial should leave a reviewable trail.
4. **Use provider-native capabilities, but normalize the user experience.** Claude, Codex, OpenCode, and Cursor can differ internally; the UI should still expose consistent send/stream/cancel/history/fork/approval/tool-call patterns.
5. **Prefer deep Modules at real Seams.** Use Module, Interface, Implementation, Seam, Adapter, Depth, Leverage, and Locality consistently. One Adapter is a hypothetical Seam; two Adapters make it real.
6. **Treat Markdown as product data, not just files.** Wiki-links, frontmatter, tags, canvases, Bases, Dataview blocks, and active editor state should be preserved.

## User personas and journeys

### Personas

- **Note-taking power user:** wants help reorganizing, summarizing, and editing Markdown without losing links or frontmatter.
- **Developer using Obsidian as project workspace:** wants Claude Code/Codex-level agency without leaving the vault.
- **Privacy-sensitive researcher:** wants local vault control, explicit sharing, citations, and minimal telemetry risk.
- **MCP/subagent tinkerer:** wants tools, skills, subagents, and provider-native files to be discoverable and debuggable.

### Priority journeys

1. First install -> provider setup -> first successful current-note answer.
2. Attach current note/selection -> ask a grounded question -> receive cited answer.
3. Ask for an edit -> review Markdown diff -> apply -> undo/revert if needed.
4. Connect MCP tool -> inspect server/tool risk -> approve one call -> audit the result.
5. CLI/auth/provider failure -> copy redacted diagnostics -> recover without searching logs manually.

## Wave 0: Trust baseline and release hygiene

### 0.1 Trust baseline gate

**Recommendation strength:** Strong / P0

**Status (2026-06-01): mostly done.** Safe defaults (Claude `normal`, Codex `workspace-write`), a one-time danger-mode warning, a per-vault trust gate for risky project settings, vault MCP default-disabled, and curated child env all landed (review SEC-1/2/3/4). **Remaining:** replace the user-facing "YOLO" toggle label with clearer terms, add a per-tab safety summary card, and enrich approval cards (data-may-leave flag, diff preview).

**Problem**

Agent runtimes can be configured in high-trust modes. A new user should not silently start in a mode equivalent to bypassing permissions or using danger-full-access. Existing power users can keep high-trust modes, but the UI should make the risk explicit.

**Proposal**

- New installs should default to an action-review mode, not a silent bypass/danger mode.
- Existing high-trust users should see a one-time safety summary.
- “Bypass permissions,” “danger full access,” or equivalent modes should require explicit opt-in and be labeled as unsafe outside an isolated VM/container.
- Replace user-facing “YOLO” language with clearer labels such as **Review actions**, **Auto-approve workspace edits**, **Plan first**, and **Read-only**. Keep `yolo` only as an internal compatibility value if needed.

**Acceptance criteria**

- Claude `bypassPermissions` and Codex `danger-full-access` are never silent defaults for new installs.
- Safety summary shows provider, working directory, sandbox/permission mode, network mode, external roots, MCP servers, and inherited provider settings.
- Approval cards show action type, affected paths, whether data may leave the machine, provider/tool, one-time vs persistent approval scope, diff preview for edits, and keyboard/screen-reader behavior.

### 0.2 Build/release/packaging guardrails

**Recommendation strength:** Strong / P0

**Status (2026-06-01): open.** None of these guardrails have landed yet, and the fork/upstream naming mismatch is now a confirmed three-way defect (see below). `scripts/release.mjs` and `scripts/test-build.mjs` already assert the three release assets exist, but no version-sync/size smoke check is wired into CI. Version-sync tooling is `scripts/sync-version.js` (not the upstream template's `version-bump.mjs`).

**Issues found**

- CI runs lint/typecheck/test but not build.
- Release workflow uses Node 20 while CI uses Node 22.
- `npm pack --dry-run` includes source/tests/docs/workflow files, while Obsidian release assets are just `main.js`, `manifest.json`, and optional `styles.css`.
- README and release script repository naming should be checked for fork/upstream consistency.

**Proposal**

- Add `npm run build` to CI.
- Add a release-artifact smoke script that checks `main.js`, `manifest.json`, `styles.css`, version sync, `minAppVersion`, and production build size.
- Align Node versions across CI/release or document why they differ.
- Add package allowlist or `npm pack` guard.
- Add `CONTRIBUTING.md`, `SECURITY.md`, and a PR/release checklist.
- Add secret scanning and dependency/bundle review before releases.

## Wave 1: First trusted successful edit

### 1. Deepen the `ComposerContextBuilder` Module

**Recommendation strength:** Strong / P0

**Status (2026-06-01): open — now the single highest-leverage remaining bet.** No `ComposerContextBuilder` or `ContextSourceHandle` exists; context is still assembled imperatively across `InputController`, file-context state/view, selection controllers, and the provider prompt encoders. With Wave 0 trust defaults and most architecture de-coupling already done, this is the recommended next initiative.

**Problem**

Context is the product. Today, understanding what will be sent requires following `InputController`, file-context state, mention resolution, selection controllers, image context, MCP mentions, provider prompt encoders, and session persistence. That makes context bugs high-risk and hard to test.

**Current files/modules involved**

- `src/features/chat/controllers/InputController.ts`
- `src/features/chat/ui/FileContext.ts`
- `src/features/chat/ui/file-context/*`
- `src/features/chat/controllers/SelectionController.ts`
- `src/features/chat/controllers/BrowserSelectionController.ts`
- `src/features/chat/controllers/CanvasSelectionController.ts`
- `src/providers/claude/prompt/ClaudeTurnEncoder.ts`
- `src/providers/codex/prompt/encodeCodexTurn.ts`
- `src/providers/opencode/runtime/buildOpencodePrompt.ts`
- `src/providers/cursor/prompt/encodeCursorTurn.ts`

**Proposed Module Interface**

`ComposerContextBuilder` should produce a normalized context envelope, not provider prompt strings. Provider prompt formatting should stay in provider Adapters such as `encodeClaudeTurn`, `encodeCodexTurn`, `buildOpencodePromptText`, and `encodeCursorTurn`.

The envelope should include:

- display text and persisted conversation text;
- normalized context items for current note, files, folders, selections, browser/canvas context, images, MCP resources, and external paths;
- `ContextSourceHandle` entries for citations and future rendering;
- MCP mentions/resources as structured items;
- compact-command and instruction-mode flags;
- cleanup requirements for temporary assets;
- data-flow classifications:
  - `sourceKind`: current note, vault file, folder, selection, browser selection, canvas, image, MCP resource, external path, tool output;
  - `trustLevel`: user-authored, vault-local, external web, MCP/tool result, generated;
  - `destination`: provider API, local CLI, MCP server, transcript, audit log;
  - `sensitivity`: normal, secret-like, private note, external file, image;
  - `sendPreview`: exact or summarized preview shown before first send.

**UX requirements**

- Context pills show source type.
- Folder pills show file count, estimated tokens, excluded/private tags, and warnings for large folders.
- A “preview prompt context” drawer shows exactly what is attached now.
- A separate “agent workspace access” banner explains what tools may access later.

**Deletion test**

If this Module were deleted, the complexity would reappear across context UI, provider prompt Adapters, session reload, citation rendering, and tests. That means the Module earns its keep.

**Benefits**

- **Leverage:** one Interface feeds display, persistence, prompt Adapter input, source handles, safety disclosure, and tests.
- **Locality:** bugs around duplicated context, missing context, pills-vs-prompt mismatch, and citation metadata concentrate in one Implementation.
- Enables explicit-context citations without committing to a full embeddings/RAG system.

**First implementation slice**

1. Define envelope types, `ContextSourceHandle`, and pure builder tests.
2. Add golden unit tests for current-note, file, folder, selection, image, MCP, external path, compact, and instruction-mode cases.
3. Route `InputController` through the builder while preserving provider prompt Adapters.
4. Add context preview UI and source-handle rendering behind existing behavior flags where needed.

### 2. Contextual answers with citations and optional local retrieval

**Recommendation strength:** Strong, narrow first slice / P0

**Problem**

In the Obsidian AI market, citations are now table stakes. Claudian should not become a generic RAG chatbot first, but it should make agent answers auditable when they are grounded in explicitly attached context.

**Approach**

- Phase A: cite explicitly attached files, selections, current note, folders, browser selections, and MCP resources via `ContextSourceHandle`.
- Phase B: cite local keyword/metadata search results using Obsidian metadata/search APIs.
- Phase C: optional embeddings/MCP retrieval Adapter for users who want RAG.

**Benefits**

- Competitive parity on trust without overcommitting to an embeddings platform.
- Better source-grounded reports and safer edits.
- Clear privacy story: retrieval can remain local unless selected context is sent to the provider.

### 3. Obsidian-native edit safety and Markdown preservation

**Recommendation strength:** Strong / P0

**Problem**

Agent edits to Markdown should preserve active editor state, frontmatter formatting, wiki-links, tags, and user preferences. Official Obsidian guidance favors Editor API for active notes, `Vault.process` for atomic background writes, `FileManager.processFrontMatter` for frontmatter, `normalizePath()`, and trash-safe deletion.

**Proposed Module**

Create a `VaultEditRouter` Module and `WorkspaceEditPolicy` Module. Avoid calling this an Adapter until there is a real shared edit Interface with multiple Adapters.

Possible routing:

- active note edit -> Editor API/diff application;
- inactive Markdown edit -> `Vault.process`;
- frontmatter-only edit -> `FileManager.processFrontMatter`;
- rename/delete -> file-manager/trash-safe APIs;
- external context edit -> explicit `ExternalPathGrant` policy;
- provider-native CLI writes -> audit and post-hoc diff where interception is not feasible.

**Benefits**

- Safer one-click edits.
- Better Obsidian review alignment.
- More reliable diff previews and rollback.

## Wave 2: Safety, audit, and diagnostics

### 4. Create an Agent Safety and Audit Center

**Recommendation strength:** Strong / P0-P1

**Status (2026-06-01): partially scaffolded.** The substrate exists — `src/core/logging/` (leveled logger, `redact.ts`, bounded ring buffer), a typed `EventBus`, and a Diagnostics settings tab with copy/clear actions (currently stubbed: `diagnostics.ts` `TODO Phase F`). What remains is the audit layer proper: `RuntimeAuditEvent`/`RuntimeAuditSink`, a redacted `RuntimeDiagnosticsSnapshot`, and the per-tab safety summary. Build these as extensions of the existing logging Module rather than new infrastructure.

**Problem**

A vault agent can read/write notes, execute shell commands, access external paths, use provider CLIs, call MCP tools, and contact cloud providers. The product should make these powers visible and controllable in the workflow.

**Proposed Modules**

- `RuntimeAuditSink`
- `RuntimeAuditEvent`
- redaction helpers
- `RuntimeDiagnosticsSnapshot`
- provider-inherited-settings viewer

**Proposed user-facing surfaces**

- Per-tab safety summary: provider, model, working directory, action-review mode, active MCP servers, external paths, network mode.
- Session audit trail: shell commands, file writes/edits, MCP calls, approvals, denials, network-capable actions, errors.
- “Copy diagnostics” action with redacted environment and provider runtime state.
- Provider settings source viewer for inherited settings, hooks, MCP config, permission allow rules, and dangerous modes.
- README data-use matrix aligned with Obsidian review expectations.

**Audit privacy rules**

- In-memory ring buffer by default.
- Persistent/exported audit only with opt-in.
- Configurable retention.
- Redacted command/env/header/output fields.
- Store hashes or summaries for large outputs.
- “Copy diagnostics” excludes note content by default.
- Audit export includes a redaction report: what was omitted and why.

**Benefits**

- **Leverage:** one audit Interface supports debugging, user trust, review disclosures, and future safety features.
- **Locality:** permission and diagnostics behavior stops being scattered across provider runtimes/renderers/settings.
- Differentiates Claudian from generic AI-chat plugins by making agent power inspectable.

**First implementation slice**

Start observe-only. Feed audit events from existing approval/tool-call/rendering paths without claiming enforceable control over provider CLIs that may bypass plugin-level policies.

### 5. Secret references and redaction

**Recommendation strength:** Strong / P1

**Status (2026-06-01): open (redaction partially done).** Log redaction was broadened (review SEC-6), but API keys, MCP env vars, and HTTP headers still persist as plaintext in `.claudian/claudian-settings.json` / `.claude/mcp.json`, and Obsidian `SecretStorage`/`SecretComponent` is not used anywhere. The secret-reference work and plaintext-migration scan remain.

**Proposal**

- Store provider API keys, MCP env vars, HTTP authorization headers, and env snippets as secret references where possible, not plaintext in `.claudian/claudian-settings.json` or `.claude/mcp.json`.
- Use Obsidian `SecretStorage` / `SecretComponent` for user-entered secrets where the API surface supports it.
- Add migration scan for existing plaintext secrets.
- Add tests that diagnostics/audit exports/transcripts never include API keys, bearer tokens, MCP headers, environment values, or full home paths unless the user opts in.
- Redact by key pattern and by value fingerprinting.

### 6. MCP threat model and workspace experience

**Recommendation strength:** Strong / P1

**Status (2026-06-01): partially done.** Hardening landed (vault MCP default-disabled, per-vault trust gate, curated child env, proxy-credential stripping — review SEC-3/SEC-4), and per-server/per-tool enablement metadata exists via `_claudian.servers`. Still open: per-tool risk labels, a server health/status panel, provenance display, and non-HTTPS/SSRF warnings. Note `supportsMcpTools` is `true` only for Claude; Codex, Opencode, and Cursor all report `false`, so for those providers this stays audit/rendering visibility rather than config/control parity.

**Problem**

MCP is becoming a default agent integration layer. Claudian currently has provider-specific MCP behavior: Claude manages vault MCP in-app, while Codex currently has `supportsMcpTools: false` in shared capabilities even though Codex streams/history can render MCP-looking tool calls. Treat Codex MCP as audit/rendering visibility first, not config/control parity.

**Threat model controls**

- Treat MCP tool descriptions/annotations as untrusted unless the server is trusted.
- Show server provenance: stdio command, args, cwd, env-secret refs, remote URL, transport type.
- Default new MCP servers to enabled only after explicit confirmation.
- Add per-tool risk labels: read, write, shell, network, external data, credentialed.
- Warn/block remote MCP over non-HTTPS except loopback/dev.
- Warn for private IP/localhost redirects and SSRF-style metadata endpoints.
- Log tool-list changes and permission changes.
- Add output truncation plus “full output may contain untrusted instructions” disclosure.

**Workspace features**

- MCP server health/status panel.
- Tool/resource/prompt catalog with search.
- `@server:resource` or equivalent resource mentions where provider-supported.
- Per-server and per-tool enablement/disablement.
- Output-size controls and result truncation disclosures.
- Approval history and reset.
- Read-only mode for high-risk servers.
- Import/export for provider-native MCP config where safe.

### 7. External path and network egress policies

**Recommendation strength:** Strong / P1

**Status (2026-06-01): partially done.** External paths are still a flat string list (`persistentExternalContextPaths`), with no grant metadata; SEC-5 added defense-in-depth vault containment to ACP `read/writeTextFile`, and Codex already has reactive per-session network approval (`ApprovalNetworkContext`). The `ExternalPathGrant` model and a configurable egress policy remain to be built.

**ExternalPathGrant model**

- resolved absolute host path;
- target-provider path mapping;
- read-only vs writable;
- one-turn vs persistent;
- symlink/UNC/WebDAV status;
- hidden/system directory warning;
- root/home/parent-directory guardrails;
- audit entry for every external path read/write.

On Windows, warn about UNC/WebDAV-style paths because provider file access can trigger unexpected network requests.

**Network policy model**

- Default network disabled where provider supports it.
- Per-session allowed hosts and HTTP methods.
- Separate policies for provider API calls, MCP HTTP/SSE, shell commands, browser/web tools, and package managers.
- Approval UI should show host, method, command, cwd, and data source.
- Add warn/deny patterns such as `curl | sh`, POSTing vault data, `cat ~/.ssh/* | curl`, and package install from untrusted URL.

## Wave 3: Provider reliability and architecture deepening

### 8. Build provider stream/history golden fixtures

**Recommendation strength:** Strong / P1

**Status (2026-06-01): open.** No `ProviderStreamFixtureHarness` or cross-provider stream-parity test exists. The report-only perf monitoring suite that landed (`tests/perf/*`) is a separate concern and does not provide projection parity coverage. This becomes more valuable now that the ARCH-6 stream-projection extraction has separated projection from DOM rendering — projection can be fixture-tested without a DOM.

**Problem**

Rendering depends on provider-specific live events and provider-owned transcript formats. Codex has large live-stream and JSONL-history Modules; Claude has complex SDK branch filtering and stream deduplication. Without a cross-provider fixture harness, renderer regressions are likely.

**Current files/modules involved**

- `src/core/types/chat.ts` (`StreamChunk`)
- `src/providers/claude/stream/transformClaudeMessage.ts`
- `src/providers/claude/history/`
- `src/providers/codex/runtime/CodexNotificationRouter.ts`
- `src/providers/codex/runtime/CodexSessionFileTail.ts`
- `src/providers/codex/history/CodexHistoryStore.ts`
- `src/providers/opencode/normalization/`
- `src/providers/acp/AcpSessionUpdateNormalizer.ts`
- `src/features/chat/rendering/*`

**Proposed test harness**

Name this `ProviderStreamFixtureHarness`, not a production `ProviderStreamProjection` Interface. The production Interface is already `StreamChunk`; the provider Adapters are the normalizers and stream/history mappers.

Fixture shape:

```text
raw provider event(s) + projection mode -> expected StreamChunk[]
```

Include live-vs-history parity fixtures for text streaming, tool use/result, file write/edit, approval requests, ask-user/elicitation requests, usage, subagents, compact/history boundaries, abort/cancel/errors, and MCP-looking tool calls.

**First implementation slice**

Start with Codex because it has both live raw JSON-RPC and JSONL replay paths, then add Claude fixtures for stream deduplication and branch filtering.

### 9. Runtime capability resolver before splitting `ChatRuntime`

**Recommendation strength:** Worth exploring / P2

**Status (2026-06-01): superseded by [ADR 0001](../adr/0001-transport-agnostic-provider-seam.md).** The diagnosis here was right (the broad interface and Opencode/Cursor no-op `rewind()` are confirmed), but the agreed direction is no longer a `RuntimeCapabilityResolver`. ADR 0001 instead splits `ChatRuntime` into a slim `ChatRuntimeCore` plus opt-in capability mixins (`RewindCapable`, `SteerCapable`, `ForkCapable`, `SubagentCapable`), a declarative nested capability **descriptor** (presence-gates-feature, LSP/MCP/ACP convention), a single `RuntimeHost` replacing the seven `setXxxCallback()` setters, and a declarative tool manifest. Treat the ADR as the source of truth for this work; the text below is retained for the original rationale.

**Problem**

`ChatRuntime` has become a broad Interface. Providers that do not support a feature still need to implement stubs or negative behavior. However, splitting it into many tiny Interfaces too early can increase call-site complexity and create hypothetical Seams.

**Proposal**

- Add a `RuntimeCapabilityResolver` or tab-level capability facade first.
- Extract optional capability Modules only when at least two real Adapters make the Seam real.
- Prefer migrating one feature at a time, starting with a feature whose no-op code will actually disappear.
- Treat `RewindRuntime` and `SteerRuntime` as speculative until the deletion test shows Leverage.

**Benefits**

- Reduces unsupported-method probing without broad over-refactor.
- Keeps provider-native differences visible.
- Gives tests a clearer capability surface.

### 10. Deepen sessions into a `ConversationSessionEnvelope`

**Recommendation strength:** Worth exploring / P2

**Status (2026-06-01): open (partial).** ARCH-3 extracted a `ConversationStore`, moving conversation/session CRUD out of `main.ts`, so the "scattered in the UI controller" framing is partly addressed. The provider-neutral envelope itself is still unbuilt; revisit once context source handles (§1) and audit (§4) clarify what session state must carry.

**Problem**

Session persistence mixes UI metadata, provider-native session IDs, providerState, native history reload, context restore, fork metadata, MCP selections, usage, and special empty-session behavior.

**Proposed Module Interface**

`ConversationSessionEnvelope` should own:

- provider-neutral metadata shape;
- providerState projection/hydration;
- native history status and warnings;
- context restore policy;
- fork/source metadata;
- deletion/cleanup semantics;
- migration from older session metadata.

**Benefits**

- **Leverage:** one Interface for save, reload, resume, fork, compact, and deletion.
- **Locality:** session bugs concentrate outside the UI controller.
- Helps future “thread as note” or “conversation archive in vault” features.

## Wave 4: Workflow expansion and settings IA

### 11. Provider setup, instruction, and workflow onboarding

**Recommendation strength:** Strong / P0-P1

**Status (2026-06-01): partially done.** A first-run banner exists; the setup wizard, comfort profiles, provider health card, and instruction viewer/validator remain open.

**Problem**

Claude Code and Codex both rely on instruction files and reusable workflows (`CLAUDE.md`, `AGENTS.md`, skills, subagents/hooks). Users can get confused by where these files live and how provider precedence works.

**Proposed features**

- First-run provider setup wizard: CLI detected, auth state, working directory, action-review mode, MCP enabled/disabled.
- Comfort profiles: **Read-only review**, **Ask before edits**, **Agentic workspace**.
- Provider health card near the top of settings.
- Instruction file viewer/validator for `CLAUDE.md`, `AGENTS.md`, `.codex/skills`, `.claude/skills`, `.claude/agents`, `.codex/agents`.
- “Create vault instruction” wizard with provider-specific templates.
- Skill/subagent health checks: missing files, invalid frontmatter/TOML, disabled tools, provider unsupported capabilities.

### 12. Invocation catalog as facade, not replacement

**Recommendation strength:** Worth exploring / P1

**Problem**

Slash commands, `$` skills, `@` mentions, MCP servers/resources, provider runtime commands, and subagents are related from the user’s point of view: they are all ways to invoke reusable capability. Today they sit behind different Modules and dropdowns.

**Proposal**

Frame `ProviderInvocationCatalog` as an aggregator/facade over existing provider-owned catalogs, not a replacement for `ProviderCommandCatalog`, `AgentMentionProvider`, skill catalogs, and runtime command loaders.

Entries could include:

- kind: command, skill, agent, subagent, MCP server, MCP resource, MCP prompt, tool;
- provider ownership and capability flags;
- display title/description/icon;
- invocation syntax and insertion behavior;
- editability and storage location;
- hidden/disabled reason;
- safety classification.

### 13. Settings information architecture and accessibility

**Recommendation strength:** Strong / P1

**Settings IA proposal**

- **Basic:** provider enablement, model, safe mode, CLI/auth status.
- **Workflow:** skills, commands, subagents, instructions.
- **Integrations:** MCP, external paths, browser/Chrome.
- **Advanced:** env vars, custom models, context limits, diagnostics.

**Accessibility acceptance criteria**

- Keyboard-only chat, context preview, approvals, and settings.
- ARIA labels for icon buttons.
- Live regions for streaming/status updates.
- Focus restoration after modals/dropdowns.
- Contrast across Obsidian themes.
- Reduced-motion support.
- jsdom/axe-style tests plus manual screen-reader pass for approval cards and setup flow.

**Empty/error states**

- CLI not found.
- Provider unauthenticated.
- MCP server down.
- Context too large.
- File excluded/private.
- Approval denied.
- Stream interrupted.

## Provider matrix for priority initiatives

| Initiative | Claude | Codex | OpenCode | Cursor |
| --- | --- | --- | --- | --- |
| `ComposerContextBuilder` | Normalized context items feed Claude prompt Adapter and MCP mentions | Normalized context items feed app-server inputs/images/collaboration mode | Normalized context items feed prompt/ACP mapping as applicable | Normalized context items feed Cursor prompt encoding |
| Trust baseline | Permission mode summary and bypass warning | Sandbox/approval summary and danger-mode warning | Provider-specific action mode summary | CLI/runtime action summary |
| Safety/audit center | Approval handler, SDK tool chunks, MCP server updates | Server-request router, JSON-RPC events, approval modes, MCP-looking tool visibility | ACP/tool normalization | CLI commands and stream mapper |
| Stream fixtures | SDK messages, JSONL branch history | JSON-RPC raw events and JSONL replay parity | ACP normalization fixtures | CLI stream fixtures |
| MCP workspace | In-app Claude MCP management | Audit/rendering first; shared config only when provider capability supports it | Provider-specific MCP story | Provider-specific MCP story |
| Invocation catalog | Slash commands, skills, agents, MCP | Skills/subagents and provider-supported commands | Runtime commands, agents | Cursor commands/models |
| Session envelope | Claude session IDs, branch/fork, sidecars | Thread/session file path, fork metadata | Provider history store | Cursor history store |

## Feature adoption/support matrix

| Feature | Adoption impact | Support impact | Competitive impact | Priority |
| --- | ---: | ---: | ---: | --- |
| Provider setup checklist | High | Very high | Medium | P0 |
| Context preview/citations | Very high | High | Very high | P0 |
| Diff/apply/revert audit | Very high | High | High | P0 |
| Trust baseline / safe defaults | High | Very high | High | P0 |
| MCP health/tool toggles | High | High | High | P1 |
| Redacted diagnostics | Medium | Very high | Medium | P1 |
| Invocation catalog | Medium-high | Medium | High | P1 |
| Full runtime Interface split | Low visible | Medium | Low | P2 |
| Conversation envelope | Medium | Medium | Medium | P2 |

## Suggested implementation order

### Phase 0: Stabilize and gate trust — *mostly complete (2026-06-01)*

The 2026-05-31 review already landed the substance of this phase. Remaining items are narrow:

- ~~Confirm clean worktree; re-run file-context typecheck/tests.~~ Done — CI is green on win32 + ubuntu (S0-1); the prior failure was platform-coupled tests, not a source defect.
- ~~Add trust baseline gate for new installs and dangerous modes.~~ Done — safe defaults, one-time danger warning, per-vault trust gate (SEC-1/2/3).
- **Still open:** add `npm run build` to CI; align CI/release Node versions; add a CI-wired artifact smoke (version sync, size, `minAppVersion`); add `CONTRIBUTING.md`/`SECURITY.md`; **resolve the `claudian-cursor` / `YishenTu` / `Luis85` naming mismatch** across `manifest.json`, `README.md`, and `scripts/release.mjs`.
- **Carried into Phase 1:** replace the user-facing "YOLO" label with clearer terms.

### Phase 1: First trusted successful edit

- Implement `ComposerContextBuilder` as a pure Module with source handles and golden tests.
- Add visible context preview and attached-vs-workspace explanation.
- Add explicit-context citations.
- Add safe diff/apply/revert path for plugin-initiated edits.

**Phase 1 definition of done**

- A fresh user can see provider setup status before the first send.
- The chat composer can show exactly which context is attached to the next message.
- The UI separately explains broader workspace/tool access.
- A current-note answer can cite the note or selected range that grounded it.
- A plugin-initiated edit can be reviewed as a Markdown diff and reverted.
- A failed setup or turn can produce redacted diagnostics without note contents by default.

### Phase 2: Audit and diagnostics

- Add `RuntimeAuditEvent`, `RuntimeAuditSink`, and per-session in-memory audit trail.
- Add “copy diagnostics” with redaction and no note content by default.
- Add provider health card and settings source viewer.

### Phase 3: Provider reliability

- Add `ProviderStreamFixtureHarness`, starting with Codex live/history parity.
- Add Claude stream dedupe and branch-history fixtures.
- Add prompt-injection security fixtures for Markdown, browser selections, MCP outputs, dependency READMEs, GitHub issue text, image OCR text, Dataview, and canvas content.

### Phase 4: Product expansion

- First-class MCP workspace panel.
- External path grants and network egress policy.
- Invocation catalog facade.
- Instruction/workflow onboarding.
- Settings IA and accessibility pass.

### Phase 5: Architecture deepening

- Introduce `RuntimeCapabilityResolver` before splitting `ChatRuntime`.
- Migrate one real capability Seam at a time.
- Explore `ConversationSessionEnvelope` once context/audit/session source handles are clearer.

## Candidate PR sequence

The roadmap should be implemented as small, reviewable PRs. A suggested sequence, **re-based on what has landed** (PRs 1–2 are now reduced to their remaining slices):

| PR | Goal | Main files likely touched | Verification |
| --- | --- | --- | --- |
| 1 | Add `npm run build` + artifact smoke to CI; align Node versions; fix repo naming (`manifest.json`/`README.md`/`scripts/release.mjs`) | `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `scripts/`, `manifest.json`, `README.md` | `npm run build`, artifact smoke, manual naming audit |
| 2 | Replace user-facing "YOLO" label with clearer action-review terms (internal `yolo` value kept) | `src/providers/*/ui/*ChatUIConfig.ts`, i18n | targeted UI tests, manual settings check |
| 3 | Introduce pure `ComposerContextBuilder` types/tests with no UI behavior change | new context Module, `InputController` tests | builder golden tests, `npm run typecheck` |
| 4 | Add visible context preview and attached-vs-workspace explanation | chat composer/context UI and styles | context UI tests, keyboard/focus checks |
| 5 | Add explicit-context source handles and citation rendering | context builder, renderer, tests | citation fixture tests |
| 6 | Add observe-only audit events and redacted diagnostics | runtime/rendering audit sink, diagnostics snapshot | redaction tests, no note-content export by default |
| 7 | Add Codex live/history stream fixture harness | Codex runtime/history tests and fixtures | live-vs-history parity fixtures |

Keep each PR to one concern. If a PR needs provider runtime traces, capture them in `.context/` first and promote only durable fixtures.

## Open questions before implementation

*Update (2026-06-01): the first question is now largely answered in code — see below.*

- ~~What should be the exact safe default for each provider on new installs, and how should existing high-trust users be migrated?~~ **Answered:** Claude defaults to `normal`, Codex to `workspace-write`; `yolo` is explicit opt-in with a one-time warning, and existing installs are handled by the per-vault trust gate plus the SEC-3 grandfather migration. The remaining sub-question is the user-facing *label* for these modes (last bullet below).
- Which provider settings are genuinely controllable by Claudian versus inherited from provider CLI/user/project config?
- What is the minimal `ContextSourceHandle` shape needed for citations without committing to a full retrieval system?
- Which edits can Claudian safely route through Obsidian APIs, and which provider-native writes can only be audited after the fact?
- Should diagnostics ever include provider transcript paths or session IDs by default, or only after explicit user confirmation?
- What is the user-facing term for action-review modes across providers: “Review actions,” “Approval mode,” or another phrase?

## Verification strategy

For each implementation PR:

1. Add or update tests at the new Module Interface first.
2. Run the smallest targeted Jest suite for the changed Module.
3. Run `npm run typecheck` and `npm run lint`.
4. For provider stream/history changes, run golden fixture parity tests.
5. For trust/security changes, run prompt-injection and redaction fixtures.
6. Before merge, run `npm run test` and `npm run build`.
7. For user-facing UI changes, manually verify in Obsidian with at least one Claude and one Codex/OpenCode/Cursor tab where credentials are available.

## Success metrics without telemetry

Claudian should not add client-side telemetry to answer product questions. Use local/manual/support-oriented metrics instead:

- Time to first successful provider connection in dogfood runs.
- Time to first current-note answer.
- Time to first accepted edit.
- Citation coverage for vault-grounded answers in fixture tasks.
- Percentage of tool/MCP calls represented by audit events in tests.
- Setup failure categories from opt-in issue templates/diagnostics exports.
- Support issues per provider/platform release.
- Revert/undo usage observed in dogfood sessions.
- Accessibility checklist pass/fail per release.

## Risks and tradeoffs

- **False local-first promise:** “Local-first always” can mislead because provider CLIs/cloud APIs may receive vault context. Prefer “local vault, explicit sharing.”
- **Safety theater:** If provider CLIs can bypass plugin controls, label policies as best-effort and disclose boundaries.
- **Context ambiguity:** Users may confuse “attached now” with “agent can access later.” The UI must separate attached context from workspace/tool access.
- **Provider-native drift:** Claude Code, Codex, OpenCode, and Cursor can change event formats and capabilities. Golden fixtures need updates from real runtime traces.
- **Over-normalization risk:** A unified UI should not hide provider-specific strengths. Provider-native features should remain accessible where meaningful.
- **RAG scope creep:** Retrieval/citations should begin with explicit context and local search before adding embeddings.
- **Safety friction:** More approvals can annoy power users. Provide comfort profiles and scoped “allow for this session” controls.
- **Obsidian API limitations:** Some safe-edit paths require active editor context; background edits need careful fallbacks.
- **Fork/upstream confusion:** Manifest/release repo naming should be resolved before release-facing changes.

## Source map

Official and primary sources used during research:

- Obsidian submit-plugin release requirements: https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin
- Obsidian plugin self-critique and guidelines: https://docs.obsidian.md/oo/plugin
- Obsidian optimize plugin load time: https://docs.obsidian.md/plugins/guides/load-time
- Obsidian SecretStorage guide: https://docs.obsidian.md/plugins/guides/secret-storage
- Obsidian manifest reference: https://docs.obsidian.md/Reference/Manifest
- Obsidian privacy policy: https://obsidian.md/privacy
- Obsidian security/plugin safety: https://obsidian.md/security and https://obsidian.md/help/plugin-security
- MCP specification: https://modelcontextprotocol.io/specification/2025-11-25
- MCP architecture overview: https://modelcontextprotocol.io/docs/learn/architecture
- MCP tools specification: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- MCP security best practices: https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices
- Claude Code features overview: https://code.claude.com/docs/en/features-overview
- Claude Code MCP docs: https://code.claude.com/docs/en/mcp
- Claude Code security and permission modes: https://code.claude.com/docs/en/security and https://code.claude.com/docs/en/permission-modes
- Claude Code subagents: https://docs.anthropic.com/en/docs/claude-code/sub-agents
- OpenAI Codex overview/use cases: https://developers.openai.com/codex and https://developers.openai.com/codex/explore/
- OpenAI Codex AGENTS.md guidance: https://developers.openai.com/codex/guides/agents-md
- OpenAI Codex internet access guidance: https://developers.openai.com/codex/cloud/internet-access
- Smart Composer competitor reference: https://github.com/glowingjade/obsidian-smart-composer and https://community.obsidian.md/plugins/smart-composer
- Copilot for Obsidian Vault QA reference: https://www.obsidiancopilot.com/en/docs/vault-qa
- Local/private AI plugin examples: https://community.obsidian.md/plugins/local-llm-hub and https://community.obsidian.md/plugins/vault-as-mcp
- MCPVault reference: https://mcp-obsidian.org/
- Agent Client reference: https://github.com/RAIT-09/obsidian-agent-client
- NoClaw reference: https://community.obsidian.md/plugins/noclaw
- Blackglass reference: https://community.obsidian.md/plugins/blackglass
- Codeian reference: https://community.obsidian.md/plugins/codeian
- Claude Code IDE reference: https://community.obsidian.md/plugins/claude-code-ide

## Decision request

With the trust baseline already in place (Wave 0 SEC-1/2/3/4), the single next initiative should be **`ComposerContextBuilder` + visible context preview + source-handle tests**. It has the highest Leverage because it feeds context UX, prompt Adapter input, citations, session reload, safety disclosure, diagnostics, and future provider Adapter simplification — and it is the largest remaining product-trust gap now that defaults, lifecycle, and architecture de-coupling have been addressed elsewhere.
