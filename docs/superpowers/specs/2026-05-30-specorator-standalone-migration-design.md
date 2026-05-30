---
priority: 1 - high
relations:
  - Product
  - Migration
status: design / approved
date: 2026-05-30
owner: Luis Mendez
supersedes_planning_in:
  - "[[docs/ideas/2026-05-28-standalone-product-vision.md]]"
related:
  - "[[docs/Specorator.md]]"
  - "[[docs/ideas/2026-05-28-standalone-product-vision.md]]"
  - "[[docs/issues/agent-board-mvp.md]]"
parent: Product
---

# Specorator standalone migration — v1.0.0 design

## Purpose

Define the concrete plan for moving the current `claudian-cursor` Obsidian plugin out of its fork identity and into a standalone **Specorator v1.0.0** plugin published at `Luis85/specorator`. This spec converts the strategic intent in `docs/ideas/2026-05-28-standalone-product-vision.md` into locked execution decisions, scoped to a brand-only release that ships the existing code under a new identity.

This design is the source of truth for the migration. Where it conflicts with the vision doc, this spec wins for execution; the vision doc remains the long-range product narrative.

## Scope

In scope for v1.0.0:

- Establish Specorator as a separate plugin with its own id, name, version, author, repository, and storage path.
- Replace the contents of `Luis85/specorator` with the current codebase, rebranded.
- Rename all user-visible Claudian references to Specorator, including in-app strings, README, settings, and command palette entries.
- Mass-rename internal TypeScript symbols from `Claudian*` to `Specorator*`.
- Publish provenance honestly: keep MIT, preserve Yishen Tu copyright, add Luis Mendez copyright, ship a `CREDITS.md`.
- Migrate the whole `docs/` tree into the public repository as part of Specorator's documentation memory.
- Close out the legacy Specorator workflow-cockpit codebase, issues, and PRs.
- Freeze the existing `claudian-cursor` fork as a public artifact with a banner pointing to Specorator.

Out of scope for v1.0.0 (deferred):

- Trust baseline work (setup health, safe permission defaults, context preview, Markdown diff/revert, audit bundles).
- Configurable Agent Board lanes, definitions of ready/done, and role assignments.
- New architectural seams (`ComposerContextBuilder`, `WorkspaceBoardConfig`, `ConversationSessionEnvelope`, provider capability resolver).
- Compatibility/upgrade path from `claudian-cursor` installs.
- Data migration from `.claudian/` to `.specorator/`.
- Submission to the Obsidian community-plugin registry (BRAT-first launch; registry follows after v1.0.x stabilizes).
- Integration of `specorator-obsidian-mcp` into a unified safety surface.
- The `agentonomous` Vue/Vite v2 companion direction is killed, not deferred.

## Locked decisions

The following decisions are settled and not revisited inside this migration. Changes require a new spec.

| # | Decision | Value |
|---|---|---|
| 1 | Scope of brainstorm | Full end-to-end migration plan |
| 2 | Plugin id strategy | New id `specorator`; old plugin archived; no upgrade path |
| 3 | Storage strategy | Fresh `.specorator/`; no import from `.claudian/`; v1.0.0 reset |
| 4 | Repo strategy | Replace main of `Luis85/specorator`; delete legacy code entirely |
| 5 | Agent Board MVP gate | MVP considered done; migration plan-first |
| 6 | Author/maintainer | `Luis Mendez` sole maintainer; CREDITS file for Yishen Tu |
| 7 | Legacy issues/PRs | Close all with transition comment + `legacy-v0` label |
| 8 | v1.0 feature scope | Brand-only; current code as-is; no new features |
| 9 | Distribution | BRAT first; community registry later |
| 10 | Legacy product elements | `agentonomous` superseded; `specorator-obsidian-mcp` stays separate optional; Luis Mendez added to LICENSE |
| 11 | Provider identities | Claude, Codex, Opencode, Cursor names and `.claude/`, `.codex/`, `.opencode/`, `.cursor/` vault folders untouched |
| 12 | Git history | Fresh orphan history at v1.0; CREDITS + LICENSE carry provenance |
| 13 | TypeScript symbol rename | Mass-rename `Claudian*` → `Specorator*` included in v1.0 |
| 14 | Docs tree | Whole `docs/` folder ships to public repo (vision doc, design specs, ideas, issues, product, research, quick-actions, superpowers) |

