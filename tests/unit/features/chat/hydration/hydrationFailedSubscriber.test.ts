import { Notice } from 'obsidian';

import type { ClaudianEventMap } from '@/app/events/claudianEvents';
import type { EventBus } from '@/core/events/EventBus';
import { registerHydrationFailedSubscriber } from '@/features/chat/hydration/hydrationFailedSubscriber';

describe('hydrationFailedSubscriber', () => {
  afterEach(() => {
    (Notice as unknown as jest.Mock).mockClear();
  });

  function makeStubBus(): {
    bus: EventBus<ClaudianEventMap>;
    handlers: Record<string, (payload: unknown) => void>;
  } {
    const handlers: Record<string, (payload: unknown) => void> = {};
    const bus = {
      on: (name: string, h: (payload: unknown) => void) => {
        handlers[name] = h;
        return () => { delete handlers[name]; };
      },
    } as unknown as EventBus<ClaudianEventMap>;
    return { bus, handlers };
  }

  it('renders an Obsidian Notice on the event', () => {
    const { bus, handlers } = makeStubBus();
    const renderBanner = jest.fn();
    registerHydrationFailedSubscriber(bus, renderBanner);

    handlers['conversation:hydration-failed']({
      conversationId: 'c1',
      code: 'store-unreadable',
      message: 'Could not read history.',
    });

    expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Could not read history.'));
    expect(renderBanner).toHaveBeenCalledWith('c1', expect.objectContaining({ code: 'store-unreadable' }));
  });

  it('passes the error code into the banner so the UI can branch on sqlite-unavailable etc', () => {
    const { bus, handlers } = makeStubBus();
    const renderBanner = jest.fn();
    registerHydrationFailedSubscriber(bus, renderBanner);

    handlers['conversation:hydration-failed']({
      conversationId: 'c1',
      code: 'sqlite-unavailable',
      message: 'OpenCode history requires node:sqlite or the sqlite3 CLI.',
    });

    expect(renderBanner).toHaveBeenCalledWith('c1', expect.objectContaining({ code: 'sqlite-unavailable' }));
  });

  it('returns a disposer that removes the subscription', () => {
    const { bus, handlers } = makeStubBus();
    const renderBanner = jest.fn();
    const dispose = registerHydrationFailedSubscriber(bus, renderBanner);
    expect(typeof dispose).toBe('function');
    expect(handlers['conversation:hydration-failed']).toBeDefined();
    dispose();
    expect(handlers['conversation:hydration-failed']).toBeUndefined();
  });
});
