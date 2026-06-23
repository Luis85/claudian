import type { SpecoratorEventMap } from '@/app/events/specoratorEvents';
import { EventBus } from '@/core/events/EventBus';

describe('QuickActionsEventMap wiring', () => {
  it('exposes vaultSkill.changed with providerId payload via SpecoratorEventMap', () => {
    const bus = new EventBus<SpecoratorEventMap>();
    const received: Array<{ providerId: string }> = [];
    const off = bus.on('vaultSkill.changed', (p) => { received.push(p); });
    bus.emit('vaultSkill.changed', { providerId: 'claude' });
    off();
    expect(received).toEqual([{ providerId: 'claude' }]);
  });
});
