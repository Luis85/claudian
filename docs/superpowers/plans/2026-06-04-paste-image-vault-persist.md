---
status: done
parent: Infrastructure
---
# Persist pasted chat images to the vault — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pasted / drag-dropped clipboard images written to the vault on send via Obsidian's attachment-folder setting; renderer prefers the vault path so the click overlay actually renders both live and after reload.

**Architecture:** `ImageAttachment` gains optional `path`. A new pure helper (`persistPastedImages`) writes any image lacking `path` to the vault via `app.fileManager.getAvailablePathForAttachment` + `app.vault.createBinary` at send-time, mutating the attachment object so the same reference flows into both the persisted `ChatMessage.images` and the `ChatTurnRequest.images`. `MessageRenderer` routes `<img>` src through a `resolveImageSrc` helper that prefers `path` (resolved via `app.vault.getResourcePath`) and falls back to the base64 data URI, with a final fallback chip when both are missing.

**Tech Stack:** TypeScript, Obsidian API (`App`, `Vault`, `FileManager`, `TFile`), Jest, jest-environment-jsdom.

**Spec:** `docs/superpowers/specs/2026-06-04-paste-image-vault-persist-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/core/types/chat.ts` | Modify | Add `path?: string` to `ImageAttachment`. |
| `src/features/chat/services/persistPastedImages.ts` | Create | Pure async helper: for each image without `path`, call Obsidian attachment APIs, mutate `path` + `name`. |
| `tests/unit/features/chat/services/persistPastedImages.test.ts` | Create | Unit tests for the helper. |
| `src/features/chat/controllers/InputController.ts` | Modify | Call helper between image collection and turn-submission build. |
| `tests/unit/features/chat/controllers/InputController.imageSave.test.ts` | Create | Integration-ish test that the helper is invoked on send and survives errors. |
| `src/features/chat/rendering/MessageRenderer.ts` | Modify | Add `resolveImageSrc`; route `setImageSrc`, `showFullImage`, `renderMessageImages` through it; render fallback chip when neither `path` nor `data` is usable. |
| `tests/unit/features/chat/rendering/MessageRenderer.test.ts` | Modify | New cases for `path`-preferred src, fallback chip, legacy data-URI behavior. |
| `tests/unit/app/conversations/ConversationStore.test.ts` | Modify | New case: after save, `image.data === ''` AND `image.path` preserved. |

Do not touch provider runtimes. `ChatTurnRequest.images[].data` stays populated at runtime call time because the save hook runs before `buildTurnSubmission`.

---

## Task 1: Extend `ImageAttachment` with optional `path`

**Files:**
- Modify: `src/core/types/chat.ts:21-31`

- [ ] **Step 1: Add the field**

Edit the `ImageAttachment` interface to add `path` between `data` and `width`:

```ts
export interface ImageAttachment {
  id: string;
  name: string;
  mediaType: ImageMediaType;
  /** Base64 encoded image data. Cleared by ConversationStore after save. */
  data: string;
  /** Vault-relative path. Stamped on send. Survives ConversationStore save. */
  path?: string;
  width?: number;
  height?: number;
  size: number;
  source: 'file' | 'paste' | 'drop';
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no consumers break — field is optional).

- [ ] **Step 3: Commit**

```bash
git add src/core/types/chat.ts
git commit -m "feat(types): add optional path to ImageAttachment for vault-backed images"
```

---

## Task 2: `persistPastedImages` helper (TDD)

**Files:**
- Create: `src/features/chat/services/persistPastedImages.ts`
- Test: `tests/unit/features/chat/services/persistPastedImages.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/features/chat/services/persistPastedImages.test.ts`:

```ts
import type { App, TFile } from 'obsidian';

import type { ImageAttachment } from '@/core/types';
import { persistPastedImages } from '@/features/chat/services/persistPastedImages';

function image(overrides: Partial<ImageAttachment> = {}): ImageAttachment {
  return {
    id: 'img-1',
    name: 'clipboard.png',
    mediaType: 'image/png',
    data: Buffer.from('hello').toString('base64'),
    size: 5,
    source: 'paste',
    ...overrides,
  };
}

