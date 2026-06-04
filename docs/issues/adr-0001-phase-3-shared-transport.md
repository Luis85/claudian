---
type: issue
id: issue-20260603-adr0001-phase3-transport
title: ADR-0001 Phase 3 — extract core/transport (spawnAgentProcess + JsonRpcStdioClient)
status: open
priority: 1 - high
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (ARCH-2)"
related:
  - "[[0001-transport-agnostic-provider-seam]]"
  - "[[2026-05-30-cursor-integration-hardening]]"
scope: provider-transport
tags:
  - architecture
  - transport
  - de-duplication
---

# ADR-0001 Phase 3 — shared transport helpers

## Problem

`src/core/transport/` does not exist. The CLI providers duplicate subprocess + JSON-RPC framing:
Codex (`CodexRpcTransport`, 171 LOC) and Opencode (`AcpJsonRpcTransport`, 427 LOC) each reimplement
spawn, bounded-stderr drain, SIGTERM→SIGKILL shutdown, and pending-request maps. The CON-3 gate is
cleared, so this is unblocked but unstarted.

## Proposed change

Per ADR-0001 Move 2, extract into `src/core/transport/`:

- **`spawnAgentProcess()`** — spawn + bounded-stderr drain + SIGTERM→SIGKILL cancellation + Windows
  `.cmd` quoting. Beneficiaries: Codex, Cursor, Opencode (Claude's SDK adaptor does not spawn).
- **`JsonRpcStdioClient`** — JSON-RPC 2.0 framing, pending-request map, notification + server-request
  handlers, timeouts. Beneficiaries: Codex + Opencode only. **Cursor's NDJSON loop does not adopt this.**

## Acceptance criteria

- Codex + Opencode consume `JsonRpcStdioClient`; all three CLI providers consume `spawnAgentProcess`.
- A `tests/perf/` target asserts `JsonRpcStdioClient` pending-request lookup stays O(1) as concurrent
  pending requests grow (no transport perf coverage exists today).
- `typecheck && lint && test && build` green.

## Sequencing

Land **after** `docs/superpowers/plans/2026-05-30-cursor-integration-hardening.md` PR2 — it touches
`CursorChatRuntime.query`, ACP subprocess kill, and ACP transport pending-request cleanup (the exact
extraction target). Otherwise the extraction repeatedly rebase-conflicts.
