import { type App, type Component, MarkdownRenderer, setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { TranslationKey } from '../../../i18n/types';
import { hasAnyHandoffSection, parseHandoffSections } from '../model/handoffSections';
import type { TaskSpec } from '../model/taskTypes';
import { renderSectionHeader } from './sectionHeader';

// One collapsible Agent-handoff card. `body` is the section's raw markdown
// (rendered through MarkdownRenderer so inline links stay live); `modifier`
// keys the per-section icon color in CSS; `defaultOpen` follows the spec.
interface HandoffCard {
  titleKey: TranslationKey;
  /** Lucide glyph; the color (per the spec table) is what matters, set in CSS. */
  icon: string;
  /** Per-section modifier driving the icon color (--summary/--verification/…). */
  modifier: string;
  defaultOpen: boolean;
  body: string;
}

// A parsed run-ledger line: `- <iso-ts> [<status>] <message>`. Malformed lines
// are dropped by the parser so the rendered list only holds well-formed entries.
interface LedgerEntry {
  timestamp: string;
  status: string;
  message: string;
}

const LEDGER_LINE = /^-\s+(\S+)\s+\[([^\]]+)\]\s*(.*)$/;

/** App + markdown component escapes the activity section needs to render handoff/ledger markdown. */
export interface WorkOrderActivityDeps {
  task: TaskSpec;
  app: App;
  markdownComponent: Component;
}

/**
 * Renders the work-order detail modal's status-driven activity section: the
 * structured Agent handoff (review / needs_fix), the needs-handoff salvage
 * callout + transcript tail, or the failed-run ledger. Extracted from
 * `WorkOrderDetailModal` so the modal keeps its shell while this owns the
 * handoff/ledger DOM + collapsible cards. Every other status renders nothing.
 */
export function renderWorkOrderActivity(parent: HTMLElement, deps: WorkOrderActivityDeps): void {
  const { status } = deps.task.frontmatter;
  if ((status === 'review' || status === 'needs_fix') && deps.task.sections.handoff.length > 0) {
    renderHandoff(parent, deps.task.sections.handoff, deps);
    return;
  }
  if (status === 'needs_handoff') {
    renderHandoffSalvage(parent, deps);
    return;
  }
  if (status === 'failed' && deps.task.sections.ledger.length > 0) {
    renderRunLedger(parent, deps.task.sections.ledger);
  }
}

/**
 * Agent handoff: parse the handoff region (marker-delimited fields, with a
 * legacy `## Heading\nbody` fallback) into the four ParsedHandoff fields and
 * render them as collapsible bordered cards
 * (Summary / Verification / Risks / Next action). If the region parses into no
 * known section, fall back to rendering the full raw markdown so handoff text
 * is never dropped.
 */
function renderHandoff(parent: HTMLElement, markdown: string, deps: WorkOrderActivityDeps): void {
  const { section } = renderSectionHeader(parent, {
    icon: 'clipboard-check',
    label: t('tasks.workOrderModal.sectionHandoff'),
  });

  const parsed = parseHandoffSections(markdown);
  if (!hasAnyHandoffSection(parsed)) {
    const fallback = section.createDiv({ cls: 'specorator-work-order-modal-handoff-fallback' });
    void MarkdownRenderer.render(deps.app, markdown, fallback, deps.task.path, deps.markdownComponent);
    return;
  }

  // Glyphs mirror the design prototype's handoff cards (Modal.jsx): file-text /
  // check-square / triangle / signal. The per-section accent color is what the
  // spec table fixes and is set in CSS off the modifier, not the glyph itself.
  const cards: HandoffCard[] = [
    { titleKey: 'tasks.workOrderModal.handoffSummary', icon: 'file-text', modifier: 'summary', defaultOpen: true, body: parsed.summary },
    { titleKey: 'tasks.workOrderModal.handoffVerification', icon: 'check-square', modifier: 'verification', defaultOpen: false, body: parsed.verification },
    { titleKey: 'tasks.workOrderModal.handoffRisks', icon: 'triangle', modifier: 'risks', defaultOpen: false, body: parsed.risks },
    { titleKey: 'tasks.workOrderModal.handoffNextAction', icon: 'signal', modifier: 'next', defaultOpen: true, body: parsed.nextAction },
  ];

  const group = section.createDiv({ cls: 'specorator-work-order-modal-collapse-group' });
  for (const card of cards) {
    renderCollapsible(group, {
      title: t(card.titleKey),
      icon: card.icon,
      modifier: card.modifier,
      defaultOpen: card.defaultOpen,
      renderBody: (body) =>
        void MarkdownRenderer.render(deps.app, card.body, body, deps.task.path, deps.markdownComponent),
    });
  }
}

