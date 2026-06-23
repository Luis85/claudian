/**
 * @jest-environment jsdom
 */
import '../../../../setup/obsidianDom';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ProviderId, ProviderRegistration } from '@/core/providers/types';

import { FirstRunBanner } from '../../../../../src/features/settings/firstRunBanner/FirstRunBanner';

// Stub registrations instead of importing `@/providers`: the real aggregator
// drags the MCP SDK's ESM-only deps into jsdom, and the banner only needs the
// registry's first-run metadata surface. Real providers' metadata completeness
// is enforced by tests/unit/core/providers/providerRegistrationContract.test.ts.
const STUBS: Array<{ id: ProviderId; name: string; blurb: string; cli: string }> = [
  { id: 'claude', name: 'Claude', blurb: 'Anthropic Claude Code', cli: 'claude' },
  { id: 'stub-beta', name: 'Beta', blurb: 'Beta CLI agent', cli: 'beta-cli' },
  { id: 'stub-gamma', name: 'Gamma', blurb: 'Gamma CLI server', cli: 'gamma' },
];

beforeAll(() => {
  for (const stub of STUBS) {
    ProviderRegistry.register(stub.id, {
      displayName: stub.name,
      firstRunBlurb: stub.blurb,
      cliCommand: stub.cli,
    } as ProviderRegistration);
  }
});

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

  it('renders one row per registered provider (registry-driven, no local list)', () => {
    const host = document.createElement('div');
    const ctx = makeCtx();
    new FirstRunBanner(host, ctx as any).render();
    const ids = ProviderRegistry.getRegisteredProviderIds();
    const rows = [...host.querySelectorAll<HTMLElement>('.specorator-first-run-row')];
    expect(rows.map((row) => row.dataset.provider)).toEqual(ids);
  });

  it.each(STUBS.map((stub) => stub.id))(
    'row for "%s" shows registry display name, blurb, and CLI command',
    (id) => {
      const host = document.createElement('div');
      new FirstRunBanner(host, makeCtx() as any).render();
      const row = host.querySelector<HTMLElement>(`[data-provider="${id}"]`);
      expect(row).not.toBeNull();
      expect(row!.querySelector('strong')?.textContent).toBe(
        ProviderRegistry.getProviderDisplayName(id),
      );
      expect(row!.textContent).toContain(ProviderRegistry.getFirstRunBlurb(id));
      expect(row!.querySelector('code')?.textContent).toBe(ProviderRegistry.getCliCommand(id));
    },
  );

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
