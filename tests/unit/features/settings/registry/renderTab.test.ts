/**
 * @jest-environment jsdom
 */
import '../../../../setup/obsidianDom';

// Stub ProviderRegistry so hasAnyProviderEnabled iterates the four built-in
// providers without pulling the full provider bootstrap (which transitively
// imports the MCP SDK ESM that breaks this jsdom suite). FirstRunBanner also
// renders from this registry now, so its metadata getters are stubbed too.
jest.mock('../../../../../src/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    getRegisteredProviderIds: () => ['claude', 'codex', 'opencode', 'cursor'],
    getProviderDisplayName: (id: string) => id,
    getFirstRunBlurb: (id: string) => `${id} blurb`,
    getCliCommand: (id: string) => id,
  },
}));

import { Setting } from 'obsidian';

import type { SpecoratorSettings } from '../../../../../src/core/types/settings';
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
    settings: { ...initial } as unknown as SpecoratorSettings,
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

    const sections = host.querySelectorAll('.specorator-settings-section');
    expect(sections).toHaveLength(2);

    const headingCalls = (Setting as any).instances
      .filter((s: any) => s.setHeading.mock.calls.length > 0)
      .map((s: any) => s.setName.mock.calls[0][0]);
    expect(headingCalls).toEqual(['Section One', 'Section Two']);

    const fieldsInS1 = sections[0].querySelectorAll('.specorator-settings-field');
    expect(fieldsInS1).toHaveLength(2);
    const fieldsInS2 = sections[1].querySelectorAll('.specorator-settings-field');
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

    const sections = host.querySelectorAll('.specorator-settings-section');
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

    const sections = host.querySelectorAll('.specorator-settings-section');
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

    const sections = host.querySelectorAll('.specorator-settings-section');
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

    const fields = host.querySelectorAll('.specorator-settings-field');
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

    expect(host.querySelectorAll('.specorator-settings-section')).toHaveLength(1);
    expect(host.querySelectorAll('.specorator-settings-field')).toHaveLength(1);
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

  describe('field disposer lifecycle', () => {
    it('returns a disposer that runs every field-level disposer in order', () => {
      const registry = new SettingsRegistry();
      registry.registerTab(makeTab('agentBoard'));
      registry.registerSection(makeSection('agentBoard', 's1', 'S1', 10));
      registry.registerField(makeField('agentBoard', 's1', 'a'));
      registry.registerField(makeField('agentBoard', 's1', 'b'));

      const disposeA = jest.fn();
      const disposeB = jest.fn();
      (renderField as jest.Mock)
        .mockReturnValueOnce(disposeA)
        .mockReturnValueOnce(disposeB);

      const host = document.createElement('div');
      const disposer = renderTab(host, 'agentBoard', makeCtx({ firstRunDismissed: true }), registry);

      expect(typeof disposer).toBe('function');
      (disposer as () => void)();
      expect(disposeA).toHaveBeenCalledTimes(1);
      expect(disposeB).toHaveBeenCalledTimes(1);
    });

    it('returns a no-op disposer when no field provided one', () => {
      const registry = new SettingsRegistry();
      registry.registerTab(makeTab('agentBoard'));
      registry.registerSection(makeSection('agentBoard', 's1', 'S1', 10));
      registry.registerField(makeField('agentBoard', 's1', 'a'));

      (renderField as jest.Mock).mockReturnValueOnce(undefined);

      const host = document.createElement('div');
      const disposer = renderTab(host, 'agentBoard', makeCtx({ firstRunDismissed: true }), registry);
      expect(typeof disposer).toBe('function');
      expect(() => (disposer as () => void)()).not.toThrow();
    });

    it('disposers from a prior render do not leak into a new render on a different host', () => {
      // Repro of the Agent Board lane-editor freeze: each SpecoratorSettings.display()
      // creates a fresh tab-content div, so a WeakMap keyed by host can never find
      // the previous disposers. The caller must hold the returned disposers and run
      // them before destroying the old host.
      const registry = new SettingsRegistry();
      registry.registerTab(makeTab('agentBoard'));
      registry.registerSection(makeSection('agentBoard', 's1', 'S1', 10));
      registry.registerField(makeField('agentBoard', 's1', 'a'));

      const disposeFirst = jest.fn();
      const disposeSecond = jest.fn();
      (renderField as jest.Mock)
        .mockReturnValueOnce(disposeFirst)
        .mockReturnValueOnce(disposeSecond);

      const firstHost = document.createElement('div');
      const firstDisposer = renderTab(firstHost, 'agentBoard', makeCtx({ firstRunDismissed: true }), registry);

      const secondHost = document.createElement('div');
      renderTab(secondHost, 'agentBoard', makeCtx({ firstRunDismissed: true }), registry);

      // Caller is responsible for running firstDisposer when the first host is gone.
      // Run it explicitly here; the second render must not auto-dispose it.
      expect(disposeFirst).not.toHaveBeenCalled();
      (firstDisposer as () => void)();
      expect(disposeFirst).toHaveBeenCalledTimes(1);
      expect(disposeSecond).not.toHaveBeenCalled();
    });

    it('does NOT auto-dispose when the same host is re-rendered (caller owns lifecycle)', () => {
      // The previous WeakMap implementation auto-disposed prior disposers when
      // a host was re-rendered. That coupling masked the cross-host bug because
      // callers never had to think about lifecycle. The new contract puts the
      // caller in charge: SpecoratorSettings.display() drains its own disposer
      // array at the top before re-rendering, and tests must lock that
      // ownership in so a future "convenience" auto-dispose cannot silently
      // come back.
      const registry = new SettingsRegistry();
      registry.registerTab(makeTab('agentBoard'));
      registry.registerSection(makeSection('agentBoard', 's1', 'S1', 10));
      registry.registerField(makeField('agentBoard', 's1', 'a'));

      const disposeA = jest.fn();
      const disposeB = jest.fn();
      (renderField as jest.Mock)
        .mockReturnValueOnce(disposeA)
        .mockReturnValueOnce(disposeB);

      const host = document.createElement('div');
      const ctx = makeCtx({ firstRunDismissed: true });

      const firstDisposer = renderTab(host, 'agentBoard', ctx, registry);
      renderTab(host, 'agentBoard', ctx, registry);

      expect(disposeA).not.toHaveBeenCalled();
      (firstDisposer as () => void)();
      expect(disposeA).toHaveBeenCalledTimes(1);
      expect(disposeB).not.toHaveBeenCalled();
    });

    it('keeps the registered event-bus listener count flat across many renders when the caller drains disposers', () => {
      // This is the regression guard for the exponential listener leak that
      // froze the Agent Board lane editor. A field that subscribes to a real
      // event bus must, when its disposer is invoked, fully release that
      // subscription so the bus's listener set does not grow over time.
      const registry = new SettingsRegistry();
      registry.registerTab(makeTab('agentBoard'));
      registry.registerSection(makeSection('agentBoard', 's1', 'S1', 10));
      registry.registerField(makeField('agentBoard', 's1', 'a'));

      const handlers = new Set<() => void>();
      const subscribe = (): (() => void) => {
        const handler = () => undefined;
        handlers.add(handler);
        return () => handlers.delete(handler);
      };
      (renderField as jest.Mock).mockImplementation(() => subscribe());

      const ctx = makeCtx({ firstRunDismissed: true });

      const RENDER_ROUNDS = 20;
      const disposers: Array<() => void> = [];
      for (let i = 0; i < RENDER_ROUNDS; i += 1) {
        if (disposers.length > 0) {
          const dispose = disposers.shift()!;
          dispose();
        }
        const host = document.createElement('div');
        disposers.push(renderTab(host, 'agentBoard', ctx, registry));
      }

      // After the loop one disposer remains undrained. Every prior render must
      // have released its subscription.
      expect(handlers.size).toBe(1);
      for (const dispose of disposers) dispose();
      expect(handlers.size).toBe(0);
    });
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

      const bannerHost = host.querySelector('.specorator-first-run-banner-host');
      expect(bannerHost).not.toBeNull();

      const firstSection = host.querySelector('.specorator-settings-section');
      expect(firstSection).not.toBeNull();
      const children = Array.from(host.children);
      expect(children.indexOf(bannerHost as Element)).toBeLessThan(
        children.indexOf(firstSection as Element),
      );
      expect(host.querySelector('.specorator-first-run-banner')).not.toBeNull();
    });

    it('omits the banner when firstRunDismissed is true', () => {
      const registry = setupGeneralWithSection();
      const host = document.createElement('div');
      const ctx = makeCtx({ firstRunDismissed: true, providerConfigs: {} });

      renderTab(host, 'general', ctx, registry);

      expect(host.querySelector('.specorator-first-run-banner-host')).toBeNull();
    });

    it('omits the banner when any provider is enabled', () => {
      const registry = setupGeneralWithSection();
      const host = document.createElement('div');
      const ctx = makeCtx({
        firstRunDismissed: false,
        providerConfigs: { claude: { enabled: true } },
      });

      renderTab(host, 'general', ctx, registry);

      expect(host.querySelector('.specorator-first-run-banner-host')).toBeNull();
    });

    it('omits the banner on non-general tabs even when conditions otherwise match', () => {
      const registry = new SettingsRegistry();
      registry.registerTab(makeTab('claude'));
      registry.registerSection(makeSection('claude', 's1', 'Section One', 10));
      registry.registerField(makeField('claude', 's1', 'a.b.c'));

      const host = document.createElement('div');
      const ctx = makeCtx({ firstRunDismissed: false, providerConfigs: {} });

      renderTab(host, 'claude', ctx, registry);

      expect(host.querySelector('.specorator-first-run-banner-host')).toBeNull();
    });
  });
});
