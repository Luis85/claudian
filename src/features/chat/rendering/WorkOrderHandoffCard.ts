import { setIcon } from 'obsidian';

import { type CollapsibleState,setupCollapsible } from './collapsible';
import type { RenderContentFn } from './MessageRenderer';
import type { WorkOrderProtocolSegment } from './WorkOrderProtocolDisplay';

export function renderWorkOrderHandoffCard(
  parentEl: HTMLElement,
  segment: Extract<WorkOrderProtocolSegment, { type: 'handoff' }>,
  renderMarkdown: RenderContentFn,
): void {
  const wrapper = parentEl.createDiv({ cls: 'specorator-work-order-handoff-card' });
  const header = wrapper.createDiv({
    cls: 'specorator-work-order-handoff-card-header',
    attr: { role: 'button', tabindex: '0' },
  });

  const icon = header.createSpan({ cls: 'specorator-work-order-handoff-card-icon' });
  setIcon(icon, 'clipboard-check');

  const main = header.createDiv({ cls: 'specorator-work-order-handoff-card-main' });
  main.createDiv({ cls: 'specorator-work-order-handoff-card-title', text: 'Work order handoff' });
  main.createDiv({ cls: 'specorator-work-order-handoff-card-preview', text: segment.preview });

  const expandLabel = header.createSpan({
    cls: 'specorator-work-order-handoff-card-toggle',
    text: 'Expand',
  });

  const chips = wrapper.createDiv({ cls: 'specorator-work-order-handoff-card-chips' });
  chips.createSpan({ cls: 'specorator-work-order-handoff-card-chip', text: 'Verification' });
  chips.createSpan({ cls: 'specorator-work-order-handoff-card-chip', text: 'Risks' });
  chips.createSpan({ cls: 'specorator-work-order-handoff-card-chip', text: 'Next Action' });

  const details = wrapper.createDiv({ cls: 'specorator-work-order-handoff-card-details' });
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
  const section = parentEl.createDiv({ cls: 'specorator-work-order-handoff-card-section' });
  section.createDiv({ cls: 'specorator-work-order-handoff-card-section-title', text: title });
  const body = section.createDiv({ cls: 'specorator-work-order-handoff-card-section-body' });
  void renderMarkdown(body, markdown);
}
