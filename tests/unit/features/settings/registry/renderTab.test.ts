/**
 * @jest-environment jsdom
 */
import '../../../../setup/obsidianDom';

import { Setting } from 'obsidian';

import type { ClaudianSettings } from '../../../../../src/core/types/settings';
import { renderTab } from '../../../../../src/features/settings/registry/renderTab';
import type {
  SettingsCtx,
  SettingsField,
  SettingsSection,
  SettingsTab,
} from '../../../../../src/features/settings/registry/SettingsField';
import { SettingsRegistry } from '../../../../../src/features/settings/registry/SettingsRegistry';

jest.mock('../../../../../src/features/settings/registry/renderField', () => ({
  renderField: jest.fn(),
}));

import { renderField } from '../../../../../src/features/settings/registry/renderField';

function makeCtx(initial: Record<string, unknown> = {}): SettingsCtx {
  return {
    settings: { ...initial } as unknown as ClaudianSettings,
    saveSettings: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn(),
    // Plugin handle is exercised by F4/F5 widget tests; renderTab only
    // forwards ctx through to renderField, so a stub satisfies the contract.
    plugin: {} as SettingsCtx['plugin'],
  };
}

function makeTab(id: string): SettingsTab {
  return { id, label: id.toUpperCase(), order: 1, visible: () => true };
}

function makeSection(
  tabId: string,
  id: string,
  label: string,
  order: number,
  opts: Partial<SettingsSection> = {},
): SettingsSection {
  return { id, tabId, label, order, ...opts };
}

function makeField(tabId: string, sectionId: string, id: string): SettingsField<boolean> {
  return {
    id,
    tabId,
    sectionId,
    label: id,
    type: { kind: 'toggle' },
    default: false,
  };
}

beforeEach(() => {
  (renderField as jest.Mock).mockClear();
});

