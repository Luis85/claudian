import { setIcon } from 'obsidian';

import type { NeedsInputData } from './WorkOrderProtocolDisplay';

export function renderWorkOrderNeedsInputCard(parentEl: HTMLElement, data: NeedsInputData): void {
  const card = parentEl.createDiv({ cls: 'specorator-work-order-needs-input-card' });
  const header = card.createDiv({ cls: 'specorator-work-order-needs-input-card-header' });

  const icon = header.createSpan({ cls: 'specorator-work-order-needs-input-card-icon' });
  setIcon(icon, 'message-circle-question');

  const main = header.createDiv({ cls: 'specorator-work-order-needs-input-card-main' });
  main.createDiv({ cls: 'specorator-work-order-needs-input-card-title', text: 'Awaiting your input' });
  main.createDiv({ cls: 'specorator-work-order-needs-input-card-question', text: data.question });

  if (data.why !== undefined) {
    const why = card.createDiv({ cls: 'specorator-work-order-needs-input-card-why' });
    why.createSpan({ cls: 'specorator-work-order-needs-input-card-label', text: 'Why: ' });
    why.appendText(data.why);
  }
  if (data.defaultValue !== undefined) {
    const def = card.createDiv({ cls: 'specorator-work-order-needs-input-card-default' });
    def.createSpan({ cls: 'specorator-work-order-needs-input-card-label', text: 'Default: ' });
    def.appendText(data.defaultValue);
  }
}
