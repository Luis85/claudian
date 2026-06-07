---
type: issue
id: issue-20260607-modal-footer-actions
title: Work-order modal — sticky footer per-status action sets
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
  - footer
  - redesign
relations:
  - agent-board
---

#### Parent

[[2026-06-07-agent-board-redesign-plan]]

#### What to build

Build the sticky footer (`display:flex; justify-content:space-between; padding 12px 26px; border-top 1px solid --border-color; background --background-secondary`). Secondary (ghost) buttons left, primary right. Buttons use `--font-ui-small`, `--font-medium`, padding `7px 14px`, `--radius-m`, with a leading Lucide icon (`setIcon`).

Variants:
- **CTA** — bg `--interactive-accent`, text `--text-on-accent`.
- **Ghost** — transparent, hover `--background-modifier-hover`.
- **Danger** — bg `--background-modifier-error`, border `color-mix(in srgb, var(--color-red) 40%, transparent)`, text `--color-red`, hover solid red.

Action sets by status (icons in parentheses):

| Status | Left (ghost) | Right |
|---|---|---|
| `inbox` | Open note (`file-text`) | **Mark ready** CTA (`check`) |
| `running` | Open note, Open conversation (`message-square`) | **Stop** danger (`square`) |
| `review` | Open note, Open conversation | Rework ghost (`rotate-ccw`), **Accept** CTA (`check`) |
| `needs_handoff` | Open note, Open conversation | Mark failed danger (`triangle`), **Send to review** CTA (`check`) |
| `done` | Open note, Archive (`archive`) | Reopen ghost (`rotate-ccw`) |
| `failed` | Open note | Archive ghost (`archive`) |

Wire to the existing callbacks: `onMarkReady / onStop / onAccept / onRework / onSendToReview / onMarkFailed / onReopen / onArchive / onOpenNote / onOpenConversation`. Preserve the existing close-on-click behavior. Preserve `running` read-only behavior — no editable fields, only the Stop action.

Replace the current `new Setting(this.contentEl)` action row with the new footer DOM.

Hide conversation actions when `canOpenConversation?` returns false or `conversation_id` is absent.

#### Acceptance criteria

- [x] Each status renders the exact action set above (label + icon + variant).
- [x] Footer stays visible while the body scrolls.
- [x] All existing callbacks fire on click; modal closes per current behavior.
- [x] `running` footer reflects read-only restrictions (Stop danger only on the right; Open note + Open conversation left).
- [x] Conversation actions hidden when `conversation_id` absent or `canOpenConversation?` returns false.
- [x] Buttons keyboard-focusable; Esc still closes the modal.
- [x] No `rgba(...)` literals — alpha shades go through `color-mix(in srgb, var(--color-X) N%, transparent)`.
- [x] All new user-visible strings introduced by this slice keyed through the i18n helper (no literal English strings).

#### Blocked by

[[2026-06-07-modal-frame-sticky-shell]]
