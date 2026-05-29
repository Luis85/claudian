import type { ChatMessage, ChatMessageAction } from '@/core/types';
import { eligibleMessageActions } from '@/features/chat/rendering/messageActions';

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', role: 'user', content: 'hi', timestamp: 0, ...over,
});

const action = (over: Partial<ChatMessageAction> = {}): ChatMessageAction => ({
  id: 'a', label: 'A', icon: 'star', isEligible: () => true, run: () => {}, ...over,
});

describe('eligibleMessageActions', () => {
  it('keeps eligible actions and drops ineligible ones', () => {
    const yes = action({ id: 'yes' });
    const no = action({ id: 'no', isEligible: () => false });
    expect(eligibleMessageActions([yes, no], msg()).map((a) => a.id)).toEqual(['yes']);
  });

  it('treats a throwing predicate as ineligible', () => {
    const boom = action({ id: 'boom', isEligible: () => { throw new Error('x'); } });
    expect(eligibleMessageActions([boom], msg())).toEqual([]);
  });
});
