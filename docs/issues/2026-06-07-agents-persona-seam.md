---
type: issue
id: issue-20260607-agents-persona-seam
title: Agents persona seam — data model + Standard built-in + avatar + assignee row
status: done
priority: 1 - high
triage: ready-for-agent
created: 2026-06-07
related:
  - "[[2026-06-07-agent-board-redesign-plan]]"
  - "[[docs/design/agent-board/README]]"
tags:
  - agent-board
  - agents
  - persona
  - data-model
  - redesign
relations:
  - agent-board
---

#### Parent

[[2026-06-07-agent-board-redesign-plan]]

#### What to build

Introduce the **Agents** persona seam — the assignee concept for work orders. This slice ships the data model, the Standard built-in persona, the avatar component, and the assignee display on both the card and the modal Properties row. Future custom-persona creation is out of scope (a future Agents feature owns that surface); the picker will list only Standard until that lands, but the wiring must be in place now.

**Data model** — new `src/features/agents/agentTypes.ts`:

```ts
interface AgentPersona {
  id: string;        // 'standard' is reserved/built-in
  name: string;      // e.g. 'Refactorer'
  color: string;     // an Obsidian color var, e.g. 'var(--color-purple)'
  initials?: string; // e.g. 'RF' (custom personas)
  builtin?: boolean; // true only for 'standard'
}
```

**Standard built-in**: `id: 'standard'`, neutral color (`--color-base-90`), no initials — rendered with the `cpu` (bot) icon at ~58% of the avatar size. `builtin: true`.

**Persona registry**: expose `listPersonas()` and `resolvePersona(id?: string)`. Absent or unknown id resolves to Standard. Wired so future Agents feature can add personas without changing read sites.

**Work-order frontmatter**: add `agent?: string` (an agent id) to `TaskFrontmatter` in `taskTypes.ts`. Read/write through the existing frontmatter pipeline; unknown ids must round-trip without being dropped (a future Agents feature may restore the persona by id even if it's unknown today).

**Avatar component**: circular chip, `border-radius 50%`, `display:inline-grid; place-items:center`, `font-weight 600`. Background = persona color at ~16–20% alpha; text/icon = full color; faint same-color border. Sizes: **20px** on cards, **18px** in the modal Properties value. Standard avatar uses `setIcon(el, 'cpu')` sized to ~58% of the avatar; custom personas show `initials`. `title` = persona name.

**Card placement**: render the avatar in the assignee slot reserved by [[2026-06-07-board-card-body]] (far right of the card footer). Tooltip via `title`.

**Modal Properties row**: fill the Agent row reserved by [[2026-06-07-modal-properties-sidebar]]:
- Non-editable states (`running`, `review`, `done`, `needs_handoff`, `failed`, `canceled`): avatar + persona name as plain text.
- Editable states (`inbox`, `ready`, `needs_fix`): dropdown picker (avatar in the value chip). Selection persists via `onSaveFields(task, { agent })`.

**Persistence pipe** — three interfaces extend together so the `agent` field actually reaches the note's frontmatter:
- `WorkOrderFieldUpdate` (in `src/features/tasks/ui/WorkOrderDetailModal.ts`) → add `agent?: string`.
- `WriteFieldsOptions` (in `src/features/tasks/storage/TaskNoteStore.ts`) → add `agent?: string` so the writer accepts it.
- `TaskFrontmatter` (in `src/features/tasks/model/taskTypes.ts`) → add `agent?: string` as described above.

Round-trip a frontmatter that has an unknown `agent` id; the writer must not drop it.

#### Acceptance criteria

- [x] `AgentPersona` type and Standard built-in shipped under `src/features/agents/`.
- [x] `resolvePersona(undefined)` and `resolvePersona('unknown-id')` both return Standard.
- [x] `TaskFrontmatter.agent` round-trips through read/write without dropping unknown ids.
- [x] Avatar component renders Standard with the `cpu` icon at ~58% of the avatar size; custom personas would render initials (no custom personas exist yet — type-level only).
- [x] Card footer renders the avatar in the reserved assignee slot; tooltip equals the persona name.
- [x] Modal Agent property row renders avatar + name in non-editable states, dropdown in editable states; selection persists via `onSaveFields`.
- [x] `WorkOrderFieldUpdate` (modal), `WriteFieldsOptions` (note store), and `TaskFrontmatter` (model) all extended with `agent?: string` — the persistence pipe is complete end to end.
- [x] Avatar sizes (20px card / 18px modal) respected; no hardcoded hex.
- [x] Unit tests cover `resolvePersona` resolution + frontmatter round-trip (including an unknown id surviving the round-trip).
- [x] All new user-visible strings introduced by this slice keyed through the i18n helper (no literal English strings).

#### Blocked by

[[2026-06-07-modal-properties-sidebar]] and [[2026-06-07-board-card-body]]
