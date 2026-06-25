---
title: Specorator v1.0.0 — Migration Execution Runbook
date: 2026-06-24
status: ready
scope: handoff runbook for the public migration (Phases 10–12) executed locally by the maintainer
owner: Luis Mendez
related:
  - "[[2026-05-30-specorator-standalone-migration-design]]"
  - "[[2026-05-30-specorator-standalone-migration]]"
---

# Specorator v1.0.0 — Migration Execution Runbook

This is the step-by-step handoff for moving the rebranded plugin out of the
`claudian-cursor` fork and into the standalone **Specorator** repository at
`Luis85/specorator`. The in-repo rebrand (Phases 1–9 of the
[implementation plan](../superpowers/plans/2026-05-30-specorator-standalone-migration.md))
is **already done and verified** on the branch
`claude/specorator-standalone-migration-mkbqz6`. This document covers the
public-facing steps (Phases 10–12) that must run from your local machine with
an authenticated `gh` and a real Obsidian vault — they cannot run in the cloud
session.

Authority: the locked decisions live in the
[migration design spec](../superpowers/specs/2026-05-30-specorator-standalone-migration-design.md).
Where this runbook deviates from the older plan, the deviation is called out
explicitly and is intentional.

> **The fork's final release is `v4.0.0`** on `Luis85/claudian`. That is the
> freeze point. The new product line restarts at **`v1.0.0`** under the
> `specorator` plugin id (locked decision #3: fresh start).

---

## 0. What is already done (do not redo)

On branch `claude/specorator-standalone-migration-mkbqz6`:

- `manifest.json` → id `specorator`, name `Specorator`, version `1.0.0`, author `Luis Mendez`, `minAppVersion 1.11.5`.
- `package.json`, `LICENSE` (dual copyright), `CREDITS.md`, README (Specorator narrative), `versions.json` (`{ "1.0.0": "1.11.5" }`).
- All `Claudian*`/`claudian*` TypeScript symbols, files, UI strings, 10 locales, view-types, and `claudian-*` CSS classes renamed to Specorator.
- Storage path `.claudian/` → `.specorator/`, settings file `specorator-settings.json`. **No data import** (fresh start).
- `scripts/release.mjs` targets `Luis85/specorator`.
- Provider identities (Claude/Codex/Opencode/Cursor) and `.claude/.codex/.cursor/.opencode` vault folders untouched.
- Verified green: `typecheck`, `lint`, `test` (9,114), `build`, `check:artifacts`, `check:quality`, `check:loc`, `perf` — locally and in CI on PR #121.

---

## 1. Pre-flight on the checked-out branch

```bash
# From your local clone of Luis85/claudian
git fetch origin
git checkout claude/specorator-standalone-migration-mkbqz6
git pull --ff-only
npm ci
npm run typecheck && npm run lint && npm run test && npm run build
npm run check:artifacts        # expects version 1.0.0, minAppVersion 1.11.5
```

Confirm the build produced `main.js` and `styles.css` at the repo root (both
are git-ignored — they ship as release assets, not source).

Sanity grep — should return **only** provenance (LICENSE/CREDITS/README) and
`docs/` history:

```bash
grep -rni "claudian" . \
  --exclude-dir=node_modules --exclude-dir=.git \
  --exclude=main.js --exclude=styles.css --exclude=package-lock.json \
  --exclude-dir=docs | grep -vi "CREDITS.md\|LICENSE\|README.md"
# expected: (no output)
```

---

## 2. Phase A — Clean-vault smoke test (manual, required)

The cloud session could not run Obsidian; this is the one step a human must do
before the irreversible force-push.

1. Build: `npm run build`.
2. Create a fresh vault, e.g. `~/specorator-smoke/`, and disable all other plugins.
3. Sideload:
   ```bash
   mkdir -p ~/specorator-smoke/.obsidian/plugins/specorator
   cp main.js manifest.json styles.css ~/specorator-smoke/.obsidian/plugins/specorator/
   ```
4. Enable **Specorator** in the vault and confirm:
   - Plugin list shows name **Specorator**, author **Luis Mendez**, version **1.0.0**.
   - Ribbon icon and command-palette entries say Specorator; no "Claudian" anywhere in the UI.
   - Opening the chat creates **`.specorator/`** (with `specorator-settings.json` + `sessions/`), and **no `.claudian/`** folder appears.
5. For each provider you have credentials/CLI for (Claude mandatory; Codex/Opencode/Cursor if available): send a message, attach an image, fork, run an inline edit, create a work order and run it through a chat tab (confirm ledger + handoff written to the note).
6. Confirm provider folders `.claude/`, `.codex/`, `.opencode/`, `.cursor/` are created only by the providers that ran and are otherwise untouched.
7. (Optional) Capture screenshots for a later README refresh under `docs/assets/screenshots/v1.0/`.

**If anything fails, stop.** Fix on the branch and re-run before pushing.

---

## 3. Phase B — Confirm the fork freeze point

You already released `v4.0.0`. Tag the fork's pre-migration tip as a stable
reference (idempotent — skip if the tag exists):

```bash
git tag claudian-cursor-final v4.0.0   # or the commit you released v4.0.0 from
git push origin claudian-cursor-final
```

---

## 4. Phase C — Build the orphan tree (fresh history)

Locked decision #12: Specorator v1.0 starts from a **single orphan commit**.
This runbook builds the tree from **git-tracked files** via `git archive`,
which automatically respects `.gitignore` (so `node_modules/`, `main.js`,
`styles.css`, `.env.local` are excluded with no manual list).

> **Deviation from the older plan (intentional):** the plan's rsync exclusion
> list is replaced by `git archive`. We also **keep `versions.json` and
> `Preview.png`** in the published tree — `versions.json` is required by BRAT
> and the README references `Preview.png`. Both are tracked, so `git archive`
> includes them.

```bash
# Still on claude/specorator-standalone-migration-mkbqz6
SCRATCH=~/scratch/specorator-v1
rm -rf "$SCRATCH" && mkdir -p "$SCRATCH"
git archive HEAD | tar -x -C "$SCRATCH"

cd "$SCRATCH"
git init -b main
git add -A
git commit -m "chore: initial Specorator v1.0"
git log --oneline        # expect exactly one commit
```

Spot-check before pushing:

```bash
ls "$SCRATCH"                       # manifest.json, package.json, LICENSE, CREDITS.md, README.md, src/, docs/, versions.json, Preview.png
test ! -e "$SCRATCH/main.js" && echo "OK: no build artifact in source"
test ! -e "$SCRATCH/node_modules" && echo "OK: no node_modules"
grep -ri "claudian" "$SCRATCH" --include=*.ts --include=*.css -l   # expect: (nothing)
```

---

## 5. Phase D — Force-push to Luis85/specorator

> **Irreversible.** This replaces the legacy Specorator codebase on `main`
> (locked decision #4). Do not proceed unless Phase A passed.

```bash
cd "$SCRATCH"
git remote add origin git@github.com:Luis85/specorator.git   # or https://github.com/Luis85/specorator.git
git push --force origin main
```

---

## 6. Phase E — Tag v1.0.0 and publish the release

```bash
cd "$SCRATCH"
git tag v1.0.0
git push origin v1.0.0
```

Build the release assets from the **source repo** (the orphan tree has no build
output) and create the GitHub release:

```bash
cd ~/path/to/claudian   # your Luis85/claudian working copy, on the branch
npm run build
gh release create v1.0.0 \
  --repo Luis85/specorator \
  --title "Specorator v1.0.0 — spec-driven agent workspace for Obsidian" \
  --notes-file docs/migration/v1.0.0-release-notes.md \
  main.js manifest.json styles.css
```

BRAT requires `manifest.json`, `main.js`, and `styles.css` attached to the
release — all three are in the command above.

---

## 7. Phase F — Repository metadata

```bash
gh repo edit Luis85/specorator \
  --description "Spec-driven agent workspace for Obsidian — plan in Markdown, run provider-native agents, review with evidence." \
  --homepage "https://github.com/Luis85/specorator#readme" \
  --add-topic obsidian-plugin --add-topic agent --add-topic spec-driven \
  --add-topic claude-code --add-topic codex --add-topic opencode --add-topic cursor
```

---

## 8. Phase G — Close legacy issues and PRs

```bash
gh label create legacy-v0 --repo Luis85/specorator \
  --color "808080" --description "Legacy v0 workflow-cockpit plugin — superseded by v1.0"

cat > /tmp/legacy-v0.md <<'EOF'
Closing as part of the Specorator v1.0 migration. This issue references the legacy v0 workflow-cockpit plugin, which has been superseded by a new provider-native implementation. See the v1.0 release notes and CREDITS.md for context. If the underlying need still applies to v1.0, please open a fresh issue against the new codebase.
EOF

# Issues
for n in $(gh issue list --repo Luis85/specorator --state open --limit 200 --json number --jq '.[].number'); do
  gh issue comment "$n" --repo Luis85/specorator --body-file /tmp/legacy-v0.md
  gh issue edit "$n" --repo Luis85/specorator --add-label legacy-v0
  gh issue close "$n" --repo Luis85/specorator
done

# PRs
for n in $(gh pr list --repo Luis85/specorator --state open --limit 200 --json number --jq '.[].number'); do
  gh pr comment "$n" --repo Luis85/specorator --body-file /tmp/legacy-v0.md
  gh pr edit "$n" --repo Luis85/specorator --add-label legacy-v0
  gh pr close "$n" --repo Luis85/specorator
done
```

---

## 9. Phase H — Freeze the claudian-cursor fork

On `Luis85/claudian` `main` (not the migration branch), prepend a banner to the
README and disable issues:

```markdown
> **Frozen fork — superseded by [Specorator](https://github.com/Luis85/specorator).** This repository is no longer updated. New work, releases, and issue tracking happen in Specorator. Existing installations of `claudian-cursor` will continue to function but receive no further updates.

---
```

```bash
gh repo edit Luis85/claudian --enable-issues=false
```

The plugin id stays `claudian-cursor` on the fork, distinct from `specorator`,
so a user with both installed sees two separate, non-colliding entries. Do not
delete the fork — it is the public record of the implementation lineage.

---

## 10. Phase I — Pinned welcome issue

```bash
cat > /tmp/welcome.md <<'EOF'
Welcome to Specorator v1.0.

Specorator turns Obsidian into a spec-driven agent workspace. Plan work in Markdown, run it through provider-native agents (Claude Code, Codex, Opencode, Cursor), review what came back, and keep the durable trail in your vault.

If you are arriving from the legacy Specorator v0 workflow-cockpit plugin or from the `claudian-cursor` fork, v1.0 is a new implementation foundation. Please read:

- The migration spec: docs/superpowers/specs/2026-05-30-specorator-standalone-migration-design.md
- CREDITS.md for the source lineage and acknowledgements.

Install via BRAT at `Luis85/specorator`. Community-plugin registry submission is planned once v1.0.x stabilises. Bug reports for v1.0 are welcome as new issues here.
EOF

num=$(gh issue create --repo Luis85/specorator \
  --title "Welcome to Specorator v1.0 — migration notes" \
  --body-file /tmp/welcome.md --json number --jq .number)
gh issue pin "$num" --repo Luis85/specorator
```

---

## 11. Rollback policy

The orphan commit is the permanent base of `Luis85/specorator`. For a critical
v1.0.0 defect, **patch forward** with `v1.0.1` — never attempt to revert the
force-push. The `claudian-cursor-final` tag on the fork remains a known-good
reference if the whole migration must be re-attempted.

---

## 12. Acceptance checklist

- [ ] `Luis85/specorator` `main` is the single orphan commit `chore: initial Specorator v1.0`.
- [ ] `v1.0.0` tagged; GitHub release exists with `main.js`, `manifest.json`, `styles.css` assets.
- [ ] BRAT install from `Luis85/specorator` boots in a clean vault and creates `.specorator/` (not `.claudian/`).
- [ ] All user-visible strings say Specorator; provider strings unchanged.
- [ ] `LICENSE` carries both copyright lines; `CREDITS.md` present; README is the Specorator narrative.
- [ ] Legacy issues/PRs closed with the templated comment + `legacy-v0` label.
- [ ] `claudian-cursor` fork has the freeze banner and issues disabled.
- [ ] Pinned welcome issue exists on `Luis85/specorator`.
