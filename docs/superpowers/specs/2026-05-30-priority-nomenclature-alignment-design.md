---
status: approved
---
# Priority Nomenclature Alignment — Design

**Date:** 2026-05-30

## Overview

Unify priority labels across docs Backlog and tasks code. Both will use a 4-level scheme with numeric prefix: `0 - urgent`, `1 - high`, `2 - normal`, `3 - low`. Storage format matches display format (no hidden mapping). Canonical representation everywhere.

## Current State

**Docs (Backlog.base):** 3 levels — `1 - high`, `2 - normal`, `3 - low` (idea notes already tagged with these).

**Tasks code:** 4 levels — `urgent`, `high`, `normal`, `low` (plain lowercase, no prefix). Stored in frontmatter as `priority: high` etc. Type union in `taskTypes.ts`. Sort via explicit rank map in `selectNextReadyTask.ts`.

**Mismatch:** Docs has 3 levels and prefixes; tasks has 4 levels without prefix. No alignment on nomenclature or storage schema.

## Design

### Canonical Scheme

| Stored Value | Rank | Usage |
|---|---|---|
| `0 - urgent` | 0 (highest) | Critical work; escalation |
| `1 - high` | 1 | Core features, bugs |
| `2 - normal` | 2 | Regular tasks (default) |
| `3 - low` | 3 (lowest) | Documentation, polish |

**Storage:** YAML frontmatter `priority: 0 - urgent` (string, no hidden enum).

**Display:** Dropdowns and board cards render raw stored value (no label map).

**Default:** `2 - normal`.

### Files Changed

#### Type & Storage
- **`src/features/tasks/model/taskTypes.ts`**
  - `TaskPriority = '0 - urgent' | '1 - high' | '2 - normal' | '3 - low'`

- **`src/features/tasks/templates/TemplateNoteStore.ts`**
  - `VALID_PRIORITIES` set: new 4-element set with prefixed strings

- **`src/features/tasks/templates/templateResolution.ts`**
  - `resolvePriority()` fallback: `'2 - normal'`

- **`src/features/tasks/commands/taskCommands.ts`**
  - Default priority arg: `'2 - normal'` (instead of `'normal'`)

#### Sort Logic
- **`src/features/tasks/execution/selectNextReadyTask.ts`**
  - Drop explicit `PRIORITY_RANK` map
  - Sort rank derived from parsing prefix: `const rank = parseInt(priority, 10)`
  - Unknown values (legacy `high`) return `NaN` → sorted last

#### UI
- **`src/features/tasks/ui/WorkOrderDetailModal.ts`**
  - `PRIORITY_OPTIONS` array: `['0 - urgent', '1 - high', '2 - normal', '3 - low']`
  - Dropdown shows raw value (no capitalization layer)

- **`src/features/tasks/ui/WorkOrderTemplateEditorModal.ts`**
  - `PRIORITY_OPTIONS` array: updated to new scheme with `{ value, label: value }` (no separate capitalized label)

- **`src/features/tasks/ui/AgentBoardRenderer.ts`**
  - Already renders raw priority — no change needed

#### Presets
- **`src/features/tasks/templates/presetTemplates.ts`**
  - Bug fix: `priority: '1 - high'`
  - Feature/refactor/research/test: `priority: '2 - normal'`
  - Documentation: `priority: '3 - low'`

#### Docs
- **`docs/Backlog.base`**
  - Ideas view: add `note.priority: 144` columnSize (already sorted by priority)
  - Issues view: ensure columnSize for priority aligns with Ideas
  - No structural changes

### Tests

Replace all `priority` values in test fixtures and assertions:
- `tests/unit/features/tasks/templates/templateResolution.test.ts`
- `tests/unit/features/tasks/templates/TemplateNoteStore.test.ts`
- `tests/unit/features/tasks/storage/TaskNoteStore.test.ts`
- `tests/unit/features/tasks/commands/taskCommands.test.ts`
- Any other fixtures with frontmatter `priority: high` etc.

Update `selectNextReadyTask.test.ts` to verify sort via prefix parsing.

### Migration

**No automated migration.** Existing work-order notes with old format (`priority: high`) remain on disk. Type union becomes strict, so:
- Old notes fail strict type check when loaded
- Dropdown won't render a matching option (falls through to blank)
- User sees empty priority field and is prompted to set a new value

User must manually edit any critical work-order notes. This is acceptable because work-order volume is typically small (~10-50 active notes in a vault).

### Out of Scope

- i18n for priority labels (no translation strings exist today)
- Color coding on board cards by priority
- Urgency-based auto-escalation or notification
- Obsidian metadata index optimization (no indexed priority field)

## Success Criteria

1. ✅ Type union reflects new 4-level scheme with numeric prefix
2. ✅ Frontmatter stores and displays `0 - urgent` ... `3 - low`
3. ✅ Dropdowns render prefixed labels without capitalization layer
4. ✅ Sort uses parsed prefix, no rank map
5. ✅ Docs Backlog Ideas column aligns with Issues
6. ✅ All tests pass with new nomenclature
7. ✅ Preset templates use new priority values
8. ✅ Manual notes can be migrated by user edit (no script)

## Implementation Order

1. Update type union and frontmatter schema
2. Update sort logic (remove rank map, add parsing)
3. Update dropdowns and presets
4. Update docs Backlog.base
5. Update all test fixtures and assertions
6. Run full test suite
7. Manual smoke test on Agent Board + create work-order
