---
title: Work Order Handoff Chat Card Implementation Plan
date: 2026-06-06
status: ready-for-review
scope: chat-rendering
parent: "[[2026-06-06-work-order-handoff-chat-card-design]]"
---

# Work Order Handoff Chat Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render valid Agent Board work-order `<claudian_handoff>` blocks as compact expandable chat cards instead of raw XML-like text.

**Architecture:** Add a pure chat-facing handoff splitter, a focused card renderer, and a narrow `MessageRenderer` integration gated by task-run tab context, applied on both the stored-replay path and a live streaming finalize hook so the card appears the moment a work-order run completes (not only after a reload). Persistence, provider transcripts, and task note handoff writing stay unchanged.

**Tech Stack:** TypeScript, Obsidian DOM helpers, existing `setupCollapsible`, Jest unit tests, modular CSS imported through `src/style/index.css`.

---

## Source Spec

- `docs/superpowers/specs/2026-06-06-work-order-handoff-chat-card-design.md`

## File Structure

- Create `src/features/chat/rendering/WorkOrderHandoffDisplay.ts`: pure parser/splitter for exactly one valid handoff block.
- Create `src/features/chat/rendering/WorkOrderHandoffCard.ts`: compact/expandable DOM card renderer.
- Modify `src/features/chat/rendering/MessageRenderer.ts`: render assistant text through the splitter when the tab has a work-order path, on both the stored-message path and a streaming finalize hook.
- Modify `src/features/chat/controllers/StreamController.ts`: route the live streamed finalize through the work-order handoff card so the card replaces the raw block when a run completes, not only on reload.
- Modify `src/features/chat/tabs/types.ts`: add `workOrderPath?: string | null` to task-run tab data and options.
- Modify `src/features/chat/tabs/TabManager.ts`: store the work-order path on task-run tabs.
- Modify `src/features/chat/tabs/tabControllers.ts`: pass work-order context into `MessageRenderer` (resolved from tab or persisted conversation) and wire the conversation-persistence accessor.
- Modify `src/features/chat/controllers/ConversationController.ts`: persist the work-order path onto `Conversation.workOrderPath` so the card survives reopen from history / restart.
- Modify `src/core/types/chat.ts`, `src/core/bootstrap/SessionStorage.ts`, and `src/app/conversations/ConversationStore.ts`: round-trip `workOrderPath` through persisted session metadata so the link survives a restart.
- Modify `src/features/chat/ClaudianView.ts`: accept an optional `workOrderPath` in `startTaskRunInFreshTab` (the commit-turn caller leaves it unset).
- Modify `src/features/tasks/execution/ChatTabExecutionSurface.ts`: pass `task.path` to the chat view.
- Create `src/style/features/work-order-handoff-card.css`: card styles.
- Modify `src/style/index.css`: import the new style module.
- Create `tests/unit/features/chat/rendering/WorkOrderHandoffDisplay.test.ts`: splitter tests.
- Modify `tests/unit/features/chat/rendering/MessageRenderer.test.ts`: renderer gating and card tests.
- Modify `docs/superpowers/specs/2026-06-06-work-order-handoff-chat-card-design.md`: set `status: approved`.

---

### Task 1: Commit the approved design status and this plan

**Files:**
- Modify: `docs/superpowers/specs/2026-06-06-work-order-handoff-chat-card-design.md:4`
- Create: `docs/superpowers/plans/2026-06-06-work-order-handoff-chat-card.md`

- [ ] **Step 1: Verify the design spec is marked approved**

Run:

```bash
grep -n "^status: approved$" docs/superpowers/specs/2026-06-06-work-order-handoff-chat-card-design.md
```

Expected:

```text
4:status: approved
```

- [ ] **Step 2: Verify the plan exists**

Run:

```bash
test -f docs/superpowers/plans/2026-06-06-work-order-handoff-chat-card.md
```

Expected: command exits 0.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-06-work-order-handoff-chat-card-design.md docs/superpowers/plans/2026-06-06-work-order-handoff-chat-card.md
git commit -m "docs: plan work order handoff chat card"
```

---

### Task 2: Add the pure handoff display splitter

**Files:**
- Create: `src/features/chat/rendering/WorkOrderHandoffDisplay.ts`
- Create: `tests/unit/features/chat/rendering/WorkOrderHandoffDisplay.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/features/chat/rendering/WorkOrderHandoffDisplay.test.ts` with this content:

```ts
import {
  HANDOFF_PREVIEW_MAX_CHARS,
  splitWorkOrderHandoffForDisplay,
  truncateHandoffPreview,
} from '@/features/chat/rendering/WorkOrderHandoffDisplay';

const VALID_HANDOFF = `<claudian_handoff>
summary: Implemented the chat card and kept persisted transcripts unchanged.
verification: npm run typecheck passed.
risks: Visual polish may need one manual Obsidian check.
next_action: Human should run one work order and expand the card.
</claudian_handoff>`;

