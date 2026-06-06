import { createMockEl } from '@test/helpers/mockElement';

import { renderWorkOrderProgressCard } from '../../../../../src/features/chat/rendering/WorkOrderProgressCard';

describe('renderWorkOrderProgressCard', () => {
  it('renders step text and done/total with a progress bar', () => {
    const parent = createMockEl('div');
    renderWorkOrderProgressCard(parent as any, { step: 'scanning files', done: { complete: 2, total: 5 }, note: 'src/ first' });

    const card = parent.querySelector('.claudian-work-order-progress-card');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.claudian-work-order-progress-card-step')?.textContent).toBe('scanning files');
    expect(card?.querySelector('.claudian-work-order-progress-card-counter')?.textContent).toBe('2 / 5');
    const fill = card?.querySelector('.claudian-work-order-progress-card-bar-fill') as any;
    expect(fill.style.width).toBe('40%'); // 2/5
    expect(card?.querySelector('.claudian-work-order-progress-card-note')?.textContent).toBe('src/ first');
  });

  it('omits counter and bar when done is missing', () => {
    const parent = createMockEl('div');
    renderWorkOrderProgressCard(parent as any, { step: 'thinking' });
    expect(parent.querySelector('.claudian-work-order-progress-card-counter')).toBeNull();
    expect(parent.querySelector('.claudian-work-order-progress-card-bar')).toBeNull();
  });

  it('omits the note line when note is missing', () => {
    const parent = createMockEl('div');
    renderWorkOrderProgressCard(parent as any, { step: 'thinking', done: { complete: 1, total: 1 } });
    expect(parent.querySelector('.claudian-work-order-progress-card-note')).toBeNull();
  });
});