## Section 1 — Identity and metadata

The migration changes the following metadata fields. All other fields are unchanged.

| Field | Old (`claudian-cursor`) | New (Specorator v1.0) |
|---|---|---|
| `manifest.id` | `claudian-cursor` | `specorator` |
| `manifest.name` | `Claudian (Cursor fork)` | `Specorator` |
| `manifest.version` | `2.9.0` | `1.0.0` |
| `manifest.author` | `Yishen Tu` | `Luis Mendez` |
| `manifest.authorUrl` | `https://github.com/YishenTu` | `https://github.com/Luis85` |
| `manifest.description` | "Embeds Claude Code, Codex, and other coding agents…" | "Spec-driven agent workspace for Obsidian. Plan, run, review, keep the record." |
| `manifest.minAppVersion` | `1.7.2` | `1.7.2` (unchanged) |
| `manifest.isDesktopOnly` | `true` | `true` (unchanged) |
| `package.name` | `claudian` | `specorator` |
| `package.description` | "Claudian - Claude Code embedded in Obsidian sidebar" | "Specorator — spec-driven agent workspace for Obsidian" |
| `package.repository.url` | n/a (or fork URL) | `https://github.com/Luis85/specorator` |
| Vault storage folder | `.claudian/` | `.specorator/` |
| Settings file in storage folder | `claudian-settings.json` | `specorator-settings.json` |
| Provider folders | `.claude/`, `.codex/`, `.opencode/`, `.cursor/` | unchanged |
| LICENSE copyright lines | `Copyright (c) <year> Yishen Tu` | `Copyright (c) <year> Yishen Tu` + `Copyright (c) 2026 Luis Mendez` |
| Old plugin | `claudian-cursor` (active fork) | Frozen as-is; banner; issues disabled |

Provider names (Claude, Codex, Opencode, Cursor) and their vault-side folders are owned by provider-native runtimes and are not renamed. The Specorator brand sits at the plugin level, above provider identities.

## Section 2 — Pre-flight in this repo

All work in this section happens locally on the existing `claudian-cursor` repository on a feature branch named `transition/specorator-v1`. No public push happens until Section 3.

### 2.1 Codebase changes

1. Update `manifest.json` per Section 1 table.
2. Update `package.json` per Section 1 table.
3. Update `LICENSE`: append `Copyright (c) 2026 Luis Mendez` line beneath the existing Yishen Tu copyright line. Keep the MIT license body unchanged.
4. Create `CREDITS.md` at the repo root with the content defined in Section 5.
5. Replace `README.md` with content derived from `docs/Specorator.md`, with the additions defined in Section 5.
6. Rename storage constants throughout the codebase: `.claudian/` → `.specorator/`. This includes any string literal, path builder, and default-value reference.
7. Rename settings filename: `claudian-settings.json` → `specorator-settings.json` in source, defaults, and tests.
8. Rename user-visible UI strings: ribbon tooltip, view titles, settings tab labels, command palette entries, modal headers, status-bar items. The transformation is `Claudian` → `Specorator` in product copy. Provider labels (Claude, Codex, Opencode, Cursor) remain unchanged inside provider-scoped UI.
9. Rename product CSS classes that surface in the DOM as identifiable Claudian branding. Internal-only class prefixes can be migrated opportunistically but are not blocking. The criterion: any class name that a user could read in DevTools and recognise as "Claudian" should be renamed.
10. Update `CLAUDE.md`, `AGENTS.md`, `CONTEXT.md`, and any other repo-level developer doc that references the product name. Provider-specific docs (`src/providers/<name>/CLAUDE.md`) keep provider names but update product references.

### 2.2 TypeScript symbol mass-rename

Rename all identifiers matching the pattern `Claudian*` to `Specorator*`, including:

- Classes: `ClaudianPlugin` → `SpecoratorPlugin`, `ClaudianSettingsStorage` → `SpecoratorSettingsStorage`, etc.
- Interfaces and type aliases: `ClaudianSettings` → `SpecoratorSettings`, etc.
- Constants and variables: `defaultClaudianSettings` → `defaultSpecoratorSettings`, etc.
- Functions: any helper named `claudian*` or `createClaudian*` → `specorator*` / `createSpecorator*`.
- File names: any `claudian-*.ts` or `Claudian*.ts` → `specorator-*.ts` / `Specorator*.ts`.
- Test fixtures, mocks, and snapshot identifiers follow the same rule.
- Import paths follow file renames.