function mockApp(overrides?: Partial<{ availablePath: string; createBinary: jest.Mock }>): App {
  const created: Record<string, TFile> = {};
  const createBinary = overrides?.createBinary ?? jest.fn(async (path: string) => {
    const file = { path, name: path.split('/').pop() ?? path, basename: 'x', extension: 'png' } as unknown as TFile;
    created[path] = file;
    return file;
  });
  return {
    fileManager: {
      getAvailablePathForAttachment: jest.fn(async (name: string) => overrides?.availablePath ?? `attachments/${name}`),
    },
    vault: { createBinary },
  } as unknown as App;
}

describe('persistPastedImages', () => {
  it('writes images without path to the vault and stamps path + name', async () => {
    const app = mockApp({ availablePath: 'attachments/Pasted image 20260604120000.png' });
    const img = image();
    await persistPastedImages(app, [img], { now: new Date('2026-06-04T12:00:00Z') });

    expect(app.fileManager.getAvailablePathForAttachment).toHaveBeenCalledWith('Pasted image 20260604120000.png');
    expect(app.vault.createBinary).toHaveBeenCalledTimes(1);
    const [calledPath, buffer] = (app.vault.createBinary as jest.Mock).mock.calls[0];
    expect(calledPath).toBe('attachments/Pasted image 20260604120000.png');
    expect(Buffer.from(buffer).toString('utf8')).toBe('hello');
    expect(img.path).toBe('attachments/Pasted image 20260604120000.png');
    expect(img.name).toBe('Pasted image 20260604120000.png');
  });

  it('skips images that already have a path', async () => {
    const app = mockApp();
    const img = image({ path: 'attachments/existing.png' });
    await persistPastedImages(app, [img], { now: new Date('2026-06-04T12:00:00Z') });

    expect(app.vault.createBinary).not.toHaveBeenCalled();
    expect(img.path).toBe('attachments/existing.png');
  });

  it('routes mediaType to file extension', async () => {
    const app = mockApp();
    const jpg = image({ mediaType: 'image/jpeg', id: 'a' });
    const gif = image({ mediaType: 'image/gif', id: 'b' });
    const webp = image({ mediaType: 'image/webp', id: 'c' });
    await persistPastedImages(app, [jpg, gif, webp], { now: new Date('2026-06-04T12:00:00Z') });

    const names = (app.fileManager.getAvailablePathForAttachment as jest.Mock).mock.calls.map((c) => c[0]);
    expect(names).toEqual([
      'Pasted image 20260604120000.jpg',
      'Pasted image 20260604120000.gif',
      'Pasted image 20260604120000.webp',
    ]);
  });

  it('continues other images when one createBinary throws and leaves path undefined', async () => {
    const app = mockApp({
      createBinary: jest.fn()
        .mockRejectedValueOnce(new Error('EACCES'))
        .mockResolvedValueOnce({ path: 'attachments/b.png', name: 'b.png', basename: 'b', extension: 'png' } as unknown as TFile),
    });
    const a = image({ id: 'a' });
    const b = image({ id: 'b' });
    await persistPastedImages(app, [a, b], { now: new Date('2026-06-04T12:00:00Z') });

    expect(a.path).toBeUndefined();
    expect(b.path).toBe('attachments/b.png');
  });

  it('runs writes sequentially (not in parallel) to avoid same-stamp collisions', async () => {
    const order: string[] = [];
    const app = mockApp({
      createBinary: jest.fn(async (path: string) => {
        order.push(`start:${path}`);
        await new Promise((r) => setTimeout(r, 0));
        order.push(`end:${path}`);
        return { path, name: path.split('/').pop() ?? path, basename: 'x', extension: 'png' } as unknown as TFile;
      }),
    });
    const a = image({ id: 'a' });
    const b = image({ id: 'b' });
    await persistPastedImages(app, [a, b], { now: new Date('2026-06-04T12:00:00Z') });

    expect(order[0]).toMatch(/^start:/);
    expect(order[1]).toMatch(/^end:/);
    expect(order[2]).toMatch(/^start:/);
    expect(order[3]).toMatch(/^end:/);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test -- tests/unit/features/chat/services/persistPastedImages.test.ts`
Expected: FAIL with "Cannot find module '@/features/chat/services/persistPastedImages'".

- [ ] **Step 3: Implement the helper**

Create `src/features/chat/services/persistPastedImages.ts`:

```ts
import type { App, TFile } from 'obsidian';

import { logger } from '../../../core/logging/Logger';
import type { ImageAttachment, ImageMediaType } from '../../../core/types';

const MEDIA_TYPE_TO_EXT: Record<ImageMediaType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export interface PersistPastedImagesOptions {
  /** Injection point for tests; defaults to `new Date()`. */
  now?: Date;
}

/**
 * Mutates each `ImageAttachment` in `images` whose `path` is unset by writing
 * the base64 buffer to the vault via Obsidian's attachment APIs. Respects the
 * user's "Default location for new attachments" setting through
 * `fileManager.getAvailablePathForAttachment`. Filename matches Obsidian's
 * native paste convention: `Pasted image YYYYMMDDHHmmss.<ext>`.
 *
 * Writes are sequential so two same-second pastes get disambiguated by
 * `getAvailablePathForAttachment` rather than racing on the same stamp.
 *
 * On individual write failure, the image is left with `path` undefined; the
 * caller can still send the in-memory `data`. Other images continue.
 */
export async function persistPastedImages(
  app: App,
  images: ImageAttachment[],
  options: PersistPastedImagesOptions = {},
): Promise<void> {
  if (!images || images.length === 0) return;
  const now = options.now ?? new Date();

  for (const image of images) {
    if (image.path) continue;
    const ext = MEDIA_TYPE_TO_EXT[image.mediaType];
    if (!ext) continue;
    const desired = `Pasted image ${formatPastedStamp(now)}.${ext}`;
    try {
      const targetPath = await app.fileManager.getAvailablePathForAttachment(desired);
      const buffer = Buffer.from(image.data, 'base64');
      const tFile: TFile = await app.vault.createBinary(targetPath, buffer);
      image.path = tFile.path;
      image.name = tFile.name;
    } catch (err) {
      logger.warn('persistPastedImages: failed to write image to vault', { id: image.id, error: err });
    }
  }
}

function formatPastedStamp(date: Date): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = date.getUTCDate().toString().padStart(2, '0');
  const hh = date.getUTCHours().toString().padStart(2, '0');
  const mi = date.getUTCMinutes().toString().padStart(2, '0');
  const ss = date.getUTCSeconds().toString().padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${mi}${ss}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/features/chat/services/persistPastedImages.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Lint + typecheck**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/chat/services/persistPastedImages.ts tests/unit/features/chat/services/persistPastedImages.test.ts
git commit -m "feat(chat): add persistPastedImages helper to write attachments to vault"
```

---

## Task 3: Wire `persistPastedImages` into `InputController.send`

**Files:**
- Modify: `src/features/chat/controllers/InputController.ts:321-322`
- Create: `tests/unit/features/chat/controllers/InputController.imageSave.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/chat/controllers/InputController.imageSave.test.ts`:

```ts
import type { App, TFile } from 'obsidian';

import type { ImageAttachment } from '@/core/types';
import { persistPastedImages } from '@/features/chat/services/persistPastedImages';

jest.mock('@/features/chat/services/persistPastedImages', () => ({
  persistPastedImages: jest.fn(async (_app: App, images: ImageAttachment[]) => {
    for (const img of images) {
      if (!img.path) {
        img.path = `attachments/${img.name}`;
      }
    }
  }),
}));

describe('InputController image save integration', () => {
  beforeEach(() => {
    (persistPastedImages as jest.Mock).mockClear();
  });

  it('calls persistPastedImages before building the turn submission', async () => {
    const { dispatchSendForTest } = await import('./_fixtures/sendImageFixture');
    const image: ImageAttachment = {
      id: 'img-1',
      name: 'clipboard.png',
      mediaType: 'image/png',
      data: Buffer.from('hello').toString('base64'),
      size: 5,
      source: 'paste',
    };

    const { messageImages, turnRequestImages } = await dispatchSendForTest({ images: [image] });

    expect(persistPastedImages).toHaveBeenCalledTimes(1);
    expect(messageImages?.[0].path).toBe('attachments/clipboard.png');
    expect(turnRequestImages?.[0].path).toBe('attachments/clipboard.png');
    expect(turnRequestImages?.[0].data).toBe(image.data); // data still present for runtime
  });

  it('skips images that already have a path (re-send / queued from prior turn)', async () => {
    const { dispatchSendForTest } = await import('./_fixtures/sendImageFixture');
    const image: ImageAttachment = {
      id: 'img-2',
      name: 'existing.png',
      mediaType: 'image/png',
      data: Buffer.from('x').toString('base64'),
      size: 1,
      source: 'paste',
      path: 'attachments/existing.png',
    };
    const result = await dispatchSendForTest({ images: [image] });

    expect(persistPastedImages).toHaveBeenCalledTimes(1);
    expect(result.messageImages?.[0].path).toBe('attachments/existing.png');
  });
});
```

The fixture below isolates the send path from the rest of `InputController`'s deps. Create `tests/unit/features/chat/controllers/_fixtures/sendImageFixture.ts`:

```ts
import type { App } from 'obsidian';

import type { ChatMessage, ImageAttachment } from '@/core/types';
import { persistPastedImages } from '@/features/chat/services/persistPastedImages';

/**
 * Mirrors the relevant block of InputController.send so the wiring of
 * persistPastedImages can be exercised in isolation. Keep in sync with
 * InputController.send: collect images → persist → build snapshot + request.
 */
export async function dispatchSendForTest(input: {
  images: ImageAttachment[];
}): Promise<{
  messageImages?: ImageAttachment[];
  turnRequestImages?: ImageAttachment[];
}> {
  const app = {} as App;
  const images = input.images;
  await persistPastedImages(app, images);
  const imagesForMessage = images.length > 0 ? [...images] : undefined;
  const message: ChatMessage = {
    id: 'm1',
    role: 'user',
    content: 'hi',
    timestamp: 0,
    images: imagesForMessage,
  };
  const turnRequest: { images?: ImageAttachment[] } = {
    images: imagesForMessage ? [...imagesForMessage] : undefined,
  };
  return {
    messageImages: message.images,
    turnRequestImages: turnRequest.images,
  };
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/features/chat/controllers/InputController.imageSave.test.ts`
Expected: FAIL — fixture file missing OR `persistPastedImages` not yet wired into actual `InputController` flow (the fixture asserts the *shape* of what `InputController` must do).

If both fixture and helper exist already, the test will PASS on the fixture but the wiring step below is still required. Continue.

- [ ] **Step 3: Wire helper into `InputController.send`**

In `src/features/chat/controllers/InputController.ts`, add the import near the other relative imports (alphabetically; after `..services/SubagentManager` import block):

```ts
import { persistPastedImages } from '../services/persistPastedImages';
```

Locate the block at lines 321-322:

```ts
    const images = imageOverride ?? imageContextManager?.getAttachedImages() ?? [];
    const imagesForMessage = images.length > 0 ? [...images] : undefined;
```

Insert a single `await` between them:

```ts
    const images = imageOverride ?? imageContextManager?.getAttachedImages() ?? [];
    if (images.length > 0) {
      await persistPastedImages(this.deps.plugin.app, images);
    }
    const imagesForMessage = images.length > 0 ? [...images] : undefined;
```

(Use `this.deps.plugin.app` — `ClaudianPlugin` extends Obsidian's `Plugin` so `.app: App` is available. Verify by reading nearby `this.deps.plugin.*` references already in the file.)

- [ ] **Step 4: Re-run tests to verify they pass**

Run: `npm run test -- tests/unit/features/chat/controllers/InputController.imageSave.test.ts`
Expected: PASS — both cases green.

- [ ] **Step 5: Confirm no regression in existing InputController tests**

Run: `npm run test -- tests/unit/features/chat/controllers/InputController.test.ts`
Expected: PASS — all existing cases unaffected (helper only mutates `path` when missing; runtime still gets `data`).

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/chat/controllers/InputController.ts tests/unit/features/chat/controllers/InputController.imageSave.test.ts tests/unit/features/chat/controllers/_fixtures/sendImageFixture.ts
git commit -m "feat(chat): persist pasted images to vault on send"
```

---

## Task 4: Renderer prefers vault path via `resolveImageSrc`

**Files:**
- Modify: `src/features/chat/rendering/MessageRenderer.ts:670-739`
- Modify: `tests/unit/features/chat/rendering/MessageRenderer.test.ts`

- [ ] **Step 1: Write the failing test cases**

Append to `tests/unit/features/chat/rendering/MessageRenderer.test.ts` (inside the existing top-level `describe`):

```ts
describe('image rendering', () => {
  const baseImage: ImageAttachment = {
    id: 'img-1',
    name: 'Pasted image.png',
    mediaType: 'image/png',
    data: 'ZGF0YQ==',
    size: 4,
    source: 'paste',
  };

  function buildRenderer(appOverrides?: Partial<{
    getAbstractFileByPath: jest.Mock;
    getResourcePath: jest.Mock;
  }>) {
    const getResourcePath = appOverrides?.getResourcePath ?? jest.fn().mockReturnValue('app://vault/Pasted%20image.png');
    const getAbstractFileByPath = appOverrides?.getAbstractFileByPath ?? jest.fn().mockReturnValue(new TFile());
    const app: any = {
      vault: { getAbstractFileByPath, getResourcePath },
      metadataCache: {},
    };
    const messagesEl = createMockEl();
    const component = createMockComponent();
    // Construct a MessageRenderer with the minimal deps it needs for image methods.
    const renderer = new MessageRenderer({
      app,
      messagesEl,
      generateId: () => 'g',
      component,
      // Fill any other required deps with jest.fn()/null as the existing test file does for unrelated cases.
    } as any);
    return { renderer, app, messagesEl };
  }

  it('prefers vault path when set and TFile exists', async () => {
    const { renderer, app } = buildRenderer();
    const img = { ...baseImage, path: 'attachments/Pasted image.png' };
    const imgEl = { setAttribute: jest.fn() } as unknown as HTMLImageElement;
    renderer.setImageSrc(imgEl, img);

    expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith('attachments/Pasted image.png');
    expect(app.vault.getResourcePath).toHaveBeenCalled();
    expect((imgEl.setAttribute as jest.Mock)).toHaveBeenCalledWith('src', 'app://vault/Pasted%20image.png');
  });

  it('falls back to data URI when path resolves to null', async () => {
    const { renderer, app } = buildRenderer({
      getAbstractFileByPath: jest.fn().mockReturnValue(null),
    });
    const img = { ...baseImage, path: 'attachments/missing.png' };
    const imgEl = { setAttribute: jest.fn() } as unknown as HTMLImageElement;
    renderer.setImageSrc(imgEl, img);

    expect((imgEl.setAttribute as jest.Mock)).toHaveBeenCalledWith('src', `data:${img.mediaType};base64,${img.data}`);
    expect(app.vault.getResourcePath).not.toHaveBeenCalled();
  });

  it('renders fallback chip when neither path resolves nor data is present', () => {
    const { renderer, messagesEl } = buildRenderer({
      getAbstractFileByPath: jest.fn().mockReturnValue(null),
    });
    const img = { ...baseImage, path: 'attachments/missing.png', data: '' };
    renderer.renderMessageImages(messagesEl, [img]);

    // No <img> child — fallback chip element present instead.
    const imagesContainer = messagesEl.children.find((c: any) => c.cls?.includes('claudian-message-images'));
    expect(imagesContainer).toBeDefined();
    const imgChildren = imagesContainer.querySelectorAll?.('img') ?? [];
    expect(imgChildren.length).toBe(0);
    const fallback = imagesContainer.children.find((c: any) => c.cls?.includes('claudian-message-image-fallback'));
    expect(fallback).toBeDefined();
  });

  it('uses data URI for legacy images that have no path', () => {
    const { renderer } = buildRenderer();
    const img = { ...baseImage }; // no path
    const imgEl = { setAttribute: jest.fn() } as unknown as HTMLImageElement;
    renderer.setImageSrc(imgEl, img);

    expect((imgEl.setAttribute as jest.Mock)).toHaveBeenCalledWith('src', `data:${img.mediaType};base64,${img.data}`);
  });
});
```

Note: if the existing `MessageRenderer.test.ts` constructor signature in the test file differs from `buildRenderer` above, copy the existing test's construction pattern verbatim. The intent is: build a renderer with a stubbed `app.vault.getAbstractFileByPath` / `getResourcePath`, then exercise `setImageSrc` / `renderMessageImages`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/features/chat/rendering/MessageRenderer.test.ts`
Expected: FAIL — `setImageSrc` currently always uses the data URI; `renderMessageImages` currently emits `<img>` unconditionally.

- [ ] **Step 3: Add `resolveImageSrc` and refactor `setImageSrc`**

In `src/features/chat/rendering/MessageRenderer.ts`, ensure `getVaultFileByPath` is imported (it should be already via existing imports; if not, add `import { getVaultFileByPath } from '../../../utils/obsidianCompat';`).

Replace the existing `setImageSrc` (lines 736-739) and add a private helper above it:

```ts
  /**
   * Returns the best <img src> for an attachment: vault resource path when the
   * file exists, base64 data URI otherwise, null if neither is usable.
   */
  private resolveImageSrc(image: ImageAttachment): string | null {
    if (image.path) {
      const file = getVaultFileByPath(this.app, image.path);
      if (file) return this.app.vault.getResourcePath(file);
    }
    if (image.data) return `data:${image.mediaType};base64,${image.data}`;
    return null;
  }

  /**
   * Sets image src from attachment — prefers vault file over base64 blob.
   */
  setImageSrc(imgEl: HTMLImageElement, image: ImageAttachment): void {
    const src = this.resolveImageSrc(image);
    if (src) {
      imgEl.setAttribute('src', src);
    }
  }
```

- [ ] **Step 4: Refactor `renderMessageImages` for fallback chip**

Replace the body of `renderMessageImages` (lines 671-693) with:

```ts
  renderMessageImages(containerEl: HTMLElement, images: ImageAttachment[]): void {
    const imagesEl = containerEl.createDiv({ cls: 'claudian-message-images' });

    for (const image of images) {
      const src = this.resolveImageSrc(image);
      if (!src) {
        const fallback = imagesEl.createDiv({ cls: 'claudian-message-image-fallback' });
        fallback.setText(image.name || 'image');
        continue;
      }

      const imageWrapper = imagesEl.createDiv({ cls: 'claudian-message-image' });
      const imgEl = imageWrapper.createEl('img', {
        attr: {
          alt: image.name,
          loading: 'lazy',
          decoding: 'async',
        },
      });
      imgEl.setAttribute('src', src);

      imgEl.addEventListener('click', () => {
        void this.showFullImage(image);
      });
    }
  }
```

- [ ] **Step 5: Refactor `showFullImage` to also use the resolver**

Replace `showFullImage` (lines 698-731), preserving the close/Esc/click-outside behavior but routing the `<img src>`:

```ts
  showFullImage(image: ImageAttachment): void {
    const src = this.resolveImageSrc(image);
    if (!src) {
      // Nothing to show — surface a brief fallback rather than a blank modal.
      new Notice('Image is no longer available in the vault.');
      return;
    }

    const ownerDocument = this.messagesEl.ownerDocument ?? window.document;
    const overlay = ownerDocument.body.createDiv({ cls: 'claudian-image-modal-overlay' });
    const modal = overlay.createDiv({ cls: 'claudian-image-modal' });

    modal.createEl('img', {
      attr: { src, alt: image.name },
    });

    const closeBtn = modal.createDiv({ cls: 'claudian-image-modal-close' });
    closeBtn.setText('×');

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const close = () => {
      ownerDocument.removeEventListener('keydown', handleEsc);
      overlay.remove();
    };
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    ownerDocument.addEventListener('keydown', handleEsc);
  }
```

Ensure `Notice` is imported at the top of the file (`import { Notice, ... } from 'obsidian';`). If already imported via another symbol on that line, just add `Notice` to the existing import list — do not add a second import statement.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- tests/unit/features/chat/rendering/MessageRenderer.test.ts`
Expected: PASS — all 4 new cases green; existing cases unaffected.

- [ ] **Step 7: Add minimal fallback CSS**

Append to `src/style/features/image-context.css` (or the nearest existing image-related stylesheet; check `src/style/index.css` for the import — if there is no `image-context.css`, add the rule to `src/style/features/image-embed.css`):

```css
.claudian-message-image-fallback {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  padding: 0.3em 0.6em;
  border: 1px dashed var(--background-modifier-border);
  border-radius: 6px;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-style: italic;
}

.claudian-message-image-fallback::before {
  content: '🖼';
}
```

Run: `npm run build:css`
Expected: `Built styles.css (...)`.

- [ ] **Step 8: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/chat/rendering/MessageRenderer.ts tests/unit/features/chat/rendering/MessageRenderer.test.ts src/style/features/image-context.css src/style/features/image-embed.css styles.css
git commit -m "feat(chat): render images from vault path with base64 fallback and graceful chip"
```

(Stage only the stylesheet you actually edited.)

---

## Task 5: Verify `path` survives `ConversationStore.save`

**Files:**
- Modify: `tests/unit/app/conversations/ConversationStore.test.ts`

- [ ] **Step 1: Read existing test setup**

Open `tests/unit/app/conversations/ConversationStore.test.ts` and find an existing test that exercises `save()` with messages containing images (search for `images` in the file). Mirror its setup.

- [ ] **Step 2: Add the failing test**

Add (or update if a similar test exists):

```ts
it('preserves image.path while clearing image.data after save', async () => {
  // Setup mirrors the file's existing "clears image data after save" test.
  // The only differences: each image carries a `path`, and the assertion
  // additionally verifies the path survives.

  const conversation = makeConversationWithImages([
    { id: 'a', data: 'AAA=', path: 'attachments/a.png' },
    { id: 'b', data: 'BBB=', path: 'attachments/b.png' },
  ]);
  await store.save(conversation);

  for (const msg of conversation.messages) {
    for (const img of msg.images ?? []) {
      expect(img.data).toBe('');
      expect(img.path).toMatch(/^attachments\//);
    }
  }
});
```

(`makeConversationWithImages` is a placeholder — use the existing fixture helper from this test file or inline the conversation literal.)

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm run test -- tests/unit/app/conversations/ConversationStore.test.ts`
Expected: PASS — the existing `data = ''` wipe is untouched, and `path` is a separate field that the wipe loop does not modify. If this fails, the wipe loop changed scope; investigate.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/app/conversations/ConversationStore.test.ts
git commit -m "test(conversations): cover ImageAttachment.path survival across save"
```

---

## Task 6: Full validation pass

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS — no regressions in any project (unit, integration).

- [ ] **Step 2: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all green. `npm run build` produces an updated bundle including the rebuilt `styles.css`.

- [ ] **Step 3: Manual smoke test in the dev vault**

1. Open the chat sidebar.
2. Paste an image (Ctrl/Cmd+V with an image on the clipboard).
3. Confirm the chip preview shows the image (existing behavior).
4. Send the message.
5. Confirm a new file appears in your Obsidian attachment folder (the path configured under Settings → Files & Links → Default location for new attachments). Filename: `Pasted image YYYYMMDDHHmmss.png`.
6. Click the image above the user bubble — full-size overlay renders the image from the vault file.
7. Reload Obsidian (`Ctrl+R`). Reopen the conversation from history. Click the image again — overlay still renders.
8. Move the image file in the vault, then click again — fallback chip appears (no blank overlay).

- [ ] **Step 4: Close the tracking issue**

Open `docs/issues/Pasted images or files to the chat dont get picked up.md`. Update the frontmatter:

```yaml
status: shipped
```

Append a brief note under the existing status block:

> **Update (2026-06-04):** Pasted images now persist to the vault on send via
> `persistPastedImages` and render through `MessageRenderer.resolveImageSrc`
> (prefers vault path, falls back to base64, then to a graceful chip). See
> `docs/superpowers/specs/2026-06-04-paste-image-vault-persist-design.md`.

- [ ] **Step 5: Commit the doc updates**

```bash
git add docs/issues/Pasted\ images\ or\ files\ to\ the\ chat\ dont\ get\ picked\ up.md
git commit -m "docs(issues): close pasted-image bug after vault-persist implementation"
```

---

## Self-Review Notes

- **Spec coverage:** Tasks 1–4 implement the Architecture, Data Model, Save Flow, Render Flow, and Edge Cases sections of the spec. Task 5 covers the Persistence section. Task 6 covers manual verification + tracking-issue closure.
- **Out-of-scope items** (`loadImageBytes` for fork rehydration, historical-conversation migration, per-message "open in vault" action) are intentionally omitted per spec.
- **Type consistency:** `persistPastedImages(app, images, options?)` signature, `ImageAttachment.path?: string`, `resolveImageSrc(image): string | null` are used identically across all tasks.
