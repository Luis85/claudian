---
type: index
id: issue-20260603-proposal-index
title: Issue index for the 2026-06-03 comprehensive improvement proposal
status: open
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]]"
scope: issue-tracking
tags:
  - index
  - backlog
---

# Issue index — 2026-06-03 proposal extraction

Bounded, single-concern issues extracted from
[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]]. Each maps one proposal finding (or a
deduplicated cluster) to one issue. Overlapping concerns were **combined** (noted below) to avoid
duplication. Pre-existing issues that already cover an open item are **referenced, not recreated**.

## Architecture

| Issue | Pri | Finding |
|-------|-----|---------|
| [[adr-0001-phase-2b-runtimehost]] | P1 | ARCH-1 — RuntimeHost migration (dead code today) |
| [[adr-0001-phase-3-shared-transport]] | P1 | ARCH-2 — extract `core/transport/` |
| [[split-inputtoolbar-widget-classes]] | P2 | ARCH-3 — 11 widget classes in one file |
| [[split-oversized-coordination-files]] | P2 | ARCH-4 — InputController / CodexHistoryStore / ClaudeChatRuntime |
| [[reduce-core-providers-type-cycles]] | P3 | ARCH-5 — type-hub cycles (low value) |

## Security & privacy

| Issue | Pri | Finding |
|-------|-----|---------|
| [[adopt-secretstorage-for-secrets]] | P1 | **SEC-A + OBS-A combined** — plaintext secrets → SecretStorage |
| [[opencode-runtime-vault-path-containment]] | P2 | SEC-B |
| [[codex-spawn-env-allowlist]] | P2 | SEC-C |
| [[remote-mcp-ssrf-blocking-guard]] | P2 | SEC-D |
| [[value-level-diagnostics-redaction]] | P3 | SEC-E |
| [[prompt-injection-untrusted-content-demarcation]] | P3 | SEC-F |

## UX & product

| Issue | Pri | Finding |
|-------|-----|---------|
| [[provider-health-check-detect-and-test]] | P1 | UX-A |
| [[composer-context-pre-send-preview]] | P1 | UX-B (ComposerContextBuilder) |
| [[explicit-context-citations]] | P1 | UX-C |
| [[unified-safe-edit-revert]] | P1 | **UX-D + PN-5 + PN-7 combined** |
| [[accessibility-pass]] | P1 | **UX-E + UX-G(ARIA) + UX-J(reduced-motion) combined** |
| [[actionable-runtime-error-states]] | P1 | **UX-F + UX-J(context-too-large/unauth) combined** |
| [[agent-board-drag-and-drop]] | P2 | UX-G (drag) |
| [[settings-information-architecture]] | P2 | UX-H (pairs with registry port) |

## Performance & reliability

| Issue | Pri | Finding |
|-------|-----|---------|
| [[onunload-synchronous-kill-audit]] | P2 | PR-1 |
| [[perf-gates-agent-board-and-multitab]] | P2 | PR-2 |
| [[streaming-render-cost]] | P3 | PR-3 |
| [[long-chat-yield-constant-tuning]] | P3 | PR-4 (F2/F3) |

## Provider-native capability

| Issue | Pri | Finding |
|-------|-----|---------|
| [[unified-in-app-mcp-control-plane]] | P1 | **PN-1 + PN-2 + Opencode in-app combined** |
| [[cursor-subagents]] | P1 | PN-3 |
| [[opencode-acp-modes-and-slash-commands]] | P1 | **PN-4 + PN-8 combined** |
| [[claude-lifecycle-hooks]] | P2 | PN-6 |
| [[context-compaction-surface]] | P3 | PN-9 |
| [[gemini-cli-provider]] | P3 | PN-10 |

## Obsidian store compliance

| Issue | Pri | Finding |
|-------|-----|---------|
| [[audit-innerhtml-rendering]] | P1 | OBS-B |
| [[normalizepath-coverage]] | P2 | OBS-C |
| [[confirm-deferred-view-load-time]] | P2 | OBS-D |
| [[resolve-fork-naming-mismatch]] | P3 | OBS-E |

## Agent Board / orchestration (D4 + idea docs)

| Issue | Pri | Finding |
|-------|-----|---------|
| [[agent-board-background-runs]] | P1 | D4 + market research #1 |
| [[integrate-orchestrator-with-agent-board]] | P2 | D4 + idea doc |
| [[better-git-changed-files-view]] | P2 | backlog + idea doc |

## Pre-existing issues (referenced, NOT recreated)

- [[settings-registry-port-followup]] — Q-7, still 3/8 tabs (open). `settings-information-architecture` pairs with it.
- [[agent-board-evidence-review]] — top open product PRD; `agent-board-background-runs` and
  `claude-lifecycle-hooks` feed it.
- [[translate-validator-helper-strings]] — Phase B open (Phase A shipped).
- [[agent-board-symphony]] (idea) — umbrella for the evidence gate + orchestrator integration.

## Backlog status flips noted by the proposal (not extracted)

- `UX polishing and improvements.md` — **shipped** (UX-1..4); frontmatter still says open → flip to done.
- `Pasted images or files…md` — likely shipped; verify agent-side and close.
- Idea docs not elevated to issues (already captured as ideas): `Custom Actions per Lane`,
  `Work-Orders with specialized Agents`, `Create a new Quick-Action from a prompt`,
  `Append docs creation system-prompt to plan mode` — left as ideas to avoid duplication.

## Strategic (decision, not a code issue)

- Specorator standalone migration — see [[docs/ideas/2026-05-28-standalone-product-vision.md]] and
  [[docs/superpowers/plans/2026-05-30-specorator-standalone-migration.md]]. Resolve
  [[resolve-fork-naming-mismatch]] first; sequence the migration after the Evidence & Review Gate.
