---
title: Add GitHub Copilot as a fifth chat provider
date: 2026-06-05
status: idea
scope: provider-roster
priority: 2 - medium
owner: Claudian
tags:
  - provider
  - copilot
  - roadmap
  - research
relations:
  - "[[gemini-cli-provider]]"
  - "[[0001-transport-agnostic-provider-seam]]"
  - "[[Multi Provider Support]]"
source: deep-research 2026-06-05 (six-angle web survey + provider-seam inventory)
---

# Add GitHub Copilot as a fifth chat provider

## Executive summary

GitHub Copilot can be added to Claudian as a first-class chat provider, and the
path is now clean. The decisive enabler is the **official, GA GitHub Copilot
CLI** (`copilot`) and its embeddable sibling
[`@github/copilot-sdk`](https://github.com/github/copilot-sdk): an agentic
runtime with tool use, MCP, custom agents, streaming, structured output, and
native session resume. Critically, the CLI **speaks the Agent Client Protocol**
(`copilot --acp --stdio`) — the same transport Claudian's Opencode provider
already runs on (`src/providers/acp/`).

> **Recommendation:** add a `copilot` provider built on the **official Copilot
> CLI over ACP**, reusing the existing ACP transport (mirroring
> `OpencodeChatRuntime`). Use the CLI's `--output-format json` (JSONL) one-shot
> mode as a fallback transport (parsed like Cursor's stream-json). **Reject** the
> Copilot Language Server path (completion-only, non-agentic) and the direct
> `api.githubcopilot.com` chat API path (reverse-engineered, documented account
> suspensions).

This corrects an earlier tentative read that Copilot CLI lacked structured
output and headless resume. That conclusion came from GitHub's *programmatic
reference* docs page, which **lags the shipped binary**. The repo changelog shows
both features shipped (see [§Decisive findings](#decisive-findings)).

A working existence proof already exists in the wild: the
`go2engle/obsidian-github-copilot-integration` plugin drives streaming, agentic,
tool-using Copilot chat **inside Obsidian today** via `@github/copilot-sdk`.

## Problem / motivation

- **Roster parity.** Claudian hosts four providers (Claude, Codex, Opencode,
  Cursor). GitHub Copilot is the most widely adopted AI coding assistant; its
  absence is the most conspicuous roster gap. Competing embedded-agent plugins
  already ship it. This is the Copilot analog of the open
  [[gemini-cli-provider]] roster-parity issue.
- **Low marginal cost on the current seam.** ADR-0001's transport-agnostic
  provider seam plus the shared ACP transport mean a fifth provider — especially
  an ACP-speaking one — is largely a wiring-and-normalization exercise, not new
  infrastructure.
- **User pull.** Copilot subscribers (including the free tier) want to use their
  existing entitlement and model access (GPT-5.x, Claude Sonnet/Opus/Haiku 4.x,
  Gemini 3) from inside their vault without paying a second provider.

## Background: how a provider plugs in

Claudian's provider boundary is data-driven and pluggable (see
[[0001-transport-agnostic-provider-seam]]). Adding a provider requires **no core
type surgery**: `ProviderId` is `export type ProviderId = string`
(`src/core/types/provider.ts`), not a closed union. A new provider is:

- a `ProviderRegistration` + `ProviderWorkspaceRegistration`
  (`src/core/providers/types.ts`), wired in `src/providers/index.ts` via
  `ProviderRegistry.register('copilot', …)` / `ProviderWorkspaceRegistry.register('copilot', …)`;
- a `ProviderCapabilities` flag set that *gates* unsupported surfaces;
- a `ChatRuntime` (`src/core/runtime/ChatRuntime.ts`) producing a streaming
  async-generator of provider-neutral `StreamChunk` values (text / thinking /
  tool / usage);
- a self-contained `src/providers/copilot/` directory (runtime, history,
  settings, UI, auxiliary services, tool normalization).

Two reference templates already exist:

- **Opencode** — builds its runtime on the **shared ACP transport**
  (`src/providers/acp/`: JSON-RPC client, subprocess wrapper, tool stream
  adapter, update normalizer). This is the closest template for an ACP-speaking
  Copilot.
- **Cursor** — spawns a CLI directly and parses a **structured NDJSON stream**
  (`cursorStreamMapper`, `cursorToolNormalization`) without ACP. This is the
  template for the JSONL fallback transport.

## Integration mechanisms surveyed

Three real ways to reach Copilot from outside an official IDE, with verdicts for
Claudian's needs (an *agentic, streaming, tool-using* chat runtime):

| Mechanism | What it is | Agentic / tools | Streaming | Sanctioned? | Verdict |
|---|---|---|---|---|---|
| **Copilot CLI / `@github/copilot-sdk`** | Official agentic runtime; CLI process driven over ACP/JSON-RPC | ✅ full agent loop, MCP, custom agents | ✅ JSONL + ACP `session/update` | ✅ official | **Adopt** |
| **Copilot Language Server** (`@github/copilot-language-server`) | Official LSP engine for inline/panel/next-edit completions | ❌ `conversation/*` is a bounded, non-agentic chat facade | partial (panel via `partialResultToken`) | ✅ official | **Reject** — completion-only, wrong shape |
| **Direct `api.githubcopilot.com/chat/completions`** | Reverse-engineered OpenAI-compatible endpoint via `copilot_internal/v2/token` | ✅ `tools` pass-through | ✅ SSE | ❌ unsanctioned | **Reject** — ToS risk, account bans |

## Prior art: two Obsidian plugins (a natural experiment)

The two community plugins took **opposite** approaches — a clean A/B on exactly
this decision.

| | **Pierrad/obsidian-github-copilot** | **go2engle/...-integration** |
|---|---|---|
| Maturity | 484★, Apache-2.0, active since 2024 | 1★, MIT, new (2026-02), self-described "vibe coded" |
| Completion | Copilot **Language Server** over LSP (`@pierrad/ts-lsp-client`, bundled `language-server.js --stdio`) | — |
| Chat | **Direct HTTP** to `api.githubcopilot.com/chat/completions`; own device-code OAuth (`Iv1.b507a08c87ecfe98`), AES-256 token store; **no streaming**, **no tools** | **Official `@github/copilot-sdk`** → spawns `copilot` CLI over JSON-RPC |
| Streaming | ❌ await-full-JSON (blocked by Obsidian `requestUrl`) | ✅ incremental via `assistant.message_delta` |
| Agentic tools | ❌ | ✅ (auto-approves via `approveAll`) |
| Auth | Runs its own OAuth | Delegates to `copilot login` (CLI owns token) |

**Takeaways for Claudian.** (1) Plugin B proves the official CLI/SDK path drives
streaming agentic chat in Obsidian today, and its architecture matches Claudian's
spawn-a-CLI-and-parse-a-stream pattern exactly. (2) Plugin A's chat path is the
one to avoid (ToS risk; and `requestUrl` blocks streaming anyway). (3) Plugin B
auto-approves every tool (`approveAll`) — Claudian must instead route tool
approvals through its own `ApprovalManager`/safe-mode, not blanket-approve.

## Decisive findings

From the GitHub changelog (authoritative for shipped behavior) and official blog,
which **supersede the lagging programmatic-reference docs page**:

- **Structured output exists.** `--output-format json` shipped in **v0.0.415
  (2026-02-23)**, emitting **JSONL** in `-p` prompt mode. Feature request
  [copilot-cli#52](https://github.com/github/copilot-cli/issues/52) is **closed**,
  fulfilled. (No distinct `stream-json` alias — the mechanism is JSONL.)
- **Headless resume exists.** `--resume`, `--continue`, `--session-id=<id>`;
  transcripts stored as JSONL at `~/.copilot/session-state/<id>/events.jsonl`.
- **ACP transport exists.** `copilot --acp --stdio` (public preview 2026-01-28).
  Zed already runs Copilot CLI as an ACP external agent. This is the same protocol
  family as `src/providers/acp/`.
- **Official SDK is GA.** `@github/copilot-sdk` (GA 2026-06-02, MIT) embeds the
  same agent runtime (planning, tool/MCP invocation, file edits, streaming,
  multi-turn). It manages a CLI process over JSON-RPC under the hood.
- **CLI is GA & agentic.** Copilot CLI went GA 2026-02-25 with tool use, built-in
  GitHub MCP + custom MCP, and custom agents (`--agent`). It ships under a
  **custom GitHub Copilot CLI License** (not MIT) that forbids modifying or
  redistributing it standalone — only `@github/copilot-sdk` is MIT.

## Recommendation & proposed architecture

### Transport: ACP primary, JSONL fallback

**Primary — `copilot --acp --stdio` over `src/providers/acp/`.** Copilot's ACP
mode emits the same `session/update` events the existing ACP normalizer already
handles for Opencode, so a `CopilotChatRuntime` mirrors `OpencodeChatRuntime` and
inherits streaming, tool cards, and image support with the least new transport
code. *Risk to manage:* the `--acp` interface is newer and has seen flag churn
(the older `--headless --stdio` was removed ~v0.0.410), so pin a known-good CLI
version and add a capability/version probe at workspace init.

**Fallback — `copilot -p --output-format json` (JSONL), parsed like Cursor.** If
ACP proves unstable, spawn one-shot per turn and parse JSONL the way
`cursorStreamMapper` parses cursor-agent's stream-json, using
`--session-id`/`--resume` for continuity and reading
`~/.copilot/session-state/<id>/events.jsonl` for history hydration (the analog of
Cursor's `store.db` and Codex's JSONL). *Risk:* JSONL output ergonomics are still
maturing ([copilot-cli#3008](https://github.com/github/copilot-cli/issues/3008)).

**Do not** depend on `@github/copilot-sdk` directly: it bundles and manages its
*own* CLI process and transport, duplicating `src/providers/acp/` and fighting
Claudian's own-the-transport pattern. (Re-evaluate only if CLI flag churn makes
the SDK's stability worth the dependency.)

### Proposed file inventory (`src/providers/copilot/`)

Mirrors the Opencode/Cursor layout:

- `registration.ts` — `ProviderRegistration` (displayName "GitHub Copilot",
  capabilities, runtime/history/aux factories).
- `capabilities.ts` — `CopilotProviderState` capability flags (see matrix below).
- `types.ts` — `CopilotProviderState` (`{ sessionId?: string }`) + typed accessor.
- `settings.ts` — settings schema, defaults, getters/setters under
  `providerConfigs.copilot`.
- `runtime/CopilotChatRuntime.ts` — ACP-backed runtime (or JSONL fallback).
- `runtime/copilotToolNormalization.ts` — Copilot tool vocabulary → Claudian
  canonical tool names.
- `runtime/CopilotCliResolver.ts` + binary locator — resolve the `copilot` binary
  (PATH + per-host overrides), route child env through
  `providers/subprocessEnvironmentAllowlist`.
- `history/CopilotConversationHistoryService.ts` — hydrate/delete from
  `~/.copilot/session-state/<id>/events.jsonl`; validate session ids before any
  path join (cf. `cursorSessionIdValidation`).
- `env/CopilotSettingsReconciler.ts` — settings/env reconciliation.
- `ui/CopilotChatUIConfig.ts` + `ui/CopilotSettingsTab.ts` — model list,
  reasoning, settings tab.
- `auxiliary/Copilot{TitleGeneration,InstructionRefine,InlineEdit}Service.ts`.
- `app/CopilotWorkspaceServices.ts` — `ProviderWorkspaceRegistration`.

Core change is two lines in `src/providers/index.ts`. No edits to hardcoded
provider lists in `core/`/`features/`; no `providerId === 'copilot'` branches.

### Capability matrix (recommended path)

| Capability | Status | Notes |
|---|---|---|
| Send / stream / cancel | ✅ | ACP `session/update` or JSONL deltas |
| Native history reload + resume | ✅ | `--resume`/`--session-id`, `events.jsonl` |
| Tool-call cards / thinking / usage | ✅ | full agent loop |
| MCP tools | ✅ | built-in GitHub MCP + custom |
| Custom agents / subagents | ✅ | `--agent`, custom agents |
| Plan mode | ✅ likely | `--plan`/`--mode`/`--autopilot`; confirm in spike |
| Image attachments | ✅ | ACP + vision models |
| Inline edit, `#` instruction, `$` skills | ✅ | aux-query pattern (cf. Cursor) |
| Fork | ⚠️ gate initially | revisit once session model is confirmed |
| Rewind | 🔒 gate | no native support |

A realistic `capabilities.ts` is therefore strong:
`supportsNativeHistory: true`, `supportsMcpTools: true`, `supportsPlanMode: true`,
`supportsImageAttachments: true`, `supportsRewind: false`,
`supportsFork: false` (initially), `reasoningControl: 'none'`.

## Auth, subscription & licensing

- **No OAuth to implement.** Auth is CLI-owned: the user runs `copilot login`
  (device flow); the CLI stores the token (system keychain / `~/.copilot/`).
  Claudian just resolves the binary and lets the CLI manage auth — exactly how it
  treats other CLIs. Token precedence for headless use:
  `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`.
- **User's own entitlement required.** Every path requires the end user's own
  active Copilot subscription (the free tier counts; BYOK with another provider's
  key is also possible). The plugin grants no access of its own.
- **Licensing / packaging constraint.** The `copilot` CLI ships under a **custom
  GitHub Copilot CLI License** that prohibits modifying it or redistributing it on
  a standalone basis; only `@github/copilot-sdk` is MIT. Claudian must therefore
  **resolve a user-installed `copilot` binary** (`npm i -g @github/copilot` or
  Homebrew) and never bundle, fork, or patch it — consistent with how the
  Cursor/Codex/Opencode providers resolve user-installed CLIs, and a further
  reason to avoid depending on `@github/copilot-sdk` (which bundles the CLI).

## ToS / risk

- The official CLI/SDK path is **sanctioned**: GitHub-published clients
  authenticating as the user.
- The rejected direct-API path (`copilot_internal/v2/token` +
  `api.githubcopilot.com`, typically while spoofing `Copilot-Integration-Id:
  vscode-chat`) is **gray-area** and has produced documented GitHub Security
  warnings and **permanent Copilot revocations** (e.g. avante.nvim users). Staying
  on the official CLI keeps Claudian clear of this.

## Effort & sequencing

- **Effort:** following the Opencode (ACP) template rather than the heavier Cursor
  (raw-NDJSON) one, the streaming/history core is plausibly *lighter* than a
  from-scratch provider because the ACP transport already exists. Bulk of work:
  runtime wiring, Copilot tool normalization, settings/CLI resolution, history
  hydration, settings UI, and tests (unit-first, mirrored under `tests/`).
- **Sequencing:** land after ADR-0001 Phase 2b/3 (RuntimeHost + shared transport)
  so the fifth provider arrives on the tightened seam — same guidance as
  [[gemini-cli-provider]]. A Copilot + Gemini pair is a natural "roster parity"
  milestone.

## Spike plan (do this before writing provider code)

Per the repo's "inspect real runtime output first" rule, validate the transport
assumptions with throwaway captures in `.context/` before committing to ACP vs
JSONL:

1. `copilot --acp --stdio` against a scratch vault — capture the `session/update`
   stream for a turn that does a file read, an edit, and a shell command; confirm
   it maps cleanly onto the existing ACP update normalizer.
2. `copilot -p "…" --output-format json` — capture the JSONL; confirm text /
   thinking / tool-call / tool-result / usage records are recoverable.
3. Inspect `~/.copilot/session-state/<id>/events.jsonl` for a resumed session;
   confirm history hydration shape and the exact subfolder name (varies by
   version).
4. Decide ACP vs JSONL on the evidence, then promote findings into an ADR or this
   note and open the implementation issue.

## Acceptance criteria

- `copilot` registered as a provider with send / stream / cancel / resume at
  minimum; no `providerId === 'x'` branches; no edits to hardcoded provider lists
  in `core/`/`features/`.
- Tool approvals routed through Claudian's `ApprovalManager`/safe-mode (never a
  blanket `approveAll`).
- Child process env routed through `providers/subprocessEnvironmentAllowlist`;
  session ids validated before any path operation.
- Unsupported surfaces (rewind, and fork initially) gated via
  `ProviderCapabilities`, not stubbed in feature code.
- Unit tests mirror `src/providers/copilot/` under `tests/unit/`.

## Open questions

- ACP vs JSONL as the shipping transport (resolve in spike) — and how to absorb
  CLI flag churn (version pin + capability probe).
- Does Copilot's ACP plan/ask mode map onto the shared post-plan approval card
  (cf. Opencode's managed plan mode), or need bespoke handling?
- Exact `~/.copilot/session-state/...` path stability across CLI versions.
- Model catalog: discover at runtime (Copilot model set drifts) vs a curated
  default list; reuse the Cursor `--list-models`-style catalog pattern if Copilot
  exposes one.

## Sources

- **Plugins:** [Pierrad/obsidian-github-copilot](https://github.com/Pierrad/obsidian-github-copilot) ·
  [go2engle/obsidian-github-copilot-integration](https://github.com/Go2Engle/obsidian-github-copilot-integration)
- **Copilot CLI:** [repo](https://github.com/github/copilot-cli) ·
  [changelog](https://github.com/github/copilot-cli/blob/main/changelog.md) ·
  [GA](https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/) ·
  [ACP preview](https://github.blog/changelog/2026-01-28-acp-support-in-copilot-cli-is-now-in-public-preview/) ·
  [ACP server docs](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server) ·
  [issue #52](https://github.com/github/copilot-cli/issues/52)
- **Copilot SDK:** [github/copilot-sdk](https://github.com/github/copilot-sdk) ·
  [GA blog](https://github.blog/changelog/2026-06-02-copilot-sdk-is-now-generally-available/) ·
  [getting-started](https://github.com/github/copilot-sdk/blob/main/docs/getting-started.md)
- **Language Server:** [release repo](https://github.com/github/copilot-language-server-release) ·
  [SDK announce](https://github.blog/changelog/2025-02-10-copilot-language-server-sdk-is-now-available/)
- **Reverse-engineered API surface (rejected path):**
  [ericc-ch/copilot-api](https://github.com/ericc-ch/copilot-api) ·
  [Alorse/copilot-to-api](https://github.com/Alorse/copilot-to-api) ·
  [LiteLLM Copilot](https://docs.litellm.ai/docs/providers/github_copilot)
- **ToS / enforcement:**
  [Extension Developer Policy](https://docs.github.com/en/site-policy/github-terms/github-copilot-extension-developer-policy) ·
  [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies) ·
  [avante.nvim #557](https://github.com/yetone/avante.nvim/issues/557) ·
  [community #174325](https://github.com/orgs/community/discussions/174325)
</content>
</invoke>
