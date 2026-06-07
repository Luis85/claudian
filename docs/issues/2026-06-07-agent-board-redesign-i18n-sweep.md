---
type: issue
id: issue-20260607-agent-board-redesign-i18n-sweep
title: Agent Board redesign — i18n sweep across 10 locales
status: open
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-07
related:
  - "[[2026-06-07-agent-board-redesign-plan]]"
  - "[[docs/design/agent-board/README]]"
tags:
  - agent-board
  - i18n
  - cross-cutting
  - redesign
relations:
  - agent-board
---

#### Parent

[[2026-06-07-agent-board-redesign-plan]]

#### What to build

Sweep every new user-visible string introduced by slices 1–12 of the redesign into all 10 locale bundles. The rule throughout the per-slice work is that strings get keyed as they are introduced; this slice is the closing audit to confirm no string slipped through as a literal.

Coverage list (non-exhaustive — verify against the per-slice diffs):

- **Auto-run**: button label, tooltip ("Automatically starts work orders once they reach Ready. Runs in the background."), halt caption template ("Queue halted: …").
- **Modal header**: "✎ Click title to rename" hint; live-state caption template ("Started Nm ago"); finished-state caption.
- **Modal sidebar**: "Properties" header; property labels (Status, Agent, Provider, Model, Priority, Created, Updated, Attempts, Conversation).
- **Section labels**: OBJECTIVE, ACCEPTANCE CRITERIA, AGENT HANDOFF, RUN LEDGER, TRANSCRIPT TAIL.
- **Handoff sub-sections**: Summary, Verification, Risks, Next action.
- **Needs-handoff salvage callout**: explanatory copy + "Transcript tail" toggle label.
- **Footer buttons**: Open note, Open conversation, Mark ready, Run, Stop, Rework, Accept, Send to review, Mark failed, Reopen, Archive, Retry, Back to inbox, Run now — any not already keyed must land in this sweep.
- **Card live strip**: attempt counter template ("Nm Ys · attempt N"), freshness aria-labels ("Fresh heartbeat (… ago)", "Stale heartbeat (… ago)", "Very stale heartbeat (… ago)") — keys preserved.
- **Right-info caption**: "N/M active", "Work-order tabs N/M · K free".

Rule: every user-visible string resolves through the existing i18n helper. No literal English strings introduced by the redesign in `src/features/tasks/ui/` or anywhere else the redesign touches.

#### Acceptance criteria

- [ ] Every new string introduced by slices 1–12 keyed via the i18n helper.
- [ ] All 10 locale files include entries for every new key (English is authoritative; other locales fall through with English copy if no translation is available, but the key MUST be present).
- [ ] Forbidden-string check: an automated grep (documented in the PR — e.g. a ripgrep pattern listing common English UI verbs against the slice-1–12 diff scope) finds zero untranslated string literals in `src/features/tasks/ui/` and any other touched paths. A manual diff audit alone is NOT sufficient — the check must be reproducible by future contributors.
- [ ] `npm run lint && npm run test && npm run build` green.

#### Blocked by

[[2026-06-07-modal-frame-sticky-shell]], [[2026-06-07-modal-header-title-meta]], [[2026-06-07-modal-properties-sidebar]], [[2026-06-07-modal-objective-acceptance]], [[2026-06-07-modal-activity-block]], [[2026-06-07-modal-footer-actions]], [[2026-06-07-board-toolbar-auto-run]], [[2026-06-07-board-lanes-refresh]], [[2026-06-07-board-card-body]], [[2026-06-07-board-card-actions-menu]], [[2026-06-07-board-card-live-strip]], [[2026-06-07-agents-persona-seam]]
