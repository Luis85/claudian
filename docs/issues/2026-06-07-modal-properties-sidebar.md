---
type: issue
id: issue-20260607-modal-properties-sidebar
title: Work-order modal — properties sidebar with editable value chips
status: done
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-07
related:
  - "[[2026-06-07-agent-board-redesign-plan]]"
  - "[[docs/design/agent-board/README]]"
tags:
  - agent-board
  - modal
  - sidebar
  - redesign
relations:
  - agent-board
---

#### Parent

[[2026-06-07-agent-board-redesign-plan]]

#### What to build

Build the right-pane Properties sidebar (`border-left 1px solid --border-color; background --background-secondary; padding 18px 20px`). Header reads "Properties" (`--font-ui-smaller`, `--font-semibold`, `--text-faint`, uppercase).

Property rows (`display:flex; justify-content:space-between; min-height 32px; padding 4px 6px; --radius-m`). Label left = icon (`--text-faint`) + text (`--font-ui-small`, `--text-muted`). Value right = `--font-ui-small`, `--text-normal`, right-aligned.

Rows in order:
1. **Status** (icon `circle-dot`) → status pill.
2. **Agent** (icon `user`) → placeholder slot, will render avatar + name in [[2026-06-07-agents-persona-seam]]. For this slice, render the row but leave the value blank (or show a dash) — the row must exist so the persona slice can fill it.
3. **Provider** (icon `cpu`) → editable dropdown in editable states, monospace text otherwise.
4. **Model** (icon `sparkles`) → editable dropdown (options depend on provider) in editable states, text otherwise.
5. **Priority** (icon `signal`) → editable dropdown in editable states, priority bars (3 ascending bars filled per level) + label otherwise.
6. *divider* (`1px --border-color`, margin `10px 6px`).
7. **Created** (icon `calendar`), **Updated** (icon `clock`), **Attempts** (icon `repeat`) → muted, tabular-nums.
8. **Conversation** (icon `message-square`, only when `conversation_id` set and `canOpenConversation?` returns truthy) → monospace accent link → `onOpenConversation`.

**Editable value chip** (replaces the current full-width `new Setting(...).addDropdown(...)` rows): borderless; on hover bg `--background-modifier-hover`; shows value + a `chevron-down`; a transparent native `<select>` overlays it for the actual picker. Wire each change to the existing `onSaveFields(task, {...})`. Provider change resets model to provider default (preserve existing logic). Read-only states (e.g. `running`) drop the chip overlay and render plain text / priority bars.

Icons via `setIcon(el, name)`.

#### Acceptance criteria

- [x] Sidebar lays out in the right pane with the spec rows in the spec order.
- [x] Provider / Model / Priority editable via value chip in editable states; persisted through `onSaveFields`.
- [x] Provider change resets model to provider default (existing logic preserved).
- [x] Read-only states render plain text / priority bars without the chip overlay.
- [x] Agent row exists as a placeholder slot (no avatar rendered yet — owned by the persona slice).
- [x] Conversation row hidden when `conversation_id` absent or `canOpenConversation?` returns false; click invokes `onOpenConversation`.
- [x] Created / Updated / Attempts render with `tabular-nums`.
- [x] Each row icon uses `setIcon`; no hardcoded hex.
- [x] All new user-visible strings introduced by this slice keyed through the i18n helper (no literal English strings).

#### Blocked by

[[2026-06-07-modal-frame-sticky-shell]]