/**
 * Needs-handoff salvage: a warning callout explaining the run finished without
 * a structured handoff, plus a collapsible monospace transcript tail sourced
 * from the available run trace (`sections.ledger`).
 */
function renderHandoffSalvage(parent: HTMLElement, deps: WorkOrderActivityDeps): void {
  const { section } = renderSectionHeader(parent, {
    icon: 'triangle',
    label: t('tasks.workOrderModal.salvageTitle'),
  });

  section.createDiv({
    cls: 'specorator-work-order-modal-salvage-callout',
    text: t('tasks.workOrderModal.salvageCallout'),
  });

  const trace = deps.task.sections.ledger.trim();
  const group = section.createDiv({ cls: 'specorator-work-order-modal-collapse-group' });
  renderCollapsible(group, {
    title: t('tasks.workOrderModal.transcriptTail'),
    icon: 'scroll-text',
    modifier: 'tail',
    defaultOpen: true,
    renderBody: (body) => {
      const trail = body.createDiv({ cls: 'specorator-work-order-modal-tail-body' });
      trail.setText(trace.length > 0 ? trace : t('tasks.workOrderModal.transcriptTailEmpty'));
    },
  });
}

/**
 * Failed run ledger: parse the `- <ts> [<status>] <message>` lines (malformed
 * lines dropped) into an ordered list of status-colored dot + monospace time +
 * message rows. Dot color follows the status→color contract via a CSS modifier.
 */
function renderRunLedger(parent: HTMLElement, ledger: string): void {
  const entries = parseLedger(ledger);
  if (entries.length === 0) return;

  const { section } = renderSectionHeader(parent, {
    icon: 'scroll-text',
    label: t('tasks.workOrderModal.sectionRunLedger'),
  });

  const list = section.createEl('ol', { cls: 'specorator-work-order-modal-ledger' });
  for (const entry of entries) {
    const row = list.createEl('li', { cls: 'specorator-work-order-modal-ledger-entry' });
    const dot = row.createSpan({
      cls: `specorator-work-order-modal-ledger-dot specorator-work-order-modal-ledger-dot--${entry.status}`,
    });
    dot.setAttr('aria-hidden', 'true');
    row.createSpan({ cls: 'specorator-work-order-modal-ledger-time', text: entry.timestamp });
    row.createSpan({ cls: 'specorator-work-order-modal-ledger-msg', text: entry.message });
  }
}

function parseLedger(ledger: string): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  for (const line of ledger.split('\n')) {
    const match = line.match(LEDGER_LINE);
    if (!match) continue;
    entries.push({ timestamp: match[1], status: match[2].trim(), message: match[3].trim() });
  }
  return entries;
}

/**
 * Shared collapsible card: a real `<button>` header (keyboard-operable,
 * `aria-expanded` reflecting state) carrying a rotating chevron + a colored
 * section icon + the title, over a body rendered on demand. Collapsible state
 * is local UI only — not persisted. The body is built lazily and cleared on
 * collapse so it re-renders cleanly on the next expand.
 */
function renderCollapsible(
  parent: HTMLElement,
  options: {
    title: string;
    icon: string;
    modifier: string;
    defaultOpen: boolean;
    renderBody: (body: HTMLElement) => void;
  },
): void {
  const card = parent.createDiv({
    cls: `specorator-work-order-modal-collapse specorator-work-order-modal-collapse--${options.modifier}`,
  });

  const head = card.createEl('button', {
    cls: 'specorator-work-order-modal-collapse-head',
    attr: { type: 'button' },
  });
  const chevron = head.createSpan({ cls: 'specorator-work-order-modal-collapse-chevron' });
  chevron.setAttr('aria-hidden', 'true');
  chevron.setAttr('data-icon', 'chevron-right');
  setIcon(chevron, 'chevron-right');
  const icon = head.createSpan({ cls: 'specorator-work-order-modal-collapse-icon' });
  icon.setAttr('aria-hidden', 'true');
  icon.setAttr('data-icon', options.icon);
  setIcon(icon, options.icon);
  head.createSpan({ cls: 'specorator-work-order-modal-collapse-title', text: options.title });

  let open = false;
  let body: HTMLElement | undefined;
  const apply = (next: boolean): void => {
    open = next;
    head.setAttr('aria-expanded', open ? 'true' : 'false');
    card.toggleClass('is-open', open);
    if (open) {
      body ??= card.createDiv({ cls: 'specorator-work-order-modal-collapse-body' });
      body.empty();
      options.renderBody(body);
    } else if (body) {
      body.remove();
      body = undefined;
    }
  };
  head.addEventListener('click', () => apply(!open));
  apply(options.defaultOpen);
}
