---
type: quick-action
name: Docs Review
description: Audit the docs/ folder for stale or out-of-date content, then offer a polish pass on findings.
icon: book-open-check
tags:
  - docs
  - review
  - maintenance
---

Scan the vault's `docs/` folder for stale, outdated, or inconsistent documentation, then offer a targeted polish pass.

## 1. Scope

Crawl `docs/` recursively. Include:

- `docs/product/` — user manuals, feature docs, release notes
- `docs/adr/` — architecture decision records
- `docs/research/` — research notes
- `docs/reviews/` — review reports
- `docs/ideas/` — idea notes
- `docs/issues/` — issue notes
- `docs/quick-actions/` — quick-action definitions
-  `docs/superpowers/` - specs and plans

## 2. Staleness signals

For each file, check:

- **Frontmatter date vs content**: `date` field more than ~3 months old and content references things likely changed (provider names, file paths, API shapes, feature status).
- **Status drift**: `status: draft` files that appear complete; `status: approved` or `status: done` plans referencing features that shipped or were abandoned.
- **Broken wikilinks**: `[[...]]` links pointing to files that no longer exist or were renamed.
- **Stale paths**: file paths in body text that no longer match vault structure (e.g. old `src/` paths, renamed folders).
- **Provider mismatches**: docs that mention a feature as "planned" or "not yet implemented" that is now shipped (check `CLAUDE.md` architecture status and `src/` for evidence).
- **Superseded content**: docs that duplicate or contradict a newer doc covering the same topic.
- **Missing cross-refs**: feature docs in `docs/product/features/` that lack a `user_manual` frontmatter link, or user manuals that lack a `related` link to their feature doc.

## 3. Dispatch subagents

Send **one message with three `Agent` tool calls in parallel**:

1. **Structure + links** — Walk `docs/` file tree. Check every wikilink and path reference. Report broken links and stale paths.
2. **Freshness + status** — Read frontmatter `date` and `status` on every file. Cross-reference feature status against `CLAUDE.md` architecture section and `src/providers/*/CLAUDE.md`. Flag status drift and stale feature claims.
3. **Coherence** — Identify duplicated coverage, contradictions between docs, and missing cross-refs. Flag superseded notes that should be archived or deleted.

Each subagent returns:

```
{ severity: "blocker" | "major" | "minor" | "nit",
  file: <vault-relative path>,
  finding: <one sentence>,
  evidence: <quote or diff>,
  suggested_fix: <one line or "none"> }
```

## 4. Synthesize

Merge reports, dedup by `file + finding`, sort by severity. Cap to ~25 items; collapse nits into a count bucket.

Print a findings table:

| Severity | File | Finding | Suggested fix |
|----------|------|---------|---------------|

## 5. Offer polish pass

After printing the table, **stop and ask**:

> "Found N issues (B blocker, M major, m minor, nits). Want me to run a polish pass now? I'll auto-fix low-risk items (broken wikilinks, stale paths, status corrections on clear-cut cases) and leave the rest as reported findings."

Wait for confirmation before touching any file. If approved, apply fixes using `Edit` (no full-file rewrites via `Write`). Re-print the findings table with a `Status` column (`polished` / `reported`) when done.
