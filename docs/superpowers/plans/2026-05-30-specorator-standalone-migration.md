---
title: Specorator Standalone Migration (v1.0.0 rebrand)
date: 2026-05-30
status: open
scope: brand/standalone migration — Claudian → Specorator v1.0.0 (packaging, not new capability)
parent: Product
related:
  - "[[Specorator Agent Harness PRD]]"
  - "[[Specorator]]"
---
# Specorator Standalone Migration Implementation Plan

> **Connects to the harness roadmap.** This plan delivers **Specorator v1.0.0 — a brand/standalone rebrand of *today's* feature set** (chat, Agent Board, inline edit, Quick Actions, Orchestrator), moved to `Luis85/specorator` with `.claudian/` → `.specorator/` storage. It is the **foundation/packaging release**; the agent-harness program (zero-terminal onboarding, undo, Vault MCP, RAG, Harness Library) ships *after* it as Specorator v1.x → v2 — see **[[Specorator Agent Harness PRD]]** (§12 roadmap). Three connections to carry forward: (1) the live manifest is **already at `minAppVersion` 1.11.5** (the SecretStorage floor the harness's in-app keys need) — Task 2's draft manifest below still shows `1.7.2` and must be updated to **preserve 1.11.5**; (2) doc paths moved under `docs/product/` since this plan was written (e.g. `docs/Specorator.md` → `docs/product/Specorator.md`, and feature wikilinks now live under `docs/product/features/`) — adjust the Task 19/20 references accordingly; (3) **resolve the harness PRD's R6 before the no-import storage tasks.** This plan's locked "fresh start, no data import" (Task 6) and the smoke test that expects no `.claudian/` would, on an existing install, **silently reset users' settings, sessions, MCP config, and Quick Actions** — the PRD flags this as a trust risk (R6). Decide *first*: ship a one-time `.claudian/` → `.specorator/` import shim **or** an in-product "your previous data is under `.claudian/`" notice; do not ship a silent reset.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the `claudian-cursor` Obsidian plugin to a standalone Specorator v1.0.0 plugin published at `Luis85/specorator`, executing the locked decisions from `docs/superpowers/specs/2026-05-30-specorator-standalone-migration-design.md`.

**Architecture:** Brand-only release. Pre-flight rename pass on a feature branch in this repo (`claudian-cursor`). Mass-rename Claudian* TypeScript identifiers and user-visible strings to Specorator*. Storage path migrates from `.claudian/` to `.specorator/`. View types and CSS classes rename to specorator-* prefixes. After local verification, build a fresh orphan git tree in a scratch directory and force-push to `Luis85/specorator` main. Tag v1.0.0, close legacy issues, freeze the fork.

**Tech Stack:** TypeScript, Obsidian Plugin API, esbuild, ESLint, Jest, Git, GitHub CLI (`gh`).

---

## Pre-conditions

- Working tree clean enough to start branch work (commit or stash unrelated docs/feature changes first).
- `npm install` ran successfully; `npm run build` works against current `claudian-cursor` codebase.
- GitHub CLI `gh` authenticated against the GitHub account that owns `Luis85/specorator`.
- Write access to both `Luis85/claudian` (this fork) and `Luis85/specorator`.
- A clean test vault available for smoke-testing. Path placeholder: `D:/test-vaults/specorator-smoke/`.

## Phase 1 — Branch setup

### Task 1: Create transition branch and tag current fork state

**Files:**
- No file edits in this task.

- [ ] **Step 1: Confirm working tree clean**

Run:
```bash
git -C D:/Projects/claudian status --short
```
Expected: empty output or only files unrelated to the migration. If non-empty, commit or stash before continuing.

- [ ] **Step 2: Tag the current `main` as the fork's final pre-migration state**

Run:
```bash
git -C D:/Projects/claudian tag claudian-cursor-final
git -C D:/Projects/claudian push origin claudian-cursor-final
```
Expected: tag created and pushed.

- [ ] **Step 3: Create migration branch from main**

Run:
```bash
git -C D:/Projects/claudian checkout -b transition/specorator-v1
```
Expected: switched to new branch `transition/specorator-v1`.

- [ ] **Step 4: Push the new branch to origin**

Run:
```bash
git -C D:/Projects/claudian push -u origin transition/specorator-v1
```
Expected: remote branch tracking set.

## Phase 2 — Metadata, LICENSE, CREDITS

### Task 2: Rewrite `manifest.json` for Specorator v1.0.0

> **The manifest/package snapshots in this plan (Tasks 2–3) are illustrative**, captured when the plan was drafted, and drift from the repo over time. Before each step, diff against the **live** `manifest.json` / `package.json` rather than the inline copy. Only these are normative: **reset** `id → specorator` and `version → 1.0.0`; **preserve** `minAppVersion 1.11.5` (the SecretStorage floor); carry author/repo/description per the target block. Current live values at last edit: `id: claudian-cursor`, `version: 3.3.0`, `minAppVersion: 1.11.5`.

**Files:**
- Modify: `D:/Projects/claudian/manifest.json`

- [ ] **Step 1: Read current manifest**

Run:
```bash
cat D:/Projects/claudian/manifest.json
```
Confirm content matches:
```json
{
  "id": "claudian-cursor",
  "name": "Claudian (Cursor fork)",
  "version": "3.3.0",
  "minAppVersion": "1.11.5",
  "description": "Embeds Claude Code, Codex, and other coding agents as AI collaborators in your vault. Your vault becomes their working directory, giving them capabilities for file reads and writes, search, bash commands, and multi-step workflows.",
  "author": "Yishen Tu",
  "authorUrl": "https://github.com/YishenTu",
  "isDesktopOnly": true
}
```

- [ ] **Step 2: Replace contents**

