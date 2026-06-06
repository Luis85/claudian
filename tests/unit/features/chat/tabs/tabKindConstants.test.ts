import {
  DEFAULT_MAX_CHAT_TABS,
  MAX_TABS,
  MAX_WORK_ORDER_TABS,
  MIN_TABS,
  MIN_WORK_ORDER_TABS,
} from '../../../../../src/features/chat/tabs/types';

describe('tab kind constants', () => {
  it('chat default sits inside the chat bounds', () => {
    expect(DEFAULT_MAX_CHAT_TABS).toBeGreaterThanOrEqual(MIN_TABS);
    expect(DEFAULT_MAX_CHAT_TABS).toBeLessThanOrEqual(MAX_TABS);
  });

  it('keeps the historical chat default at 3', () => {
    expect(DEFAULT_MAX_CHAT_TABS).toBe(3);
  });

  it('work-order range matches the Agent Board queue cap range', () => {
    expect(MIN_WORK_ORDER_TABS).toBe(1);
    expect(MAX_WORK_ORDER_TABS).toBe(8);
  });
});
