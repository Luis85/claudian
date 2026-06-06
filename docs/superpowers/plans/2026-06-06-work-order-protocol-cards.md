---
title: Work-order protocol cards (progress / needs_input / needs_approval)
date: 2026-06-06
status: done
scope: features/chat
parent: "[[Agent Kanban Board]]"
---

# Work-Order Protocol Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw `<claudian_progress>`, `<claudian_needs_input>`, and `<claudian_needs_approval>` XML in work-order chat tabs with compact visual cards, matching the existing `<claudian_handoff>` card pattern.

**Architecture:** Generalize `splitWorkOrderHandoffForDisplay` into `splitWorkOrderProtocolForDisplay`, which returns a discriminated union of `markdown | progress | needs_input | needs_approval | handoff` segments. Add three new card renderers under `src/features/chat/rendering/` and one CSS module. `MessageRenderer.renderAssistantTextBlock` and `finalizeStreamedAssistantText` dispatch each segment to the matching card. Cards are scoped to work-order tabs only (gated by `getWorkOrderPath()`), so general chat is untouched.

**Tech Stack:** TypeScript, Obsidian Plugin API (`setIcon`), existing `setupCollapsible` helper, project CSS variables.

---

## Scope Check

This plan covers only the chat-side rendering of protocol blocks. It does NOT change:
- The protocol semantics (parser in `RunSession`, pause flow, ledger entries).
- The handoff card visuals — only the splitter is generalized; the existing handoff card keeps the same DOM/CSS.
- The `InlineAskUserQuestion` / `InlinePlanApproval` cards (those are provider-driven, not protocol-XML-driven).

## File Structure

- **Create** `src/features/chat/rendering/WorkOrderProtocolDisplay.ts` — generalized splitter. Re-exports `WorkOrderHandoffSegment` (renamed `WorkOrderProtocolSegment`) and adds `progress | needs_input | needs_approval` variants.
- **Create** `src/features/chat/rendering/WorkOrderProgressCard.ts` — compact inline card (icon · step · done/total · slim progress bar).
- **Create** `src/features/chat/rendering/WorkOrderNeedsInputCard.ts` — collapsible card (question + optional `why` + optional `default`).
- **Create** `src/features/chat/rendering/WorkOrderNeedsApprovalCard.ts` — collapsible card (action + optional `risk` + reversibility chip).
- **Create** `src/style/features/work-order-protocol-cards.css` — styles for the three new cards.
- **Modify** `src/style/index.css` — register the new CSS module.
- **Modify** `src/features/chat/rendering/WorkOrderHandoffDisplay.ts` — thin shim that re-exports from `WorkOrderProtocolDisplay.ts` for backward compatibility, then delete in Task 8.
- **Modify** `src/features/chat/rendering/MessageRenderer.ts` — call `splitWorkOrderProtocolForDisplay`; dispatch each segment to its card; `finalizeStreamedAssistantText` mirrors the dispatch.
- **Create** tests:
  - `tests/unit/features/chat/rendering/WorkOrderProtocolDisplay.test.ts` — splitter coverage for each block type, mixed text, multiples, malformed.
  - `tests/unit/features/chat/rendering/WorkOrderProgressCard.test.ts` — renders step + done/total + progress bar width.
  - `tests/unit/features/chat/rendering/WorkOrderNeedsInputCard.test.ts` — renders question, hides empty `why`/`default`.
  - `tests/unit/features/chat/rendering/WorkOrderNeedsApprovalCard.test.ts` — renders action, risk, reversibility (true/false/unknown).

---

## Task 1: Generalize the splitter to `WorkOrderProtocolDisplay` (TDD)

