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
path is now clean. The integration surface is the **official, GA
[`@github/copilot-sdk`](https://github.com/github/copilot-sdk)** (MIT) — GitHub's
supported programmatic wrapper over the Copilot agent — driving the user's
installed **Copilot CLI** (`copilot`): an agentic runtime with tool use, MCP,
custom agents, streaming, structured output, and native session resume. The same
agent is also reachable as raw JSONL (`copilot -p --output-format json`) and over
ACP (`copilot --acp`), which give Claudian a no-dependency fallback and a
contingency that reuses its existing ACP transport (`src/providers/acp/`).

> **Recommendation:** add a `copilot` provider built on the **official
> `@github/copilot-sdk`**, configured to drive a *user-installed* `copilot` CLI
> (`cliPath` + allowlisted `env` + vault `cwd` + `onPermissionRequest` →
> `ApprovalManager`). Keep `copilot -p --output-format json` JSONL as a
> no-dependency fallback, and `copilot --acp` over `src/providers/acp/` as a
> contingency. **Reject** the Copilot Language Server (editor-completion only —
> out of scope) and the direct `api.githubcopilot.com` chat API
> (reverse-engineered, documented account suspensions).

This corrects an earlier tentative read that Copilot CLI lacked structured output
and headless resume. That conclusion came from GitHub's *programmatic reference*
docs page, which **lags the shipped binary**. The repo changelog shows both
features shipped (see [§Decisive findings](#decisive-findings)).

A working existence proof already exists in the wild: the
`go2engle/obsidian-github-copilot-integration` plugin drives streaming, agentic,
tool-using Copilot chat **inside Obsidian today** via `@github/copilot-sdk` — i.e.
it is literally the transport this note recommends.

## Problem / motivation

- **Roster parity.** Claudian hosts four providers (Claude, Codex, Opencode,
  Cursor). GitHub Copilot is the most widely adopted AI coding assistant; its
  absence is the most conspicuous roster gap. Competing embedded-agent plugins
  already ship it. This is the Copilot analog of the open
  [[gemini-cli-provider]] roster-parity issue.
- **Low marginal cost on the current seam.** ADR-0001's transport-agnostic
  provider seam plus GitHub's official SDK (which owns spawn, JSON-RPC, resume,
  and auth detection) mean a fifth provider is largely a wiring-and-normalization
  exercise, not new infrastructure.
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

No single existing provider is a perfect template, but two are close:

- **Claude** already depends on an *official vendor SDK* rather than parsing a raw
  stream — it's the precedent for the SDK-driven approach this note recommends.
- **Cursor / Opencode** show the CLI-subprocess discipline (env allowlist,
  Windows spawn, cancellation) and the stream → `StreamChunk` normalization the
  Copilot runtime still needs, whichever transport wins.

## Integration mechanisms surveyed

Three real ways to reach Copilot from outside an official IDE, with verdicts for
Claudian's needs (an *agentic, streaming, tool-using* chat runtime):

| Mechanism | What it is | Agentic / tools | Streaming | Sanctioned? | Verdict |
|---|---|---|---|---|---|
| **Copilot CLI / `@github/copilot-sdk`** | Official agentic runtime; CLI process driven over JSON-RPC (SDK), JSONL (`-p`), or ACP | ✅ full agent loop, MCP, custom agents | ✅ SDK deltas / JSONL / ACP `session/update` | ✅ official | **Adopt** |
| **Copilot Language Server** (`@github/copilot-language-server`) | Official LSP engine for inline/panel/next-edit completions | ❌ `conversation/*` is a bounded, non-agentic chat facade | partial (panel via `partialResultToken`) | ✅ official | **Reject — out of scope** (editor completion only) |
| **Direct `api.githubcopilot.com/chat/completions`** | Reverse-engineered OpenAI-compatible endpoint via `copilot_internal/v2/token` | ✅ `tools` pass-through | ✅ SSE | ❌ unsanctioned | **Reject** — ToS risk, account bans |

Claudian integrates providers as **chat/agent runtimes**, not editor autocomplete,
so the Language Server is out of scope *by design* — Copilot ghost-text while
typing is a non-goal here.

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

**Takeaways for Claudian.** (1) Plugin B proves the official SDK path drives
streaming agentic chat in Obsidian today — it is the transport this note
recommends — and matches Claudian's spawn-a-CLI-and-talk-JSON-RPC pattern. (2)
Plugin A's friendly "login with GitHub" is the same GitHub **device flow** the
sanctioned CLI uses (`copilot login`); the risky part is its *chat* path (the
reverse-engineered API), not the login UX — so the smooth login is reproducible
safely. (3) Plugin B auto-approves every tool (`approveAll`) — Claudian must
instead route tool approvals through its own `ApprovalManager`/safe-mode via the
SDK's `onPermissionRequest`, never blanket-approve.

## Decisive findings

From the GitHub changelog (authoritative for shipped behavior) and official blog,
which **supersede the lagging programmatic-reference docs page**:

- **Structured output exists.** `--output-format json` shipped in **v0.0.421
  (2026-03-03)**, emitting **JSONL** in `-p` prompt mode — so require **≥ 0.0.421**
  before enabling the JSONL path. Feature request
  [copilot-cli#52](https://github.com/github/copilot-cli/issues/52) is **closed**,
  fulfilled. (No distinct `stream-json` alias — the mechanism is JSONL.)
- **Headless resume exists.** Resume a known session with `copilot --resume <id>`
  (or `--continue` for the latest session in the cwd, v1.0.52); `--session-id=<id>`
  (v1.0.51) additionally lets you assign a specific session UUID. These flags are
  **changelog-only — undocumented in the official CLI reference** — so pin a CLI
  version and probe before relying on them. Transcripts are stored as JSONL at
  `~/.copilot/session-state/<id>/events.jsonl`.
- **Official SDK is GA.** `@github/copilot-sdk` (GA 2026-06-02, MIT) embeds the
  same agent runtime (planning, tool/MCP invocation, file edits, streaming,
  multi-turn). It drives the CLI as a JSON-RPC server and owns the process
  lifecycle. `CopilotClientOptions` exposes `cliPath`, `env`, `cwd`, `logLevel`,
  `autoStart`/`autoRestart`, `start()`/`stop()`/`forceStop()`, `resumeSession()`,
  and `onPermissionRequest` (see [§Recommendation](#recommendation--proposed-architecture)).
- **ACP transport exists.** `copilot --acp --stdio` (public preview 2026-01-28).
  Zed already runs Copilot CLI as an ACP external agent. This is the same protocol
  family as `src/providers/acp/` — the basis for the contingency transport.
- **CLI is GA & agentic.** Copilot CLI went GA 2026-02-25 with tool use, built-in
  GitHub MCP + custom MCP, and custom agents (`--agent`). It ships under a
  **custom GitHub Copilot CLI License** (not MIT) that forbids modifying or
  redistributing it standalone — only `@github/copilot-sdk` is MIT.

## Recommendation & proposed architecture

### Transport: official SDK primary, JSONL fallback, ACP contingency

**Primary — `@github/copilot-sdk` driving a *user-installed* `copilot` CLI.** The
SDK is GitHub's GA, MIT-licensed, officially supported programmatic surface over
the Copilot agent, and it's the most on-pattern choice: Claudian's
"provider-native first" rule already has the **Claude** provider depend on an
official vendor SDK rather than parse a raw stream. Crucially, `CopilotClientOptions`
exposes every control Claudian treats as non-negotiable, so adopting the SDK does
**not** forfeit Claudian's spawn discipline:

| Claudian requirement | SDK option |
|---|---|
| Resolve a *user-installed* binary (license + no native-binary bundling) | `cliPath` |
| **Allowlisted** child env (hard `core/` security rule) | `env` — pass an *explicit* allowlisted env; the default is `process.env` |
| Vault working directory | `cwd` |
| Lifecycle / cleanup / cancel | `start()` / `stop()` / `forceStop()`, `autoStart`, `autoRestart` |
| Native resume / history | `resumeSession()` |
| Route approvals through `ApprovalManager` (never `approveAll`) | `onPermissionRequest` |
| Map to `StreamChunk` | typed `assistant.message_delta` + tool events |

*Why over a raw CLI bind:* the CLI's programmatic seam is churny (`--headless
--stdio` was removed and replaced by `--acp`; `--output-format json` and the
resume flags are changelog-only/undocumented). The SDK is GitHub's **stable
contract** over that churn, and absorbs CLI version drift behind a typed API.

*Packaging caveat — the main risk, validate in the spike:* the SDK's npm package
*bundles* a copy of the CLI, but an Obsidian plugin ships a single esbuild'd
`main.js` and must **not** ship a native binary. Mark the SDK `external` and point
`cliPath` at the user-installed `copilot`; don't rely on the bundled copy. (Plugin
B sidesteps this by requiring `copilot` on PATH.)

**Fallback — `copilot -p --output-format json` (JSONL), no SDK dependency.** If
the SDK can't be bundled cleanly, spawn one-shot per turn and parse JSONL the way
`cursorStreamMapper` parses cursor-agent's stream-json, using `--resume <id>` /
`--continue` for continuity and reading `~/.copilot/session-state/<id>/events.jsonl`
for history hydration (the analog of Cursor's `store.db` and Codex's JSONL).
*Risk:* JSONL output ergonomics are still maturing
([copilot-cli#3008](https://github.com/github/copilot-cli/issues/3008)).

**Contingency — `copilot --acp --stdio` over `src/providers/acp/`.** Copilot's ACP
mode emits the same `session/update` events Claudian's existing ACP normalizer
already handles for Opencode, so this is a viable zero-new-dependency transport if
we'd rather reuse the ACP stack than add the SDK. *Risk:* Copilot's ACP dialect
may diverge from Opencode's, and the `--acp` flag is newer than the SDK contract.

### Proposed file inventory (`src/providers/copilot/`)

Mirrors the Opencode/Cursor layout:

- `registration.ts` — `ProviderRegistration` (displayName "GitHub Copilot",
  capabilities, runtime/history/aux factories).
- `capabilities.ts` — `ProviderCapabilities` flag set (see matrix below).
- `types.ts` — `CopilotProviderState` (`{ sessionId?: string }`) + typed accessor.
- `settings.ts` — settings schema, defaults, getters/setters under
  `providerConfigs.copilot`.
- `runtime/CopilotChatRuntime.ts` — SDK-driven runtime (`CopilotClient` →
  `createSession` / `resumeSession`); the JSONL fallback sits behind the same
  interface.
- `runtime/copilotToolNormalization.ts` — Copilot tool vocabulary → Claudian
  canonical tool names.
- `runtime/CopilotCliResolver.ts` + binary locator — resolve the *user-installed*
  `copilot` binary (PATH + per-host overrides) and feed it to the SDK as `cliPath`;
  route the child env through `providers/subprocessEnvironmentAllowlist` and pass
  the result as the SDK's explicit `env` (never the default `process.env`).
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
| Send / stream / cancel | ✅ | SDK message deltas (or JSONL deltas in fallback) |
| Native history reload + resume | ✅ | `resumeSession()` / `--resume`, `events.jsonl` |
| Tool-call cards / thinking / usage | ✅ | full agent loop |
| MCP tools | ✅ | built-in GitHub MCP + custom |
| Custom agents / subagents | ✅ | `--agent`, custom agents |
| Plan mode | ✅ likely | `--plan`/`--mode`/`--autopilot`; confirm in spike |
| Image attachments | ✅ | vision models |
| Inline edit, `#` instruction, `$` skills | ✅ | aux-query pattern (cf. Cursor) |
| Fork | ⚠️ gate initially | revisit once session model is confirmed |
| Rewind | 🔒 gate | no native support |
| Editor autocomplete (ghost text) | 🚫 non-goal | Language Server out of scope |

A realistic `capabilities.ts` is therefore strong:
`supportsNativeHistory: true`, `supportsMcpTools: true`, `supportsPlanMode: true`,
`supportsImageAttachments: true`, `supportsRewind: false`,
`supportsFork: false` (initially), `reasoningControl: 'none'`.

## Auth, subscription & licensing

- **No OAuth to implement.** Auth is CLI-owned: the user runs `copilot login`
  (GitHub device flow); the CLI stores the token (system keychain / `~/.copilot/`).
  Claudian resolves the binary and lets the SDK/CLI manage auth — exactly how it
  treats other CLIs. Token precedence for headless use:
  `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`.
- **User's own entitlement required.** Every path requires the end user's own
  active Copilot subscription (the free tier counts; BYOK with another provider's
  key is also possible). The plugin grants no access of its own.
- **Licensing / packaging constraint.** The `copilot` CLI ships under a **custom
  GitHub Copilot CLI License** that prohibits modifying it or redistributing it on
  a standalone basis; only `@github/copilot-sdk` is MIT. Claudian must therefore
  **resolve a user-installed `copilot` binary** (`npm i -g @github/copilot` or
  Homebrew) and never bundle, fork, or patch it — which is also why the SDK is
  pointed at that binary via `cliPath` rather than shipping its bundled copy.

## End-user onboarding

"Install the plugin and you're instantly chatting" is **not** achievable on any
sanctioned path — but Copilot can match the smoothest bar Claudian already sets for
Cursor/Codex/Opencode. Three things the user needs:

| Requirement | Avoidable? | Why |
|---|---|---|
| A GitHub Copilot subscription (their own; free tier counts) | ❌ never | the plugin uses the user's entitlement, not its own |
| A one-time GitHub sign-in | ❌ never | someone has to authenticate |
| The `copilot` CLI present | ⚠️ not cleanly | the only no-CLI chat path is the gray-area API; bundling a native binary doesn't fit a plugin |

**Smoothest realistic flow** (same shape as the `install-codex` / `install-cursor`
user manuals):

1. Install Claudian from Obsidian community plugins.
2. Install the CLI once — `npm i -g @github/copilot` or Homebrew. Claudian detects
   it's missing and links/guides this (provider health-check pattern).
3. **Sign in** — surface `copilot login` (GitHub device flow) behind an in-app
   button; needs the subscription. Auth then persists (the CLI owns the token).
4. Claudian auto-detects the binary and you're chatting.

So: **one install + one sign-in**, then seamless. We can match Pierrad's friendly
"Sign in with GitHub" — the device flow is *not* the risky part (the sanctioned
`copilot login` uses the same flow) — while staying within GitHub's terms. The only
thing we deliberately give up versus Pierrad's chat is "zero CLI install," which is
the price of not using the bannable direct-API route.

**Scope note:** because the Language Server is out of scope, Claudian's Copilot
integration is **chat/agent only — no Copilot inline autocomplete while typing
notes**, consistent with how every Claudian provider works.

## ToS / risk

- The official SDK/CLI path is **sanctioned**: GitHub-published clients
  authenticating as the user.
- The rejected direct-API path (`copilot_internal/v2/token` +
  `api.githubcopilot.com`, typically while spoofing `Copilot-Integration-Id:
  vscode-chat`) is **gray-area** and has produced documented GitHub Security
  warnings and **permanent Copilot revocations** (e.g. avante.nvim users). Staying
  on the official SDK/CLI keeps Claudian clear of this.

## Effort & sequencing

- **Effort:** the SDK removes most transport and process-lifecycle work (it owns
  spawn, JSON-RPC, resume, and auth detection), so the bulk shifts to Copilot tool
  normalization, settings/CLI resolution, the settings UI, onboarding, and tests
  (unit-first, mirrored under `tests/`). Net plausibly lighter than a from-scratch
  provider; the main unknown is the Obsidian packaging of the SDK (spike item 1).
- **Sequencing:** land after ADR-0001 Phase 2b/3 (RuntimeHost + shared transport)
  so the fifth provider arrives on the tightened seam — same guidance as
  [[gemini-cli-provider]]. A Copilot + Gemini pair is a natural "roster parity"
  milestone.

## Spike plan (do this before writing provider code)

Per the repo's "inspect real runtime output first" rule, validate with throwaway
captures in `.context/` before committing to a transport:

1. **Packaging (decisive).** Confirm `@github/copilot-sdk` can be bundled into an
   Obsidian plugin (esbuild `external`) and run purely as a JSON-RPC client against
   a **user-installed** `copilot` (`cliPath`), shipping no native binary. If not,
   fall back to the JSONL path or ACP-direct.
2. **Spawn discipline.** Confirm the SDK honors `env` (allowlisted, not
   `process.env`), `cwd` (vault), and `onPermissionRequest` (→ `ApprovalManager`),
   and that `stop()`/`forceStop()` give clean cancellation/cleanup.
3. **Streaming map.** Capture `assistant.message_delta` + tool events for a turn
   that reads a file, edits, and runs a shell command; confirm they map onto
   `StreamChunk` (text / thinking / tool / usage).
4. **Resume/history.** Drive `resumeSession()` and inspect
   `~/.copilot/session-state/<id>/events.jsonl`; confirm hydration shape and the
   exact subfolder name (varies by version).
5. **Fallback sanity.** Capture `copilot -p "…" --output-format json` (≥ 0.0.421)
   so the no-dependency JSONL path is ready if the SDK can't be bundled.
6. Decide SDK vs JSONL vs ACP-direct on the evidence; promote findings into an ADR
   and open the implementation issue.

## Acceptance criteria

- `copilot` registered as a provider with send / stream / cancel / resume at
  minimum; no `providerId === 'x'` branches; no edits to hardcoded provider lists
  in `core/`/`features/`.
- Copilot CLI resolved as a *user-installed* binary and passed to the SDK via
  `cliPath`; the SDK's `env` is the allowlisted child env (not `process.env`).
- Tool approvals routed through Claudian's `ApprovalManager`/safe-mode via
  `onPermissionRequest` (never a blanket `approveAll`).
- Session ids validated before any path operation.
- Unsupported surfaces (rewind, and fork initially) gated via
  `ProviderCapabilities`, not stubbed in feature code.
- Unit tests mirror `src/providers/copilot/` under `tests/unit/`.

## Open questions

- **Packaging:** can `@github/copilot-sdk` be cleanly bundled in an Obsidian plugin
  (esbuild `external`) while forcing `cliPath` at a user-installed CLI and shipping
  no binary? If not, the JSONL path or ACP-direct becomes primary. (Resolve in
  spike item 1.)
- Does Copilot's plan/ask mode map onto the shared post-plan approval card (cf.
  Opencode's managed plan mode), or need bespoke handling?
- Exact `~/.copilot/session-state/...` path stability across CLI versions.
- Model catalog: discover at runtime (the Copilot model set drifts) vs a curated
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
  [getting-started](https://github.com/github/copilot-sdk/blob/main/docs/getting-started.md) ·
  [Node SDK usage](https://github.com/github/awesome-copilot/blob/main/instructions/copilot-sdk-nodejs.instructions.md)
- **Language Server (out of scope):** [release repo](https://github.com/github/copilot-language-server-release) ·
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
