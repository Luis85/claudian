---
type: tech-debt
title: "Shared transport helpers from ADR-0001 are still unextracted"
date: 2026-06-07
updated: 2026-06-07
status: open
priority: "2 - normal"
severity: medium
scope: provider-transport
tags:
  - tech-debt
  - architecture
  - transport
  - provider-boundary
related:
  - "[[0001-transport-agnostic-provider-seam]]"
  - "[[reduce-core-providers-type-cycles]]"
---

# Shared transport helpers from ADR-0001 are still unextracted

## Summary

The provider seam is intentionally provider-native, but the CLI providers still duplicate lower-level process and JSON-RPC plumbing. ADR-0001 accepted an optional `core/transport` extraction; the directory does not exist yet.

## Evidence

- `src/core/transport/` is absent.
- Current transport/process modules reviewed on 2026-06-07:
  - `src/providers/codex/runtime/CodexRpcTransport.ts` — 143 nonblank LOC.
  - `src/providers/codex/runtime/CodexAppServerProcess.ts` — 131 nonblank LOC.
  - `src/providers/acp/AcpJsonRpcTransport.ts` — 369 nonblank LOC.
  - `src/providers/acp/AcpSubprocess.ts` — 130 nonblank LOC.
  - `src/providers/cursor/runtime/cursorLaunch.ts` — 103 nonblank LOC.
- The subprocess modules repeat the same concerns: spawn, stderr buffering, process liveness, SIGTERM/SIGKILL, and disposal.
- The JSON-RPC transports are not identical, but share enough concepts to benefit from a common request map / line framing / shutdown helper.

## Why it matters

Transport failures are high-risk because they appear as hung turns, stuck approvals, orphaned processes, or lost provider state. Duplicated low-level plumbing makes it harder to apply lifecycle fixes uniformly and harder for agents to reason about which provider path owns which cancellation invariant.

## Suggested remediation

1. Extract a small process helper first: spawn, stderr ring buffer, cooperative close, SIGTERM to SIGKILL escalation, exit callbacks.
2. Keep JSON-RPC helpers optional and capability-aware; do not force Cursor's NDJSON stream or Claude's SDK path through a fake common transport.
3. Add transport-level tests for pending request rejection, process exit, abort/timeout cleanup, and stderr diagnostics.
4. Add a perf or reliability gate if JSON-RPC request volume becomes hot.

## Acceptance criteria

- [ ] `src/core/transport/` contains a reusable process helper used by Codex and Opencode.
- [ ] Provider-native differences remain inside provider adapters.
- [ ] Transport tests cover shutdown, pending request rejection, and stderr diagnostics.
- [ ] No provider loses current cancellation or approval-dismiss behavior.
