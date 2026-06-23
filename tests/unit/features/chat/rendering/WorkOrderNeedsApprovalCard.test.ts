import { createMockEl } from '@test/helpers/mockElement';

import { renderWorkOrderNeedsApprovalCard } from '../../../../../src/features/chat/rendering/WorkOrderNeedsApprovalCard';

describe('renderWorkOrderNeedsApprovalCard', () => {
  it('renders action, risk, and a "Reversible" chip when true', () => {
    const parent = createMockEl('div');
    renderWorkOrderNeedsApprovalCard(parent as unknown as HTMLElement, { action: 'rm -rf node_modules', risk: 'rebuild required', reversible: true });
    const card = parent.querySelector('.specorator-work-order-needs-approval-card');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.specorator-work-order-needs-approval-card-action')?.textContent).toBe('rm -rf node_modules');
    const riskEl = card?.querySelector('.specorator-work-order-needs-approval-card-risk');
    expect(riskEl?.querySelector('.specorator-work-order-needs-approval-card-label')?.textContent).toBe('Risk: ');
    const chip = card?.querySelector('.specorator-work-order-needs-approval-card-reversible-chip');
    expect(chip?.textContent).toBe('Reversible');
    expect(chip?.classList.contains('is-irreversible')).toBe(false);
    expect(card?.querySelector('.specorator-work-order-needs-approval-card-title')?.textContent).toBe('Approval required');
    expect(riskEl?.textContent).toContain('rebuild required');
  });

  it('renders an "Irreversible" chip when reversible is false', () => {
    const parent = createMockEl('div');
    renderWorkOrderNeedsApprovalCard(parent as unknown as HTMLElement, { action: 'drop database', reversible: false });
    const chip = parent.querySelector('.specorator-work-order-needs-approval-card-reversible-chip');
    expect(chip?.textContent).toBe('Irreversible');
    expect(chip?.classList.contains('is-irreversible')).toBe(true);
  });

  it('omits the chip and risk when not provided', () => {
    const parent = createMockEl('div');
    renderWorkOrderNeedsApprovalCard(parent as unknown as HTMLElement, { action: 'deploy' });
    expect(parent.querySelector('.specorator-work-order-needs-approval-card-reversible-chip')).toBeNull();
    expect(parent.querySelector('.specorator-work-order-needs-approval-card-risk')).toBeNull();
  });

  it('renders risk row when reversible is false', () => {
    const parent = createMockEl('div');
    renderWorkOrderNeedsApprovalCard(parent as unknown as HTMLElement, {
      action: 'drop database',
      risk: 'data loss',
      reversible: false,
    });
    const riskEl = parent.querySelector('.specorator-work-order-needs-approval-card-risk');
    expect(riskEl).not.toBeNull();
    expect(riskEl?.querySelector('.specorator-work-order-needs-approval-card-label')?.textContent).toBe('Risk: ');
  });
});
