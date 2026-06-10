---
type: tech-debt
title: "No import-cycle budget; large existing cycles block a hard gate"
date: 2026-06-07
updated: 2026-06-10
status: done
priority: "2 - medium"
severity: medium
scope: build-ci
tags:
  - tech-debt
  - ci
  - architecture
  - module-depth
  - quality-gates
related:
  - "[[2026-06-07-agentic-quality-gates]]"
  - "[[2026-06-07-oversized-modules-and-test-files]]"
  - "[[2026-06-07-shared-transport-extraction]]"
---

# No import-cycle budget; large existing cycles block a hard gate

## Summary

The agentic-quality-gates work added file-size, build, artifact, and
function-health gates, but **dependency cycles are still ungated**. A first
measurement shows the codebase already contains sizable import cycles, so a
cycle gate cannot simply block — it has to grandfather what exists and catch
only new cycles (the same ratchet shape as `check:loc`). The gate was
deliberately deferred until the existing cycles are understood and, ideally,
reduced.

## Evidence

Throwaway Tarjan SCC pass over the `src/**/*.ts` import graph on 2026-06-07
(resolves `@/` + relative specifiers to `.ts`/`index.ts`; counts `import` and
`export ... from`, **including `import type`**). Strongly-connected components
of size > 1:

| SCC | Size | Anchor |
|----:|-----:|--------|
| 1 | 142 files | `src/providers/opencode/**` |
| 2 | 13 files | `src/core/providers/commands/**` + feature `events.ts` cluster |
| 3 | 2 files | `src/providers/cursor/runtime/cursorTaskSubagent.ts` ↔ `cursorToolNormalization.ts` |

### Measurement caveats

The detector is intentionally crude and almost certainly **over-states** the
real runtime-cycle picture:

- It counts `import type` edges, which TypeScript erases at build time and which
  a proper tool (`eslint-plugin-import/no-cycle` with `ignoreTypeImports`, or
  `madge --ts-config`) can exclude.
- A barrel `index.ts` that re-exports a package's modules collapses the whole
  package into one apparent SCC. The 142-file opencode blob is very likely a
  barrel artifact, not 142 mutually-recursive modules.

So treat the numbers as "cycles exist and at least one is large," not as a
precise count. Confirming the true graph (type-only excluded, barrels handled)
is the first task before any gate.

## Why it matters

Cycles erode the provider boundary that ADR 0001 and the `no-restricted-imports`
lint rule are meant to protect: they make modules impossible to load, test, or
reason about in isolation, and they hide ordering constraints. Agentic edits
tend to add the convenient import that closes a loop. Without a gate, the graph
silently degrades.

## Suggested remediation

1. **Confirm the real graph.** Re-measure with `eslint-plugin-import/no-cycle`
   (`ignoreExternal`, `ignoreTypeImports`) or `madge --circular --ts-config`,
   excluding type-only edges and resolving barrels, to get the true cycle set.
2. **Reduce, don't just gate.** Break the genuine cycles — most likely by
   splitting shared `events.ts`/`types.ts` hubs and trimming barrel re-exports
   that create artificial coupling.
3. **Then add a baseline-aware gate** mirroring `check:loc`: a dependency-free
   `check:cycles` script (or the eslint rule at `warn`) that grandfathers the
   remaining cycles and fails only on *new* ones. Keep output short for agents.

## Acceptance criteria

- [x] True cycle set is measured with type-only edges excluded and barrels resolved.
- [x] Genuine cycles are reduced to a documented baseline.
- [x] A cycle gate fails on new cycles while grandfathering the baseline, and does not block on the existing set.

## Decision log

- 2026-06-07: Deferred the cycle gate during the agentic-quality-gates PR.
  Existing cycles are too large to block on, and robust detection needs either
  a new dependency or careful barrel/type-only handling. Captured here so the
  direction is not lost; the quality-gates PR shipped the non-cycle gates.
- 2026-06-10: Closed. The crude Tarjan numbers above were measurement
  artifacts, as the caveats suspected: fallow's import graph (type-aware,
  barrel-aware, already wired into `npm run check:quality`) reports **zero**
  circular dependencies and zero re-export cycles on the current tree — the
  142-file "SCC" was `import type` edges plus barrel collapse, and the real
  cycles found earlier had been fixed when the fallow ratchet went live
  (2026-06-09).

## Resolution (2026-06-10)

No grandfathered budget was needed — the baseline is zero, so the gate is
strict instead of ratcheted-from-debt. `scripts/check-quality.mjs` gained three
counter metrics pinned at 0 in `scripts/quality-baseline.json`:
`circularDependencies`, `reExportCycles`, and `boundaryViolations`. The third
is backed by new `boundaries` zones/rules in `.fallowrc.json` that encode the
ADR 0001 layer rules (core → utils only; features never import providers;
provider zones never import each other; only `src/providers/index.ts` sees
provider internals). All three run in the existing CI `quality` job via
`npm run check:quality` — no new tooling, no new dependency. Details:
`docs/build-ci/quality-gates.md` § "Fallow quality ratchet".
