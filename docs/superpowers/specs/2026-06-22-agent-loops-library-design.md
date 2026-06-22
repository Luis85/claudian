---
title: Agent Loops Library for Work Orders
date: 2026-06-22
status: draft
scope: features/tasks
---

# Agent Loops Library for Work Orders

## Summary

Add an **agent-loops** library to the Agent Board, inspired by
[Forward-Future/loop-library](https://github.com/Forward-Future/loop-library).
A *loop* is a reusable, structured playbook — *Use when / Approach / Steps /
Verify / Notes* — that the user can attach to a work order or a work-order
template. When an attached work order runs, the loop's guidance is **injected
into the rendered task prompt**; it does not change run control flow. The run
executes exactly as it does today.

The library ships with curated **preset loops** (bundled in code, installable
into a vault folder) and also surfaces any user-authored loop notes in that
folder — mirroring the existing work-order **template** subsystem.

## Goals

- A loop is a Markdown note with a typed frontmatter and structured body
  sections, parsed by a dedicated store.
- Curated preset loops install into a settings-configured vault folder, plus
  user-authored loop notes in the same folder are discovered.
- A work order or template can attach **exactly one optional** loop by slug.
- At run time, the attached loop's *Approach / Steps / Verify / Notes* are
  injected into the task prompt as a clearly-marked `## Loop: <name>` block.
- Four UI surfaces: a loop chip on work orders, a loop selector in the template
  editor, a loop picker modal, a loop editor modal, plus a settings install
  control.

## Non-Goals (v1)

- **Iterative control flow.** Loops do not re-run the agent or gate on a
  `Verify` condition. (Explicitly deferred; the data model leaves room to layer
  this on later.)
- **Online-catalog sync** from `signals.forwardfuture.ai`.
- **Multiple loops** per work order / template.
- **"Related loops"** as runtime composition (it remains a discovery hint
  authored in the note body, not a wired feature).

## Design

### Mirroring the template subsystem

The implementation is structurally parallel to `src/features/tasks/templates/`.
That subsystem is the proven pattern for "bundled presets installable into a
configured vault folder, plus user-authored notes," and loops reuse it wholesale
while staying a distinct concept (different schema, different injection
semantics). A new `src/features/tasks/loops/` directory owns the loop slice.

### 1. Loop definition & schema

A loop is a Markdown note:

```yaml
---
type: claudian-loop
schema_version: 1
name: "Reproduce → fix → verify"
description: "Tight bug-fix loop with a verify gate."
icon: bug
---
## Use when

Use this when a defect is reproducible and you need a disciplined fix.

## Approach

Reproduce first, isolate the root cause, fix narrowly, then prove it.

## Steps

1. Reproduce the defect with a failing check.
2. Isolate the root cause; state it in one sentence.
3. Apply the smallest fix.
4. Verify.

## Verify

The failing check now passes and no unrelated tests regress.

## Notes

Do not refactor adjacent code in the same loop.
```

Parsed shape:

```ts
export interface LoopDefinition {
  path: string;
  id: string;          // slug derived from filename
  name: string;
  description?: string;
  icon?: string;
  useWhen: string;     // picker-only; NOT injected at run time
  approach: string;
  steps: string;
  verify: string;
  notes: string;
}
```

Body sections are parsed by heading (`## Use when`, `## Approach`, `## Steps`,
`## Verify`, `## Notes`). Missing optional sections parse to empty strings; the
parser is tolerant (a loop with only `## Approach` is valid).

### 2. Storage

`loops/LoopNoteStore.ts` (parallel to `TemplateNoteStore`):

- `parse(path, content): LoopDefinition` — requires `type: claudian-loop` and
  `schema_version: 1`; throws on mismatch.
- `list(vault, folder): { loops: LoopDefinition[]; warnings: string[] }` —
  scans the folder, collects per-file parse warnings, sorts by name.
- `build(input: SaveLoopInput): string` — serializes frontmatter + section
  bodies back to Markdown.
- `getFilePathForName(folder, name)`, `save(...)`, `delete(app, path)` — same
  contract as `TemplateNoteStore`.

Folder comes from a new setting `agentBoardLoopFolder` (default
`Agent Board/loops`), defined in `app/` defaults alongside the existing
`agentBoardTemplateFolder`.

`loops/LoopCatalog.ts` (or a small resolver module) exposes:

- `listLoops(): Promise<LoopDefinition[]>` for pickers.
- `resolveLoop(slug): Promise<LoopDefinition | null>` for run-time injection;
  a dangling/unknown slug resolves to `null` (graceful no-op — the run proceeds
  with no loop block).

### 3. Preset loops

- `loops/presetLoops.ts` — a curated `SaveLoopInput[]` (e.g. a bug-fix loop, a
  refactor-with-characterization loop, a research/spike loop, a
  test-backfill loop) authored to the schema above.
- `loops/installPresetLoops.ts` — `installPresetLoops(plugin)` and
  `installPresetLoopsWithNotice(plugin)`, mirroring `installPresetTemplates`:
  create the folder if missing, skip loops already present by path, report
  installed/skipped counts as a `Notice`.

### 4. Attachment (frontmatter)

- `TaskFrontmatter` gains optional `loop?: string` (loop slug).
- `WorkOrderTemplate` gains optional `loop?: string`; `SaveTemplateInput`
  likewise.
- `TaskNoteStore` parses `loop` from work-order frontmatter;
  `TemplateNoteStore.parse/build` round-trips `loop` on templates.
- `commands/taskCommands.ts` `workOrderFrontmatter(...)` emits the `loop:` line
  when set; `resolveRunTarget` / the template→work-order path carries
  `template.loop` onto the created work order's frontmatter.

The `loop` field is **optional and absent by default**; existing work orders and
templates without it are unaffected.

### 5. Run-time injection

`prompt/TaskPromptRenderer.ts`:

```ts
export function renderTaskPrompt(
  task: TaskSpec,
  lane?: TaskPromptLaneCriteria,
  loop?: LoopDefinition,
): string
```

When `loop` is present, the renderer appends a block after `## Constraints`
(and after any DoR/DoD/rework/prior-attempts sections), before the
`## Required Structured Handoff` section:

```
## Loop: <name>
You are following a predefined loop. Apply its approach, work the steps, and
satisfy its verify condition before handing off.

### Approach
<approach>

### Steps
<steps>

### Verify
<verify>

### Notes
<notes>
```

Empty sub-sections are omitted. **`useWhen` is never injected** (it is selection
guidance for the picker). All injected loop strings pass through the existing
`escapeClaudianMarkers` helper, identical to how user-supplied work-order
sections are sanitized against protocol-marker injection.

`renderTaskPrompt` stays a pure function. Loop resolution (slug → note read)
happens in `AgentBoardView`'s existing `renderPrompt` dep closure (the same
closure that supplies `lane`), which calls `LoopCatalog.resolveLoop(task.loop)`
and threads the result into `renderTaskPrompt`. `TaskRunCoordinator` is
unchanged beyond receiving the already-bound closure it gets today.