Provider-namespaced symbols (`Claude*`, `Codex*`, `Opencode*`, `Cursor*`) are not touched. The src/ directory layout (chat, tasks, providers, etc.) is not restructured.

Execution strategy:

- Perform renames in one batched pass on the `transition/specorator-v1` branch.
- Run `npm run typecheck` after each major rename group to catch references missed by find-replace.
- Run `npm run lint` and `npm run test` once at the end.
- Because v1.0 ships from an orphan commit (Section 3), the size of the rename diff is irrelevant to the published history. The diff matters only for local review.

### 2.3 Verification

The following must pass before any push to `Luis85/specorator`:

- `npm run typecheck` clean.
- `npm run lint` clean (zero warnings).
- `npm run test` clean for both unit and integration projects.
- `npm run build` clean.
- Sideload-built plugin installed into a clean test vault.
- Test vault confirms: plugin boots, ribbon and command palette entries say Specorator, `.specorator/` folder is created (not `.claudian/`), `specorator-settings.json` is written.
- Manual smoke test in test vault for every provider the executing developer has configured locally (Claude is mandatory; Codex, Opencode, Cursor exercised if credentials/CLIs are available): send a chat message, attach an image, fork a conversation, run an inline edit, create a work order, run it through a chat tab, observe ledger + handoff written to the work-order note.
- Provider-native vault folders (`.claude/`, `.codex/`, `.opencode/`, `.cursor/`) confirmed untouched.
- Screenshot capture for README update.

If any verification step fails, the migration is paused and the branch is fixed before continuing. No partial migration is published.

## Section 3 — Migration push to Luis85/specorator

Pre-condition: Section 2 verification passes.

### 3.1 Freeze the fork

1. In the current `claudian-cursor` repository, tag the latest commit on the `transition/specorator-v1` branch's base as `claudian-cursor-final`. This tag captures the last state of the fork before brand work, providing a stable reference point.
2. Push the tag to the fork's origin.

### 3.2 Build the orphan tree

The Specorator v1.0 commit history starts fresh. Steps:

1. In a scratch directory outside this repository, run `git init`.
2. Copy the working tree from `transition/specorator-v1` into the scratch directory, excluding:
   - `.git/`
   - `node_modules/`
   - Build artefacts: `main.js`, `styles.css` (these are produced by `npm run build` and should be excluded from source unless required for BRAT delivery — confirm Obsidian plugin convention before final push)
   - `.context/`
   - Vault-only root paths that do not belong in the published source tree: `Agent Board/`, `Wikipedia - Signs of AI writing - Wikipedia.md`, `test-output.log`, and any other vault-private root note identified during execution.
3. **Ship the whole `docs/` tree.** Every subdirectory under `docs/` (`Backlog.base`, `examples/`, `ideas/`, `issues/`, `product/`, `quick-actions/`, `research/`, `superpowers/`) migrates into the public repository as-is. This includes the vision doc, this migration spec at its original `docs/superpowers/specs/` location, prior design specs, brainstorming artefacts, idea notes, research notes, and quick-action templates. The published `docs/` tree becomes part of Specorator's source of truth and product memory. Wikilinks inside those notes (e.g. `[[docs/features/Chat]]`) will render as plain text on GitHub but remain readable; no automated rewrite happens at migration time.
4. `git add -A`.
5. `git commit -m "chore: initial Specorator v1.0"`.

The exclusion list is intentionally tight. Apart from `.git/`, `node_modules/`, build artefacts, `.context/`, and the listed vault-only root paths, everything else in the repository ships. The full `docs/` tree is in scope per locked decision (added during spec review): the public Specorator repository carries the same documentation memory the vault carries.

### 3.3 Push to Luis85/specorator

1. `git remote add origin git@github.com:Luis85/specorator.git`.
2. `git push --force origin main`.

The force-push is explicitly sanctioned by locked decision #4. It replaces the legacy Specorator codebase with the new orphan commit. Legacy code becomes unreachable from `main` and is retained only via the GitHub reflog and any pre-existing release tarballs.

### 3.4 Tag and release

