import { opencodeChatUIConfig } from '@/providers/opencode/ui/OpencodeChatUIConfig';

describe('opencodeChatUIConfig.getAvailableModes', () => {
  it('returns id/label pairs for non-empty mode ids', () => {
    const settings = {
      providerConfigs: {
        opencode: {
          availableModes: [
            { id: 'plan', name: 'Plan' },
            { id: 'safe', name: 'Safe' },
            { id: '', name: 'Skipped' },
            { id: 'name-only', name: '' },
          ],
        },
      },
    };
    const modes = opencodeChatUIConfig.getAvailableModes?.(settings);
    expect(modes).toEqual([
      { id: 'plan', label: 'Plan' },
      { id: 'safe', label: 'Safe' },
      { id: 'name-only', label: 'name-only' },
    ]);
  });

  it('returns an empty array when availableModes is missing', () => {
    expect(opencodeChatUIConfig.getAvailableModes?.({})).toEqual([]);
  });
});
