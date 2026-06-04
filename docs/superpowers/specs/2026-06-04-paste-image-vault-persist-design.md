---
title: Persist pasted chat images to the vault
date: 2026-06-04
status: draft
scope: features/chat — image attachments, persistence, rendering
relations:
  - "[[docs/issues/Pasted images or files to the chat dont get picked up.md]]"
---

## Problem

Pasted and drag-dropped clipboard images attach to a chat turn as base64 only.
After `ConversationStore.save()` wipes `img.data = ''` (to keep session JSON
small), there is nothing left for the renderer to display. Click on the image
in a sent message — same session or after reload — produces a broken `<img>`
overlay showing only the alt text (`image.png`). Obsidian's "Default location
for new attachments" setting is ignored: the image never lands in the vault.

## Goals

1. Pasted/dropped clipboard images survive `ConversationStore.save()` so the
   click overlay renders both in the live session and after reload.
2. Saved images respect Obsidian's attachment-folder setting and filename
   convention.
3. No changes to provider runtimes; existing `ChatTurnRequest.images[].data`
   contract stays intact.

## Non-goals

- Rehydrating images for fork or history-rebuild flows. If a fork needs the
  original bytes after `data` was wiped, `path` will be present but no helper
  reads it back yet. Tracked separately.
- Migrating already-broken historical messages. Old conversations with cleared
  `data` and no `path` stay broken (render fallback chip, not blank).
- Drag-dropped vault `TFile` images. Out of scope; if upstream stamps `path`,
  the save pipeline skips re-writing.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Save timing | On send only | Avoids orphan vault files from removed chips. |
| Display surface | Keep images-above-bubble UX | `ImageAttachment` gains `path?`; no markdown body change. |
| Click behavior | Existing modal overlay, src from vault path | Minimal UX change; modal now actually renders. |

## Architecture

Three touch points:

1. **`src/core/types/chat.ts`** — `ImageAttachment` grows `path?: string`
   (vault-relative). `data` remains the in-flight source of truth; `path`
   becomes the persisted source of truth.
2. **`src/features/chat/controllers/InputController.ts`** — pre-send hook
   iterates `attachedImages`. For each image without `path`, writes the
   base64 buffer to the vault via Obsidian APIs and stamps `path` + updates
   `name`. Runs before `runtime.prepareTurn()` so the runtime still receives
   `data`.
3. **`src/features/chat/rendering/MessageRenderer.ts`** — `setImageSrc` and
   `showFullImage` route through a new `resolveImageSrc(image)` helper that
   prefers `path` → `app.vault.getResourcePath(file)`, falls back to the
   existing data URI, and returns `null` when both are missing.

No new module. No DI change. `App` already reaches both call sites.

## Data model

```ts
// src/core/types/chat.ts
export interface ImageAttachment {
  id: string;
  name: string;
  mediaType: ImageMediaType;
  /** Base64 encoded image data. Cleared after ConversationStore.save(). */
  data: string;
  /** Vault-relative path. Populated on send. Survives save. */
  path?: string;
  width?: number;
  height?: number;
  size: number;
  source: 'file' | 'paste' | 'drop';
}
```

## Save flow

```ts
// Pseudocode inside InputController, per send, per image without `path`:
const ext = mediaTypeToExt(image.mediaType);          // 'png' | 'jpg' | 'gif' | 'webp'
const stamp = formatPastedStamp(new Date());          // 'YYYYMMDDHHmmss'
const desired = `Pasted image ${stamp}.${ext}`;
const targetPath = await app.fileManager.getAvailablePathForAttachment(desired);
const buf = Buffer.from(image.data, 'base64');
const tFile = await app.vault.createBinary(targetPath, buf);
image.path = tFile.path;
image.name = tFile.name;
```

**Why `app.fileManager.getAvailablePathForAttachment`:**
- Respects the user's "Default location for new attachments" setting (vault
  root / same folder as current file / specified subfolder).
- Honors `attachmentFolderPath` config.
- Handles filename collisions automatically (appends ` 1`, ` 2`, ...).

**Sequencing.** Multiple images in one send write sequentially (await each),
so two same-second pastes get disambiguated by `getAvailablePathForAttachment`
rather than racing on the same stamp.

**Error handling.** `createBinary` failure → log warning, surface a `Notice`,
keep `path` undefined. Send proceeds with base64 only; image will not survive
reload but the turn still goes through.

## Render flow

```ts
// src/features/chat/rendering/MessageRenderer.ts
private resolveImageSrc(image: ImageAttachment): string | null {
  if (image.path) {
    const file = getVaultFileByPath(this.app, image.path);
    if (file) return this.app.vault.getResourcePath(file);
  }
  if (image.data) return `data:${image.mediaType};base64,${image.data}`;
  return null;
}
```

`setImageSrc` and `showFullImage` call this helper. If `null`, render a
fallback chip (icon + filename) instead of a broken `<img>` element.

## Persistence

`ConversationStore.ts:202-210` already wipes `img.data = ''` after save to keep
session JSON small. That stays unchanged. With `path` stamped at send time,
the renderer continues to resolve the image after reload.

Old conversations whose images have neither `data` nor `path` fall through to
the fallback chip — no migration.

## Provider parity

Claude, Codex, and Cursor runtimes all consume `ChatTurnRequest.images[].data`.
The save-on-send pre-flight runs **before** `runtime.prepareTurn()`, so `data`
is still populated when the runtime serializes the turn. No runtime change.

## Edge cases

- **Read-only vault / sync conflict.** `createBinary` throws → `Notice`, send
  proceeds with base64-only.
- **Vault file deleted later.** `getVaultFileByPath` returns `null` → fallback
  chip rendered, no blank overlay.
- **Queued messages.** `QueuedMessageController` holds attachments in memory
  with `data`. When the queue drains, each turn runs the same save pipeline.
- **Drop pipeline.** Drag-dropped clipboard images flow through
  `addImageFromFile` → same save pre-flight applies.

## Test plan

1. `tests/unit/features/chat/ui/ImageContext.test.ts` — paste path still
   stamps chip with `data`, no `path` yet. Unchanged behavior.
2. New `tests/unit/features/chat/controllers/InputController.imageSave.test.ts`:
   - Send with pasted image → mock `fileManager.getAvailablePathForAttachment`
     returns `attachments/Pasted image 20260604120000.png`, mock
     `vault.createBinary` resolves with a `TFile`. Assert `image.path` is
     stamped and `createBinary` is called with the decoded buffer.
   - Send with image whose `path` is already set → assert `createBinary` NOT
     called.
   - `createBinary` rejects → assert send proceeds, `image.path` is
     `undefined`, `Notice` surfaced.
3. `tests/unit/features/chat/rendering/MessageRenderer.test.ts`:
   - Image with `path` and existing `TFile` → `<img>` src equals mocked
     `vault.getResourcePath` return.
   - Image with `path` but missing `TFile` and no `data` → fallback chip
     rendered, no `<img>`.
   - Image with `data` only (legacy in-memory path) → data URI src
     (unchanged behavior).
4. `tests/unit/app/conversations/ConversationStore.test.ts` — after save,
   `image.data === ''` AND `image.path` preserved.

No perf test: vault write is one-shot per paste, off the streaming path.

## Out of scope (follow-ups)

- `loadImageBytes(app, image)` helper for fork / history-rebuild flows that
  need original bytes after `data` is wiped.
- Migration of historical conversations with broken images.
- Surfacing a per-message "open image in vault" action.