1. `git tag v1.0.0`.
2. `git push origin v1.0.0`.
3. Create a GitHub release for `v1.0.0` with:
   - Title: `Specorator v1.0.0 — spec-driven agent workspace for Obsidian`
   - Body content per Section 5.5.
   - Release assets: `manifest.json`, `main.js`, `styles.css` (built artefacts), and any additional files BRAT and Obsidian conventionally require.
4. Update repository metadata in GitHub:
   - Description: "Spec-driven agent workspace for Obsidian — plan in Markdown, run provider-native agents, review with evidence."
   - Topics: `obsidian-plugin`, `agent`, `spec-driven`, `claude-code`, `codex`, `opencode`, `cursor`.
   - Website link: pointer to README or future product page.
   - Social preview image: derived from existing `Preview.png` or a new Specorator-branded asset.

### 3.5 Rollback policy

The orphan commit becomes the new permanent base of `Luis85/specorator`. Rollback for a critical v1.0.0 bug:

- Patch forward via `v1.0.1` release; do not attempt to revert the force-push.
- BRAT users following the repository receive the patch automatically.
- The `claudian-cursor-final` tag in the old fork remains a known-good reference state should everything need to be re-attempted.

## Section 4 — Legacy handling

### 4.1 Issues and PRs on Luis85/specorator

Before the force-push:

1. Create a `legacy-v0` label in the repository (a neutral grey colour is recommended).
2. Bulk-close every open issue and every open PR with the following templated comment:

   > Closing as part of the Specorator v1.0 migration. This issue references the legacy v0 workflow-cockpit plugin, which has been superseded by a new provider-native implementation. See the v1.0 release notes and CREDITS.md for context. If the underlying need still applies to v1.0, please open a fresh issue against the new codebase.

3. Apply the `legacy-v0` label on each close.

Closed-with-label issues remain accessible, are filtered out of the default open view, and signal honest treatment of historic work without committing to retrofit every old idea.

### 4.2 The frozen claudian-cursor fork

After the migration, the existing `claudian-cursor` repository is frozen:

