---
name: project-setup
description: Bootstrap a JS/TS project's quality harness (fallow ratchet, ESLint severity-staging, LOC guard, coverage floors, CI) and docs/requirements scaffolding, deterministically via a bundled Node engine. Use when setting up a new project or retroactively adopting agent-driven development on an existing repo. Local-first; GitHub integration is opt-in.
---

# project-setup

Thin orchestration over the deterministic engine in `scripts/setup.mjs`. The
engine owns every mutation; you detect, interview, then invoke it.

## Flow

1. **Detect:** `node scripts/setup.mjs detect` (run from the target repo root via
   the absolute path to this skill's `setup.mjs`). Read the JSON to tailor the
   interview and skip redundant work.
2. **Interview** (one question at a time): guardrail toggles (default all on);
   **test framework — Jest or Vitest** (default the detected one); docs scaffold +
   optional grill; the GitHub decision (see `references/github-integration.md`).
   Write the answers to `answers.json` (shape in `references/quality-harness.md`).
3. **Preview:** `node .../setup.mjs plan --config answers.json` (dry-run; mutates
   nothing). Show the user the deduped change list and the deps that will be
   installed before applying.
4. **Apply:** `node .../setup.mjs apply --config answers.json`. This installs
   deps, writes/merges configs, and baselines every ratchet from the **current**
   state (brownfield-safe — green CI on day one). Relay the output: a **Notice**
   means your existing file/script was kept and that generated gate won't run
   until you merge or rename it — surface these for a decision. **Next steps**
   (e.g. commit the lockfile) are routine.
5. **Optional grill:** if requested, run the interview in `references/grill.md`
   to fill `CONTEXT.md`, seed ADRs, and a first requirements doc.
6. **Verify + report:** `node .../setup.mjs verify --config answers.json` then
   `node .../setup.mjs report`. Then close with a concrete summary:
   - the gate commands with the detected package-manager prefix (e.g. `pnpm
     lint`, `pnpm check:loc`, `pnpm check:quality`, `pnpm test`);
   - `docs/quality-integration-guide.md` as the kept reference;
   - the top items from `quality-report.md`;
   - any Notices from step 4 that still need attention;
   - that the harness is re-runnable (re-apply any time; it won't clobber edits).

## Rules

- Never hand-write harness files — only the engine mutates. If something is
  missing, add a template + sub-planner, don't patch the target directly.
- The engine is idempotent and non-destructive (merge + backup). Re-running is
  safe.
- Requires Node ≥20 (the installed ESLint 9 / typescript-eslint 8 need it).
- If CI was generated, commit the **lockfile** (`package-lock.json` / `pnpm-lock.yaml`
  / `yarn.lock`) with the changes — the generated CI's strict install + dependency
  cache require a committed lockfile (a fresh `apply` creates one but won't commit it).
- Apply on a clean git tree (`git status`) so the change is easy to review; the
  engine backs up any file it must overwrite.
- Run `check:quality` with `./coverage` absent (see `references/quality-harness.md`).
