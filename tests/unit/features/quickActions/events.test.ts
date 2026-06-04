import type { ClaudianEventMap } from '@/app/events/claudianEvents';
import { EventBus } from '@/core/events/EventBus';

describe('QuickActionsEventMap wiring', () => {
  it('exposes vaultSkill.changed with providerId payload via ClaudianEventMap', () => {
    const bus = new EventBus<ClaudianEventMap>();
    const received: Array<{ providerId: string }> = [];
    const off = bus.on('vaultSkill.changed', (p) => { received.push(p); });
    bus.emit('vaultSkill.changed', { providerId: 'claude' });
    off();
    expect(received).toEqual([{ providerId: 'claude' }]);
  });
});
