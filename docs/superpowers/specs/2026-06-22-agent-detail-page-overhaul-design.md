---
title: "Agent Detail Page Overhaul"
date: 2026-06-22
status: draft
scope: agents
related:
  - "[[docs/superpowers/specs/2026-06-17-ai-agents-roster-design]]"
  - "[[docs/tech-debt/2026-06-19-agent-roster-tools-skills-followups]]"
---

# Agent Detail Page Overhaul

## Problem

The Agent Roster detail editor (`AgentRosterView.renderDetail`) is one long
scrolling form — Identity → Appearance → Model → Instructions → Skills → Tools →
Roles — built from stacked Obsidian `Setting` rows, with the Skills and Tools
selectors rendered as **flat checkbox lists**. As a vault accumulates skills and
user tools, those two lists grow unbounded and dominate the page: there is no
search, no sense of how many are selected, and no way to collapse them. The
identity/model fields read as a generic settings form rather than an agent
profile, and the Save button sits only at the very bottom of the page while
**Back silently discards** unsaved edits.

## Goals

- Make the page scale gracefully as skill/tool catalogs grow.
- Make editing the three components — agent identity/model, skills, tools —
  cleaner and better looking.
- Remove the silent-discard footgun and keep Save reachable.

## Non-goals (YAGNI)

- Drag-reorder of skills/tools.
- Grouping skills by provider into collapsible groups (search covers discovery).
- Select-all / bulk operations.
- Autosave (an explicit Save with a dirty indicator was chosen instead).
- Restructuring into tabs or a two-pane layout (single page was chosen).

## Decisions (from brainstorming)

1. **Single page, redesigned** — keep one scrolling page; restyle into cards and
   replace the flat pickers, rather than moving to tabs or two-pane.
2. **Collapsible chips + searchable list** picker model.
3. **Sticky footer + unsaved guard** for save behavior.

## Design

### Layout

The detail page remains a single scrolling view (rendered into the
`ItemView` `contentEl`) but is reorganized into styled **cards** with a pinned
footer:

1. **Header card** — a large live avatar, a prominent **Name** field, a one-line
   **Description** field, **Worker/Verifier** rendered as toggle *chips*, and
   **Appearance** (color dropdown + 2-char initials) as a compact inline row
   beside the avatar. The avatar updates live as name/color/initials change
   (existing `refreshAvatar` behavior).
2. **Model card** — Provider + Model dropdowns laid out two-up, stacking on
   narrow widths. Existing populate/clear-on-provider-change logic is preserved.
3. **Instructions card** — a taller, labeled, monospace, vertically resizable
   textarea.
4. **Skills picker** — a `CapabilityPicker` (below).
5. **Tools picker** — a `CapabilityPicker`.
6. **Sticky footer** — Save (primary) · Start chat · Delete, pinned to the
   bottom of the view so Save is always reachable, plus an "Unsaved changes"
   indicator shown only when the draft differs from the saved agent.

Obsidian `Setting`-based controls (dropdowns, toggles, text inputs) are **reused
inside the cards**; the visual lift comes from card grouping, the header, the
pickers, and the footer — not from rebuilding every input.

### Component extraction: `AgentDetailEditor`

The detail editor moves out of `AgentRosterView.ts` into a new
`src/features/agents/roster/view/AgentDetailEditor.ts`. `AgentRosterView` keeps
the list/dashboard and navigation; `AgentDetailEditor` owns the detail page.

```ts
interface AgentDetailEditorCallbacks {
  onBack(): void;            // return to the list
  onSaved(agent: RosterAgent): void;
  onDeleted(agent: RosterAgent): void;
  onStartChat(agent: RosterAgent): void;
}

class AgentDetailEditor {
  constructor(plugin: ClaudianPlugin, callbacks: AgentDetailEditorCallbacks);
  async render(root: HTMLElement, agent: RosterAgent): Promise<void>;
}
```

The editor owns the draft copy, dirty tracking, the cards, and the footer. The
existing action methods (`saveDraft`, `deleteAgent`, `startChatWithAgent`,
provider resolution) move with it or are invoked through the callbacks. This
keeps both files focused and within the LOC cap (`AgentRosterView.ts` is
currently ~430 lines against a 500 ceiling).

### Component: `CapabilityPicker`

One reusable component, used for both Skills and Tools, in
`src/features/agents/roster/view/CapabilityPicker.ts`.