describe('WorkOrderHandoffDisplay', () => {
  it('splits a valid single handoff block with surrounding markdown', () => {
    const result = splitWorkOrderHandoffForDisplay(`Before text.\n\n${VALID_HANDOFF}\n\nAfter text.`);

    expect(result).toHaveLength(3);
    expect(result?.[0]).toEqual({ type: 'markdown', content: 'Before text.' });
    expect(result?.[1]).toMatchObject({
      type: 'handoff',
      preview: 'Implemented the chat card and kept persisted transcripts unchanged.',
      handoff: {
        summary: 'Implemented the chat card and kept persisted transcripts unchanged.',
        verification: 'npm run typecheck passed.',
        risks: 'Visual polish may need one manual Obsidian check.',
        nextAction: 'Human should run one work order and expand the card.',
      },
    });
    expect(result?.[2]).toEqual({ type: 'markdown', content: 'After text.' });
  });

  it('returns only a handoff segment when there is no surrounding markdown', () => {
    const result = splitWorkOrderHandoffForDisplay(VALID_HANDOFF);

    expect(result).toHaveLength(1);
    expect(result?.[0].type).toBe('handoff');
  });

  it('returns null for malformed handoff content', () => {
    const result = splitWorkOrderHandoffForDisplay(`<claudian_handoff>
summary: Missing fields
</claudian_handoff>`);

    expect(result).toBeNull();
  });

  it('returns null when no handoff block is present', () => {
    expect(splitWorkOrderHandoffForDisplay('plain assistant response')).toBeNull();
  });

  it('returns null when multiple handoff blocks are present', () => {
    const result = splitWorkOrderHandoffForDisplay(`${VALID_HANDOFF}\n${VALID_HANDOFF}`);

    expect(result).toBeNull();
  });

  it('returns null when a required field is repeated', () => {
    const result = splitWorkOrderHandoffForDisplay(`<claudian_handoff>
summary: First summary.
summary: Second summary.
verification: npm run test passed.
risks: No known risks.
next_action: Review the result.
</claudian_handoff>`);

    expect(result).toBeNull();
  });

  it('returns null when handoff delimiters are unmatched or nested', () => {
    const result = splitWorkOrderHandoffForDisplay(`<claudian_handoff> stray
<claudian_handoff>
summary: Finished the work.
verification: npm run test passed.
risks: No known risks.
next_action: Review the result.
</claudian_handoff>`);

    expect(result).toBeNull();
  });

  it('normalizes and truncates long summary previews', () => {
    const preview = truncateHandoffPreview(`${'word '.repeat(60)}final`);

    expect(preview.length).toBeLessThanOrEqual(HANDOFF_PREVIEW_MAX_CHARS);
    expect(preview.endsWith('…')).toBe(true);
    expect(preview).not.toContain('  ');
  });

  it('keeps short summary previews unchanged after whitespace normalization', () => {
    expect(truncateHandoffPreview('short\nsummary')).toBe('short summary');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- --selectProjects unit tests/unit/features/chat/rendering/WorkOrderHandoffDisplay.test.ts
```

Expected: FAIL because `WorkOrderHandoffDisplay` does not exist.

- [ ] **Step 3: Implement the splitter**

Create `src/features/chat/rendering/WorkOrderHandoffDisplay.ts` with this content:

```ts
import { parseTaskHandoff } from '../../tasks/execution/TaskHandoffParser';
import type { ParsedHandoff } from '../../tasks/model/taskTypes';

export const HANDOFF_PREVIEW_MAX_CHARS = 160;

export interface WorkOrderHandoffDisplaySegment {
  type: 'handoff';
  handoff: ParsedHandoff;
  preview: string;
}

export interface WorkOrderMarkdownDisplaySegment {
  type: 'markdown';
  content: string;
}

export type WorkOrderHandoffSegment =
  | WorkOrderMarkdownDisplaySegment
  | WorkOrderHandoffDisplaySegment;

const HANDOFF_BLOCK_PATTERN = /<claudian_handoff>\s*[\s\S]*?\s*<\/claudian_handoff>/g;
const REQUIRED_HANDOFF_LABELS = ['summary', 'verification', 'risks', 'next_action'] as const;

export function splitWorkOrderHandoffForDisplay(content: string): WorkOrderHandoffSegment[] | null {
  // Reject unmatched or nested delimiters before matching: a stray opening tag
  // before the real block would otherwise be swallowed by the single-block
  // regex and hidden behind a card instead of failing open.
  const openCount = (content.match(/<claudian_handoff>/g) ?? []).length;
  const closeCount = (content.match(/<\/claudian_handoff>/g) ?? []).length;
  if (openCount !== 1 || closeCount !== 1) return null;

  const matches = [...content.matchAll(HANDOFF_BLOCK_PATTERN)];
  if (matches.length !== 1) return null;

  const match = matches[0];
  if (match.index === undefined) return null;

  const rawBlock = match[0];
  // The shared task parser keeps last-wins on duplicate labels; reject ambiguous
  // blocks here so a repeated required field fails open to the raw transcript
  // instead of silently hiding content behind a card.
  if (hasDuplicateHandoffField(rawBlock)) return null;
  const parsed = parseTaskHandoff(rawBlock);
  if (!parsed.ok) return null;

  const before = content.slice(0, match.index).trim();
  const after = content.slice(match.index + rawBlock.length).trim();
  const segments: WorkOrderHandoffSegment[] = [];

  if (before) segments.push({ type: 'markdown', content: before });
  segments.push({
    type: 'handoff',
    handoff: parsed.handoff,
    preview: truncateHandoffPreview(parsed.handoff.summary),
  });
  if (after) segments.push({ type: 'markdown', content: after });

  return segments;
}

function hasDuplicateHandoffField(block: string): boolean {
  return REQUIRED_HANDOFF_LABELS.some((label) => {
    const matches = block.match(new RegExp(`^${label}:`, 'gm'));
    return (matches?.length ?? 0) > 1;
  });
}

export function truncateHandoffPreview(
  summary: string,
  maxLength = HANDOFF_PREVIEW_MAX_CHARS,
): string {
  const normalized = summary.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run test -- --selectProjects unit tests/unit/features/chat/rendering/WorkOrderHandoffDisplay.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/rendering/WorkOrderHandoffDisplay.ts tests/unit/features/chat/rendering/WorkOrderHandoffDisplay.test.ts
git commit -m "feat: split work order handoffs for chat display"
```

---

### Task 3: Add the expandable handoff card renderer

**Files:**
- Create: `src/features/chat/rendering/WorkOrderHandoffCard.ts`

- [ ] **Step 1: Create the card renderer**

Create `src/features/chat/rendering/WorkOrderHandoffCard.ts` with this content:

```ts
import { setIcon } from 'obsidian';

import { setupCollapsible, type CollapsibleState } from './collapsible';
import type { RenderContentFn } from './MessageRenderer';
import type { WorkOrderHandoffDisplaySegment } from './WorkOrderHandoffDisplay';

export function renderWorkOrderHandoffCard(
  parentEl: HTMLElement,
  segment: WorkOrderHandoffDisplaySegment,
  renderMarkdown: RenderContentFn,
): void {
  const wrapper = parentEl.createDiv({ cls: 'claudian-work-order-handoff-card' });
  const header = wrapper.createDiv({
    cls: 'claudian-work-order-handoff-card-header',
    attr: { role: 'button', tabindex: '0' },
  });

  const icon = header.createSpan({ cls: 'claudian-work-order-handoff-card-icon' });
  setIcon(icon, 'clipboard-check');

  const main = header.createDiv({ cls: 'claudian-work-order-handoff-card-main' });
  main.createDiv({ cls: 'claudian-work-order-handoff-card-title', text: 'Work order handoff' });
  main.createDiv({ cls: 'claudian-work-order-handoff-card-preview', text: segment.preview });

  const expandLabel = header.createSpan({
    cls: 'claudian-work-order-handoff-card-toggle',
    text: 'Expand',
  });

  const chips = wrapper.createDiv({ cls: 'claudian-work-order-handoff-card-chips' });
  chips.createSpan({ cls: 'claudian-work-order-handoff-card-chip', text: 'Verification' });
  chips.createSpan({ cls: 'claudian-work-order-handoff-card-chip', text: 'Risks' });
  chips.createSpan({ cls: 'claudian-work-order-handoff-card-chip', text: 'Next Action' });

  const details = wrapper.createDiv({ cls: 'claudian-work-order-handoff-card-details' });
  renderSection(details, 'Summary', segment.handoff.summary, renderMarkdown);
  renderSection(details, 'Verification', segment.handoff.verification, renderMarkdown);
  renderSection(details, 'Risks', segment.handoff.risks, renderMarkdown);
  renderSection(details, 'Next Action', segment.handoff.nextAction, renderMarkdown);

  const state: CollapsibleState = { isExpanded: false };
  setupCollapsible(wrapper, header, details, state, {
    baseAriaLabel: 'Work order handoff',
    onToggle: (isExpanded) => expandLabel.setText(isExpanded ? 'Collapse' : 'Expand'),
  });
}

function renderSection(
  parentEl: HTMLElement,
  title: string,
  markdown: string,
  renderMarkdown: RenderContentFn,
): void {
  const section = parentEl.createDiv({ cls: 'claudian-work-order-handoff-card-section' });
  section.createDiv({ cls: 'claudian-work-order-handoff-card-section-title', text: title });
  const body = section.createDiv({ cls: 'claudian-work-order-handoff-card-section-body' });
  void renderMarkdown(body, markdown);
}
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/chat/rendering/WorkOrderHandoffCard.ts
git commit -m "feat: add work order handoff card renderer"
```

---

### Task 4: Thread work-order context from Agent Board tabs into the renderer

**Files:**
- Modify: `src/features/chat/tabs/types.ts`
- Modify: `src/features/chat/tabs/TabManager.ts`
- Modify: `src/features/chat/tabs/tabControllers.ts`
- Modify: `src/features/chat/controllers/ConversationController.ts`
- Modify: `src/core/types/chat.ts`
- Modify: `src/core/bootstrap/SessionStorage.ts`
- Modify: `src/app/conversations/ConversationStore.ts`
- Modify: `src/features/chat/ClaudianView.ts`
- Modify: `src/features/tasks/execution/ChatTabExecutionSurface.ts`

- [ ] **Step 1: Add tab and API types**

In `src/features/chat/tabs/types.ts`, add this property to `TabData` after `pinnedModel?: string | null;`:

```ts
  /** Vault-relative work-order note path when this tab hosts an Agent Board run. */
  workOrderPath?: string | null;
```

In the same file, change `TabManagerInterface.createTaskRunTab` options to include:

```ts
    workOrderPath?: string | null;
```

- [ ] **Step 2: Store work-order path on task-run tabs**

In `src/features/chat/tabs/TabManager.ts`, change the `createTaskRunTab` options type to include:

```ts
    workOrderPath?: string | null;
```

Replace the return statement in `createTaskRunTab` with:

```ts
    const tab = await this.createTab(options.conversationId ?? undefined, undefined, {
      activate: false,
      draftModel: options.model,
      pinnedModel: options.model,
      defaultProviderId: options.providerId,
    });
    if (tab) {
      tab.workOrderPath = options.workOrderPath ?? null;
    }
    return tab;
```

- [ ] **Step 3: Pass task-tab context into MessageRenderer (durable across reopen)**

In `src/features/chat/tabs/tabControllers.ts`, pass a seventh argument to `new MessageRenderer` that resolves the work-order path from the transient tab first, then the persisted conversation — so the gate still fires when a saved work-order conversation is reopened through `createTab` (history / restart), not only on a fresh `createTaskRunTab`:

```ts
    () =>
      tab.workOrderPath
      ?? (tab.conversationId
        ? plugin.getConversationSync(tab.conversationId)?.workOrderPath ?? null
        : null),
```

The full call should end like this:

```ts
    () => getTabCapabilities(tab, plugin),
    () =>
      tab.workOrderPath
      ?? (tab.conversationId
        ? plugin.getConversationSync(tab.conversationId)?.workOrderPath ?? null
        : null),
  );
```

Also clear the transient tab path when the tab (re)binds a different conversation, so a task-run tab that later opens an unrelated conversation in place does not keep treating it as a work-order chat — and so the Step 4 save accessor cannot write the stale path onto the wrong conversation. In `src/features/chat/tabs/tabControllers.ts`, set `tab.workOrderPath = null` in the `ConversationController` `ensureServiceForConversation` callback (where `tab.conversationId` is reassigned on load/switch) and in `onNewConversation`. A fresh run creates its conversation lazily through `save()` rather than those callbacks, so the run's path survives until its first save persists it; once any conversation is bound, the durable `Conversation.workOrderPath` becomes the source of truth.

- [ ] **Step 4: Persist the work-order path on the conversation (durably, across restart)**

`tab.workOrderPath` is set only by `createTaskRunTab`, so reopening a saved run (which uses `createTab`) would lose it and re-render the raw block. Persist it on the durable conversation through the existing save chokepoint — `Conversation.workOrderPath` already exists in the model and is otherwise unused.

In `src/features/chat/controllers/ConversationController.ts`, add an accessor to `ConversationControllerDeps`:

```ts
  getWorkOrderPath?: () => string | null;
```

In `save()`, include it in the `updates` object. It is a `Partial<Conversation>`, so a `null` from a normal tab omits the key and leaves any stored value intact:

```ts
    const updates: Partial<Conversation> = {
      ...sessionUpdates,
      messages: state.messages,
      currentNote: currentNote,
      externalContextPaths: externalContextPaths.length > 0 ? externalContextPaths : undefined,
      usage: state.usage ?? undefined,
      enabledMcpServers: enabledMcpServers.length > 0 ? enabledMcpServers : undefined,
      ...(this.deps.getWorkOrderPath?.() ? { workOrderPath: this.deps.getWorkOrderPath()! } : {}),
    };
```

In `src/features/chat/tabs/tabControllers.ts`, wire the accessor where `ConversationController` is constructed (add to its deps object):

```ts
      getWorkOrderPath: () => tab.workOrderPath ?? null,
```

The first save of a run writes `task.path` onto the conversation, so the stored-replay path re-derives the card after reopen. Verify by asserting `plugin.updateConversation` receives `workOrderPath` when the accessor returns a path (extend the existing `ConversationController` save coverage).

Saving the in-memory conversation is not enough for the **restart** case — the durable session-metadata layer must round-trip the field too. `SessionMetadata` already declares `workOrderPath` (drop the stale "In-memory only" note in `src/core/types/chat.ts`), but the serializer and hydrator skip it.

In `src/core/bootstrap/SessionStorage.ts`, add it to the object returned by `toSessionMetadata()`:

```ts
      resumeAtMessageId: conversation.resumeAtMessageId,
      workOrderPath: conversation.workOrderPath,
    };
```

In `src/app/conversations/ConversationStore.ts`, hydrate it back in the `loadConversations()` mapping:

```ts
      resumeAtMessageId: meta.resumeAtMessageId,
      workOrderPath: meta.workOrderPath,
    } satisfies Conversation;
```

Now `plugin.getConversationSync(...)?.workOrderPath` survives a reload/restart, so a reopened work-order conversation still re-renders the card. (`saveMetadata`/`loadMetadata` serialize the whole `SessionMetadata` as JSON, so no further wiring is needed.)

- [ ] **Step 5: Add work-order path to the chat view task-run API**

In `src/features/chat/ClaudianView.ts`, add this **optional** option to `startTaskRunInFreshTab`:

```ts
    workOrderPath?: string;
```

Keep it optional. `startTaskRunInFreshTab` has a second caller inside `injectCommitTurnForConversation` (the commit-turn fallback) that has no work-order note path to pass; a required field there would break typecheck. The common commit turn already reuses the original run's tab (which carries `workOrderPath` from creation), so only the rare fresh-tab fallback resolves to a normal, non-work-order tab — which is correct.

Pass it to `createTaskRunTab`:

```ts
    const tab = await this.tabManager.createTaskRunTab({
      providerId: options.providerId,
      model: options.model,
      workOrderPath: options.workOrderPath,
    });
```

- [ ] **Step 6: Pass task path from the execution surface**

In `src/features/tasks/execution/ChatTabExecutionSurface.ts`, add this property to the `view.startTaskRunInFreshTab` call:

```ts
      workOrderPath: task.path,
```

- [ ] **Step 7: Run typecheck to see the expected constructor failure**

Run:

```bash
npm run typecheck
```

Expected: FAIL only because `MessageRenderer` does not yet accept the seventh constructor argument. (The optional `workOrderPath` keeps both `startTaskRunInFreshTab` callers compiling, so there is no second error.) Continue to Task 5 before committing.

---

### Task 5: Integrate handoff rendering into MessageRenderer and tests

**Files:**
- Modify: `src/features/chat/rendering/MessageRenderer.ts`
- Modify: `src/features/chat/controllers/StreamController.ts`
- Modify: `tests/unit/features/chat/rendering/MessageRenderer.test.ts`

- [ ] **Step 1: Add renderer tests**

In `tests/unit/features/chat/rendering/MessageRenderer.test.ts`, update `createRenderer` to accept `isWorkOrderTab = false` and pass this seventh constructor argument:

```ts
      () => isWorkOrderTab ? 'docs/work-orders/example.md' : null,
```

Add these tests inside the `renderAssistantContent` section:

```ts
  it('renders a valid work-order handoff as a collapsed card', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'claude', true);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const handoff = `<claudian_handoff>
summary: Finished the work.
verification: npm run test passed.
risks: No known risks.
next_action: Review the result.
</claudian_handoff>`;

    renderer.renderStoredMessage({
      id: 'a-handoff',
      role: 'assistant',
      content: `Intro text.\n\n${handoff}\n\nClosing text.`,
      timestamp: Date.now(),
    });

    expect(messagesEl.querySelector('.claudian-work-order-handoff-card')).not.toBeNull();
    expect(messagesEl.textContent).toContain('Work order handoff');
    expect(messagesEl.textContent).toContain('Finished the work.');
    expect(messagesEl.textContent).not.toContain('<claudian_handoff>');
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Intro text.');
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Closing text.');
  });

  it('expands the handoff card to reveal formatted sections', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'claude', true);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    renderer.renderStoredMessage({
      id: 'a-handoff-expanded',
      role: 'assistant',
      content: `<claudian_handoff>
summary: Finished the work.
verification: npm run test passed.
risks: No known risks.
next_action: Review the result.
</claudian_handoff>`,
      timestamp: Date.now(),
    });

    const header = messagesEl.querySelector('.claudian-work-order-handoff-card-header') as any;
    const details = messagesEl.querySelector('.claudian-work-order-handoff-card-details');
    expect(details?.hasClass('claudian-hidden')).toBe(true);

    header._eventListeners.get('click')[0]();

    expect(details?.hasClass('claudian-hidden')).toBe(false);
    expect(messagesEl.textContent).toContain('Summary');
    expect(messagesEl.textContent).toContain('Verification');
    expect(messagesEl.textContent).toContain('Risks');
    expect(messagesEl.textContent).toContain('Next Action');
  });

  it('renders valid handoff text unchanged outside work-order tabs', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'claude', false);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const handoff = `<claudian_handoff>
summary: Finished the work.
verification: npm run test passed.
risks: No known risks.
next_action: Review the result.
</claudian_handoff>`;

    renderer.renderStoredMessage({ id: 'a-normal', role: 'assistant', content: handoff, timestamp: Date.now() });

    expect(messagesEl.querySelector('.claudian-work-order-handoff-card')).toBeNull();
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), handoff);
  });

  it('renders malformed work-order handoff text unchanged', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'claude', true);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const malformed = `<claudian_handoff>\nsummary: Missing fields\n</claudian_handoff>`;

    renderer.renderStoredMessage({ id: 'a-bad', role: 'assistant', content: malformed, timestamp: Date.now() });

    expect(messagesEl.querySelector('.claudian-work-order-handoff-card')).toBeNull();
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), malformed);
  });

  it('swaps a streamed work-order handoff text block for a card on finalize', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'claude', true);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const contentEl = messagesEl.createDiv({ cls: 'claudian-message-content' });
    const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });

    const replaced = renderer.finalizeStreamedAssistantText(contentEl, textEl, `<claudian_handoff>
summary: Finished the work.
verification: npm run test passed.
risks: No known risks.
next_action: Review the result.
</claudian_handoff>`);

    expect(replaced).toBe(true);
    expect(contentEl.querySelector('.claudian-work-order-handoff-card')).not.toBeNull();
    expect(messagesEl.textContent).not.toContain('<claudian_handoff>');
  });

  it('leaves a streamed text block untouched outside work-order tabs', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'claude', false);
    const contentEl = messagesEl.createDiv({ cls: 'claudian-message-content' });
    const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });

    const replaced = renderer.finalizeStreamedAssistantText(contentEl, textEl, `<claudian_handoff>
summary: Finished the work.
verification: npm run test passed.
risks: No known risks.
next_action: Review the result.
</claudian_handoff>`);

    expect(replaced).toBe(false);
    expect(contentEl.querySelector('.claudian-work-order-handoff-card')).toBeNull();
  });

  it('keeps registered message actions reachable on a handoff-only card', () => {
    const messagesEl = createMockEl();
    const run = jest.fn();
    const action: ChatMessageAction = {
      id: 'create-wo',
      label: 'Create work order',
      icon: 'plus',
      isEligible: () => true,
      run,
    };
    const renderer = new MessageRenderer(
      mockRendererPlugin({ chatMessageActions: [action] }) as any,
      createMockComponent() as any,
      messagesEl,
      undefined,
      undefined,
      mockCapabilities('claude'),
      () => 'docs/work-orders/example.md',
    );
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    renderer.renderStoredMessage({
      id: 'a-handoff-actions',
      role: 'assistant',
      content: `<claudian_handoff>
summary: Finished the work.
verification: npm run test passed.
risks: No known risks.
next_action: Review the result.
</claudian_handoff>`,
      timestamp: Date.now(),
    });

    const card = messagesEl.querySelector('.claudian-work-order-handoff-card');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.claudian-text-actions')).not.toBeNull();
    expect(messagesEl.querySelector('.claudian-text-action-btn')).not.toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- --selectProjects unit tests/unit/features/chat/rendering/MessageRenderer.test.ts --runInBand
```

Expected: FAIL because `MessageRenderer` does not yet transform handoff blocks.

- [ ] **Step 3: Add MessageRenderer imports and constructor callback**

In `src/features/chat/rendering/MessageRenderer.ts`, add:

```ts
import { renderWorkOrderHandoffCard } from './WorkOrderHandoffCard';
import {
  splitWorkOrderHandoffForDisplay,
  type WorkOrderHandoffSegment,
} from './WorkOrderHandoffDisplay';
```

Add this private field near `private getCapabilities`:

```ts
  private getWorkOrderPath: () => string | null | undefined;
```

Change the constructor to accept:

```ts
    getCapabilities?: () => ProviderCapabilities,
    getWorkOrderPath?: () => string | null | undefined,
  ) {
```

Add this assignment after `this.getCapabilities = ...`:

```ts
    this.getWorkOrderPath = getWorkOrderPath ?? (() => null);
```

- [ ] **Step 4: Add assistant text rendering helpers**

Add these methods above `private renderAssistantContent`:

```ts
  private renderAssistantTextBlock(contentEl: HTMLElement, markdown: string): void {
    const handoffSegments = this.getWorkOrderPath()
      ? splitWorkOrderHandoffForDisplay(markdown)
      : null;

    if (!handoffSegments) {
      this.renderPlainAssistantTextBlock(contentEl, markdown);
      return;
    }

    for (const segment of handoffSegments) {
      this.renderAssistantDisplaySegment(contentEl, segment);
    }
  }

  private renderPlainAssistantTextBlock(contentEl: HTMLElement, markdown: string): void {
    const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
    void this.renderContent(textEl, markdown);
    this.addTextCopyButton(textEl, markdown);
  }

  private renderAssistantDisplaySegment(contentEl: HTMLElement, segment: WorkOrderHandoffSegment): void {
    if (segment.type === 'markdown') {
      this.renderPlainAssistantTextBlock(contentEl, segment.content);
      return;
    }

    renderWorkOrderHandoffCard(contentEl, segment, (el, md, options) => this.renderContent(el, md, options));
  }

  /**
   * Streaming finalize hook: when a work-order run's final text block holds a
   * complete handoff, drop the raw text element and render the compact card (plus
   * any surrounding markdown) in its place. Returns true when it replaced the
   * block; no-ops (returns false) outside work-order tabs or without a valid
   * single handoff, leaving the caller to keep the raw text block. The stored
   * `text` content block is untouched, so persistence and reload stay unchanged.
   */
  finalizeStreamedAssistantText(
    contentEl: HTMLElement,
    textEl: HTMLElement,
    markdown: string,
  ): boolean {
    if (!this.getWorkOrderPath()) return false;
    const segments = splitWorkOrderHandoffForDisplay(markdown);
    if (!segments) return false;

    textEl.remove();
    for (const segment of segments) {
      this.renderAssistantDisplaySegment(contentEl, segment);
    }
    return true;
  }
```

- [ ] **Step 5: Replace direct assistant text rendering and keep message actions reachable**

In the `block.type === 'text'` branch, replace the direct `createDiv`/`renderContent`/`addTextCopyButton` lines with:

```ts
          this.renderAssistantTextBlock(contentEl, block.content);
```

In the fallback `if (msg.content)` branch, replace the direct `createDiv`/`renderContent`/`addTextCopyButton` lines with:

```ts
        this.renderAssistantTextBlock(contentEl, msg.content);
```

Finally, in `addAssistantMessageActions`, make the action anchor fall back to the handoff card so a handoff-only message (which renders no `.claudian-text-block`) still surfaces registered actions. Replace:

```ts
    const textBlocks = msgEl.querySelectorAll('.claudian-text-block');
    const lastTextBlock = textBlocks.length > 0
      ? (textBlocks[textBlocks.length - 1] as HTMLElement)
      : null;
    if (!lastTextBlock) return;

    const container = lastTextBlock.createDiv({ cls: 'claudian-text-actions' });
```

with:

```ts
    const textBlocks = msgEl.querySelectorAll('.claudian-text-block');
    const anchorEl = textBlocks.length > 0
      ? (textBlocks[textBlocks.length - 1] as HTMLElement)
      // A handoff-only assistant message renders as a card with no text block;
      // anchor actions to the card so they stay reachable in work-order tabs.
      : msgEl.querySelector<HTMLElement>('.claudian-work-order-handoff-card');
    if (!anchorEl) return;

    const container = anchorEl.createDiv({ cls: 'claudian-text-actions' });
```

- [ ] **Step 6: Route the live streaming finalize through the card**

The streamed run-completion path renders text directly into the live element and never re-enters `renderAssistantContent`, so without this step the card would only appear after a conversation reload (the main UX this plan fixes). In `src/features/chat/controllers/StreamController.ts`, update `finalizeCurrentTextBlock` so it swaps a finished work-order handoff for the card. Replace the copy-button block:

```ts
      // Copy button added here (not during streaming) to match history-loaded messages
      if (state.currentTextEl) {
        renderer.addTextCopyButton(state.currentTextEl, state.currentTextContent);
      }
```

with:

```ts
      // Work-order tabs swap a completed handoff block for the compact card on
      // finalize; everything else keeps the raw text block plus copy button.
      const replacedWithCard =
        state.currentContentEl && state.currentTextEl
          ? renderer.finalizeStreamedAssistantText(
              state.currentContentEl,
              state.currentTextEl,
              state.currentTextContent,
            )
          : false;
      // Copy button added here (not during streaming) to match history-loaded messages
      if (state.currentTextEl && !replacedWithCard) {
        renderer.addTextCopyButton(state.currentTextEl, state.currentTextContent);
      }
      // The card swap removed the text block that registered actions anchor to;
      // re-anchor them onto the card so a freshly completed run keeps actions
      // (e.g. Create work order) without waiting for a reload.
      if (replacedWithCard && msg) {
        renderer.refreshMessageActions(msg);
      }
```

The raw text is still pushed to `msg.contentBlocks` just above this block, so persisted history and reload are unchanged — only the live DOM is transformed. Because the swap removes the text block that `addAssistantMessageActions` anchors to, the hook also re-anchors registered actions onto the card through `refreshMessageActions`; the stored-replay path gets the same result via the Step 5 fallback.

- [ ] **Step 7: Run focused tests and typecheck**

Run:

```bash
npm run test -- --selectProjects unit tests/unit/features/chat/rendering/WorkOrderHandoffDisplay.test.ts tests/unit/features/chat/rendering/MessageRenderer.test.ts --runInBand
npm run typecheck
```

Expected: both commands PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/chat/rendering/MessageRenderer.ts src/features/chat/controllers/StreamController.ts src/features/chat/controllers/ConversationController.ts src/core/types/chat.ts src/core/bootstrap/SessionStorage.ts src/app/conversations/ConversationStore.ts src/features/chat/tabs/types.ts src/features/chat/tabs/TabManager.ts src/features/chat/tabs/tabControllers.ts src/features/chat/ClaudianView.ts src/features/tasks/execution/ChatTabExecutionSurface.ts tests/unit/features/chat/rendering/MessageRenderer.test.ts
git commit -m "feat: render work order handoffs as chat cards"
```

---

### Task 6: Add card styling

**Files:**
- Create: `src/style/features/work-order-handoff-card.css`
- Modify: `src/style/index.css`

- [ ] **Step 1: Create CSS module**

Create `src/style/features/work-order-handoff-card.css` with this content:

```css
.claudian-work-order-handoff-card {
  /* Positioning context for card-anchored `.claudian-text-actions` (absolute). */
  position: relative;
  margin: 8px 0;
  padding: 8px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  background: var(--background-secondary);
  font-size: var(--font-ui-small);
}

.claudian-work-order-handoff-card-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
  outline: none;
}

.claudian-work-order-handoff-card-header:focus-visible {
  box-shadow: 0 0 0 2px var(--background-modifier-border-focus);
  border-radius: 6px;
}

.claudian-work-order-handoff-card-icon {
  display: inline-flex;
  color: var(--text-muted);
  width: 16px;
  height: 16px;
  margin-top: 2px;
  flex: 0 0 auto;
}

.claudian-work-order-handoff-card-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.claudian-work-order-handoff-card-title {
  color: var(--text-normal);
  font-weight: 600;
}

.claudian-work-order-handoff-card-preview {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.claudian-work-order-handoff-card-toggle {
  color: var(--text-accent);
  font-size: var(--font-ui-smaller);
  white-space: nowrap;
  margin-top: 1px;
}

.claudian-work-order-handoff-card-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.claudian-work-order-handoff-card-chip {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--background-modifier-hover);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

/* The chips are a collapsed-state affordance; hide them once expanded so they
   do not duplicate the section headers (setupCollapsible adds `expanded`). */
.claudian-work-order-handoff-card.expanded .claudian-work-order-handoff-card-chips {
  display: none;
}

.claudian-work-order-handoff-card-details {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--background-modifier-border);
}

.claudian-work-order-handoff-card-section + .claudian-work-order-handoff-card-section {
  margin-top: 10px;
}

.claudian-work-order-handoff-card-section-title {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  margin-bottom: 3px;
}

.claudian-work-order-handoff-card-section-body {
  color: var(--text-normal);
}

/* Handoff-only messages anchor `.claudian-text-actions` under the card instead
   of a `.claudian-text-block`. That shared element is opacity:0 and is only
   revealed by `.claudian-text-block:hover` in messages.css, so reveal it on card
   hover/focus here too — otherwise actions like "Create work order" stay hidden. */
.claudian-work-order-handoff-card:hover .claudian-text-actions,
.claudian-work-order-handoff-card:focus-within .claudian-text-actions {
  opacity: 1;
}
```

- [ ] **Step 2: Import CSS module**

In `src/style/index.css`, add this line after `@import "./features/context-card.css";`:

```css
@import "./features/work-order-handoff-card.css";
```

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/style/features/work-order-handoff-card.css src/style/index.css
git commit -m "style: add work order handoff chat card"
```

---

### Task 7: Final verification and PR handoff

**Files:**
- No file edits unless a verification command fails.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run typecheck
npm run lint
npm run test -- --selectProjects unit
npm run build
```

Expected:

- `npm run typecheck` exits 0.
- `npm run lint` exits 0.
- `npm run test -- --selectProjects unit` exits 0.
- `npm run build` exits 0.

- [ ] **Step 2: Inspect final branch state**

Run:

```bash
git status --short
git log --oneline --decorate -8
git diff origin/main...HEAD --stat
```

Expected:

- `git status --short` prints no file changes.
- `git log` shows this plan plus implementation commits on `spec/work-order-handoff-chat-card`.
- Diff stat includes the spec, plan, helper, card renderer, `MessageRenderer`, the `StreamController` finalize hook, `ConversationController` work-order-path persistence, the session-metadata round-trip (`SessionStorage` + `ConversationStore` + `chat.ts`), task-tab context wiring, CSS, and tests.

- [ ] **Step 3: Push the branch**

Run:

```bash
git push -u origin spec/work-order-handoff-chat-card
```

Expected: branch pushes successfully.

- [ ] **Step 4: Open a draft PR**

Run:

```bash
gh pr create --fill --draft --base main --head spec/work-order-handoff-chat-card
```

Expected: command prints a GitHub draft PR URL.

- [ ] **Step 5: Report handoff**

Report these fields:

```text
PR URL: paste the URL printed by `gh pr create`
Branch: spec/work-order-handoff-chat-card
Commit: paste the SHA printed by `git rev-parse HEAD`
Verification: typecheck, lint, unit tests, build
Remaining risk: run one manual Obsidian Agent Board work order and confirm the card appears the moment the run completes (live), then reopen the conversation from history (and after a restart) to confirm it re-renders as a card, and expand/collapse it.
```
