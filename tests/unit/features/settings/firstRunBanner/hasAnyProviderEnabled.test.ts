// Bootstraps provider registrations so ProviderRegistry.getRegisteredProviderIds resolves.
import '../../../../../src/providers';

import { ProviderRegistry } from '../../../../../src/core/providers/ProviderRegistry';
import type { ClaudianSettings } from '../../../../../src/core/types/settings';
import { hasAnyProviderEnabled } from '../../../../../src/features/settings/firstRunBanner/hasAnyProviderEnabled';

function s(c: boolean, x: boolean, o: boolean, u: boolean): ClaudianSettings {
  return {
    providerConfigs: {
      claude: { enabled: c },
      codex: { enabled: x },
      opencode: { enabled: o },
      cursor: { enabled: u },
    },
  } as unknown as ClaudianSettings;
}

describe('hasAnyProviderEnabled', () => {
  it('returns false when no provider is enabled', () => {
    expect(hasAnyProviderEnabled(s(false, false, false, false))).toBe(false);
  });
  it('returns true if claude is enabled', () => {
    expect(hasAnyProviderEnabled(s(true, false, false, false))).toBe(true);
  });
  it('returns true if any single provider is enabled', () => {
    expect(hasAnyProviderEnabled(s(false, false, true, false))).toBe(true);
  });
});

describe('hasAnyProviderEnabled — ordering source', () => {
  it('iterates ProviderRegistry.getRegisteredProviderIds', () => {
    const spy = jest.spyOn(ProviderRegistry, 'getRegisteredProviderIds');
    hasAnyProviderEnabled({ providerConfigs: {} } as never);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
