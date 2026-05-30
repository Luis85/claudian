/**
 * @jest-environment jsdom
 */
import '../../../../setup/obsidianDom';

import { FirstRunBanner } from '../../../../../src/features/settings/firstRunBanner/FirstRunBanner';

describe('FirstRunBanner', () => {
  function makeCtx() {
    let settings: any = { firstRunDismissed: false, providerConfigs: {} };
    const saved: any[] = [];
    return {
      get settings() {
        return settings;
      },
      set settings(s: any) {
        settings = s;
      },
      saveSettings: async () => {
        saved.push(JSON.parse(JSON.stringify(settings)));
      },
      refresh: jest.fn(),
      saved,
    };
  }

  it('renders four provider rows with enable checkboxes', () => {
    const host = document.createElement('div');
    const ctx = makeCtx();
    new FirstRunBanner(host, ctx as any).render();
    expect(host.querySelectorAll('.claudian-first-run-row').length).toBe(4);
  });

  it('Enable selected writes the chosen providers and dismisses', async () => {
    const host = document.createElement('div');
    const ctx = makeCtx();
    const banner = new FirstRunBanner(host, ctx as any);
    banner.render();
    (host.querySelector('[data-provider="claude"] input[type="checkbox"]') as HTMLInputElement).checked = true;
    (host.querySelector('[data-action="enable"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(ctx.settings.providerConfigs.claude.enabled).toBe(true);
    expect(ctx.settings.firstRunDismissed).toBe(true);
  });

  it('Dismiss sets firstRunDismissed without enabling anything', async () => {
    const host = document.createElement('div');
    const ctx = makeCtx();
    const banner = new FirstRunBanner(host, ctx as any);
    banner.render();
    (host.querySelector('[data-action="dismiss"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(ctx.settings.firstRunDismissed).toBe(true);
    expect(ctx.settings.providerConfigs.claude?.enabled).toBeUndefined();
  });
});