```ts
interface CapabilityItem {
  id: string;            // selection key (skill name / tool capability id)
  name: string;          // display label
  description?: string;  // secondary line
  badge?: string;        // small right-aligned tag (skills: provider)
}

interface CapabilityPickerOptions {
  label: string;
  items: CapabilityItem[];
  selectedIds: string[];          // initial selection
  emptyHint: string;              // shown when the catalog is empty
  searchPlaceholder: string;
  onChange(selectedIds: string[]): void;
}

function renderCapabilityPicker(parent: HTMLElement, options: CapabilityPickerOptions): void;
```

Behavior:

- **Header row:** `label`, a muted `N selected` count, and an expand/collapse
  caret. The whole row toggles expansion; it is keyboard-operable
  (`role="button"`, `tabindex=0`, Enter/Space) with a visible focus ring.
- **Collapsed (default):** removable chips for the selected items (`name ×`).
  Clicking `×` deselects. No chips when nothing is selected.
- **Expanded:** a search input plus a scrollable, max-height checklist. Each row
  is a checkbox + name + optional description + optional badge. **Selected items
  sort first**; within each group, catalog order is preserved. The search filters
  case-insensitively on name + description.
- **Empty catalog:** render `emptyHint` instead of the list (the existing
  "No user tools yet…" / "No skills discovered yet." strings).
- Every selection change (checkbox toggle or chip removal) re-renders the chips +
  count and calls `onChange` with the new id list.

Data mapping:

- **Skills:** `vaultSkillAggregator.listAll()` → `{ id: name, name, description,
  badge: providerDisplayName }`. `selectedIds` = `draft.skills` (skill names).
- **Tools:** `toolRegistry.list()` (loaded, error-free) →
  `{ id: toolCapabilityId(manifest.name), name: manifest.name,
  description: manifest.description }`. `selectedIds` = `draft.tools`.

### Save safety & dirty tracking

- The editor snapshots the original agent on open and compares the draft to it
  (a structural equality over the editable fields, in a small testable helper —
  e.g. `isRosterAgentDirty(original, draft)`).
- The footer "Unsaved changes" indicator appears only while dirty; Save persists
  and clears it.
- **Back** (and the in-view back affordance) confirms via the shared
  `confirm()` modal when dirty; clean navigation goes straight back.

### Styling

New CSS in `src/style/features/agent-roster.css`:

- Card container (`--background-secondary`, border, `--radius-m`, padding) and a
  card section label.
- Header card layout (avatar + fields), role toggle chips, appearance row.
- `CapabilityPicker`: header row, selected chips, search input, scroll list,
  list-row (checkbox/name/description/badge), badge.
- Sticky footer + dirty indicator dot.
- Focus-visible ring for the picker header (added to `accessibility.css`).

Responsive: the two-up model row and the header collapse to stacked on narrow
sidebars.

### i18n

New keys (added to all 10 locales + the `agents` type union):

- `agentRoster.searchSkills`, `agentRoster.searchTools` — search placeholders.
- `agentRoster.selectedCount` — `"{count} selected"`.
- `agentRoster.unsavedChanges` — footer indicator.
- `agentRoster.discardConfirm` — "Discard unsaved changes?" for the Back guard.

Existing keys are reused where possible (`agentRoster.skills`, `.tools`,
`.noToolsHint`, `.noSkillsHint`, `.save`, `.startChat`, `.delete`, `.back`,
section headings).

## Testing

- **`CapabilityPicker`** (jsdom unit tests): selected count, chip rendering,
  expand/collapse toggle, search filtering, checkbox select/deselect →
  `onChange` payload, selected-first ordering, chip-removal deselect, empty-hint
  path.
- **`isRosterAgentDirty`** (unit): equal vs each editable field changed.
- `AgentRosterView` / `AgentDetailEditor` remain manually-verified UI, excluded
  from coverage collection (consistent with the other library views), so no
  global-coverage regression.

## Quality gates

- LOC: extraction keeps both view files under the 500 cap.
- Duplication: the picker is a single helper used twice, so Skills/Tools share
  one implementation (no new clone group); the dirty/back-guard wiring is shared.
- Coverage: the new `src/features/agents/roster/view/CapabilityPicker.ts` and the
  dirty helper are tested; views stay excluded.

## Rollout

Single PR change set on the existing branch (`claude/ai-agents-plugin-research-ljdmgg`,
PR #117). No data/storage changes — `RosterAgent` shape and the
`.claudian/agents/*.json` store are untouched; this is purely a view-layer
overhaul.
