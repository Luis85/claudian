---
status: shipped
parent: "[[Agent Kanban Board]]"
---
# Work-Order Templates Design

Date: 2026-05-29
Source idea: [[Work-Order Templates]]
Builds on: [[2026-05-29-agent-board-configurable-lanes-design]]

## Summary

Let users pick from a set of pre-defined templates when creating an Agent Board work order, so common task types are faster to prepare. Templates are Markdown notes in a dedicated vault folder. Each template supplies the human-authored body sections plus optional defaults for provider, model, and priority. A fuzzy picker at create time chooses the template (or a built-in "Blank" that reproduces today's skeleton). Template bodies support a small strict placeholder set. The orchestrator continues to own the generated Run Ledger and Result / Handoff regions.

## Goals

- Define work-order templates as Markdown notes under a configurable folder (default `Agent Board/templates`).
- Let a template prefill the work-order body and set defaults for provider, model, and priority.
- Support a small strict placeholder set in template bodies: `{{title}}`, `{{date}}`, `{{source}}`.
- Offer a fuzzy template picker from the board "Add work order" button and the capture commands, including a built-in "Blank" entry equal to today's skeleton.
- Keep the engine in control of generated regions: always append a valid Run Ledger and Result / Handoff to created work orders.
- Fall back cleanly: zero templates uses Blank silently; invalid template defaults or unknown placeholders surface a visible error.
- Preserve current behavior when no template is chosen (non-regression for the Blank path).

## Non-goals

- No template-controlled initial status or target lane (status stays caller-driven: `inbox` from the board, `ready` from commands).
- No rich/Templater-style expressions (conditionals, JS, date math) — only the three fixed placeholders.
- No coupling to the Obsidian core Templates or Templater plugins.
- No template variables beyond the fixed set; unknown placeholders are an error, not a pass-through.
- No editing of templates through a structured settings editor — templates are authored as plain notes.
- No changes to the run prompt renderer, state machine, lane config, or live-run behavior.

## Decisions

| Question | Decision |
|----------|----------|
| Template store | Markdown notes in a dedicated vault folder |
| Folder | New setting `agentBoardTemplateFolder`, default `Agent Board/templates` |
| Prefill scope | Body sections + frontmatter defaults: provider, model, priority |
| Initial status/lane | Not template-controlled (stays caller-driven) |
| Placeholders | Strict fixed set: `{{title}}`, `{{date}}`, `{{source}}`; unknown → error |
| Picker UX | Fuzzy suggester modal with a built-in "Blank" entry |
| Zero templates | Skip picker, create from Blank silently |
| Generated regions | Engine always appends Run Ledger + Result / Handoff; templates never include them |
| Scaffolding command | Include "Create work-order template" command that writes an example note |

## Template note format

Templates live in `agentBoardTemplateFolder` (default `Agent Board/templates`), separate from the work-order folder (default `Agent Board/tasks`). This keeps them out of the board index: `TaskIndexer.indexVaultFolder` scans only the work-order folder, and `TaskNoteStore.parse` rejects any note whose `type` is not `claudian-work-order`. The distinct type below makes a template inert as a work order even if a stray copy lands in the tasks folder.

```yaml
---
type: claudian-work-order-template
schema_version: 1
name: Bug fix          # picker label; falls back to the filename when absent
description: ...       # optional; shown as the picker detail line
provider: claude       # optional default
model: ...             # optional default
priority: high         # optional default (low|normal|high|urgent)
---
# {{title}}

## Objective
Fix the bug described below.

## Acceptance Criteria
- [ ] Repro confirmed
- [ ] Fix covered by a test

## Context
{{source}}

## Constraints
- Do not modify unrelated files.
```

The author writes only the human-authored sections. The engine appends `## Run Ledger` and `## Result / Handoff` with their Claudian markers when it creates the work order, so every created note has a valid run path and the orchestrator keeps ownership of generated regions (safety invariant: orchestrator owns generated log regions).

Canonical sections (`Objective`, `Acceptance Criteria`, `Context`, `Constraints`) are recommended because the run prompt renderer reads them by H2 heading. A template that omits one is allowed; the corresponding prompt section is just empty. The "Blank" built-in always includes all four.

## Placeholders

Allowed set, substituted at create time:

| Placeholder | Value |
|-------------|-------|
| `{{title}}` | Work-order title (source basename, folder name, or `New work order`) |
| `{{date}}` | Creation date, `YYYY-MM-DD` |
| `{{source}}` | Wiki-link to the source note (`[[path]]`), or `` `folder/path` `` for a folder source, or empty string when there is no source |

Rendering is strict: any `{{token}}` not in the allowed set aborts creation with a Notice that names the offending token. `{{source}}` mirrors the existing `contextBody` logic in `buildWorkOrderMarkdown`.

## Architecture

New folder `src/features/tasks/templates/`.

### `templateTypes.ts`

```ts
export interface WorkOrderTemplate {
  path: string;
  name: string;
  description?: string;
  provider?: string;
  model?: string;
  priority?: TaskPriority;
  body: string; // human sections, placeholders unresolved
}
```

### `TemplateNoteStore.ts`

Reuses `parseFrontmatter` from `src/utils/frontmatter`.

```ts
parse(path: string, content: string): WorkOrderTemplate
list(vault: Vault, folder: string): Promise<{ templates: WorkOrderTemplate[]; warnings: string[] }>
```

- `parse` requires `type === 'claudian-work-order-template'` and `schema_version === 1`; throws otherwise. `name` falls back to the filename. Reads optional `description`, `provider`, `model`, `priority`; keeps the raw body.
- `list` scans the template folder, parses each note, collects valid templates, and records a warning per skipped/invalid note. Never throws on a single bad note.

### `renderTemplate.ts` (pure)

```ts
interface TemplateVars { title: string; date: string; source: string; }
renderWorkOrderBody(template: WorkOrderTemplate, vars: TemplateVars): { body: string; errors: string[] }
```

- Validates every `{{...}}` token against the allowed set; unknown tokens go into `errors`.
- On no errors, substitutes and returns the resolved body. On errors, returns them for the caller to surface and abort.

### `createWorkOrder` refactor (`commands/taskCommands.ts`)

- `CreateWorkOrderOptions` gains `template?: WorkOrderTemplate`.
- Template path: resolve provider/model/priority from the template when set and valid (provider enabled, model known), else the settings defaults. Render the body via `renderWorkOrderBody`; on render errors, Notice and abort. Append the generated Run Ledger and Result / Handoff regions. Build frontmatter exactly as today for the generated fields (`id`, `created`, `updated`, run fields).
- No template: current `buildWorkOrderMarkdown` Blank path, unchanged.
- Provider/model precedence: template value → settings default → existing Notice guard when neither is available.
- `buildWorkOrderMarkdown` stays as the Blank built-in and the engine's region-appending helper is shared between Blank and template paths.

### Picker (`ui/WorkOrderTemplateSuggest.ts`)

`WorkOrderTemplateSuggest extends FuzzySuggestModal<TemplateChoice>` where `TemplateChoice = { kind: 'blank' } | { kind: 'template'; template: WorkOrderTemplate }`. The board "Add work order" button and the capture commands (current note / folder) open the picker first, then call `createWorkOrder(plugin, source, { template, status, reveal })`. When the template list is empty, the picker is skipped and Blank is used directly. Choice-to-options mapping lives in a small pure helper so it is unit-testable without driving the modal.

### Settings + scaffolding

- Add `agentBoardTemplateFolder?: string` to `ClaudianSettings` with default `Agent Board/templates` in `defaultSettings.ts`.
- `AgentBoardSettingsSection` gains a template-folder text input. If it equals the work-order folder, show an inline warning (templates would render as invalid notes on the board).
- New command "Create work-order template" scaffolds an example template note in the template folder (with the format above) and opens it.

## Edge cases

| Case | Behavior |
|------|----------|
| Template note with wrong `type`/`schema_version` | Skipped by `list`, recorded as a warning |
| Unknown placeholder in body | Abort create; Notice names the token |
| Template provider/model invalid or disabled | Fall back to settings default; Notice |
| Template omits a canonical section | Allowed; prompt section is empty; engine still appends ledger/handoff |
| Template folder equals work-order folder | Settings shows a warning |
| Zero templates available | Picker skipped; Blank used silently |

## File structure

New:
- `src/features/tasks/templates/templateTypes.ts`
- `src/features/tasks/templates/TemplateNoteStore.ts`
- `src/features/tasks/templates/renderTemplate.ts`
- `src/features/tasks/ui/WorkOrderTemplateSuggest.ts`

Modify:
- `src/features/tasks/commands/taskCommands.ts` — `template` option, precedence, shared region append, scaffold command.
- `src/features/tasks/ui/AgentBoardView.ts` — "Add work order" opens the picker, then creates.
- `src/core/types/settings.ts` — add `agentBoardTemplateFolder`.
- `src/app/settings/defaultSettings.ts` — default template folder.
- `src/features/settings/ui/AgentBoardSettingsSection.ts` — template-folder input + equal-folder warning.

## Testing plan

TDD, mirrored under `tests/unit/features/tasks/templates/` and existing task test paths.

### `TemplateNoteStore` (unit)
- Valid template parses: name, description, provider/model/priority, body.
- Missing `name` falls back to the filename.
- Wrong `type` or `schema_version` throws in `parse` and is skipped (with a warning) in `list`.
- `list` returns valid templates and a warning per bad note; never throws on a single bad note.

### `renderTemplate` (unit)
- Substitutes `{{title}}`, `{{date}}`, `{{source}}`.
- No-source case yields an empty `{{source}}`.
- Unknown placeholder returns an error and no substituted body.

### `createWorkOrder` (unit)
- Template path uses the template's provider/model/priority.
- Absent template defaults fall back to settings defaults.
- Invalid/disabled template provider falls back to settings default.
- Created note always contains valid Run Ledger and Handoff regions.
- Blank path (no template) is byte-for-byte unchanged (non-regression).
- Render error aborts creation (no file written).

### Picker mapping (unit)
- Choice list always includes Blank plus every template, in folder order.

### Non-regression
- `TaskIndexer` does not index the template folder; templates never appear as tasks or invalid notes on the board.

## Manual verification

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Smoke test:

1. Run "Create work-order template"; confirm an example template note opens under `Agent Board/templates`.
2. Click "Add work order" on the board; confirm the picker lists Blank plus the new template.
3. Pick the template; confirm the new work order uses the template body and its provider/model/priority, with valid Run Ledger and Handoff regions.
4. Confirm `{{title}}`, `{{date}}`, `{{source}}` are resolved in the created note.
5. Add an unknown `{{token}}` to a template and try to create; confirm a Notice names the token and no note is created.
6. Remove all templates; click "Add work order"; confirm it creates a Blank work order with no picker.
7. Confirm the board does not show template notes as cards or invalid notes.
8. Set the template folder equal to the tasks folder in settings; confirm the warning appears.

## Acceptance criteria

- Templates are authored as Markdown notes under a configurable folder and never appear on the board as work orders.
- A template can prefill the work-order body and set defaults for provider, model, and priority.
- `{{title}}`, `{{date}}`, and `{{source}}` resolve correctly; unknown placeholders abort creation with a visible error.
- The "Add work order" button and capture commands open a picker listing Blank plus all templates; zero templates uses Blank silently.
- Created work orders always contain valid Run Ledger and Result / Handoff regions, regardless of template content.
- Template provider/model that is invalid or disabled falls back to the settings default with a notice.
- The Blank (no-template) path is unchanged from current behavior.

## Risks

- Picker wiring touches the board "Add work order" path and the capture commands; the existing provider/model guard and `reveal`/`status` options must keep working.
- Strict placeholder validation must not reject legitimate content; only `{{...}}` tokens are validated, leaving other braces untouched.
- Region-append must guarantee markers so `appendLedger`/`writeHandoff` never throw on a templated note.
- Template folder defaulting must not collide with the work-order folder; the equal-folder warning mitigates accidental misconfiguration.
- Modal code is hard to unit test; keeping the choice-mapping logic pure preserves coverage.
