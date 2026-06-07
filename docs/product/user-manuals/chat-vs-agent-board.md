---
date: 2026-06-07
status: shipped
type: user-manual
parent: "[[Specorator - Product Vision]]"
related:
  - "[[sidepanel-chat]]"
  - "[[agent-board]]"
  - "[[quick-actions]]"
---
# Chat vs Agent Board — when to use which

Specorator gives you two work surfaces for AI help:

- **[[sidepanel-chat|Co-Worker Chat]]** is for foreground collaboration: fast, conversational, low-ceremony work beside the note you are already editing.
- **[[agent-board|Agent Board]]** is for durable handoffs: scoped work orders you can queue, prioritize, run, review, rework, and keep as a record in your vault.

The simple rule: **talk through it in chat; hand it off on the board.**

---

## Start in chat

Use Co-Worker Chat when you want to work with the assistant right now:

- Ask a question about the note you are viewing.
- Rewrite a paragraph, draft an email, summarize a selection, or compare two snippets.
- Brainstorm until the shape of the work is clear.
- Try a provider quickly without setting up a work order.
- Keep a lightweight conversation open while you edit.

Chat is intentionally low ceremony. Open the sidebar, type, attach context with `@`, and decide whether to apply any suggested edits. It is the fastest path from “I need help with this” to “let’s try a version.”

---

## Move bigger work to the board

Use the Agent Board when the task should become a managed handoff:

- It needs a clear objective, acceptance criteria, context, and constraints.
- You want to queue it behind other work.
- You want to prioritize several tasks and run the next ready one.
- You want the run to continue as a tracked item while you focus elsewhere.
- You need a review step before accepting the result.
- You want a durable record of what was handed off, what came back, and what happened next.

A work order is a Markdown note, so it stays in your vault after the chat tab is gone. That is the board's job: make AI work visible, sortable, reviewable, and hard to lose.

---

## Use Quick Actions for repeated prompts

[[quick-actions|Quick Actions]] are not a third workspace. They are shortcuts for prompts you reuse.

Use them when you catch yourself typing the same instruction again:

- “Summarize this note in three bullets.”
- “Turn this into a polite email.”
- “Find open questions and next actions.”
- “Review this work order for missing acceptance criteria.”

Quick Actions usually fire into the active chat. On the Agent Board, they can also run against a work-order note from a card's right-click menu.

---

## Decision guide

| If you want to… | Use |
|-----------------|-----|
| Ask, explore, or revise something immediately | Co-Worker Chat: [[sidepanel-chat]] |
| Work beside the current note with selected text already attached | Co-Worker Chat: [[sidepanel-chat]] |
| Have a back-and-forth conversation before you know the exact task | Co-Worker Chat: [[sidepanel-chat]] |
| Save a prompt you use often | Quick Actions: [[quick-actions]] |
| Turn a useful chat result into follow-up work | Create a work order: [[agent-board-chat-interop-and-capture]] |
| Queue several tasks and pick the next one by priority | Agent Board: [[agent-board]] |
| Define acceptance criteria and review the result before calling it done | Agent Board: [[agent-board]] |
| Keep a durable handoff record in Markdown | Agent Board: [[agent-board]] |

---

## Typical flows

### Fast foreground task

1. Open a note.
2. Open [[sidepanel-chat|Co-Worker Chat]].
3. Ask for a rewrite, summary, explanation, or comparison.
4. Preview and apply the result, or keep chatting until it is right.

### Repeated task

1. Type a useful prompt in chat.
2. Capture it as a [[quick-actions|Quick Action]].
3. Next time, click the lightning-bolt picker and run it in one tap.

### Bigger handoff

1. Start in chat to shape the idea.
2. Capture the assistant's useful reply, or the whole conversation, as a [[agent-board-chat-interop-and-capture|work order]].
3. Scope the work order: objective, acceptance criteria, context, and constraints.
4. Move it to **Ready**.
5. Run it from the [[agent-board|Agent Board]].
6. Review the handoff, then accept, rework, archive, or reopen.

---

## Rule of thumb

If the work can be finished in the conversation you are having now, keep it in **Co-Worker Chat**.

If the work deserves a place in a queue, a priority, acceptance criteria, or a review record, put it on the **Agent Board**.