describe('renderTab', () => {
  it('renders each visible section heading in order with section + field DOM', () => {
    const registry = new SettingsRegistry();
    registry.registerTab(makeTab('general'));
    registry.registerSection(makeSection('general', 's1', 'Section One', 10));
    registry.registerSection(makeSection('general', 's2', 'Section Two', 20));
    registry.registerField(makeField('general', 's1', 'a.b.c'));
    registry.registerField(makeField('general', 's1', 'a.b.d'));
    registry.registerField(makeField('general', 's2', 'x.y.z'));
    registry.registerField(makeField('general', 's2', 'x.y.w'));

    const host = document.createElement('div');
    const ctx = makeCtx({ firstRunDismissed: true });

    (Setting as any).instances = [];
    renderTab(host, 'general', ctx, registry);

    const sections = host.querySelectorAll('.claudian-settings-section');
    expect(sections).toHaveLength(2);

    const headingCalls = (Setting as any).instances
      .filter((s: any) => s.setHeading.mock.calls.length > 0)
      .map((s: any) => s.setName.mock.calls[0][0]);
    expect(headingCalls).toEqual(['Section One', 'Section Two']);

    const fieldsInS1 = sections[0].querySelectorAll('.claudian-settings-field');
    expect(fieldsInS1).toHaveLength(2);
    const fieldsInS2 = sections[1].querySelectorAll('.claudian-settings-field');
    expect(fieldsInS2).toHaveLength(2);

    expect((renderField as jest.Mock)).toHaveBeenCalledTimes(4);
  });

  it('skips sections whose visible predicate returns false', () => {
    const registry = new SettingsRegistry();
    registry.registerTab(makeTab('general'));
    registry.registerSection(makeSection('general', 'visible', 'Visible', 10));
    registry.registerSection(
      makeSection('general', 'hidden', 'Hidden', 20, { visible: () => false }),
    );
    registry.registerField(makeField('general', 'visible', 'v.f'));
    registry.registerField(makeField('general', 'hidden', 'h.f'));

    const host = document.createElement('div');
    renderTab(host, 'general', makeCtx(), registry);

    const sections = host.querySelectorAll('.claudian-settings-section');
    expect(sections).toHaveLength(1);
    expect(sections[0].getAttribute('data-section-id')).toBe('visible');
    expect((renderField as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('sets data-section-id on each section element', () => {
    const registry = new SettingsRegistry();
    registry.registerTab(makeTab('general'));
    registry.registerSection(makeSection('general', 's1', 'S1', 10));
    registry.registerSection(makeSection('general', 's2', 'S2', 20));
    registry.registerField(makeField('general', 's1', 's1.f'));
    registry.registerField(makeField('general', 's2', 's2.f'));

    const host = document.createElement('div');
    renderTab(host, 'general', makeCtx(), registry);

    const sections = host.querySelectorAll('.claudian-settings-section');
    expect(Array.from(sections).map((s) => s.getAttribute('data-section-id'))).toEqual([
      's1',
      's2',
    ]);
  });

  it('skips sections with zero fields', () => {
    const registry = new SettingsRegistry();
    registry.registerTab(makeTab('general'));
    registry.registerSection(makeSection('general', 'withFields', 'With', 10));
    registry.registerSection(makeSection('general', 'empty', 'Empty', 20));
    registry.registerField(makeField('general', 'withFields', 'f.one'));

    const host = document.createElement('div');
    renderTab(host, 'general', makeCtx({ firstRunDismissed: true }), registry);

    const sections = host.querySelectorAll('.claudian-settings-section');
    expect(sections).toHaveLength(1);
    expect(sections[0].getAttribute('data-section-id')).toBe('withFields');
    expect((renderField as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('sets data-field-id on each field row element', () => {
    const registry = new SettingsRegistry();
    registry.registerTab(makeTab('general'));
    registry.registerSection(makeSection('general', 's1', 'S1', 10));
    registry.registerField(makeField('general', 's1', 'alpha.beta'));
    registry.registerField(makeField('general', 's1', 'gamma.delta'));

    const host = document.createElement('div');
    renderTab(host, 'general', makeCtx(), registry);

    const fields = host.querySelectorAll('.claudian-settings-field');
    expect(Array.from(fields).map((f) => f.getAttribute('data-field-id'))).toEqual([
      'alpha.beta',
      'gamma.delta',
    ]);
  });

  it('passes section description to Setting.setDesc when present', () => {
    const registry = new SettingsRegistry();
    registry.registerTab(makeTab('general'));
    registry.registerSection(
      makeSection('general', 's1', 'With desc', 10, { description: 'Details here' }),
    );
    registry.registerSection(makeSection('general', 's2', 'No desc', 20));
    registry.registerField(makeField('general', 's1', 's1.f'));
    registry.registerField(makeField('general', 's2', 's2.f'));

    const host = document.createElement('div');
    (Setting as any).instances = [];
    renderTab(host, 'general', makeCtx(), registry);

    const headingsWithDesc = (Setting as any).instances
      .filter((s: any) => s.setHeading.mock.calls.length > 0);
    expect(headingsWithDesc[0].setDesc).toHaveBeenCalledWith('Details here');
    expect(headingsWithDesc[1].setDesc).not.toHaveBeenCalled();
  });

  it('empties host before rendering on each call (no double-render)', () => {
    const registry = new SettingsRegistry();
    registry.registerTab(makeTab('general'));
    registry.registerSection(makeSection('general', 's1', 'S1', 10));
    registry.registerField(makeField('general', 's1', 'f.one'));

    const host = document.createElement('div');
    const ctx = makeCtx();

    renderTab(host, 'general', ctx, registry);
    renderTab(host, 'general', ctx, registry);

    expect(host.querySelectorAll('.claudian-settings-section')).toHaveLength(1);
    expect(host.querySelectorAll('.claudian-settings-field')).toHaveLength(1);
  });

  it('renders nothing when the tab has no visible sections', () => {
    const registry = new SettingsRegistry();
    registry.registerTab(makeTab('general'));

    const host = document.createElement('div');
    host.appendChild(document.createElement('span'));
    renderTab(host, 'general', makeCtx({ firstRunDismissed: true }), registry);

    expect(host.children).toHaveLength(0);
    expect((renderField as jest.Mock)).not.toHaveBeenCalled();
  });

  describe('first-run banner', () => {
    function setupGeneralWithSection(): SettingsRegistry {
      const registry = new SettingsRegistry();
      registry.registerTab(makeTab('general'));
      registry.registerSection(makeSection('general', 's1', 'Section One', 10));
      registry.registerField(makeField('general', 's1', 'a.b.c'));
      return registry;
    }

    it('mounts banner host above the first section when not dismissed and no provider enabled', () => {
      const registry = setupGeneralWithSection();
      const host = document.createElement('div');
      const ctx = makeCtx({ firstRunDismissed: false, providerConfigs: {} });

      renderTab(host, 'general', ctx, registry);

      const bannerHost = host.querySelector('.claudian-first-run-banner-host');
      expect(bannerHost).not.toBeNull();

      const firstSection = host.querySelector('.claudian-settings-section');
      expect(firstSection).not.toBeNull();
      const children = Array.from(host.children);
      expect(children.indexOf(bannerHost as Element)).toBeLessThan(
        children.indexOf(firstSection as Element),
      );
      expect(host.querySelector('.claudian-first-run-banner')).not.toBeNull();
    });

    it('omits the banner when firstRunDismissed is true', () => {
      const registry = setupGeneralWithSection();
      const host = document.createElement('div');
      const ctx = makeCtx({ firstRunDismissed: true, providerConfigs: {} });

      renderTab(host, 'general', ctx, registry);

      expect(host.querySelector('.claudian-first-run-banner-host')).toBeNull();
    });

    it('omits the banner when any provider is enabled', () => {
      const registry = setupGeneralWithSection();
      const host = document.createElement('div');
      const ctx = makeCtx({
        firstRunDismissed: false,
        providerConfigs: { claude: { enabled: true } },
      });

      renderTab(host, 'general', ctx, registry);

      expect(host.querySelector('.claudian-first-run-banner-host')).toBeNull();
    });

    it('omits the banner on non-general tabs even when conditions otherwise match', () => {
      const registry = new SettingsRegistry();
      registry.registerTab(makeTab('claude'));
      registry.registerSection(makeSection('claude', 's1', 'Section One', 10));
      registry.registerField(makeField('claude', 's1', 'a.b.c'));

      const host = document.createElement('div');
      const ctx = makeCtx({ firstRunDismissed: false, providerConfigs: {} });

      renderTab(host, 'claude', ctx, registry);

      expect(host.querySelector('.claudian-first-run-banner-host')).toBeNull();
    });
  });
});
