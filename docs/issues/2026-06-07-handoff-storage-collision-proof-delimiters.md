---
type: issue
id: issue-20260607-handoff-storage-collision-proof-delimiters
title: Harden handoff storage format against heading collisions
status: open
priority: 3 - low
triage: backlog
created: 2026-06-07
related:
  - "[[2026-06-07-modal-activity-block]]"
  - "[[2026-06-07-agent-board-redesign-plan]]"
tags:
  - agent-board
  - handoff
  - storage
  - robustness
relations:
  - agent-board
---

#### Context

Surfaced during Codex review of [[2026-06-07-modal-activity-block]] (PR #53). The
work-order modal's Activity block parses the note's handoff region into its four
fields via `parseHandoffSections` (`src/features/tasks/model/handoffSections.ts`).

The handoff region is written by `renderHandoffMarkdown`
(`src/features/tasks/execution/TaskHandoffParser.ts`) as **raw field markdown under
`## Headings`** in a fixed order:

```
## Summary
<summary>

## Verification
<verification>

## Risks
<risks>

## Next Action
<nextAction>
```

Because each field body is raw markdown with no escaping or unique delimiter, a
field body that itself contains a line matching a section heading is
indistinguishable from the real delimiter. The display-slice parser mitigates the
common cases by matching **only the next expected heading in sequence** (so an
in-body `## Risks` inside the Summary stays as Summary content), but it cannot
disambiguate a body that contains the exact **next-expected** heading — e.g. a
Summary body literally containing a line `## Verification` before the real
Verification section. In that contrived case the text is mis-attributed to the
wrong collapsible card (no content is dropped, but the sectioning is wrong).

This is an inherent limitation of the stored format, not of the display parser.

#### Decision (2026-06-07)

Accepted as a known limitation for the Agent Board redesign display work; the
best-effort sequential parser ships in slice 4. This issue tracks the optional
follow-up hardening.

#### Proposed approaches (pick one when scheduled)

1. **Collision-proof delimiters** — emit machine-readable region markers around
   each field (e.g. `<!-- claudian:handoff:verification -->` … fence), parse on
   those instead of `## Headings`. Downside: the note's handoff region becomes
   less human-readable; needs back-compat parsing for existing notes.
2. **Escape body headings on write** — `renderHandoffMarkdown` escapes/indents any
   body line that would collide with a section heading; parser reverses it.
3. **Length-prefixed / fenced field encoding** — store each field in a fenced
   block whose info string names the field.

Any approach must round-trip existing notes (the handoff region is durable
state) and keep the region readable enough for users browsing the note.

#### Acceptance criteria

- [ ] A handoff whose field body contains a line matching any section heading
      round-trips and renders losslessly in the modal Activity block (correct
      sectioning).
- [ ] Existing notes written by the current `renderHandoffMarkdown` still parse.
- [ ] `npm run typecheck && npm run lint && npm run test && npm run build` green.

#### Blocked by

None — independent follow-up.
