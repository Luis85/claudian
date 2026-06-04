---
type: quick-action
name: Work-Order Review
description: Audit a work-order's code + doc with parallel subagents, then polish low-risk issues in-place.
icon: shield-check
tags:
  - review
  - work-order
  - agents
---

Thoroughly review a completed (or in-review) work-order. Dispatch parallel subagents, synthesize findings, apply a low-risk polish pass, and update the work-order via its native conventions.

## 1. Inputs

Ask me for the work-order path if I did not pass one. Do **not** search the vault on your own. Expect a path like `Agent Board/tasks/work-order-YYYYMMDD-<slug>.md`.

## 2. Gather context

- Read the work-order: frontmatter (`type: claudian-work-order`, `schema_version: 1`, `id`, `title`, `status`, `started`, `finished`, …), `## Objective`, `## Acceptance Criteria`, `## Context`, `## Constraints`, the existing `## Run Ledger`, and any prior handoff between `<!-- claudian:handoff-start -->` and `<!-- claudian:handoff-end -->`.
- Determine the diff produced by this work-order:
  - Prefer `git log --since="<started ISO>" --name-only` plus `git diff <started-commit>..HEAD` if traceable.
  - Otherwise `git diff main...HEAD` (or the configured base).
  - Scope the diff to files listed under `## Context → Files to modify/create` when present; widen only if subagents need cross-cutting evidence.
- If no diff is found, **abort** and tell me — likely wrong work-order or unmerged base.

## 3. Dispatch 4 parallel subagents

Send **one message with four `Agent` tool calls in parallel** (do not use `TaskCreate`). Each subagent gets the work-order path, the diff scope, and a focused brief. Each returns a structured finding list:

```
{ severity: "blocker" | "major" | "minor" | "nit",
  area: <file:line or section>,
  finding: <one sentence>,
  evidence: <quote/diff hunk>,
  suggested_fix: <one line, or "none"> }
```

The four briefs:

1. **Correctness + Acceptance** — For each acceptance criterion in `## Acceptance Criteria`, decide met / partial / not met with file:line evidence. Flag silently-skipped criteria. Flag behavior the diff changed but the work-order did not cover.
2. **Code quality** — Naming, duplication, dead code, complexity, layering. Must fit conventions in the nearest `src/**/CLAUDE.md` and the slice owner doc (e.g. `src/features/tasks/CLAUDE.md`). Flag `console.*` in production code, leaked `any`, large new files that should split.
3. **Tests** — New behavior covered? Edge cases? `tests/` layout mirrors `src/`? No `.skip` / `.only` / disabled suites? Snapshot churn justified? Flag tests that only assert the happy path.
4. **Docs + regressions** — User manuals under `docs/product/user-manuals/` updated when user-visible behavior changed. CLAUDE.md / ADRs updated when contracts moved. Wikilinks resolve. Then run `npm run typecheck && npm run lint && npm run test && npm run build` — paste exact output; any non-zero exit is a **blocker**.

## 4. Synthesize

Merge the four reports. Dedup by `area + finding`. Drop duplicates of the same root cause. Sort by severity (blocker → nit). Cap to ~20 items; collapse the long tail into a single "nits" bucket with counts.

## 5. Polish pass

Apply **low-risk** fixes in-place using the `Edit` tool. Do **not** use `Write` (no full-file rewrites). Do **not** edit `type`, `schema_version`, or `id` in any frontmatter.

In-scope for auto-fix:

- Typos, comment cleanups, dead imports.
- Lint autofixable items.
- Missing one-liner doc updates (wikilink fix, stale path).
- Weak test assertions where the intent is obvious (tightening `toBeTruthy` to a concrete value).

Out-of-scope — **stop and report only**:

- API or signature changes.
- New tests for nontrivial logic.
- Anything ambiguous, anything touching a state machine, anything crossing slice boundaries.
- Anything in `~/.claude/`, `.obsidian/`, or other provider-owned state.

After edits, re-run `npm run typecheck && npm run lint && npm run test`. If anything regresses, revert the polish edits in that file and demote the item back to a reported finding.

## 6. Update the work-order

Use the work-order's native conventions exactly. **Do not write `status` directly** — the task state machine guards transitions (`running → review`, `review → done | needs_fix | canceled`). Recommend the next status inside the handoff block.

**Append a Run Ledger entry** inside `<!-- claudian:run-ledger-start -->` … `<!-- claudian:run-ledger-end -->`:

```
- <ISO timestamp> [review] Reviewed by 4 subagents. <N> findings (<B> blocker, <M> major, <m> minor, <nits> nits). Polish applied to <W> items. Verification: typecheck/lint/test/build all green.
```

**Replace the handoff region** content (between `<!-- claudian:handoff-start -->` and `<!-- claudian:handoff-end -->`) with a single `<claudian_handoff>` block — this is the format `TaskHandoffParser` expects:

```
<claudian_handoff>
summary: <one paragraph verdict — what was reviewed, top-line outcome, whether acceptance is met>
verification: <exact commands run and their outcomes, e.g. "npm run typecheck → ok; npm run lint → 0 errors / 0 warnings; npm run test → 247/247 pass; npm run build → ok">
risks: <remaining unfixed issues, adjacent-feature concerns, anything the reviewer is uncertain about>
next_action: <recommended status transition and why, e.g. "review → done — all criteria met, polish applied" or "review → needs_fix — 2 blockers must be addressed first">
</claudian_handoff>
```

**Long-form findings (optional)** — if the finding list is too rich for the handoff block, append a `## Review Findings` section after `## Constraints` and before the generated regions. The parser ignores unknown headings, so this is safe. Use a table:

```
| Severity | Area | Finding | Status |
|----------|------|---------|--------|
| blocker  | …    | …       | reported / polished / reverted |
```

## 7. Report

In chat, print:

- Path to the updated work-order.
- Count by severity, count auto-polished, count remaining.
- Recommended status transition.
- Top 3 remaining items by severity, one line each.

Then stop and wait for me. Do not flip the work-order status — that's mine or the board's call.