1. The `claudian-cursor-final` tag from Section 3.1 marks the final state.
2. Update the README with a banner at the top:

   > **Frozen fork — superseded by [Specorator](https://github.com/Luis85/specorator).** This repository is no longer updated. New work, releases, and issue tracking happen in Specorator. Existing installations of `claudian-cursor` will continue to function but receive no further updates.

3. Disable issues on the fork via GitHub repository settings. Users attempting to open issues are guided to Specorator's issue tracker by GitHub's default messaging.
4. The plugin manifest id remains `claudian-cursor`. Because Specorator uses id `specorator`, a user with both plugins installed sees them as distinct entries with no collision.
5. The fork is not deleted. It remains a public artefact of the implementation lineage.

### 4.3 Legacy Specorator codebase

The legacy Specorator workflow-cockpit code dies at the force-push. Per locked decision #4, this is intentional. Useful product concepts have already been migrated into the vision doc and `docs/Specorator.md` narrative; the codebase itself has no path forward.

Reflog and any GitHub-archived release tarballs of the legacy code remain accessible if required for historical reference.

## Section 5 — Provenance and attribution

### 5.1 LICENSE

The MIT licence body remains unchanged. The copyright block is updated to:

```
MIT License

Copyright (c) <existing-year> Yishen Tu
Copyright (c) 2026 Luis Mendez

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The existing year in the original copyright line is preserved as found in the current LICENSE file. Plan execution confirms the exact wording at write time.

### 5.2 CREDITS.md

A new file at the repository root with the following content:

```markdown
# Credits

Specorator is built on the work of multiple project lines.

## Implementation origin

Specorator's plugin implementation began as a fork of the original Claudian
Obsidian plugin by Yishen Tu, released under the MIT License. The current
codebase has evolved substantially — provider-native runtimes for Claude,
Codex, Opencode, and Cursor; Agent Board work orders; inline edit;
configurable workspace surfaces — but the foundation traces back to that
work. We are grateful for the MIT release and preserve the original
copyright in the LICENSE file.

Upstream: https://github.com/YishenTu/claudian

## Product origin

The Specorator name and the spec-driven workflow concept originate from
earlier Specorator project work in this repository (Luis Mendez,
https://github.com/Luis85/specorator). The v1.0 release supersedes the
prior workflow-cockpit plugin implementation but preserves the product
direction: capture intent as Markdown, run provider-native agents, keep
the durable trail in the vault.

## Maintainer

Specorator is currently maintained by Luis Mendez (https://github.com/Luis85).
```

### 5.3 README.md

The new README replaces the existing Claudian README in full. Source content is `docs/Specorator.md`. The following changes apply when promoting that note to repository README:

- Add an installation section near the top with BRAT instructions pointing at `Luis85/specorator` and a note that the community-plugin registry submission is planned for after v1.0.x stabilises.
- Add a short "Origins" footer that links to `CREDITS.md` for the full provenance.
- Drop YAML frontmatter that is meaningful inside the vault but not on GitHub (`type`, `name`, `tagline`, `status`, `features`, `cta_url`, `date`); replace with rendered markdown where useful (e.g., the tagline appears as a subtitle line).
- Convert vault-internal wikilinks (`[[docs/features/Chat]]` etc.) to relative markdown links into the repository's docs directory (e.g., `[Chat](docs/features/Chat.md)`).
- Keep screenshot placeholders. Replacement screenshots ship in v1.0.x as captures become available.

### 5.4 In-app provenance

Settings → "About Specorator" pane (or equivalent) exposes:

- Version number.
- Link to `CREDITS.md` on GitHub.
- Link to the Specorator GitHub repository.
- Link to the GitHub releases page.

No Claudian branding remains in any user-visible surface after Section 2.

### 5.5 GitHub release notes

For the `v1.0.0` GitHub release:

```markdown
# Specorator v1.0.0 — spec-driven agent workspace for Obsidian

Specorator turns Obsidian into a spec-driven agent workspace. Plan work in
Markdown, run it through provider-native agents (Claude Code, Codex,
Opencode, Cursor), review what came back, and keep the durable trail in
your vault.

This is the first release of Specorator under its new implementation
foundation. The plugin's source lineage is documented in
[CREDITS.md](https://github.com/Luis85/specorator/blob/main/CREDITS.md).

## Install via BRAT

Point BRAT at `Luis85/specorator` and install v1.0.0. Submission to the
Obsidian community-plugin registry is planned once v1.0.x stabilises.

## What's inside

See the [README](https://github.com/Luis85/specorator#readme) for the
full overview. v1.0 ships the current provider-native chat, Agent Board
work orders, inline edit, quick actions, and orchestrator under the
Specorator identity.

## Migration notes

If you are coming from the legacy Specorator v0 workflow-cockpit plugin
or from the `claudian-cursor` fork, please read the
[migration spec](https://github.com/Luis85/specorator/blob/main/docs/superpowers/specs/2026-05-30-specorator-standalone-migration-design.md)
for context on what changed and why.
```

The migration spec ships at its native path under `docs/superpowers/specs/` as part of the full `docs/` tree migration (Section 3.2), so the link resolves once the orphan commit is published.

## Section 6 — Post-launch and deferred items

### 6.1 Day-0 communications

- The `v1.0.0` GitHub release is published as the primary launch artefact.
- A pinned issue titled "Welcome to Specorator v1.0 — migration notes" is created in the new repository, linking to the migration spec at `docs/superpowers/specs/2026-05-30-specorator-standalone-migration-design.md` and to `CREDITS.md`.
- `docs/Specorator.md` remains the canonical product narrative in the vault and is mirrored as `README.md` in the repository.
- No social or forum push happens with v1.0. Distribution is BRAT-first and intentionally low-pressure.

### 6.2 The patch window

- A two-to-four-week patch window follows the v1.0.0 release.
- Real user reports against v1.0 are triaged into `v1.0.1`, `v1.0.2`, etc. as needed.
- The patch line is bug fixes and documentation fixes only. No new features.
- Legacy issues from the closed-out `legacy-v0` set are not retrofitted; new reports go through fresh issues.

### 6.3 Deferred roadmap

The following items are explicitly deferred from v1.0 and are recorded here for the v1.x planning that follows:

| Item | Source | Target |
|---|---|---|
| Trust baseline: provider setup health, safe permission defaults, context preview, Markdown diff/review/revert, audit events, redacted diagnostic bundles | Vision Phase 4 | v1.1 |
| Audit/diagnostics module (alongside trust baseline) | Vision Phase 6 | v1.1 |
| Configurable Agent Board lanes, definitions of ready, definitions of done, role assignments, evidence requirements | Vision §6 + Phase 5 | v1.2 |
| `WorkspaceBoardConfig` model and renderer | Vision Phase 6 | v1.2 |
| Workflow/template store for work-order templates | Vision Phase 6 | v1.2 |
| `ComposerContextBuilder` seam | Vision Phase 6 | v1.x |
| Provider capability resolver | Vision Phase 6 | v1.x |
| `ConversationSessionEnvelope` typed seam | Vision Phase 6 | v1.x |
| In-app MCP management for Codex, Opencode, Cursor (Claude already supported) | Existing gap | v1.x |
| Community plugin registry submission | Locked decision #9 | After v1.0.x stabilises |
| `specorator-obsidian-mcp` integration evaluation | Vision open question | v1.x |
| CSS class and internal-only symbol cleanup beyond v1.0 pass | Section 2.1 follow-up | v1.0.x as found |

### 6.4 Explicitly killed

The following are not deferred — they are dropped:

- The `agentonomous` Vue/Vite v2 companion app direction. Provider-native runtimes already inside the plugin supersede it.
- Compatibility or upgrade path from `claudian-cursor` installations to Specorator. Users who want history continuity must move it manually.
- Data migration from `.claudian/` to `.specorator/`. v1.0 is a fresh-start product per locked decision #3.

### 6.5 Open follow-up questions

These are recorded for v1.x planning, not v1.0 blockers:

- Will `specorator-obsidian-mcp` eventually fold into Specorator's safety surface, or remain a separate optional companion permanently?
- Which trust baseline items are P0 for v1.1 versus P1 for v1.2?
- Does the configurable board get a settings UI, a Markdown-based config file, or both?
- After registry submission, do `claudian-cursor` users need a one-time migration helper, or is the fresh-start policy permanent?

## Verification and acceptance

The migration is considered complete when all of the following are true:

- `Luis85/specorator` main is at the orphan commit `chore: initial Specorator v1.0`.
- `v1.0.0` is tagged and a GitHub release exists with the standard release assets.
- The plugin installs via BRAT from `Luis85/specorator` and boots in a clean vault.
- The plugin creates `.specorator/`, not `.claudian/`, in a clean vault.
- All user-visible product strings say Specorator. Provider-scoped strings (Claude / Codex / Opencode / Cursor) are unchanged.
- All TypeScript identifiers matching `Claudian*` have been renamed to `Specorator*` outside provider-namespaced scopes.
- `LICENSE` carries both copyright lines.
- `CREDITS.md` is present at the repository root and matches Section 5.2 content.
- `README.md` reflects the Specorator narrative with installation guidance.
- All legacy Specorator issues and PRs are closed with the templated comment and the `legacy-v0` label.
- The `claudian-cursor` fork carries the freeze banner and has its issues disabled.
- `npm run typecheck && npm run lint && npm run test && npm run build` are clean in the new repository.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Force-push to `Luis85/specorator` cannot be reverted | Local Section 2 verification is mandatory before push. Patch forward for bugs; never attempt force-push reversal. |
| TypeScript mass-rename misses references | Run `npm run typecheck` after each rename group; resolve all errors before continuing. Final `npm run lint` and `npm run test` pass is required. |
| Vault-internal docs (e.g., `Agent Board/`, `docs/ideas/`) accidentally ship to the public repository | Exclusion list is built explicitly in Section 3.2 before the orphan commit. Spot-check the staged tree before commit. |
| Provider folders or settings are touched by storage rename | Storage renames target Claudian-owned paths only (`.claudian/`, `claudian-settings.json`). Provider folders (`.claude/`, etc.) are protected by the locked decision #11 and confirmed in Section 2.3 smoke test. |
| Existing `claudian-cursor` users feel abandoned | The frozen fork remains installed and functional. README banner explains the supersession. No silent breakage occurs because the plugin id changes. |
| Legacy Specorator users feel old work was ignored | Closed-with-`legacy-v0` issues acknowledge history. `CREDITS.md` and the migration narrative explain why the codebase was replaced. |
| Provenance is unclear to downstream consumers | LICENSE carries both copyright lines. `CREDITS.md` spells out both project lines. In-app About pane links to CREDITS. |

## Out-of-scope reminder

This spec covers brand migration only. Architectural deepening, new features, configurable workflows, and trust baseline work are explicitly deferred. The deferred-roadmap table in Section 6.3 records the next planning targets, but each of those gets its own brainstorm, spec, and plan in its own cycle.
