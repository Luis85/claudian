# Work Order Handoff Chat Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render valid Agent Board work-order `<claudian_handoff>` blocks as compact expandable chat cards instead of raw XML-like text.

**Architecture:** Add a pure chat-facing handoff splitter, a focused card renderer, and a narrow `MessageRenderer` integration gated by task-run tab context. Persistence, provider transcripts, and task note handoff writing stay unchanged.

**Tech Stack:** TypeScript, Obsidian DOM helpers, existing `setupCollapsible`, Jest unit tests, modular CSS imported through `src/style/index.css`.

---

## Source Spec

- `docs/superpowers/specs/2026-06-06-work-order-handoff-chat-card-design.md`

## File Structure

- Create `src/features/chat/rendering/WorkOrderHandoffDisplay.ts`: pure parser/splitter for exactly one valid handoff block.
- Create `src/features/chat/rendering/WorkOrderHandoffCard.ts`: compact/expandable DOM card renderer.
- Modify `src/features/chat/rendering/MessageRenderer.ts`: render assistant text through the splitter when the tab has a work-order path.
- Modify `src/features/chat/tabs/types.ts`: add `workOrderPath?: string | null` to task-run tab data and options.
- Modify `src/features/chat/tabs/TabManager.ts`: store the work-order path on task-run tabs.
- Modify `src/features/chat/tabs/tabControllers.ts`: pass work-order context into `MessageRenderer`.
- Modify `src/features/chat/ClaudianView.ts`: accept `workOrderPath` in `startTaskRunInFreshTab`.
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

export function splitWorkOrderHandoffForDisplay(content: string): WorkOrderHandoffSegment[] | null {
  const matches = [...content.matchAll(HANDOFF_BLOCK_PATTERN)];
  if (matches.length !== 1) return null;

  const match = matches[0];
  if (match.index === undefined) return null;

  const rawBlock = match[0];
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

- [ ] **Step 3: Pass task-tab context into MessageRenderer**

In `src/features/chat/tabs/tabControllers.ts`, pass a seventh argument to `new MessageRenderer`:

```ts
    () => tab.workOrderPath ?? null,
```

The full call should end like this:

```ts
    () => getTabCapabilities(tab, plugin),
    () => tab.workOrderPath ?? null,
  );
```

- [ ] **Step 4: Add work-order path to the chat view task-run API**

In `src/features/chat/ClaudianView.ts`, add this option to `startTaskRunInFreshTab`:

```ts
    workOrderPath: string;
```

Pass it to `createTaskRunTab`:

```ts
    const tab = await this.tabManager.createTaskRunTab({
      providerId: options.providerId,
      model: options.model,
      workOrderPath: options.workOrderPath,
    });
```

- [ ] **Step 5: Pass task path from the execution surface**

In `src/features/tasks/execution/ChatTabExecutionSurface.ts`, add this property to the `view.startTaskRunInFreshTab` call:

```ts
      workOrderPath: task.path,
```

- [ ] **Step 6: Run typecheck to see the expected constructor failure**

Run:

```bash
npm run typecheck
```

Expected: FAIL because `MessageRenderer` does not yet accept the seventh constructor argument. Continue to Task 5 before committing.

---

### Task 5: Integrate handoff rendering into MessageRenderer and tests

**Files:**
- Modify: `src/features/chat/rendering/MessageRenderer.ts`
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
```

- [ ] **Step 5: Replace direct assistant text rendering**

In the `block.type === 'text'` branch, replace the direct `createDiv`/`renderContent`/`addTextCopyButton` lines with:

```ts
          this.renderAssistantTextBlock(contentEl, block.content);
```

In the fallback `if (msg.content)` branch, replace the direct `createDiv`/`renderContent`/`addTextCopyButton` lines with:

```ts
        this.renderAssistantTextBlock(contentEl, msg.content);
```

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
npm run test -- --selectProjects unit tests/unit/features/chat/rendering/WorkOrderHandoffDisplay.test.ts tests/unit/features/chat/rendering/MessageRenderer.test.ts --runInBand
npm run typecheck
```

Expected: both commands PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/chat/rendering/MessageRenderer.ts src/features/chat/tabs/types.ts src/features/chat/tabs/TabManager.ts src/features/chat/tabs/tabControllers.ts src/features/chat/ClaudianView.ts src/features/tasks/execution/ChatTabExecutionSurface.ts tests/unit/features/chat/rendering/MessageRenderer.test.ts
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
- Diff stat includes the spec, plan, helper, card renderer, `MessageRenderer`, task-tab context wiring, CSS, and tests.

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
Remaining risk: run one manual Obsidian Agent Board work order and expand/collapse the handoff card.
```
