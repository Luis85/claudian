import { setIcon } from 'obsidian';

import type { NeedsApprovalData } from './WorkOrderProtocolDisplay';

export function renderWorkOrderNeedsApprovalCard(parentEl: HTMLElement, data: NeedsApprovalData): void {
  const card = parentEl.createDiv({ cls: 'specorator-work-order-needs-approval-card' });
  const header = card.createDiv({ cls: 'specorator-work-order-needs-approval-card-header' });

  const icon = header.createSpan({ cls: 'specorator-work-order-needs-approval-card-icon' });
  setIcon(icon, 'shield-alert');

  const main = header.createDiv({ cls: 'specorator-work-order-needs-approval-card-main' });
  main.createDiv({ cls: 'specorator-work-order-needs-approval-card-title', text: 'Approval required' });
  main.createDiv({ cls: 'specorator-work-order-needs-approval-card-action', text: data.action });

  if (data.reversible !== undefined) {
    const chipClasses = ['specorator-work-order-needs-approval-card-reversible-chip'];
    if (!data.reversible) chipClasses.push('is-irreversible');
    const chip = header.createSpan({ cls: chipClasses.join(' ') });
    chip.setText(data.reversible ? 'Reversible' : 'Irreversible');
  }

  if (data.risk !== undefined) {
    const risk = card.createDiv({ cls: 'specorator-work-order-needs-approval-card-risk' });
    risk.createSpan({ cls: 'specorator-work-order-needs-approval-card-label', text: 'Risk: ' });
    risk.appendText(data.risk);
  }
}