**Files:**
- Create: `src/features/chat/rendering/WorkOrderProtocolDisplay.ts`
- Create: `tests/unit/features/chat/rendering/WorkOrderProtocolDisplay.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/features/chat/rendering/WorkOrderProtocolDisplay.test.ts
import { splitWorkOrderProtocolForDisplay } from '../../../../../src/features/chat/rendering/WorkOrderProtocolDisplay';

describe('splitWorkOrderProtocolForDisplay', () => {
  it('splits a progress block out of surrounding markdown', () => {
    const segments = splitWorkOrderProtocolForDisplay(
      'Working on it.\n<claudian_progress>\nstep: scanning\ndone: 1/3\nnote: starting with src/\n</claudian_progress>\nMore text.',
    );
    expect(segments).toEqual([
      { type: 'markdown', content: 'Working on it.' },
      {
        type: 'progress',
        progress: { step: 'scanning', done: { complete: 1, total: 3 }, note: 'starting with src/' },
      },
      { type: 'markdown', content: 'More text.' },
    ]);
  });

  it('splits a needs_input block', () => {
    const segments = splitWorkOrderProtocolForDisplay(
      '<claudian_needs_input>\nquestion: Use TypeScript?\nwhy: package.json is ambiguous\ndefault: yes\n</claudian_needs_input>',
    );
    expect(segments).toEqual([
      {
        type: 'needs_input',
        needsInput: { question: 'Use TypeScript?', why: 'package.json is ambiguous', defaultValue: 'yes' },
      },
    ]);
  });

  it('splits a needs_approval block with reversible flag', () => {
    const segments = splitWorkOrderProtocolForDisplay(
      '<claudian_needs_approval>\naction: rm -rf node_modules\nrisk: rebuild required\nreversible: true\n</claudian_needs_approval>',
    );
    expect(segments).toEqual([
      {
        type: 'needs_approval',
        needsApproval: { action: 'rm -rf node_modules', risk: 'rebuild required', reversible: true },
      },
    ]);
  });

  it('handles multiple progress blocks intermixed with text and a handoff', () => {
    const segments = splitWorkOrderProtocolForDisplay(
      '<claudian_progress>\nstep: a\ndone: 1/2\n</claudian_progress>\n' +
      'midway\n' +
      '<claudian_progress>\nstep: b\ndone: 2/2\n</claudian_progress>\n' +
      '<claudian_handoff>\nsummary: s\nverification: v\nrisks: None\nnext_action: n\n</claudian_handoff>',
    );
    expect(segments.map((s) => s.type)).toEqual(['progress', 'markdown', 'progress', 'handoff']);
  });

  it('falls back to a single markdown segment when no protocol blocks are present', () => {
    const segments = splitWorkOrderProtocolForDisplay('Just text, no blocks.');
    expect(segments).toEqual([{ type: 'markdown', content: 'Just text, no blocks.' }]);
  });

  it('rejects a malformed handoff block (returns the input as raw markdown)', () => {
    // Mirrors the old splitter contract: unmatched/duplicate handoff = no card.
    const segments = splitWorkOrderProtocolForDisplay(
      '<claudian_handoff>\nsummary: s\n', // unclosed
    );
    expect(segments).toEqual([
      { type: 'markdown', content: '<claudian_handoff>\nsummary: s\n' },
    ]);
  });

  it('renders an incomplete progress block as raw markdown (does not swallow)', () => {
    // Unclosed protocol block during streaming should fall through to markdown,
    // so the user sees something until the close tag arrives.
    const segments = splitWorkOrderProtocolForDisplay(
      '<claudian_progress>\nstep: a\n', // unclosed
    );
    expect(segments).toEqual([
      { type: 'markdown', content: '<claudian_progress>\nstep: a\n' },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/features/chat/rendering/WorkOrderProtocolDisplay.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the splitter**

```ts
// src/features/chat/rendering/WorkOrderProtocolDisplay.ts
export interface ProgressData {
  step: string;
  done?: { complete: number; total: number };
  note?: string;
}

export interface NeedsInputData {
  question: string;
  why?: string;
  defaultValue?: string;
}

export interface NeedsApprovalData {
  action: string;
  risk?: string;
  reversible?: boolean;
}

export interface ParsedHandoffForDisplay {
  summary: string;
  verification: string;
  risks: string;
  nextAction: string;
}

export type WorkOrderProtocolSegment =
  | { type: 'markdown'; content: string }
  | { type: 'progress'; progress: ProgressData }
  | { type: 'needs_input'; needsInput: NeedsInputData }
  | { type: 'needs_approval'; needsApproval: NeedsApprovalData }
  | { type: 'handoff'; handoff: ParsedHandoffForDisplay; preview: string };

const BLOCK_PATTERNS: Array<{ kind: 'progress' | 'needs_input' | 'needs_approval' | 'handoff'; regex: RegExp }> = [
  { kind: 'progress', regex: /<claudian_progress>([\s\S]*?)<\/claudian_progress>/g },
  { kind: 'needs_input', regex: /<claudian_needs_input>([\s\S]*?)<\/claudian_needs_input>/g },
  { kind: 'needs_approval', regex: /<claudian_needs_approval>([\s\S]*?)<\/claudian_needs_approval>/g },
  { kind: 'handoff', regex: /<claudian_handoff>([\s\S]*?)<\/claudian_handoff>/g },
];

export const HANDOFF_PREVIEW_MAX_CHARS = 160;