### 6. UI surfaces

All four selected surfaces, each mirroring its template-subsystem analogue:

- **Loop chip — `ui/workOrderPropertiesPanel.ts`.** A new editable property row
  ("Loop") rendered next to agent/provider/model. It shows the attached loop's
  name (or "—"), is editable in the same statuses as the other chips, opens the
  `LoopPickerModal`, and persists via `callbacks.onSaveFields(task, { loop })`.
  Clearing selects "none" (`loop: undefined`). The detail-modal callback
  contract (`onSaveFields`) already supports arbitrary frontmatter field writes;
  `loop` is added to its accepted field set.
- **Template editor — `ui/WorkOrderTemplateEditorModal.ts`.** A loop selector
  field (dropdown of available loops + "none") that writes `loop` into the saved
  template.
- **`ui/LoopPickerModal.ts`** (mirrors `WorkOrderTemplatePickerModal`) — lists
  loops with icon/name/description and the `Use when` text; includes a "No loop"
  option; returns the chosen slug (or null/clear).
- **`ui/LoopEditorModal.ts`** (mirrors `WorkOrderTemplateEditorModal`) —
  create/edit a loop note: name, description, icon, and the five body sections.
- **Settings — Agent Board tab.** A loop-folder setting and an "Install common
  loops" button calling `installPresetLoopsWithNotice`, mirroring the existing
  template install control.

