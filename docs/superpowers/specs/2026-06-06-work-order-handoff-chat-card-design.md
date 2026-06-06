---
title: Work Order Handoff Chat Card Design
date: 2026-06-06
status: approved
scope: chat-rendering
parent: "[[Work-Orders handoff message clutters chat]]"
relations:
  - "[[Agent Kanban Board]]"
  - "[[Chat]]"
---

# Work Order Handoff Chat Card Design

## Summary

Work-order runs currently leave the structured `<claudian_handoff>` block visible in the chat transcript. The block is useful for Agent Board persistence, but it creates a large, noisy assistant message that is hard for users to scan.

Render valid work-order handoffs as a compact, expandable chat card. The card keeps the transcript readable while preserving the original assistant message and the existing work-order handoff flow.

## Goals

- Replace raw handoff-block display in work-order run chats with a compact **Work order handoff** card.
- Keep the card collapsed by default to minimize visual clutter.
- Expand into clean formatted sections: Summary, Verification, Risks, and Next Action.
- Preserve the original assistant message, provider transcript, and work-order note content unchanged.
- Scope the behavior to Agent Board work-order chats so ordinary chat content is not transformed accidentally.

## Non-goals

- Do not change the required `<claudian_handoff>` prompt contract for agents.
- Do not alter how `RunSession` parses handoffs or writes them to work-order notes.
- Do not rewrite saved conversation history or provider-native transcript files.
- Do not introduce a new settings toggle for this first version.
- Do not render malformed handoffs as cards.

## User Experience

When a work-order run finishes, the assistant message should no longer show the raw `<claudian_handoff>` block inline. Chat renders normal text before and after the handoff as usual, and replaces the valid handoff block itself with a compact card at the same position.

The collapsed card shows:

- Title: **Work order handoff**.
- A short preview from the `summary:` field.
- Lightweight labels or indicators showing that Verification, Risks, and Next Action details are available.
- An **Expand** control.

When expanded, the card shows formatted Markdown sections:

- Summary
- Verification
- Risks
- Next Action

The expanded view hides the XML wrapper and raw field syntax. Users can collapse the card again after inspection.

If the summary is long, only the collapsed preview is truncated. Expanded content remains complete.

## Recommended Approach

Use a render-only transformation in the chat renderer for eligible work-order messages.

This approach is preferred because it fixes the visible clutter directly, keeps durable data untouched, and avoids changing provider/runtime message semantics for a UI-only concern.

Alternative approaches considered:

1. **Task runtime emits separate display metadata.** Cleaner in theory, but more invasive because it changes message or turn metadata seams.
2. **Prompt agents to produce shorter handoffs.** Simpler, but unreliable and still exposes raw XML in chat.

## Architecture and Boundaries

`features/tasks` remains the owner of the canonical structured handoff format and the work-order persistence flow. `features/chat/rendering` owns how assistant messages are displayed.

The design adds a small chat-facing handoff display helper so `MessageRenderer` does not embed handoff parsing details directly. The helper should be easy to test in isolation and should avoid coupling the full chat renderer to task execution internals.

Expected responsibilities:

- Handoff display helper:
  - detects exactly one valid `<claudian_handoff>` block,
  - parses required fields compatible with the task handoff format,
  - splits a message into pre-handoff Markdown, structured handoff data, and post-handoff Markdown,
  - rejects malformed, incomplete, or ambiguous content.
- Message rendering:
  - determines whether the message belongs to a work-order run,
  - delegates eligible assistant-message content to the helper,
  - renders normal Markdown segments with existing behavior,
  - inserts the compact/expandable card for the structured handoff segment,
  - applies the transformation on two paths — the stored-message replay path and a streaming finalize hook — so the card appears as soon as a live run completes and again after reload.
- Task execution:
  - continues using the existing handoff parser and note-writing path.

If practical, the helper may reuse an exported pure parser from `features/tasks/execution/TaskHandoffParser.ts`. If reuse would pull undesirable dependencies into chat rendering, duplicate only a small format adapter and keep it covered by tests.

## Eligibility Rules

Transform a handoff block only when all of the following are true:

1. The message is an assistant message.
2. The active chat tab or message context is linked to a work-order run.
3. The content contains exactly one `<claudian_handoff>` block.
4. The block contains all required fields: `summary`, `verification`, `risks`, and `next_action`.
5. No required field label is repeated inside the block (a duplicate label is ambiguous because the shared parser keeps only the last value).
6. The block parses without ambiguity.

When any rule fails, render the message normally. This fail-open behavior avoids hiding potentially important output.

## Data Flow

1. The Agent Board starts a work-order run in a chat tab linked to the work-order note.
2. The provider streams an assistant response that ends with one structured `<claudian_handoff>` block.
3. Existing task execution parses the final response and writes the handoff into the work-order note.
4. Chat rendering receives the assistant message for display, on either the live streaming finalize (when the run completes) or the stored-message replay (on reload, switch, or rewind).
5. The renderer recognizes the work-order context and passes the content to the handoff display helper.
6. The helper returns display segments: Markdown before the handoff, a structured handoff card model, and Markdown after the handoff.
7. The renderer displays the Markdown segments normally and the handoff model as a collapsed card. On the streaming path it swaps the just-finished raw text element in place; the stored content block keeps the raw handoff text so reload re-derives the same card.
8. Expanding the card reveals formatted sections without raw XML or field labels.

## Error Handling

- **No valid handoff block:** render the message normally.
- **Malformed handoff block:** render the message normally.
- **Missing required field:** render the message normally.
- **Duplicate required field:** render the message normally; a repeated label is ambiguous.
- **Multiple handoff blocks:** render the message normally to avoid hiding unexpected output.
- **Long summary:** truncate only the collapsed preview; keep expanded content complete.
- **Unexpected rendering error:** fall back to normal message rendering rather than dropping assistant content.

## Testing Strategy

Unit tests should cover the handoff display helper:

- valid block with Markdown before and after it,
- valid block without surrounding text,
- malformed XML-like block,
- missing `summary`, `verification`, `risks`, or `next_action`,
- multiple handoff blocks,
- a repeated required field,
- long summary preview truncation.

Renderer tests should cover:

- work-order assistant message renders a collapsed handoff card by default,
- expanding the card reveals Summary, Verification, Risks, and Next Action sections,
- raw `<claudian_handoff>` tags and raw field labels are not visible in card mode,
- normal assistant text before and after the block still renders,
- non-work-order chat containing the same valid handoff text renders unchanged,
- malformed work-order handoff content renders unchanged,
- the streaming finalize hook swaps a completed handoff text block for the card in work-order tabs and leaves it untouched elsewhere.

Later implementation verification should run targeted unit tests plus the usual project checks: typecheck, lint, unit tests, and build.

## Key Decisions Captured

- The fix is render-only; persisted history and provider transcripts stay unchanged.
- The card is collapsed by default.
- Expanded content is formatted, not raw.
- The behavior is scoped to work-order run chats.
- Ambiguous or malformed content — including duplicate required fields — fails open by rendering normally.
- The transformation runs on both the live streaming finalize and the stored replay path, so the card appears at run completion and survives reload.
- No settings toggle is required for the first version.

## Open Follow-up

After this spec is approved, the next step is to turn it into an implementation plan. A suitable next action is to run `/to-prd` or the Plan Review action when ready.
