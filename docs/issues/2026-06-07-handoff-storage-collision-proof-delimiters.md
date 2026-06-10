---
type: issue
id: issue-20260607-handoff-storage-collision-proof-delimiters
title: Harden handoff storage format against heading collisions
status: done
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

- [x] A handoff whose field body contains a line matching any section heading
      round-trips and renders losslessly in the modal Activity block (correct
      sectioning).
- [x] Existing notes written by the current `renderHandoffMarkdown` still parse.
- [ ] `npm run typecheck && npm run lint && npm run test && npm run build` green.
      (Targeted verification only at resolution time — full-repo gates deferred
      to the merging branch because concurrent work was in flight; see
      Resolution.)

#### Blocked by

None — independent follow-up.

## Resolution (2026-06-09)

Implemented approach **1 — collision-proof delimiters**, shaped to keep the
region human-readable: `renderHandoffMarkdown` (moved from
`execution/TaskHandoffParser.ts` into `model/handoffSections.ts` so the writer
and reader share one contract) still emits the four `## Headings`, but wraps
each field body in HTML-comment markers:

```
## Summary
<!-- claudian:handoff:summary:start -->
<summary, verbatim>
<!-- claudian:handoff:summary:end -->
…
```

The markers are invisible in Obsidian reading view, so the note region reads
exactly as before, while `parseHandoffSections` keys on the markers — a body
containing the literal next-expected heading (e.g. `## Verification` inside the
Summary) now round-trips with correct sectioning.

**Backward compatibility (read old, write new):** `parseHandoffSections`
detects the field markers; when absent it falls through to the unchanged
legacy sequential-heading parser, so existing notes written by the old
`renderHandoffMarkdown` still parse. New handoffs are always written in the
marker format. A field whose markers are missing parses as empty (existing
fallback renders the raw markdown so nothing is dropped); a hand-mangled end
marker salvages the body up to the next field marker.

**Guard interplay:** `TaskNoteStore.writeHandoff` scrubs exactly the sanctioned
field markers (`HANDOFF_FIELD_MARKER_STRINGS`) before its embedded-marker
assertion, so structural markers pass while any other `<!-- claudian:` content
is still rejected. To keep bodies from spoofing markers, `parseTaskHandoff` now
rejects a handoff whose field contains `<!-- claudian:` (run takes the graceful
`needs_handoff` path instead of a hard note-write failure).

**Tests (TDD — collision regression written first, red on old code):**

- `tests/unit/features/tasks/execution/TaskHandoffParser.test.ts`: round-trip
  regression for a summary containing a literal `## Verification` line; exact
  new-format markdown; rejection of marker-bearing fields.
- `tests/unit/features/tasks/model/handoffSections.test.ts`: marker-format
  round-trips (including a body containing every section heading), readable
  headings retained, missing-marker and mangled-end-marker degradation; all
  legacy-format tests kept unchanged as the back-compat suite.
- `tests/unit/features/tasks/storage/TaskNoteStore.test.ts`: `writeHandoff`
  accepts structural field markers, still rejects foreign claudian markers.

Verified with `npx jest tests/unit/features/tasks tests/integration/features/tasks`
(59 suites / 789 tests green) plus the chat `WorkOrderProtocolDisplay` suite and
`npx eslint` on the touched files; full-repo gates were not run here because
other branches were being edited concurrently.