export function splitWorkOrderProtocolForDisplay(content: string): WorkOrderProtocolSegment[] {
  // Collect every block match with its position, then walk in order.
  const matches: Array<{ kind: 'progress' | 'needs_input' | 'needs_approval' | 'handoff'; start: number; end: number; body: string }> = [];
  for (const { kind, regex } of BLOCK_PATTERNS) {
    regex.lastIndex = 0;
    for (const m of content.matchAll(regex)) {
      if (m.index === undefined) continue;
      matches.push({ kind, start: m.index, end: m.index + m[0].length, body: m[1] });
    }
  }
  matches.sort((a, b) => a.start - b.start);

  if (matches.length === 0) {
    return [{ type: 'markdown', content }];
  }

  const segments: WorkOrderProtocolSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      const between = content.slice(cursor, match.start).trim();
      if (between.length > 0) segments.push({ type: 'markdown', content: between });
    }
    const parsed = parseBlock(match.kind, match.body);
    if (parsed) {
      segments.push(parsed);
    } else {
      // Invalid block — keep the raw text visible instead of silently dropping.
      segments.push({ type: 'markdown', content: content.slice(match.start, match.end) });
    }
    cursor = match.end;
  }
  if (cursor < content.length) {
    const tail = content.slice(cursor).trim();
    if (tail.length > 0) segments.push({ type: 'markdown', content: tail });
  }

  return segments;
}

function parseBlock(
  kind: 'progress' | 'needs_input' | 'needs_approval' | 'handoff',
  body: string,
): WorkOrderProtocolSegment | null {
  const fields = parseKeyedBody(body);
  if (kind === 'progress') {
    const step = fields.get('step');
    if (!step) return null;
    const doneStr = fields.get('done');
    const doneMatch = doneStr?.match(/^(\d+)\s*\/\s*(\d+)$/);
    const done = doneMatch ? { complete: parseInt(doneMatch[1], 10), total: parseInt(doneMatch[2], 10) } : undefined;
    return { type: 'progress', progress: { step, done, note: fields.get('note') } };
  }
  if (kind === 'needs_input') {
    const question = fields.get('question');
    if (!question) return null;
    return {
      type: 'needs_input',
      needsInput: { question, why: fields.get('why'), defaultValue: fields.get('default') },
    };
  }
  if (kind === 'needs_approval') {
    const action = fields.get('action');
    if (!action) return null;
    const reversibleStr = fields.get('reversible');
    const reversible = reversibleStr === 'true' ? true : reversibleStr === 'false' ? false : undefined;
    return {
      type: 'needs_approval',
      needsApproval: { action, risk: fields.get('risk'), reversible },
    };
  }
  // handoff
  const required: Array<'summary' | 'verification' | 'risks' | 'next_action'> = ['summary', 'verification', 'risks', 'next_action'];
  for (const label of required) {
    if (!fields.get(label)) return null;
  }
  return {
    type: 'handoff',
    handoff: {
      summary: fields.get('summary')!,
      verification: fields.get('verification')!,
      risks: fields.get('risks')!,
      nextAction: fields.get('next_action')!,
    },
    preview: truncatePreview(fields.get('summary')!),
  };
}

function parseKeyedBody(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  const lines = body.split(/\r?\n/);
  let currentKey: string | null = null;
  let currentValue: string[] = [];
  const commit = () => {
    if (currentKey === null) return;
    fields.set(currentKey, currentValue.join('\n').trim());
    currentKey = null;
    currentValue = [];
  };
  for (const line of lines) {
    const match = line.match(/^([a-z_]+):\s*(.*)$/);
    if (match) {
      commit();
      currentKey = match[1];
      currentValue = [match[2]];
    } else if (currentKey !== null) {
      currentValue.push(line);
    }
  }
  commit();
  return fields;
}

