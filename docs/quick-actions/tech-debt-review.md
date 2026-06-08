---
type: quick-action
name: Tech Debt Review
description: Thoroughly review the codebase and capture actionable tech debt as individual Obsidian notes in docs/tech-debt.
icon: scan-search
tags:
  - codebase-review
  - tech-debt
  - architecture
  - ci
  - quality
---

Run a focused tech-debt review of this repository and document the findings as individual Obsidian notes.

## Intent

Repeat the tech-debt review workflow: inspect the current codebase, identify maintainability/security/performance/build/CI/agentic-workflow debt, and create one durable note per debt item under `docs/tech-debt/`.

## Branch and write-scope rules

- First read `AGENTS.md`, `CLAUDE.md`, and `.codex/instructions.md` / `.codex/workflows/` if present.
- Respect the user's branch/worktree instruction for this run.
  - If the user says to stay on the current branch or work on main, do **not** create a worktree or switch branches, if no instruction is given, ask.
  - If no override is given and this is non-trivial repository work, follow the project worktree workflow.
- Do not edit product code for this action unless the user explicitly asks.
- Avoid touching unrelated modified files. Check `git status --short --branch` before and after.
- Write only new or intentionally updated notes in `docs/tech-debt/` unless the user asks for another target folder.

## Review workflow

1. Inspect project instructions and current context:
   - `AGENTS.md`
   - `CLAUDE.md`
   - relevant nested `CLAUDE.md` files
   - `CONTEXT.md`
   - `docs/adr/`
   - existing `docs/reviews/`, `docs/issues/`, and `docs/tech-debt/`
2. Inventory quality gates and build/release setup:
   - `package.json`
   - `eslint.config.mjs`
   - `jest.config.js`
   - `.github/workflows/`
   - build/release scripts in `scripts/`
3. Gather lightweight evidence:
   - largest `src/**/*.ts` and `tests/**/*.ts` files by nonblank LOC
   - current lint/typecheck/build/coverage/perf gate coverage from scripts and CI config
   - obvious unimplemented ADR phases or open issues still reflected in code
   - provider-boundary, settings, context/trust, MCP/security, Agent Board, performance, and release-artifact gaps
4. Reconcile with existing docs before creating duplicates:
   - If an issue already exists, link it from the tech-debt note.
   - If a prior review is stale, prefer a fresh note that states current evidence.

## Note format

Create one Markdown note per debt item in `docs/tech-debt/` named:

```text
YYYY-MM-DD-<short-kebab-slug>.md
```

Each note must have Obsidian-compatible YAML frontmatter:

```yaml
---
type: tech-debt
title: "<clear debt title>"
date: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
status: open
priority: "1 - high" # or "2 - normal" / "3 - low"
severity: high # or medium / low
scope: <short-scope>
tags:
  - tech-debt
related:
  - "[[existing-related-note]]"
---
```

Body structure:

```markdown
# <Title>

## Summary

One or two paragraphs describing the debt.

## Evidence

- Concrete files, config, commands, counts, or grep findings.
- Prefer current evidence over remembered claims.

## Why it matters

Explain impact on maintainability, safety, performance, UX, or agentic workflow.

## Suggested remediation

Actionable sequence, small enough to become a PR or work order.

## Acceptance criteria

- [ ] Objective completion checks.
```

## Required topics to consider

Always check whether there is current evidence for these categories:

- Agentic quality gates: lint warning policy, max LOC per file, build in CI, artifact smoke, stale generated assets.
- Oversized modules/tests and deletion-test-positive splits.
- ADR follow-through, especially accepted ADR phases that have types/docs but no wiring.
- Provider-native parity gaps and provider-boundary leaks.
- Settings registry / duplicated imperative UI debt.
- Agent Board evidence, verification, leases, review gates, and run trust.
- Context provenance, pre-send preview, citations, and prompt-injection demarcation.
- MCP and remote transport safety, including SSRF and untrusted tool descriptions.
- Performance gate blind spots for new hot paths.
- Release and Obsidian plugin artifact reproducibility.

## Verification before reporting

After writing notes, run a lightweight verification script/check that confirms:

- every `docs/tech-debt/*.md` note has frontmatter bounded by `---`
- required fields exist: `type`, `title`, `date`, `updated`, `status`, `priority`, `severity`, `scope`, `tags`
- each note has an H1
- local wikilink targets resolve by basename where practical
- `git status --short --branch` still shows only intended changes

## Final response

Report:

- number of notes created or updated
- wikilinks to each note
- verification performed and result
- any existing unrelated modified files that were left untouched
- top 1-3 recommended next actions
