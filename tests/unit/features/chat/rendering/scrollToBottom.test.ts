import { createMockEl } from '@test/helpers/mockElement';

import { scrollMessagesToBottom } from '@/features/chat/rendering/scrollToBottom';

describe('scrollMessagesToBottom', () => {
  it('scrolls the trailing element into view without reading scrollHeight', () => {
    const messagesEl = createMockEl();
    messagesEl.createDiv({ cls: 'claudian-message' });
    const anchor = messagesEl.createDiv({ cls: 'claudian-message' });

    let scrollHeightReads = 0;
    Object.defineProperty(messagesEl, 'scrollHeight', {
      configurable: true,
      get() {
        scrollHeightReads += 1;
        return 9999;
      },
    });
    const scrollSpy = jest.spyOn(anchor, 'scrollIntoView');

    scrollMessagesToBottom(messagesEl);

    expect(scrollSpy).toHaveBeenCalledWith({ block: 'end' });
    expect(scrollHeightReads).toBe(0);
  });

  it('falls back to scrollTop write when the container is empty', () => {
    const messagesEl = createMockEl();
    Object.defineProperty(messagesEl, 'scrollHeight', { value: 500, configurable: true });
    messagesEl.scrollTop = 0;

    scrollMessagesToBottom(messagesEl);

    expect(messagesEl.scrollTop).toBe(500);
  });
});