### 7. i18n

New keys for: the Loop property label, picker/editor titles and fields, the "No
loop" option, the install button + its installed/skipped/empty notices, and the
settings folder label. English carries real strings; the other nine locales
follow the existing fallback convention.

## Data Flow

```
Author/Install loop note (.md in agentBoardLoopFolder)
        │  LoopNoteStore.parse
        ▼
LoopCatalog.listLoops ──► LoopPickerModal / Template editor selector
        │
        ▼  user attaches → onSaveFields({ loop }) / template.loop
Work-order frontmatter: loop: <slug>
        │
        ▼  run start: AgentBoardView.renderPrompt closure
LoopCatalog.resolveLoop(slug) ─► LoopDefinition | null
        │
        ▼
renderTaskPrompt(task, lane, loop) ─► "## Loop: <name>" block in prompt
```

## Error Handling

- **Unknown/dangling slug** → `resolveLoop` returns `null`; the run proceeds with
  no loop block (no error surfaced to the run; a warning may be logged).
- **Malformed loop note** → excluded from `list` with a collected warning
  (parity with `TemplateNoteStore.list`); never crashes the picker.
- **Missing loop folder** → install/list create or treat as empty, never throw.
- **Protocol-marker injection** in loop content → neutralized by
  `escapeClaudianMarkers` before it reaches the prompt.

## Testing (TDD)

Specs under the mirrored `tests/unit/features/tasks/loops/` and
`tests/unit/features/tasks/prompt/` paths:

- `LoopNoteStore`: parse valid note; reject wrong `type`/`schema_version`;
  build→parse round-trip; tolerate missing optional sections; `list` collects
  warnings for malformed files.
- `LoopCatalog`: `resolveLoop` returns the definition for a known slug and
  `null` for an unknown slug.
- `TaskPromptRenderer`: loop present → block rendered with Approach/Steps/
  Verify/Notes and **without** Use-when; loop absent → output unchanged from
  today; protocol markers in loop content are escaped; empty sub-sections
  omitted.
- Frontmatter flow: `template.loop` propagates onto a work order created from
  that template; work-order `loop` round-trips through `TaskNoteStore`.

## Affected / New Files

New (`src/features/tasks/loops/`): `loopTypes.ts`, `LoopNoteStore.ts`,
`presetLoops.ts`, `installPresetLoops.ts`, `LoopCatalog.ts`.
New UI (`src/features/tasks/ui/`): `LoopPickerModal.ts`, `LoopEditorModal.ts`.

Modified: `model/taskTypes.ts` (+`loop?`), `templates/templateTypes.ts` &
`templates/TemplateNoteStore.ts` (+`loop?`), `commands/taskCommands.ts`
(emit `loop`), `prompt/TaskPromptRenderer.ts` (loop param + block),
`ui/workOrderPropertiesPanel.ts` (loop chip), `ui/WorkOrderTemplateEditorModal.ts`
(loop selector), `ui/AgentBoardView.ts` (resolve + thread loop into the
`renderPrompt` closure), `storage/TaskNoteStore.ts` (parse `loop`), Agent Board
settings tab (folder + install button), `app/` defaults
(+`agentBoardLoopFolder`), and i18n locale files.
