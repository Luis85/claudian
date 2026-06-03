---
type: issue
id: issue-20260603-reduce-type-cycles
title: Optionally reduce madge cycles by splitting the core/providers/types.ts type-hub
status: open
priority: 3 - low
triage: low-value
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (ARCH-5)"
scope: module-graph
tags:
  - architecture
  - tech-debt
---

# Reduce core/providers/types.ts import-type cycles (low value)

## Problem

`npx madge --circular` reports **58** cycles (drifted up from 52). The worst root in
`src/core/providers/types.ts:1-20`, a type-hub that round-trips imports back from `bootstrap/storage`,
`runtime/ChatRuntime`, `providers/commands/ProviderCommandCatalog`, and `types/PluginContext`.

## Important caveat

**All these imports are `import type`** — erased at compile time, zero runtime initialization-order risk.
Madge counts them but they are not a hazard. **Do not prioritize the cycle count.** This issue exists only
so the finding is tracked, not as a call to action.

## Proposed change (if pursued)

Split `core/providers/types.ts` so the `ChatRuntime` / `ProviderCommandCatalog` / `PluginContext` type
re-exports do not round-trip. Effort: S. Value: low.

## Acceptance criteria

- Cycle count drops without changing emitted JS or any runtime behavior.
