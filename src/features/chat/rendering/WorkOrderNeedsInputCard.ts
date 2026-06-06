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
