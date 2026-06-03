---
type: bug
status: needs-verification
tags:
  - chat
priority: 2 - normal
relations:
  - "[[Chat]]"
---
When the user pastes an image to the chat, it gets added to the context but the agent is not able to find and use it.

> **Status (2026-06-03): paste path appears wired — needs user re-verification.** The paste handler captures
> the image and routes it via `addImageFromFile('paste')` into image context (`ImageContext.ts:174-204`).
> Confirm the *agent* now resolves the pasted image end-to-end, then close. (Flagged in
> [[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] backlog reconciliation.)