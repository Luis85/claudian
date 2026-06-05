---
title: Plugin improvement roadmap (parent index)
date: 2026-06-05
status: active
scope: Claudian plugin — decomposes the 2026-05-28 proposal's remaining open work into ordered child slices
parent: "[[2026-05-28-plugin-improvement-research-proposal]]"
supersedes: phase order in the parent proposal
related:
  - "[[2026-05-28-plugin-improvement-research-proposal]]"
  - "[[2026-06-03-comprehensive-improvement-proposal]]"
  - "[[0001-transport-agnostic-provider-seam]]"
---

# Plugin improvement roadmap

Parent index over the child slice specs that close the remaining work in the 2026-05-28 plugin improvement research proposal.

## Purpose

This document is **not a new design**. It is a navigable index: it orders the proposal's still-open work into five tracks of small, single-concern child slices, and links to a spec for each slice as that spec is written.

Slices that already shipped — composer pills ([[2026-05-28-composer-context-pills-design]]) and SecretStorage (PR #27) — are not re-tracked here. They appear only in the 2026-06-05 state delta below.

Each slice has its own spec at `docs/superpowers/specs/YYYY-MM-DD-<slice>-design.md`. The roadmap rule is: **no source code without an approved spec**.

## State as of 2026-06-05

Four days past the parent proposal's 2026-06-01 reconciliation.

### Done since 2026-06-01

- **Secret references / Obsidian `SecretStorage`** — Phases 0–4 merged. Provider API keys, MCP auth headers, and MCP env vars now persist via `app.secretStorage` (keychain), not in vault config files. Substrate: `src/core/security/secretStore.ts`, `src/core/security/secretIds.ts`, `src/core/mcp/mcpSecrets.ts`, `src/features/settings/ui/SecretEnvVarsSection.ts`. Manifest `minAppVersion` bumped to 1.11.5.

### Partial since 2026-06-01

- **ADR 0001 transport-agnostic provider seam** — `RuntimeHost` interface designed at `src/core/runtime/RuntimeHost.ts`. `ChatRuntime` still carries the seven `setXxxCallback()` setters; capability mixins, the nested capability descriptor, and the setter migration are deferred to slices **4.3** / **4.4**.
- **`ConversationStore`** extracted from `main.ts` (ARCH-3). Provider-neutral `ConversationSessionEnvelope` deferred to slice **4.5**.
- **Diagnostics tab** registered in settings with Copy / Clear actions, currently stubbed (`TODO Phase F` in `src/features/settings/registry/fields/diagnostics.ts`). Wiring deferred to slice **2.2**.

### Still fully open

The 26 slices in the track tables below. None started yet.

### Cross-references

- [[2026-05-28-plugin-improvement-research-proposal]] — origin proposal with its 2026-06-01 and (now) 2026-06-05 reconciliation blocks.
- [[2026-06-03-comprehensive-improvement-proposal]] — superseding review that covered SEC-A scope (now shipped).
- [[0001-transport-agnostic-provider-seam]] — governs slices 4.3 / 4.4.

## Track summary

| Track | Theme | Slices | Gates |
|-------|-------|-------:|-------|
| **0** | Release hygiene | 5 | parallel-safe; no dependency on other tracks |
| **1** | Context-trust UX | 5 | sequential 1.1 → 1.5; downstream of nothing |
| **2** | Safety / audit / diagnostics | 4 | 2.1 gated behind 1.2 (envelope feeds audit) |
| **3** | MCP + external paths + network | 6 | mostly independent; 3.6 gated behind 3.5 |
| **4** | Provider reliability + architecture | 5 | 4.5 gated behind 1.1 + 2.1 |
| **5** | Workflow expansion + accessibility | 6 | 5.5 populates the IA after 5.1 / 5.2 / 5.3 |

## Track 0 — Release hygiene

Parallel-safe small PRs. Can ship in any order alongside Tracks 1–5.

| Slice | Goal | Status | Depends on | Spec |
|-------|------|--------|------------|------|
| 0.1 | Repo naming three-way fix (`manifest.json` id+author, `README.md` links, `scripts/release.mjs` target repo) | open | — | TBD |
| 0.2 | CI runs `npm run build`; align Node 20 / 22 between CI and release | open | — | TBD |
| 0.3 | Release-artifact smoke wired into CI (version sync, size, `minAppVersion`) | partial | 0.2 | TBD |
| 0.4 | `CONTRIBUTING.md` + `SECURITY.md` + PR template | open | — | TBD |
| 0.5 | Relabel user-facing "YOLO" to action-review terms (keep internal `yolo` value) | open | — | TBD |

## Track 1 — Context-trust UX

Sequential. The substrate slice (1.1) is the parent proposal's named highest-leverage next bet.

| Slice | Goal | Status | Depends on | Spec |
|-------|------|--------|------------|------|
| **1.1** | `ComposerContextBuilder` substrate + `ContextSourceHandle` types + golden tests | open | — | [[2026-06-05-composer-context-builder-substrate-design]] |
| 1.2 | Route `InputController` + 4 provider prompt encoders through the envelope | open | 1.1 | TBD |
| 1.3 | Visible context-preview drawer | open | 1.2 | TBD |
| 1.4 | Phase A citations rendering (cite explicitly-attached sources) | open | 1.2 | TBD |
| 1.5 | `VaultEditRouter` + Markdown-safe edit routing | partial | — | TBD |

## Track 2 — Safety / audit / diagnostics

Gated behind 1.2 so audit can redact via envelope classifications.

| Slice | Goal | Status | Depends on | Spec |
|-------|------|--------|------------|------|
| 2.1 | `RuntimeAuditEvent` + `RuntimeAuditSink` (observe-only) wired from approval / tool-call / render paths | open | 1.2 | TBD |
| 2.2 | `RuntimeDiagnosticsSnapshot` + Copy Diagnostics action (finish `TODO Phase F`) | partial | 2.1 | TBD |
| 2.3 | Per-tab safety summary card | open | 2.1 | TBD |
| 2.4 | Provider settings source viewer | open | — | TBD |

## Track 3 — MCP + external paths + network

Mostly independent; intra-track gates noted.

| Slice | Goal | Status | Depends on | Spec |
|-------|------|--------|------------|------|
| 3.1 | MCP per-tool risk labels + server provenance display | open | — | TBD |
| 3.2 | MCP server health / status panel | open | — | TBD |
| 3.3 | Non-HTTPS / SSRF / private-IP warnings | open | — | TBD |
| 3.4 | Tool catalog + approval-history reset + output-truncation disclosure | open | 3.1 | TBD |
| 3.5 | `ExternalPathGrant` model (replaces flat `persistentExternalContextPaths` list) | open | — | TBD |
| 3.6 | Shared network egress policy (cross-provider) | open | 3.5 | TBD |

## Track 4 — Provider reliability + architecture

Fixtures land first so capability migration can be verified.

| Slice | Goal | Status | Depends on | Spec |
|-------|------|--------|------------|------|
| 4.1 | `ProviderStreamFixtureHarness` — Codex live / history parity | open | — | TBD |
| 4.2 | Claude stream dedupe + branch-history fixtures | open | 4.1 | TBD |
| 4.3 | ADR 0001 Phase 2: `RuntimeHost` adoption + setter migration | partial | — | TBD |
| 4.4 | ADR 0001 Phase 3: capability mixins + nested descriptor + tool manifest | open | 4.3 | TBD |
| 4.5 | `ConversationSessionEnvelope` | partial | 1.1, 2.1 | TBD |

## Track 5 — Workflow expansion + accessibility

Settings IA waits for new surfaces to populate; a11y audit wraps the IA.

| Slice | Goal | Status | Depends on | Spec |
|-------|------|--------|------------|------|
| 5.1 | Provider setup wizard + CLI / auth detection | partial | — | TBD |
| 5.2 | Comfort profiles + provider health card | open | 5.1 | TBD |
| 5.3 | Instruction file viewer / validator (`CLAUDE.md`, `AGENTS.md`, skills, agents) | open | — | TBD |
| 5.4 | `ProviderInvocationCatalog` facade | open | — | TBD |
| 5.5 | Settings IA 4-bucket reorg (Basic / Workflow / Integrations / Advanced) | open | 5.1, 5.2, 5.3 | TBD |
| 5.6 | Accessibility audit + axe / jest-axe + live regions | open | 5.5 | TBD |

## How to use

1. When starting a slice with no spec yet, write the spec first (use the brainstorming skill). Save to `docs/superpowers/specs/YYYY-MM-DD-<slice>-design.md`. Link it from this roadmap.
2. When a slice ships, flip its status here to `shipped` and add a date. Link the PR in the slice's spec frontmatter.
3. The parent proposal's original Phase 1–5 ordering is superseded by this roadmap. Future reconciliation passes should land in the parent proposal as dated blocks (see its 2026-06-01 and 2026-06-05 sections), and slice-level status should land here.
4. Doc edits unrelated to a specific slice (CLAUDE.md, ADR status, README) can land alongside the relevant slice's PR.
