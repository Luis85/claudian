import { createMockEl } from '@test/helpers/mockElement';

import { renderWorkOrderProgressCard } from '../../../../../src/features/chat/rendering/WorkOrderProgressCard';

describe('renderWorkOrderProgressCard', () => {
  it('renders step text and done/total with a progress bar', () => {
    const parent = createMockEl('div');
    renderWorkOrderProgressCard(parent as any, { step: 'scanning files', done: { complete: 2, total: 5 }, note: 'src/ first' });

    const card = parent.querySelector('.specorator-work-order-progress-card');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.specorator-work-order-progress-card-step')?.textContent).toBe('scanning files');
    expect(card?.querySelector('.specorator-work-order-progress-card-counter')?.textContent).toBe('2 / 5');
    const fill = card?.querySelector('.specorator-work-order-progress-card-bar-fill') as any;
    expect(fill.style.width).toBe('40%'); // 2/5
    expect(card?.querySelector('.specorator-work-order-progress-card-note')?.textContent).toBe('src/ first');
  });

  it('omits counter and bar when done is missing', () => {
    const parent = createMockEl('div');
    renderWorkOrderProgressCard(parent as any, { step: 'thinking' });
    expect(parent.querySelector('.specorator-work-order-progress-card-counter')).toBeNull();
    expect(parent.querySelector('.specorator-work-order-progress-card-bar')).toBeNull();
  });

  it('omits the note line when note is missing', () => {
    const parent = createMockEl('div');
    renderWorkOrderProgressCard(parent as any, { step: 'thinking', done: { complete: 1, total: 1 } });
    expect(parent.querySelector('.specorator-work-order-progress-card-note')).toBeNull();
  });

  it('renders progress bar at 0% when total is zero', () => {
    const parent = createMockEl('div');
    renderWorkOrderProgressCard(parent as unknown as HTMLElement, {
      step: 'init',
      done: { complete: 0, total: 0 },
    });
    const fill = parent.querySelector('.specorator-work-order-progress-card-bar-fill') as any;
    expect(fill?.style.width).toBe('0%');
    const counter = parent.querySelector('.specorator-work-order-progress-card-counter');
    expect(counter?.textContent).toBe('0 / 0');
  });

  it('clamps progress bar at 100% when complete exceeds total', () => {
    const parent = createMockEl('div');
    renderWorkOrderProgressCard(parent as unknown as HTMLElement, {
      step: 's',
      done: { complete: 7, total: 3 },
    });
    const fill = parent.querySelector('.specorator-work-order-progress-card-bar-fill') as any;
    expect(fill?.style.width).toBe('100%');
  });

  it('renders progress bar at 100% when complete equals total', () => {
    const parent = createMockEl('div');
    renderWorkOrderProgressCard(parent as unknown as HTMLElement, {
      step: 'done',
      done: { complete: 5, total: 5 },
    });
    const fill = parent.querySelector('.specorator-work-order-progress-card-bar-fill') as any;
    expect(fill?.style.width).toBe('100%');
  });
});