> **Update (post-harness-design):** preserve **`minAppVersion` 1.11.5** (required by the harness's `SecretStorage` key entry — the live manifest is already there; the `1.7.2` shown when this plan was drafted must not regress that floor). The *product* `version` intentionally **resets to `1.0.0`** for the standalone release, as the manifest block below sets — regardless of the fork's current `3.3.0`. (Only `minAppVersion` carries forward; the version is a deliberate reset.)

Write to `D:/Projects/claudian/manifest.json`:
```json
{
  "id": "specorator",
  "name": "Specorator",
  "version": "1.0.0",
  "minAppVersion": "1.11.5",
  "description": "Spec-driven agent workspace for Obsidian. Plan, run, review, keep the record.",
  "author": "Luis Mendez",
  "authorUrl": "https://github.com/Luis85",
  "isDesktopOnly": true
}
```

- [ ] **Step 3: Commit**

Run:
```bash
git -C D:/Projects/claudian add manifest.json
git -C D:/Projects/claudian commit -m "chore(brand): rewrite manifest.json for Specorator v1.0.0"
```

### Task 3: Rewrite `package.json` for Specorator

**Files:**
- Modify: `D:/Projects/claudian/package.json`

- [ ] **Step 1: Update fields**

Edit `D:/Projects/claudian/package.json`:
- Change `"name": "claudian"` to `"name": "specorator"`.
- Change `"version": "3.3.0"` to `"version": "1.0.0"`.
- Change `"description": "Claudian - Claude Code embedded in Obsidian sidebar"` to `"description": "Specorator — spec-driven agent workspace for Obsidian"`.
- Change `"author": "Yishen Tu"` to `"author": "Luis Mendez"`.
- Update `keywords` array to: `["specorator", "obsidian", "obsidian-plugin", "agent", "spec-driven", "claude-code", "codex", "opencode", "cursor"]`.
- Add or update `"repository"` block:
  ```json
  "repository": {
    "type": "git",
    "url": "https://github.com/Luis85/specorator"
  }
  ```

- [ ] **Step 2: Confirm scripts unchanged**

Verify that the `scripts` block (postinstall, build:css, dev, build, test-build, release, typecheck, lint, lint:fix, test, test:watch, test:coverage, version) is unchanged.

- [ ] **Step 3: Commit**

Run:
```bash
git -C D:/Projects/claudian add package.json
git -C D:/Projects/claudian commit -m "chore(brand): rewrite package.json for Specorator v1.0.0"
```

### Task 4: Rewrite `LICENSE` with both copyright lines

**Files:**
- Modify: `D:/Projects/claudian/LICENSE`

- [ ] **Step 1: Read current LICENSE**

Current content:
```
MIT License

Copyright (c) 2025

Permission is hereby granted, ...
```
The current copyright line lacks a name. Replace with both lines.

- [ ] **Step 2: Write the updated LICENSE**

Replace the entire file with:
```
MIT License

Copyright (c) 2024 Yishen Tu
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

The 2024 year for the Yishen Tu line is a best-effort estimate for the original Claudian release. If the actual original year can be confirmed from upstream `https://github.com/YishenTu/claudian` history before commit, replace with the confirmed year.

- [ ] **Step 3: Commit**

Run:
```bash
git -C D:/Projects/claudian add LICENSE
git -C D:/Projects/claudian commit -m "chore(license): add Luis Mendez copyright line for Specorator v1.0"
```

### Task 5: Create `CREDITS.md`

**Files:**
- Create: `D:/Projects/claudian/CREDITS.md`

- [ ] **Step 1: Write the file**

Create `D:/Projects/claudian/CREDITS.md`:
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

- [ ] **Step 2: Commit**

Run:
```bash
git -C D:/Projects/claudian add CREDITS.md
git -C D:/Projects/claudian commit -m "docs(credits): add CREDITS.md with implementation and product provenance"
```

## Phase 3 — Storage path rename

### Task 6: Rename storage path constants

**Files:**
- Modify: `D:/Projects/claudian/src/core/bootstrap/StoragePaths.ts`

- [ ] **Step 1: Read current file**

Current content:
```typescript
export const CLAUDIAN_STORAGE_PATH = '.claudian';

export const LEGACY_CLAUDIAN_SETTINGS_PATH = '.claude/claudian-settings.json';
export const CLAUDIAN_SETTINGS_PATH = `${CLAUDIAN_STORAGE_PATH}/claudian-settings.json`;

export const LEGACY_SESSIONS_PATH = '.claude/sessions';
export const SESSIONS_PATH = `${CLAUDIAN_STORAGE_PATH}/sessions`;
```

- [ ] **Step 2: Replace with Specorator constants**

Replace with:
```typescript
export const SPECORATOR_STORAGE_PATH = '.specorator';

export const SPECORATOR_SETTINGS_PATH = `${SPECORATOR_STORAGE_PATH}/specorator-settings.json`;

export const SESSIONS_PATH = `${SPECORATOR_STORAGE_PATH}/sessions`;
```

Note: per locked decision #3 (fresh start, no import), all `LEGACY_*` constants pointing at `.claude/` paths are dropped because v1.0 does not migrate data from older locations. If the legacy fallback is read elsewhere, treat those reads as dead code and remove them in Task 7.

- [ ] **Step 3: Update consumers — find all imports**

Run:
```bash
grep -rn "CLAUDIAN_STORAGE_PATH\|CLAUDIAN_SETTINGS_PATH\|LEGACY_CLAUDIAN_SETTINGS_PATH\|LEGACY_SESSIONS_PATH" D:/Projects/claudian/src D:/Projects/claudian/tests
```
For each match, rename:
- `CLAUDIAN_STORAGE_PATH` → `SPECORATOR_STORAGE_PATH`
- `CLAUDIAN_SETTINGS_PATH` → `SPECORATOR_SETTINGS_PATH`
- `LEGACY_CLAUDIAN_SETTINGS_PATH` → remove the reference and any fallback read path it gated
- `LEGACY_SESSIONS_PATH` → remove the reference and any fallback read path it gated

- [ ] **Step 4: Typecheck**

Run:
```bash
cd D:/Projects/claudian && npm run typecheck
```
Expected: 0 errors. If any errors mention legacy constants, finish removing fallback code in those files.

- [ ] **Step 5: Commit**

Run:
```bash
git -C D:/Projects/claudian add -A
git -C D:/Projects/claudian commit -m "refactor(storage): rename storage path constants to SPECORATOR_*"
```

### Task 7: Rename settings storage filename

**Files:**
- Modify: `D:/Projects/claudian/src/app/settings/ClaudianSettingsStorage.ts` (renamed in Task 14)
- Modify any source/test referencing the literal `claudian-settings.json`

- [ ] **Step 1: Find literal references**

Run:
```bash
grep -rn "claudian-settings" D:/Projects/claudian/src D:/Projects/claudian/tests D:/Projects/claudian/scripts
```

- [ ] **Step 2: Replace each `claudian-settings.json` with `specorator-settings.json`**

For each match in source and tests, change the literal string.

- [ ] **Step 3: Typecheck + run tests**

Run:
```bash
cd D:/Projects/claudian && npm run typecheck && npm run test
```
Expected: 0 typecheck errors; all tests pass. Tests that hard-code the old filename will fail and must be updated to expect `specorator-settings.json`.

- [ ] **Step 4: Commit**

Run:
```bash
git -C D:/Projects/claudian add -A
git -C D:/Projects/claudian commit -m "refactor(storage): rename settings filename to specorator-settings.json"
```

### Task 8: Add a regression test for the new storage path

**Files:**
- Create or modify: `D:/Projects/claudian/tests/unit/core/bootstrap/storagePaths.test.ts`

- [ ] **Step 1: Write failing test**

If the file does not exist, create it:
```typescript
import {
  SESSIONS_PATH,
  SPECORATOR_SETTINGS_PATH,
  SPECORATOR_STORAGE_PATH,
} from '../../../../src/core/bootstrap/StoragePaths';

describe('StoragePaths', () => {
  it('resolves the Specorator storage root', () => {
    expect(SPECORATOR_STORAGE_PATH).toBe('.specorator');
  });

  it('resolves the Specorator settings path', () => {
    expect(SPECORATOR_SETTINGS_PATH).toBe('.specorator/specorator-settings.json');
  });

  it('resolves the sessions path beneath the Specorator root', () => {
    expect(SESSIONS_PATH).toBe('.specorator/sessions');
  });
});
```

- [ ] **Step 2: Run the test**

Run:
```bash
cd D:/Projects/claudian && npm run test -- tests/unit/core/bootstrap/storagePaths.test.ts
```
Expected: PASS.

- [ ] **Step 3: Commit**

Run:
```bash
git -C D:/Projects/claudian add tests/unit/core/bootstrap/storagePaths.test.ts
git -C D:/Projects/claudian commit -m "test(storage): pin Specorator storage path constants"
```

## Phase 4 — View type rename

### Task 9: Rename view-type constants and string values

**Files:**
- Modify: `D:/Projects/claudian/src/core/types/chat.ts`
- Modify all consumers grep'd in Step 3.

- [ ] **Step 1: Read current declarations**

In `D:/Projects/claudian/src/core/types/chat.ts`:
```typescript
export const VIEW_TYPE_CLAUDIAN = 'claudian-view';
export const VIEW_TYPE_CLAUDIAN_AGENT_BOARD = 'claudian-agent-board-view';
```

- [ ] **Step 2: Replace with Specorator names + string values**

```typescript
export const VIEW_TYPE_SPECORATOR = 'specorator-view';
export const VIEW_TYPE_SPECORATOR_AGENT_BOARD = 'specorator-agent-board-view';
```

- [ ] **Step 3: Find all consumers**

Run:
```bash
grep -rn "VIEW_TYPE_CLAUDIAN\|VIEW_TYPE_CLAUDIAN_AGENT_BOARD\|'claudian-view'\|'claudian-agent-board-view'\|\"claudian-view\"\|\"claudian-agent-board-view\"" D:/Projects/claudian/src D:/Projects/claudian/tests
```

- [ ] **Step 4: Rename each occurrence**

For each match:
- Identifier `VIEW_TYPE_CLAUDIAN` → `VIEW_TYPE_SPECORATOR`
- Identifier `VIEW_TYPE_CLAUDIAN_AGENT_BOARD` → `VIEW_TYPE_SPECORATOR_AGENT_BOARD`
- String literal `'claudian-view'` → `'specorator-view'`
- String literal `'claudian-agent-board-view'` → `'specorator-agent-board-view'`
- CSS-selector string `[data-type="claudian-agent-board-view"]` (in `src/style/features/agent-board.css`) → `[data-type="specorator-agent-board-view"]`

- [ ] **Step 5: Typecheck + test**

Run:
```bash
cd D:/Projects/claudian && npm run typecheck && npm run test
```
Expected: 0 errors; all tests pass.

- [ ] **Step 6: Commit**

Run:
```bash
git -C D:/Projects/claudian add -A
git -C D:/Projects/claudian commit -m "refactor(views): rename VIEW_TYPE_CLAUDIAN* to VIEW_TYPE_SPECORATOR* and update view-type string values"
```

## Phase 5 — TypeScript symbol mass-rename

Each task in this phase performs one logical rename across the codebase. After every task, run `npm run typecheck` to catch references missed by find-replace.

### Task 10: Rename `ClaudianPlugin` class

**Files:**
- Modify: `D:/Projects/claudian/src/main.ts`
- Modify all consumers.

- [ ] **Step 1: Find references**

Run:
```bash
grep -rn "ClaudianPlugin\b" D:/Projects/claudian/src D:/Projects/claudian/tests
```

- [ ] **Step 2: Rename identifier**

In every match, change `ClaudianPlugin` to `SpecoratorPlugin`. This includes:
- The class declaration in `src/main.ts` (`export default class ClaudianPlugin extends Plugin`)
- Every import `import type { ClaudianPlugin }` or `import { ClaudianPlugin }` (typically none because it is a default export)
- Every type annotation `: ClaudianPlugin`
- Every parameter type `plugin: ClaudianPlugin`

- [ ] **Step 3: Typecheck**

Run:
```bash
cd D:/Projects/claudian && npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

Run:
```bash
git -C D:/Projects/claudian add -A
git -C D:/Projects/claudian commit -m "refactor(rename): ClaudianPlugin -> SpecoratorPlugin"
```

### Task 11: Rename `ClaudianSettings` type and related identifiers

**Files:**
- Modify: `D:/Projects/claudian/src/core/types/settings.ts`
- Modify: `D:/Projects/claudian/src/app/settings/defaultSettings.ts`
- Modify all consumers.

- [ ] **Step 1: Find references**

Run:
```bash
grep -rn "\bClaudianSettings\b\|DEFAULT_CLAUDIAN_SETTINGS\|defaultClaudianSettings" D:/Projects/claudian/src D:/Projects/claudian/tests
```

- [ ] **Step 2: Rename identifiers**

- Type `ClaudianSettings` → `SpecoratorSettings`
- Constant `DEFAULT_CLAUDIAN_SETTINGS` → `DEFAULT_SPECORATOR_SETTINGS`
- Constant `defaultClaudianSettings` (if present) → `defaultSpecoratorSettings`

Apply to every declaration, import, and reference.

- [ ] **Step 3: Typecheck**

Run:
```bash
cd D:/Projects/claudian && npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

Run:
```bash
git -C D:/Projects/claudian add -A
git -C D:/Projects/claudian commit -m "refactor(rename): ClaudianSettings -> SpecoratorSettings"
```

### Task 12: Rename `ClaudianSettingTab`, `ClaudianSettingsStorage`, and their host files

**Files:**
- Rename file: `D:/Projects/claudian/src/features/settings/ClaudianSettings.ts` → `D:/Projects/claudian/src/features/settings/SpecoratorSettings.ts`
- Rename file: `D:/Projects/claudian/src/app/settings/ClaudianSettingsStorage.ts` → `D:/Projects/claudian/src/app/settings/SpecoratorSettingsStorage.ts`
- Rename file: `D:/Projects/claudian/src/providers/claude/storage/ClaudianSettingsStorage.ts` → `D:/Projects/claudian/src/providers/claude/storage/SpecoratorSettingsStorage.ts`
- Modify all imports.

- [ ] **Step 1: Find references**

Run:
```bash
grep -rn "ClaudianSettingTab\|ClaudianSettingsStorage" D:/Projects/claudian/src D:/Projects/claudian/tests
```

- [ ] **Step 2: Rename file paths via git**

Run:
```bash
git -C D:/Projects/claudian mv src/features/settings/ClaudianSettings.ts src/features/settings/SpecoratorSettings.ts
git -C D:/Projects/claudian mv src/app/settings/ClaudianSettingsStorage.ts src/app/settings/SpecoratorSettingsStorage.ts
git -C D:/Projects/claudian mv src/providers/claude/storage/ClaudianSettingsStorage.ts src/providers/claude/storage/SpecoratorSettingsStorage.ts
```

- [ ] **Step 3: Rename identifiers inside renamed files and all importers**

- Class/interface name `ClaudianSettingTab` → `SpecoratorSettingTab`
- Class/interface name `ClaudianSettingsStorage` → `SpecoratorSettingsStorage`
- Every import path `'./ClaudianSettings'`, `'./ClaudianSettingsStorage'`, `'../settings/ClaudianSettings'`, etc. → corresponding `Specorator*` path.

- [ ] **Step 4: Typecheck**

Run:
```bash
cd D:/Projects/claudian && npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

Run:
```bash
git -C D:/Projects/claudian add -A
git -C D:/Projects/claudian commit -m "refactor(rename): ClaudianSettings*/ClaudianSettingsStorage -> Specorator*"
```

### Task 13: Rename `ClaudianEventMap` and `claudianEvents.ts`

**Files:**
- Rename file: `D:/Projects/claudian/src/app/events/claudianEvents.ts` → `D:/Projects/claudian/src/app/events/specoratorEvents.ts`
- Modify all imports.

- [ ] **Step 1: Find references**

Run:
```bash
grep -rn "ClaudianEventMap\|claudianEvents" D:/Projects/claudian/src D:/Projects/claudian/tests
```

- [ ] **Step 2: Rename file and identifier**

```bash
git -C D:/Projects/claudian mv src/app/events/claudianEvents.ts src/app/events/specoratorEvents.ts
```

In every match:
- Type/interface `ClaudianEventMap` → `SpecoratorEventMap`
- Import path `'./claudianEvents'`, `'../events/claudianEvents'`, etc. → corresponding `specoratorEvents` path.

- [ ] **Step 3: Typecheck**

Run:
```bash
cd D:/Projects/claudian && npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

Run:
```bash
git -C D:/Projects/claudian add -A
git -C D:/Projects/claudian commit -m "refactor(rename): ClaudianEventMap -> SpecoratorEventMap"
```

### Task 14: Rename `ClaudianView` class and its host file

**Files:**
- Rename file: `D:/Projects/claudian/src/features/chat/ClaudianView.ts` → `D:/Projects/claudian/src/features/chat/SpecoratorView.ts`
- Modify all imports.

- [ ] **Step 1: Find references**

Run:
```bash
grep -rn "\bClaudianView\b\|isClaudianView\|ClaudianView\.ts" D:/Projects/claudian/src D:/Projects/claudian/tests
```

- [ ] **Step 2: Rename file**

```bash
git -C D:/Projects/claudian mv src/features/chat/ClaudianView.ts src/features/chat/SpecoratorView.ts
```

- [ ] **Step 3: Rename identifiers**

- Class `ClaudianView` → `SpecoratorView`
- Function `isClaudianView` → `isSpecoratorView`
- Import paths `'./ClaudianView'`, `'../chat/ClaudianView'`, etc. → corresponding `SpecoratorView` path.

- [ ] **Step 4: Typecheck**

Run:
```bash
cd D:/Projects/claudian && npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

Run:
```bash
git -C D:/Projects/claudian add -A
git -C D:/Projects/claudian commit -m "refactor(rename): ClaudianView -> SpecoratorView"
```

### Task 15: Final symbol sweep — catch any remaining `Claudian*` identifiers

**Files:**
- Modify: any file with remaining `Claudian` identifier references.

- [ ] **Step 1: Find remaining matches**

Run:
```bash
grep -rn "\bClaudian\b\|\bclaudian\b" D:/Projects/claudian/src D:/Projects/claudian/tests --include="*.ts"
```

Allowed remaining matches:
- Comments and JSDoc that intentionally reference Claudian provenance (rare — should be lifted into `CREDITS.md` instead).
- Test fixtures that hard-code legacy data shapes only if explicitly justified.

- [ ] **Step 2: Apply renames**

For every code-level match (not a comment about provenance):
- Identifier `Claudian<rest>` → `Specorator<rest>`
- Identifier `claudian<rest>` → `specorator<rest>`
- File name `<prefix>claudian<rest>.ts` → `<prefix>specorator<rest>.ts` (use `git mv`)

Keep provider-namespaced names (`Claude*`, `Codex*`, `Opencode*`, `Cursor*`) untouched. Keep CSS classes for now (rename in Phase 7). Keep i18n locale strings for now (rename in Phase 6).

- [ ] **Step 3: Typecheck + lint + test**

Run:
```bash
cd D:/Projects/claudian && npm run typecheck && npm run lint && npm run test
```
Expected: 0 type errors; 0 lint warnings; all tests pass.

- [ ] **Step 4: Commit**

Run:
```bash
git -C D:/Projects/claudian add -A
git -C D:/Projects/claudian commit -m "refactor(rename): finish Claudian* -> Specorator* TypeScript sweep"
```

## Phase 6 — User-visible strings and locales

### Task 16: Update locale files (10 locales)

**Files:**
- Modify: `D:/Projects/claudian/src/i18n/locales/{en,de,es,fr,ja,ko,pt,ru,zh-CN,zh-TW}.json`

- [ ] **Step 1: Find Claudian mentions per locale**

For each locale file, run:
```bash
grep -n "Claudian\|claudian" D:/Projects/claudian/src/i18n/locales/en.json
```

- [ ] **Step 2: Replace product-name strings**

In every locale file, perform a literal substitution `"Claudian"` → `"Specorator"` for user-visible strings. Provider names inside other keys (`"Claude"`, `"Codex"`, `"Opencode"`, `"Cursor"`) remain unchanged.

Examples in `en.json` (lines 143, 159, 233, 375 per current grep):
- `"title": "Claudian Settings"` → `"title": "Specorator Settings"`
- `"name": "What should Claudian call you?"` → `"name": "What should Specorator call you?"`
- `"desc": "Hide specific commands and skills from the dropdown. Useful for hiding Claude Code entries that are not relevant to Claudian..."` → `"desc": "Hide specific commands and skills from the dropdown. Useful for hiding Claude Code entries that are not relevant to Specorator..."`
- `"name": "Open Claudian in"` → `"name": "Open Specorator in"`

Repeat the same substitution in every other locale file (`de.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`, `pt.json`, `ru.json`, `zh-CN.json`, `zh-TW.json`).

- [ ] **Step 3: Verify with test**

Run:
```bash
cd D:/Projects/claudian && npm run test
```
Expected: all tests pass. Any test that asserts on the old "Claudian Settings" string must be updated.

- [ ] **Step 4: Commit**

Run:
```bash
git -C D:/Projects/claudian add -A
git -C D:/Projects/claudian commit -m "i18n: rebrand user-visible Claudian strings to Specorator across 10 locales"
```

### Task 17: Update remaining hard-coded UI strings

**Files:**
- Modify any TypeScript file that contains a hard-coded user-visible `Claudian` string outside the i18n catalog.

- [ ] **Step 1: Find remaining hard-coded strings**

Run:
```bash
grep -rn "\"Claudian\\|'Claudian" D:/Projects/claudian/src --include="*.ts"
```

- [ ] **Step 2: Rename each match**

For every match that is a user-visible string (Notice text, modal title, ribbon tooltip, command palette name):
- Replace `Claudian` with `Specorator`.

Do not rewrite `Claudian` inside type imports, log messages that are developer-only diagnostics, or test snapshots that key off internal events.

- [ ] **Step 3: Typecheck + test**

Run:
```bash
cd D:/Projects/claudian && npm run typecheck && npm run test
```
Expected: 0 errors; all tests pass.

- [ ] **Step 4: Commit**

Run:
```bash
git -C D:/Projects/claudian add -A
git -C D:/Projects/claudian commit -m "ui: rebrand hard-coded Claudian strings to Specorator"
```

## Phase 7 — CSS class rename

### Task 18: Rename `claudian-*` CSS classes

**Files:**
- Modify: every `*.css` file under `D:/Projects/claudian/src/style/` containing a `claudian-` class.
- Modify: every `*.ts` file that creates DOM with `cls: 'claudian-...'` or `addClass('claudian-...')`.

- [ ] **Step 1: Find matches in style files**

Run:
```bash
grep -rn "\.claudian-\|\"claudian-\|'claudian-" D:/Projects/claudian/src/style
```

- [ ] **Step 2: Find matches in TypeScript DOM creation**

Run:
```bash
grep -rn "claudian-" D:/Projects/claudian/src --include="*.ts"
```

- [ ] **Step 3: Rename each `claudian-*` to `specorator-*`**

For every CSS class:
- `.claudian-agent-board` → `.specorator-agent-board`
- `.claudian-agent-board-lanes` → `.specorator-agent-board-lanes`
- ... apply to every `claudian-` prefixed class name in CSS and in TypeScript class strings.

- [ ] **Step 4: Build CSS**

Run:
```bash
cd D:/Projects/claudian && npm run build:css
```
Expected: success.

- [ ] **Step 5: Typecheck + test**

Run:
```bash
cd D:/Projects/claudian && npm run typecheck && npm run test
```
Expected: 0 errors; all tests pass.

- [ ] **Step 6: Commit**

Run:
```bash
git -C D:/Projects/claudian add -A
git -C D:/Projects/claudian commit -m "style: rename claudian-* CSS classes to specorator-*"
```

## Phase 8 — README, repo-level docs, release script

### Task 19: Replace README with Specorator narrative

**Files:**
- Modify: `D:/Projects/claudian/README.md`
- Reference source: `D:/Projects/claudian/docs/product/Specorator.md`

- [ ] **Step 1: Read the source narrative**

Read `D:/Projects/claudian/docs/product/Specorator.md`. It contains the product narrative drafted during the brainstorming phase.

- [ ] **Step 2: Write new README**

Overwrite `D:/Projects/claudian/README.md` with content derived from `docs/product/Specorator.md`. Apply these transformations:

1. Drop the YAML frontmatter block (`---` through `---` at the top of `docs/product/Specorator.md`).
2. Convert the tagline (`tagline: "Plan the work, run it, review what came back, keep the record. All in your vault."`) into a subtitle line under the `# Specorator` heading.
3. Replace every feature wikilink — `[[Chat]]`, `[[Multi Provider Support]]`, `[[Quick Actions]]`, `[[Orchestrator]]`, `[[Agent Kanban Board]]` (plain wikilinks, as they appear in `docs/product/Specorator.md`) — with a relative markdown link to the file under `docs/product/features/`, e.g. `[Chat](docs/product/features/Chat.md)`.
4. Add a new section after the intro:
   ```markdown
   ## Install

   Install via the [Beta Reviewers Auto-update Tool (BRAT)](https://github.com/TfTHacker/obsidian42-brat):

   1. Install BRAT from the Obsidian community-plugin directory.
   2. In BRAT, **Add Beta Plugin** → `Luis85/specorator`.
   3. Enable Specorator in Obsidian → Settings → Community plugins.

   Submission to the official Obsidian community-plugin registry is planned once v1.0.x stabilises.
   ```
5. Add a final "Origins" footer:
   ```markdown
   ## Origins

   Specorator combines two project lines: an evolved provider-native agent plugin that began as a fork of the original Claudian Obsidian plugin by Yishen Tu, and earlier Specorator work around spec-driven Obsidian workflows. See [CREDITS.md](CREDITS.md) for the full provenance and acknowledgements.
   ```

- [ ] **Step 3: Commit**

Run:
```bash
git -C D:/Projects/claudian add README.md
git -C D:/Projects/claudian commit -m "docs(readme): replace Claudian README with Specorator narrative"
```

### Task 20: Update `CLAUDE.md`, `AGENTS.md`, `CONTEXT.md`

**Files:**
- Modify: `D:/Projects/claudian/CLAUDE.md`
- Modify: `D:/Projects/claudian/AGENTS.md`
- Modify: `D:/Projects/claudian/CONTEXT.md`

- [ ] **Step 1: Find Claudian mentions**

Run:
```bash
grep -n "Claudian\|claudian" D:/Projects/claudian/CLAUDE.md D:/Projects/claudian/AGENTS.md D:/Projects/claudian/CONTEXT.md
```

- [ ] **Step 2: Update product references**

In each file:
- Replace product-name `Claudian` with `Specorator`.
- Replace storage path references `.claudian/` with `.specorator/` and `.claudian/sessions/*.meta.json` with `.specorator/sessions/*.meta.json`.
- Replace `.claudian/claudian-settings.json` with `.specorator/specorator-settings.json`.
- Keep provider-specific text (Claude Code, Codex, Opencode, Cursor) unchanged.

- [ ] **Step 3: Commit**

Run:
```bash
git -C D:/Projects/claudian add -A
git -C D:/Projects/claudian commit -m "docs: rebrand repo-level developer docs from Claudian to Specorator"
```

### Task 20b: Create the v1.0.0 release-notes file

**Files:**
- Create: `D:/Projects/claudian/docs/migration/v1.0.0-release-notes.md`

- [ ] **Step 1: Create the directory**

Run:
```bash
mkdir -p D:/Projects/claudian/docs/migration
```

- [ ] **Step 2: Write the release notes**

Create `D:/Projects/claudian/docs/migration/v1.0.0-release-notes.md`:
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

- [ ] **Step 3: Commit**

Run:
```bash
git -C D:/Projects/claudian add docs/migration/v1.0.0-release-notes.md
git -C D:/Projects/claudian commit -m "docs(release): add v1.0.0 release-notes content"
```

### Task 21: Update `scripts/release.mjs` to target the new repo

**Files:**
- Modify: `D:/Projects/claudian/scripts/release.mjs`

- [ ] **Step 1: Find target repo constant**

Open the file. Find:
```js
const RELEASE_REPO = 'Luis85/claudian';
```

- [ ] **Step 2: Replace with new repo**

Change to:
```js
const RELEASE_REPO = 'Luis85/specorator';
```

- [ ] **Step 3: Confirm asset list unchanged**

Verify `ASSETS = ['main.js', 'manifest.json', 'styles.css']` remains the same.

- [ ] **Step 4: Find any remaining `claudian` references in scripts**

Run:
```bash
grep -n "claudian" D:/Projects/claudian/scripts/release.mjs D:/Projects/claudian/scripts/run-jest.js
```
For each match that names the product (not the upstream provider directories like `.claude/`), replace `claudian` with `specorator`.

- [ ] **Step 5: Commit**

Run:
```bash
git -C D:/Projects/claudian add scripts/release.mjs scripts/run-jest.js
git -C D:/Projects/claudian commit -m "build(release): target Luis85/specorator from release script"
```

## Phase 9 — Verification and smoke test

### Task 22: Full local verification

**Files:**
- No file edits in this task.

- [ ] **Step 1: Run all checks**

Run:
```bash
cd D:/Projects/claudian && npm run typecheck && npm run lint && npm run test && npm run build
```
Expected: 0 typecheck errors; 0 lint warnings; all tests pass; build emits `main.js` and `styles.css`.

- [ ] **Step 2: Final Claudian sweep across the whole tree (excluding vendor, build, vault-internal paths)**

Run:
```bash
grep -rn "Claudian\|claudian" D:/Projects/claudian \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  --exclude-dir=.context \
  --exclude="main.js" \
  --exclude="styles.css" \
  --exclude="package-lock.json"
```

Allowed remaining matches:
- Provenance text in `LICENSE`, `CREDITS.md`, `README.md` (intentional acknowledgements).
- Vault-private notes under `docs/ideas/`, `docs/issues/`, `docs/research/`, `docs/superpowers/specs/`, `docs/superpowers/plans/` that discuss the migration itself (intentional history).
- The frozen-fork tag name `claudian-cursor-final` in commit messages (intentional history).

If anything else surfaces, fix it before moving on.

- [ ] **Step 3: Commit any final fixes**

If Step 2 surfaced fixes:
```bash
git -C D:/Projects/claudian add -A
git -C D:/Projects/claudian commit -m "chore(brand): finish residual Claudian references"
```

### Task 23: Smoke test in a clean vault

**Files:**
- No file edits in this task.
- Test vault: `D:/test-vaults/specorator-smoke/`

- [ ] **Step 1: Build the plugin**

Run:
```bash
cd D:/Projects/claudian && npm run build
```
Expected: success.

- [ ] **Step 2: Prepare a clean test vault**

Create a fresh Obsidian vault at `D:/test-vaults/specorator-smoke/` if not present. Open Obsidian against it and disable all other plugins.

- [ ] **Step 3: Sideload the built plugin**

Copy the build output into the vault's plugin directory:
```bash
mkdir -p D:/test-vaults/specorator-smoke/.obsidian/plugins/specorator
cp D:/Projects/claudian/main.js D:/test-vaults/specorator-smoke/.obsidian/plugins/specorator/
cp D:/Projects/claudian/manifest.json D:/test-vaults/specorator-smoke/.obsidian/plugins/specorator/
cp D:/Projects/claudian/styles.css D:/test-vaults/specorator-smoke/.obsidian/plugins/specorator/
```

- [ ] **Step 4: Boot Obsidian and enable Specorator**

In Obsidian → Settings → Community plugins, enable Specorator. Confirm:
- Plugin name in the plugin list reads `Specorator`.
- Author reads `Luis Mendez`.
- Version reads `1.0.0`.
- Ribbon icon and command palette entries say Specorator.
- No `Claudian` strings appear in any user-facing surface.

- [ ] **Step 5: Smoke test the chat sidepanel**

For each provider the developer has credentials/CLIs for (Claude is mandatory; Codex, Opencode, Cursor are exercised when available):
- Open the Specorator chat sidepanel.
- Send a simple message ("hello").
- Confirm streaming works.
- Attach an image; send a second message.
- Fork the conversation.
- Trigger an inline edit.

- [ ] **Step 6: Smoke test Agent Board**

- Open the Agent Board view.
- Create a work order.
- Run the work order through a chat tab.
- Confirm the work-order note receives a ledger entry and a handoff entry.

- [ ] **Step 7: Confirm storage layout**

Inspect the vault:
```bash
ls D:/test-vaults/specorator-smoke/.specorator/
ls D:/test-vaults/specorator-smoke/.claude/ 2>/dev/null || true
ls D:/test-vaults/specorator-smoke/.codex/ 2>/dev/null || true
```
Expected: `.specorator/` exists and contains `specorator-settings.json` plus `sessions/`. Provider folders (`.claude/`, `.codex/`, `.opencode/`, `.cursor/`) are created only if the matching provider runtime ran. No `.claudian/` folder anywhere.

- [ ] **Step 8: Capture screenshots**

Capture screenshots of:
- The chat sidepanel beside a note.
- The Agent Board view.
- The Settings → Specorator pane.

Save them under `D:/Projects/claudian/docs/assets/screenshots/v1.0/`. These will replace the placeholder screenshots in the README later.

- [ ] **Step 9: Commit any test-vault-derived doc updates (screenshots)**

If screenshots were captured:
```bash
git -C D:/Projects/claudian add docs/assets/screenshots/v1.0/
git -C D:/Projects/claudian commit -m "docs(assets): add Specorator v1.0 smoke-test screenshots"
```

## Phase 10 — Orphan-history push to `Luis85/specorator`

### Task 24: Build the orphan tree in a scratch directory

**Files:**
- New scratch directory: `D:/scratch/specorator-v1-orphan/`

- [ ] **Step 1: Decide the exclusion list**

The orphan tree includes everything under `D:/Projects/claudian/` except:
- `.git/`
- `node_modules/`
- `.context/`
- Build artefacts: `main.js`, `styles.css` — excluded from the source tree; they ship only as GitHub-release assets per Task 26 Step 3.
- Vault-only root paths: `Agent Board/`, `Wikipedia - Signs of AI writing - Wikipedia.md`, `test-output.log`, `Preview.png` (replaced by the new screenshots), `versions.json` (regenerated by release script)

The whole `docs/` tree ships per locked decision #14: every subdirectory under `docs/` (`Backlog.base`, `examples/`, `ideas/`, `issues/`, `product/`, `quick-actions/`, `research/`, `superpowers/`) migrates as-is.

- [ ] **Step 2: Create the scratch tree**

Run:
```bash
mkdir -p D:/scratch/specorator-v1-orphan
cd D:/scratch/specorator-v1-orphan
git init
```

- [ ] **Step 3: Copy files from the working tree**

Run (Windows PowerShell or Git Bash equivalent):
```bash
rsync -a \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='.context/' \
  --exclude='main.js' \
  --exclude='styles.css' \
  --exclude='Agent Board/' \
  --exclude='Wikipedia - Signs of AI writing - Wikipedia.md' \
  --exclude='test-output.log' \
  --exclude='Preview.png' \
  --exclude='versions.json' \
  D:/Projects/claudian/ D:/scratch/specorator-v1-orphan/
```
If `rsync` is not installed, use `robocopy` or a similar tool with equivalent excludes.

- [ ] **Step 4: Inspect the staged tree**

Run:
```bash
ls D:/scratch/specorator-v1-orphan
ls D:/scratch/specorator-v1-orphan/docs
ls D:/scratch/specorator-v1-orphan/src
```
Expected:
- `docs/` includes the subdirectories listed in Step 1.
- No `Agent Board/`, `.context/`, or `node_modules/`.
- `manifest.json`, `package.json`, `LICENSE`, `CREDITS.md`, `README.md` all present.

- [ ] **Step 5: Create the single orphan commit**

Run:
```bash
cd D:/scratch/specorator-v1-orphan
git add -A
git commit -m "chore: initial Specorator v1.0"
```
Expected: one commit on `main` (or whatever the initial branch is). Verify with `git log --oneline` — exactly one entry.

### Task 25: Force-push to `Luis85/specorator`

**Files:**
- No file edits in this task.

- [ ] **Step 1: Add remote**

Run:
```bash
cd D:/scratch/specorator-v1-orphan
git remote add origin git@github.com:Luis85/specorator.git
```

- [ ] **Step 2: Rename branch to `main` if needed**

Run:
```bash
git branch -M main
```

- [ ] **Step 3: Force-push**

Run:
```bash
git push --force origin main
```
Expected: remote `main` now points at the orphan commit.

This force-push is sanctioned by locked decision #4 in the migration spec. It permanently replaces the legacy Specorator codebase.

### Task 26: Tag v1.0.0 and create the GitHub release

**Files:**
- No file edits in this task.

- [ ] **Step 1: Tag**

Run:
```bash
cd D:/scratch/specorator-v1-orphan
git tag v1.0.0
git push origin v1.0.0
```

- [ ] **Step 2: Build release artefacts**

The release artefacts come from a clean build in this repo (the orphan tree does not contain build outputs). Run in the source repo, on the tagged commit:
```bash
cd D:/Projects/claudian
npm run build
```
Outputs: `main.js`, `styles.css`, and the existing `manifest.json`. Stage them for upload to the GitHub release as assets.

- [ ] **Step 3: Create the GitHub release**

Run:
```bash
gh release create v1.0.0 \
  --repo Luis85/specorator \
  --title "Specorator v1.0.0 — spec-driven agent workspace for Obsidian" \
  --notes-file D:/Projects/claudian/docs/migration/v1.0.0-release-notes.md \
  D:/Projects/claudian/main.js D:/Projects/claudian/manifest.json D:/Projects/claudian/styles.css
```

Expected: GitHub release published at `https://github.com/Luis85/specorator/releases/tag/v1.0.0` with the three release assets attached. The release-notes file referenced by `--notes-file` was created in Task 20b during Phase 8 and ships with the orphan commit.

### Task 27: Update repository metadata on GitHub

**Files:**
- No file edits in this task.

- [ ] **Step 1: Set description and topics**

Run:
```bash
gh repo edit Luis85/specorator \
  --description "Spec-driven agent workspace for Obsidian — plan in Markdown, run provider-native agents, review with evidence." \
  --homepage "https://github.com/Luis85/specorator#readme" \
  --add-topic obsidian-plugin \
  --add-topic agent \
  --add-topic spec-driven \
  --add-topic claude-code \
  --add-topic codex \
  --add-topic opencode \
  --add-topic cursor
```

- [ ] **Step 2: Confirm**

Run:
```bash
gh repo view Luis85/specorator
```
Expected: new description and topics appear.

## Phase 11 — Legacy handling

### Task 28: Close all legacy issues and PRs on Luis85/specorator

**Files:**
- No file edits in this task.

- [ ] **Step 1: Create the `legacy-v0` label**

Run:
```bash
gh label create legacy-v0 \
  --repo Luis85/specorator \
  --color "808080" \
  --description "Legacy v0 workflow-cockpit plugin — superseded by v1.0"
```

- [ ] **Step 2: List open issues and PRs**

Run:
```bash
gh issue list --repo Luis85/specorator --state open --limit 200 --json number,title
gh pr list --repo Luis85/specorator --state open --limit 200 --json number,title
```

- [ ] **Step 3: Prepare the close comment**

Save the close comment to a file for reuse:
```bash
cat > D:/scratch/legacy-v0-comment.md <<'EOF'
Closing as part of the Specorator v1.0 migration. This issue references the legacy v0 workflow-cockpit plugin, which has been superseded by a new provider-native implementation. See the v1.0 release notes and CREDITS.md for context. If the underlying need still applies to v1.0, please open a fresh issue against the new codebase.
EOF
```

- [ ] **Step 4: Close each issue with the templated comment and label**

For each issue number listed in Step 2:
```bash
gh issue comment <NUMBER> --repo Luis85/specorator --body-file D:/scratch/legacy-v0-comment.md
gh issue edit <NUMBER> --repo Luis85/specorator --add-label legacy-v0
gh issue close <NUMBER> --repo Luis85/specorator
```

For each PR number listed in Step 2:
```bash
gh pr comment <NUMBER> --repo Luis85/specorator --body-file D:/scratch/legacy-v0-comment.md
gh pr edit <NUMBER> --repo Luis85/specorator --add-label legacy-v0
gh pr close <NUMBER> --repo Luis85/specorator
```

(If there are many items, script the loop in bash or PowerShell.)

- [ ] **Step 5: Verify**

Run:
```bash
gh issue list --repo Luis85/specorator --state open
gh pr list --repo Luis85/specorator --state open
```
Expected: empty lists.

### Task 29: Freeze the `claudian-cursor` fork

**Files:**
- Modify: `D:/Projects/claudian/README.md` (in the `claudian-cursor` fork — only after the migration push is confirmed)

- [ ] **Step 1: Check out main on the fork**

Run:
```bash
git -C D:/Projects/claudian checkout main
```

- [ ] **Step 2: Add a freeze banner to the top of the fork's README**

Edit the fork's `README.md` and prepend:
```markdown
> **Frozen fork — superseded by [Specorator](https://github.com/Luis85/specorator).** This repository is no longer updated. New work, releases, and issue tracking happen in Specorator. Existing installations of `claudian-cursor` will continue to function but receive no further updates.

---
```

Note: this edit happens on the `claudian-cursor` fork's `main` branch, not on the `transition/specorator-v1` branch. The `transition/specorator-v1` branch is no longer relevant after the orphan push; it remains in the fork as a historical reference of how the migration was prepared.

- [ ] **Step 3: Commit and push**

Run:
```bash
git -C D:/Projects/claudian add README.md
git -C D:/Projects/claudian commit -m "docs(freeze): mark claudian-cursor fork as superseded by Specorator"
git -C D:/Projects/claudian push origin main
```

- [ ] **Step 4: Disable issues on the fork**

Run:
```bash
gh repo edit Luis85/claudian --enable-issues=false
```

Note: the fork repository is at `Luis85/claudian` per `scripts/release.mjs`. The plugin manifest id `claudian-cursor` is distinct from the repo name.

- [ ] **Step 5: Verify**

Run:
```bash
gh repo view Luis85/claudian
```
Expected: issues are disabled; the README banner is visible.

## Phase 12 — Day-0 communications

### Task 30: Create the pinned welcome issue on Luis85/specorator

**Files:**
- No file edits in this task.

- [ ] **Step 1: Prepare the issue body**

Save to `D:/scratch/specorator-welcome.md`:
```markdown
Welcome to Specorator v1.0.

Specorator turns Obsidian into a spec-driven agent workspace. Plan work in Markdown, run it through provider-native agents (Claude Code, Codex, Opencode, Cursor), review what came back, and keep the durable trail in your vault.

If you are reading this from the legacy Specorator v0 workflow-cockpit plugin or from the `claudian-cursor` fork, the v1.0 release is a new implementation foundation. Please read:

- The [migration spec](https://github.com/Luis85/specorator/blob/main/docs/superpowers/specs/2026-05-30-specorator-standalone-migration-design.md) for the full transition context.
- [CREDITS.md](https://github.com/Luis85/specorator/blob/main/CREDITS.md) for the source lineage and acknowledgements.

Install via BRAT at `Luis85/specorator`. Submission to the official Obsidian community-plugin registry is planned once v1.0.x stabilises.

Questions and bug reports for v1.0 are welcome as new issues against this repository.
```

- [ ] **Step 2: Create and pin the issue**

Run:
```bash
gh issue create \
  --repo Luis85/specorator \
  --title "Welcome to Specorator v1.0 — migration notes" \
  --body-file D:/scratch/specorator-welcome.md
```

Capture the issue number from the command output, then pin it:
```bash
gh issue pin <NUMBER> --repo Luis85/specorator
```

- [ ] **Step 3: Verify**

Run:
```bash
gh issue list --repo Luis85/specorator
```
Expected: the welcome issue appears at the top, marked as pinned.

## Acceptance criteria

The migration is complete when all of these are true:

- `Luis85/specorator` main is at the orphan commit `chore: initial Specorator v1.0`.
- `v1.0.0` is tagged. The corresponding GitHub release exists with `main.js`, `manifest.json`, and `styles.css` as assets.
- BRAT installation from `Luis85/specorator` boots in a clean test vault and produces `.specorator/` storage (not `.claudian/`).
- `grep -rn "Claudian\|claudian"` across the source tree (excluding `node_modules`, build outputs, vault-private docs, and intentional provenance text) returns no matches.
- `LICENSE` carries both copyright lines.
- `CREDITS.md` exists at the repository root and matches the spec content.
- `README.md` reflects the Specorator narrative with installation guidance.
- All legacy issues and PRs on `Luis85/specorator` are closed with the templated comment and the `legacy-v0` label.
- The `claudian-cursor` fork has a freeze banner and disabled issues.
- A pinned welcome issue exists on `Luis85/specorator`.
- `npm run typecheck && npm run lint && npm run test && npm run build` are clean in the orphan tree (re-validated from a fresh clone).
