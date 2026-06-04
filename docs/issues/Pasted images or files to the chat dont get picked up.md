---
type: bug
status: done
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

## Implementation (2026-06-04)

**Status: SHIPPED**

Pasted images now persist to the vault on send via `persistPastedImages` and render through `MessageRenderer.resolveImageSrc` (prefers vault path, falls back to base64, then to a graceful chip). See [[docs/superpowers/specs/2026-06-04-paste-image-vault-persist-design.md]] and [[docs/superpowers/plans/2026-06-04-paste-image-vault-persist.md]].

Changes:
- `ImageAttachment` gains optional `path` field (vault-relative, stamped on send)
- `persistPastedImages` helper writes images to vault via `app.fileManager.getAvailablePathForAttachment` + `app.vault.createBinary`
- `MessageRenderer.resolveImageSrc` routes through vault path → base64 data URI → fallback chip
- Path survives `ConversationStore.save()` (data is cleared, path persists)