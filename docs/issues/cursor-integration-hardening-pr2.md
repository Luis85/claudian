---
type: issue
id: issue-20260603-cursor-hardening-pr2
title: Cursor integration hardening PR2 (open T-items; gates ADR-0001 Phase 3)
status: open
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/superpowers/plans/2026-05-30-cursor-integration-hardening.md]]; [[docs/superpowers/plans/2026-05-30-cursor-hardening-telemetry-design.md]]"
related:
  - "[[docs/issues/adr-0001-phase-3-shared-transport.md]]"
scope: cursor-acp-transport
tags:
  - cursor
  - acp
  - transport
  - hardening
---

# Cursor hardening PR2

## Problem

PR1 of the cursor-integration-hardening plan shipped (env allowlist, SQLite close, hash normalization). The
PR2 items remain open in code and **gate ADR-0001 Phase 3** (shared `core/transport/` extraction touches the
same files). Verified still open:

- **T6/H2 platform-aware kill** — `AcpSubprocess.ts:122` always sends `SIGTERM` first then `SIGKILL` on a
  timer; no Windows-aware first signal and no `CLAUDIAN_ACP_FORCE_SIGTERM` flag.
- **T8/H4 bounded request id** — `AcpJsonRpcTransport.ts:80` `nextId = 1` with `this.nextId++` (`:191`); unbounded, no wrap.
- **T13/H11 tool_result dedup** — `AcpSessionUpdateNormalizer.ts:75` dedups message roles only; no per-tool-call-id `tool_result` dedup.
- **T14/H12 tool fallback content** — fall back to `args` when `result` missing on the live tool-start path.
- **T22 integration smoke** — `tests/integration/providers/cursor/` does not exist.
- **T25 telemetry log codes** — no `logCode`/telemetry refs in `src/providers/cursor` or `src/providers/acp` (design in `2026-05-30-cursor-hardening-telemetry-design.md`).

## Proposed change

Land the PR2 items per the plan. **Sequence before [[docs/issues/adr-0001-phase-3-shared-transport.md]]** so
the corrected cancellation/id/dedup behavior is encoded once in the extracted transport.

## Acceptance criteria

- The six T-items land with tests (incl. the Cursor integration smoke test).
- ADR-0001 Phase 3 is unblocked (no remaining file collision with this plan).
