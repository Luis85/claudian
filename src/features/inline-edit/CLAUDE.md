# Inline Edit

In-editor agent overlay for replacing the active selection or inserting AI-generated content. The feature is provider-neutral: all four providers (Claude, Codex, Opencode, Cursor) register an `InlineEditService` factory through `ProviderRegistration.createInlineEditService`, and `InlineEditModal` resolves the active conversation's `providerId` to pick the implementation.

## Architecture

- `InlineEditModal` mounts a CodeMirror `StateField` (`inlineEditField`) of decorations on the active editor. The field reacts to three effects (`showInlineEdit`, `showDiff`, `showInsertion`) plus a `hideInlineEdit` reset.
- `InlineEditController` owns the lifecycle for a single edit session: input box, mention/slash dropdowns, agent dispatch, diff/insertion display, accept/reject, and the markdown preview slot above the diff.
- `inlineEditMarkdownPreview.ts` renders a markdown string into a target `HTMLElement` via Obsidian's `MarkdownRenderer.render`, with image-embed preprocessing via `replaceImageEmbedsWithHtml` and a plain-text fallback when rendering throws.

## Markdown Preview Pipeline

The preview body is rendered through `renderInlineEditMarkdownPreview()`:

1. The container is emptied (using `HTMLElement.empty()` when available, `replaceChildren()` otherwise — the second path is a jsdom-friendly fallback for tests).
2. `replaceImageEmbedsWithHtml` rewrites `![[image.png]]` wikilink embeds into `<img>` tags resolved against the vault. Non-image embeds pass through unchanged for `MarkdownRenderer` to handle.
3. `MarkdownRenderer.render(app, processedMarkdown, container, sourcePath, component)` performs the actual render. The `component` is the plugin instance; the `sourcePath` (the active note path) drives wikilink resolution.
4. If the rendered output contains `[[`, `processFileLinks` post-processes resolvable wikilinks into clickable internal-link anchors.
5. Any thrown error falls back to a plain-text `<div class="claudian-inline-markdown-fallback">` containing the raw markdown — the user always sees the agent's text, even if rendering fails.

This pipeline is used both for the `PreviewWidget` body above the diff and for the multi-turn clarification bubble inside the input container.

## Decorations

- `showDiff` and `showInsertion` both carry a `previewPos` plus `previewText`. The reducer composes a block `PreviewWidget` anchored at `previewPos` together with the diff/insertion widget at the selection span, so the markdown preview renders above the diff in document order.
- `previewPos` is always `doc.lineAt(this.selFrom).from` — the start of the line containing the selection. Anchoring to the line start (rather than `selFrom` itself) keeps the preview block widget out of the middle of the rendered line, which CodeMirror would otherwise treat as an inline break.
- `PreviewWidget.eq(other)` returns true when the rendered markdown string matches, so CodeMirror skips re-rendering the widget on no-op state updates.

## Gotchas

- Agent reply markdown rendering is async; UI updates run through a stale-render guard.
  - `agentReplyRenderVersion` is a monotonic counter on `InlineEditController`. Each call to `showAgentReply` increments it and captures a local `renderVersion` snapshot.
  - The `MarkdownRenderer.render` promise resolution checks both `renderVersion !== this.agentReplyRenderVersion` (a later render won) and `replyEl !== this.agentReplyEl` (the modal was torn down). Late resolutions discard themselves and never mutate the DOM.
  - The reply container is emptied and the `has-agent-reply` CSS class is added synchronously, so the layout slot is reserved even while the markdown is still rendering off-screen into a detached element.

- `replaceImageEmbedsWithHtml` accepts both a legacy positional `mediaFolder: string` and an options bag `{ mediaFolder?, sourcePath? }`. Only `inlineEditMarkdownPreview` threads `sourcePath` (the active note path) so wikilink-style `![[...]]` embeds resolve relative to the note being edited. `MessageRenderer` (chat) intentionally omits `sourcePath` because chat messages have no source note — they are rendered against the vault root, and the helper falls back to vault-root resolution when `sourcePath` is empty.

- The clarification path is provider-neutral. `InlineEditResult.clarification` is declared on the shared `InlineEditResult` in `src/core/providers/types.ts`; any provider can return it from `editText` or `continueConversation`, and the controller flips into a multi-turn `isConversing` state without provider-specific branching.

- Only one inline-edit session can exist at a time. The module-level `activeController` singleton guards this; opening a second modal calls `reject()` on the existing one and resolves the new caller with `{ decision: 'reject' }` immediately.

- Accept on plain Enter is wired through `installAcceptRejectHandler`, which attaches a document-level `keydown` listener after the diff/insertion is shown. It is distinct from the chat composer's Mod+Enter scope handler in `ClaudianView`; the two never collide because the chat handler requires the composer textarea to be `document.activeElement`, and the inline-edit handler is only installed while the modal owns focus.

- Cross-references: see `src/features/chat/CLAUDE.md` for the chat-side renderer that shares `replaceImageEmbedsWithHtml`, and the root `CLAUDE.md` for the per-provider capability matrix.
