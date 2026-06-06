import { createMockEl } from '@test/helpers/mockElement';

import { renderWorkOrderNeedsInputCard } from '../../../../../src/features/chat/rendering/WorkOrderNeedsInputCard';

describe('renderWorkOrderNeedsInputCard', () => {
  it('renders question, why, and default when present', () => {
    const parent = createMockEl('div');
    renderWorkOrderNeedsInputCard(parent as unknown as HTMLElement, {
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
    const parent = createMockEl('div');
    renderWorkOrderNeedsInputCard(parent as unknown as HTMLElement, { question: 'Continue?' });
    expect(parent.querySelector('.claudian-work-order-needs-input-card-why')).toBeNull();
    expect(parent.querySelector('.claudian-work-order-needs-input-card-default')).toBeNull();
  });
});