function truncatePreview(summary: string, maxLength = HANDOFF_PREVIEW_MAX_CHARS): string {
  const normalized = summary.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/features/chat/rendering/WorkOrderProtocolDisplay.test.ts`
Expected: PASS — all seven cases.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/rendering/WorkOrderProtocolDisplay.ts tests/unit/features/chat/rendering/WorkOrderProtocolDisplay.test.ts
git commit -m "feat(chat): WorkOrderProtocolDisplay splitter for progress/needs_input/needs_approval/handoff"
```

---

## Task 2: Progress card renderer (TDD)

**Files:**
- Create: `src/features/chat/rendering/WorkOrderProgressCard.ts`
- Create: `tests/unit/features/chat/rendering/WorkOrderProgressCard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/chat/rendering/WorkOrderProgressCard.test.ts
import { renderWorkOrderProgressCard } from '../../../../../src/features/chat/rendering/WorkOrderProgressCard';

describe('renderWorkOrderProgressCard', () => {
  it('renders step text and done/total with a progress bar', () => {
    const parent = document.createElement('div');
    renderWorkOrderProgressCard(parent, { step: 'scanning files', done: { complete: 2, total: 5 }, note: 'src/ first' });

    const card = parent.querySelector('.claudian-work-order-progress-card');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.claudian-work-order-progress-card-step')?.textContent).toBe('scanning files');
    expect(card?.querySelector('.claudian-work-order-progress-card-counter')?.textContent).toBe('2 / 5');
    const fill = card?.querySelector('.claudian-work-order-progress-card-bar-fill') as HTMLElement;
    expect(fill.style.width).toBe('40%'); // 2/5
    expect(card?.querySelector('.claudian-work-order-progress-card-note')?.textContent).toBe('src/ first');
  });

  it('omits counter and bar when done is missing', () => {
    const parent = document.createElement('div');
    renderWorkOrderProgressCard(parent, { step: 'thinking' });
    expect(parent.querySelector('.claudian-work-order-progress-card-counter')).toBeNull();
    expect(parent.querySelector('.claudian-work-order-progress-card-bar')).toBeNull();
  });

  it('omits the note line when note is missing', () => {
    const parent = document.createElement('div');
    renderWorkOrderProgressCard(parent, { step: 'thinking', done: { complete: 1, total: 1 } });
    expect(parent.querySelector('.claudian-work-order-progress-card-note')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- tests/unit/features/chat/rendering/WorkOrderProgressCard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/chat/rendering/WorkOrderProgressCard.ts
import { setIcon } from 'obsidian';

import type { ProgressData } from './WorkOrderProtocolDisplay';

export function renderWorkOrderProgressCard(parentEl: HTMLElement, progress: ProgressData): void {
  const card = parentEl.createDiv({ cls: 'claudian-work-order-progress-card' });
  const header = card.createDiv({ cls: 'claudian-work-order-progress-card-header' });

  const icon = header.createSpan({ cls: 'claudian-work-order-progress-card-icon' });
  setIcon(icon, 'activity');

  const main = header.createDiv({ cls: 'claudian-work-order-progress-card-main' });
  main.createDiv({ cls: 'claudian-work-order-progress-card-step', text: progress.step });

  if (progress.done) {
    const counter = header.createSpan({ cls: 'claudian-work-order-progress-card-counter' });
    counter.setText(`${progress.done.complete} / ${progress.done.total}`);
  }

  if (progress.done) {
    const bar = card.createDiv({ cls: 'claudian-work-order-progress-card-bar' });
    const fill = bar.createDiv({ cls: 'claudian-work-order-progress-card-bar-fill' });
    const pct = progress.done.total > 0
      ? Math.min(100, Math.max(0, Math.round((progress.done.complete / progress.done.total) * 100)))
      : 0;
    fill.style.width = `${pct}%`;
  }

  if (progress.note) {
    card.createDiv({ cls: 'claudian-work-order-progress-card-note', text: progress.note });
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- tests/unit/features/chat/rendering/WorkOrderProgressCard.test.ts`
Expected: PASS — all three cases.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/rendering/WorkOrderProgressCard.ts tests/unit/features/chat/rendering/WorkOrderProgressCard.test.ts
git commit -m "feat(chat): WorkOrderProgressCard renders compact step + counter + bar"
```

---

## Task 3: Needs-input card renderer (TDD)

**Files:**
- Create: `src/features/chat/rendering/WorkOrderNeedsInputCard.ts`
- Create: `tests/unit/features/chat/rendering/WorkOrderNeedsInputCard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/chat/rendering/WorkOrderNeedsInputCard.test.ts
import { renderWorkOrderNeedsInputCard } from '../../../../../src/features/chat/rendering/WorkOrderNeedsInputCard';

describe('renderWorkOrderNeedsInputCard', () => {
  it('renders question, why, and default when present', () => {
    const parent = document.createElement('div');
    renderWorkOrderNeedsInputCard(parent, {
      question: 'Use TypeScript?',
      why: 'package.json is ambiguous',
      defaultValue: 'yes',
    });
    const card = parent.querySelector('.claudian-work-order-needs-input-card');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.claudian-work-order-needs-input-card-question')?.textContent).toBe('Use TypeScript?');
    expect(card?.querySelector('.claudian-work-order-needs-input-card-why')?.textContent).toContain('package.json is ambiguous');
    expect(card?.querySelector('.claudian-work-order-needs-input-card-default')?.textContent).toContain('yes');
  });

  it('omits optional fields when not provided', () => {
    const parent = document.createElement('div');
    renderWorkOrderNeedsInputCard(parent, { question: 'Continue?' });
    expect(parent.querySelector('.claudian-work-order-needs-input-card-why')).toBeNull();
    expect(parent.querySelector('.claudian-work-order-needs-input-card-default')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test -- tests/unit/features/chat/rendering/WorkOrderNeedsInputCard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/chat/rendering/WorkOrderNeedsInputCard.ts
import { setIcon } from 'obsidian';

import type { NeedsInputData } from './WorkOrderProtocolDisplay';

export function renderWorkOrderNeedsInputCard(parentEl: HTMLElement, data: NeedsInputData): void {
  const card = parentEl.createDiv({ cls: 'claudian-work-order-needs-input-card' });
  const header = card.createDiv({ cls: 'claudian-work-order-needs-input-card-header' });

  const icon = header.createSpan({ cls: 'claudian-work-order-needs-input-card-icon' });
  setIcon(icon, 'message-circle-question');

  const main = header.createDiv({ cls: 'claudian-work-order-needs-input-card-main' });
  main.createDiv({ cls: 'claudian-work-order-needs-input-card-title', text: 'Awaiting your input' });
  main.createDiv({ cls: 'claudian-work-order-needs-input-card-question', text: data.question });

  if (data.why) {
    const why = card.createDiv({ cls: 'claudian-work-order-needs-input-card-why' });
    why.createSpan({ cls: 'claudian-work-order-needs-input-card-label', text: 'Why: ' });
    why.appendText(data.why);
  }
  if (data.defaultValue) {
    const def = card.createDiv({ cls: 'claudian-work-order-needs-input-card-default' });
    def.createSpan({ cls: 'claudian-work-order-needs-input-card-label', text: 'Default: ' });
    def.appendText(data.defaultValue);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- tests/unit/features/chat/rendering/WorkOrderNeedsInputCard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/rendering/WorkOrderNeedsInputCard.ts tests/unit/features/chat/rendering/WorkOrderNeedsInputCard.test.ts
git commit -m "feat(chat): WorkOrderNeedsInputCard renders question + optional why/default"
```

---

## Task 4: Needs-approval card renderer (TDD)

**Files:**
- Create: `src/features/chat/rendering/WorkOrderNeedsApprovalCard.ts`
- Create: `tests/unit/features/chat/rendering/WorkOrderNeedsApprovalCard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/chat/rendering/WorkOrderNeedsApprovalCard.test.ts
import { renderWorkOrderNeedsApprovalCard } from '../../../../../src/features/chat/rendering/WorkOrderNeedsApprovalCard';

describe('renderWorkOrderNeedsApprovalCard', () => {
  it('renders action, risk, and a "Reversible" chip when true', () => {
    const parent = document.createElement('div');
    renderWorkOrderNeedsApprovalCard(parent, { action: 'rm -rf node_modules', risk: 'rebuild required', reversible: true });
    const card = parent.querySelector('.claudian-work-order-needs-approval-card');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.claudian-work-order-needs-approval-card-action')?.textContent).toBe('rm -rf node_modules');
    expect(card?.querySelector('.claudian-work-order-needs-approval-card-risk')?.textContent).toContain('rebuild required');
    const chip = card?.querySelector('.claudian-work-order-needs-approval-card-reversible-chip');
    expect(chip?.textContent).toBe('Reversible');
  });

  it('renders an "Irreversible" chip when reversible is false', () => {
    const parent = document.createElement('div');
    renderWorkOrderNeedsApprovalCard(parent, { action: 'drop database', reversible: false });
    const chip = parent.querySelector('.claudian-work-order-needs-approval-card-reversible-chip');
    expect(chip?.textContent).toBe('Irreversible');
    expect(chip?.classList.contains('is-irreversible')).toBe(true);
  });

  it('omits the chip and risk when not provided', () => {
    const parent = document.createElement('div');
    renderWorkOrderNeedsApprovalCard(parent, { action: 'deploy' });
    expect(parent.querySelector('.claudian-work-order-needs-approval-card-reversible-chip')).toBeNull();
    expect(parent.querySelector('.claudian-work-order-needs-approval-card-risk')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test -- tests/unit/features/chat/rendering/WorkOrderNeedsApprovalCard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/chat/rendering/WorkOrderNeedsApprovalCard.ts
import { setIcon } from 'obsidian';

import type { NeedsApprovalData } from './WorkOrderProtocolDisplay';

export function renderWorkOrderNeedsApprovalCard(parentEl: HTMLElement, data: NeedsApprovalData): void {
  const card = parentEl.createDiv({ cls: 'claudian-work-order-needs-approval-card' });
  const header = card.createDiv({ cls: 'claudian-work-order-needs-approval-card-header' });

  const icon = header.createSpan({ cls: 'claudian-work-order-needs-approval-card-icon' });
  setIcon(icon, 'shield-alert');

  const main = header.createDiv({ cls: 'claudian-work-order-needs-approval-card-main' });
  main.createDiv({ cls: 'claudian-work-order-needs-approval-card-title', text: 'Approval required' });
  main.createDiv({ cls: 'claudian-work-order-needs-approval-card-action', text: data.action });

  if (data.reversible !== undefined) {
    const chipClasses = ['claudian-work-order-needs-approval-card-reversible-chip'];
    if (!data.reversible) chipClasses.push('is-irreversible');
    const chip = header.createSpan({ cls: chipClasses.join(' ') });
    chip.setText(data.reversible ? 'Reversible' : 'Irreversible');
  }

  if (data.risk) {
    const risk = card.createDiv({ cls: 'claudian-work-order-needs-approval-card-risk' });
    risk.createSpan({ cls: 'claudian-work-order-needs-approval-card-label', text: 'Risk: ' });
    risk.appendText(data.risk);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- tests/unit/features/chat/rendering/WorkOrderNeedsApprovalCard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/rendering/WorkOrderNeedsApprovalCard.ts tests/unit/features/chat/rendering/WorkOrderNeedsApprovalCard.test.ts
git commit -m "feat(chat): WorkOrderNeedsApprovalCard renders action + risk + reversible chip"
```

---

## Task 5: CSS for protocol cards

**Files:**
- Create: `src/style/features/work-order-protocol-cards.css`
- Modify: `src/style/index.css`

- [ ] **Step 1: Write the CSS**

```css
/* src/style/features/work-order-protocol-cards.css */

/* ----- Progress (compact, inline) ----- */
.claudian-work-order-progress-card {
  margin: 6px 0;
  padding: 6px 8px;
  border-left: 3px solid var(--interactive-accent);
  background: var(--background-secondary);
  border-radius: 4px;
  font-size: var(--font-ui-small);
}

.claudian-work-order-progress-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.claudian-work-order-progress-card-icon {
  color: var(--interactive-accent);
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  display: inline-flex;
}

.claudian-work-order-progress-card-main {
  flex: 1 1 auto;
  min-width: 0;
}

.claudian-work-order-progress-card-step {
  color: var(--text-normal);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.claudian-work-order-progress-card-counter {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}

.claudian-work-order-progress-card-bar {
  margin-top: 4px;
  height: 3px;
  background: var(--background-modifier-border);
  border-radius: 2px;
  overflow: hidden;
}

.claudian-work-order-progress-card-bar-fill {
  height: 100%;
  background: var(--interactive-accent);
  transition: width 200ms ease-out;
}

.claudian-work-order-progress-card-note {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

/* ----- Needs input (amber) ----- */
.claudian-work-order-needs-input-card {
  margin: 8px 0;
  padding: 8px 10px;
  border: 1px solid var(--text-warning, #d29922);
  border-left-width: 4px;
  border-radius: 6px;
  background: var(--background-secondary);
  font-size: var(--font-ui-small);
}

.claudian-work-order-needs-input-card-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.claudian-work-order-needs-input-card-icon {
  color: var(--text-warning, #d29922);
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  display: inline-flex;
  margin-top: 2px;
}

.claudian-work-order-needs-input-card-main {
  flex: 1 1 auto;
  min-width: 0;
}

.claudian-work-order-needs-input-card-title {
  color: var(--text-warning, #d29922);
  font-weight: 600;
  font-size: var(--font-ui-smaller);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.claudian-work-order-needs-input-card-question {
  color: var(--text-normal);
  margin-top: 2px;
}

.claudian-work-order-needs-input-card-why,
.claudian-work-order-needs-input-card-default {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

.claudian-work-order-needs-input-card-label {
  font-weight: 600;
  color: var(--text-muted);
}

/* ----- Needs approval (red) ----- */
.claudian-work-order-needs-approval-card {
  margin: 8px 0;
  padding: 8px 10px;
  border: 1px solid var(--text-error, #cf222e);
  border-left-width: 4px;
  border-radius: 6px;
  background: var(--background-secondary);
  font-size: var(--font-ui-small);
}

.claudian-work-order-needs-approval-card-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.claudian-work-order-needs-approval-card-icon {
  color: var(--text-error, #cf222e);
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  display: inline-flex;
  margin-top: 2px;
}

.claudian-work-order-needs-approval-card-main {
  flex: 1 1 auto;
  min-width: 0;
}

.claudian-work-order-needs-approval-card-title {
  color: var(--text-error, #cf222e);
  font-weight: 600;
  font-size: var(--font-ui-smaller);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.claudian-work-order-needs-approval-card-action {
  color: var(--text-normal);
  margin-top: 2px;
  font-family: var(--font-monospace);
  word-break: break-word;
}

.claudian-work-order-needs-approval-card-reversible-chip {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: var(--font-ui-smaller);
  background: var(--background-modifier-success, #1a7f37);
  color: var(--text-on-accent, #fff);
  flex: 0 0 auto;
}

.claudian-work-order-needs-approval-card-reversible-chip.is-irreversible {
  background: var(--background-modifier-error, #cf222e);
}

.claudian-work-order-needs-approval-card-risk {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

.claudian-work-order-needs-approval-card-label {
  font-weight: 600;
  color: var(--text-muted);
}
```

- [ ] **Step 2: Register the module in `src/style/index.css`**

Insert the line `@import "./features/work-order-protocol-cards.css";` immediately after the existing `@import "./features/work-order-handoff-card.css";` line (around line 53).

- [ ] **Step 3: Build CSS to verify it compiles**

Run: `npm run build`
Expected: CSS bundling step passes.

- [ ] **Step 4: Commit**

```bash
git add src/style/features/work-order-protocol-cards.css src/style/index.css
git commit -m "feat(chat): CSS for work-order protocol cards"
```

---

## Task 6: Wire protocol cards into `MessageRenderer`

**Files:**
- Modify: `src/features/chat/rendering/MessageRenderer.ts`

- [ ] **Step 1: Replace the splitter call**

In `renderAssistantTextBlock` (around line 504), replace:

```ts
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
```

with:

```ts
if (!this.getWorkOrderPath()) {
  this.renderPlainAssistantTextBlock(contentEl, markdown);
  return;
}
const segments = splitWorkOrderProtocolForDisplay(markdown);
for (const segment of segments) {
  this.renderAssistantDisplaySegment(contentEl, segment);
}
```

- [ ] **Step 2: Extend the dispatcher**

Update `renderAssistantDisplaySegment` to handle all five segment types:

```ts
private renderAssistantDisplaySegment(contentEl: HTMLElement, segment: WorkOrderProtocolSegment): void {
  if (segment.type === 'markdown') {
    this.renderPlainAssistantTextBlock(contentEl, segment.content);
    return;
  }
  if (segment.type === 'progress') {
    renderWorkOrderProgressCard(contentEl, segment.progress);
    return;
  }
  if (segment.type === 'needs_input') {
    renderWorkOrderNeedsInputCard(contentEl, segment.needsInput);
    return;
  }
  if (segment.type === 'needs_approval') {
    renderWorkOrderNeedsApprovalCard(contentEl, segment.needsApproval);
    return;
  }
  // handoff
  renderWorkOrderHandoffCard(contentEl, segment, (el, md, options) => this.renderContent(el, md, options));
}
```

`renderWorkOrderHandoffCard` currently takes a `WorkOrderHandoffDisplaySegment`; the new `splitWorkOrderProtocolForDisplay` emits a compatible shape (`{ type: 'handoff', handoff, preview }`). If the handoff card's parameter type doesn't accept the new segment shape directly, narrow with a local type assertion or update the card's parameter type to `{ handoff: ParsedHandoffForDisplay; preview: string }`.

- [ ] **Step 3: Update imports**

Replace `splitWorkOrderHandoffForDisplay`/`WorkOrderHandoffSegment` imports with `splitWorkOrderProtocolForDisplay`/`WorkOrderProtocolSegment`. Add imports for the three new card render functions.

- [ ] **Step 4: Update `finalizeStreamedAssistantText`**

Mirror the new flow: call `splitWorkOrderProtocolForDisplay`. The current early-return (`if (!segments) return false`) becomes "if every segment is markdown, return false" — so live runs that produced no protocol blocks keep the streaming text element as-is:

```ts
finalizeStreamedAssistantText(contentEl: HTMLElement, textEl: HTMLElement, markdown: string): boolean {
  if (!this.getWorkOrderPath()) return false;
  const segments = splitWorkOrderProtocolForDisplay(markdown);
  if (segments.every((s) => s.type === 'markdown')) return false;
  // ... existing footer detach, textEl.remove(), per-segment render, footer re-append
}
```

- [ ] **Step 5: Typecheck + run tests**

Run: `npm run typecheck && npm run test -- tests/unit/features/chat`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/chat/rendering/MessageRenderer.ts src/features/chat/rendering/WorkOrderHandoffCard.ts
git commit -m "feat(chat): MessageRenderer dispatches protocol cards alongside handoff"
```

---

## Task 7: Update or retire `WorkOrderHandoffDisplay.ts`

**Files:**
- Modify: `src/features/chat/rendering/WorkOrderHandoffDisplay.ts`
- Modify: any tests that imported `splitWorkOrderHandoffForDisplay`

- [ ] **Step 1: Make it a thin re-export**

Replace the contents of `WorkOrderHandoffDisplay.ts` with:

```ts
export {
  HANDOFF_PREVIEW_MAX_CHARS,
  splitWorkOrderProtocolForDisplay as splitWorkOrderHandoffForDisplay,
  type ParsedHandoffForDisplay,
  type WorkOrderProtocolSegment as WorkOrderHandoffSegment,
} from './WorkOrderProtocolDisplay';
```

This preserves any existing import sites without code churn. (If the migrated callers in Task 6 already point at `WorkOrderProtocolDisplay`, this file is purely defensive.)

- [ ] **Step 2: Run the full unit suite**

Run: `npm run test -- --selectProjects unit`
Expected: PASS — no callers are broken.

- [ ] **Step 3: Commit**

```bash
git add src/features/chat/rendering/WorkOrderHandoffDisplay.ts
git commit -m "refactor(chat): WorkOrderHandoffDisplay re-exports from WorkOrderProtocolDisplay"
```

---

## Task 8: Final verification + screenshot the rendered cards

- [ ] **Step 1: Full gate**

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

All four MUST be clean.

- [ ] **Step 2: Smoke-test in the dev vault**

- Launch a work order whose prompt instructs the agent to emit one `<claudian_progress>` block early, then one `<claudian_needs_input>`, then resume after reply.
- Confirm the work-order chat tab shows:
  - A compact progress card with step + counter + slim bar, NOT raw XML.
  - An amber awaiting-input card with the question, NOT raw XML.
- Reload the conversation; cards re-render from stored content blocks.
- Open a non-work-order chat tab and confirm the same XML (if pasted) renders as plain markdown (no card), proving the work-order gating works.

- [ ] **Step 3: Commit fixups**

```bash
git status
git add -p
git commit -m "fix(chat): protocol card post-verification fixups"
```

---

## Self-Review Pass

1. **Spec coverage:** Splitter (Task 1), progress card (Task 2), needs-input card (Task 3), needs-approval card (Task 4), CSS (Task 5), MessageRenderer wiring + live finalize (Task 6), backward-compat shim (Task 7), full verify (Task 8). ✓
2. **Placeholder scan:** Task 6 step 2 mentions "narrow with a local type assertion or update the card's parameter type" — that's a real branch the engineer chooses based on what TypeScript reports; the alternative paths are both spelled out. No TODOs/TBDs elsewhere. ✓
3. **Type consistency:** `ProgressData`, `NeedsInputData`, `NeedsApprovalData`, `ParsedHandoffForDisplay`, `WorkOrderProtocolSegment` defined in Task 1 and consumed exactly in Tasks 2, 3, 4, 6. `defaultValue` (not `default`, which is reserved) used consistently. `reversible: boolean | undefined` used consistently with `is-irreversible` modifier class. ✓

---

## Post-Implementation Notes (2026-06-06)

- **Permissive parser shift**: the new `splitWorkOrderProtocolForDisplay` accepts duplicate fields (overwrite, last wins), stray openers (ignored), and multiple handoff blocks (all render). The deleted `splitWorkOrderHandoffForDisplay` rejected each of these. The shift is documented in the JSDoc above `splitWorkOrderProtocolForDisplay`.
- **Fence-aware extraction**: agent messages may include protocol XML inside fenced code blocks for documentation. The splitter ignores matches inside ``` or ~~~ ranges.
- **Shim retired**: `WorkOrderHandoffDisplay.ts` was deleted after confirming no remaining consumers.
- **Optional-string render gate**: `WorkOrderNeedsInputCard` and `WorkOrderNeedsApprovalCard` use `!== undefined` rather than the plan's falsy guard, preserving empty-string field intent.
