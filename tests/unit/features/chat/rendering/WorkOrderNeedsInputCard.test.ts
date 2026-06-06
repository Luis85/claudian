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
    const whyEl = card?.querySelector('.claudian-work-order-needs-input-card-why');
    expect(whyEl?.querySelector('.claudian-work-order-needs-input-card-label')?.textContent).toBe('Why: ');
    const defEl = card?.querySelector('.claudian-work-order-needs-input-card-default');
    expect(defEl?.querySelector('.claudian-work-order-needs-input-card-label')?.textContent).toBe('Default: ');
  });

  it('omits optional fields when not provided', () => {
    const parent = createMockEl('div');
    renderWorkOrderNeedsInputCard(parent as unknown as HTMLElement, { question: 'Continue?' });
    expect(parent.querySelector('.claudian-work-order-needs-input-card-why')).toBeNull();
    expect(parent.querySelector('.claudian-work-order-needs-input-card-default')).toBeNull();
  });

  it('renders why and default rows even when values are empty strings', () => {
    const parent = createMockEl('div');
    renderWorkOrderNeedsInputCard(parent as unknown as HTMLElement, {
      question: 'Confirm?',
      why: '',
      defaultValue: '',
    });
    expect(parent.querySelector('.claudian-work-order-needs-input-card-why')).not.toBeNull();
    expect(parent.querySelector('.claudian-work-order-needs-input-card-default')).not.toBeNull();
  });
});
