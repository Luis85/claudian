import type { ClaudianSettings } from '../../../../../src/core/types/settings';
import type {
  SettingsField,
  SettingsSection,
  SettingsTab,
} from '../../../../../src/features/settings/registry/SettingsField';
import { SettingsRegistry } from '../../../../../src/features/settings/registry/SettingsRegistry';

function makeSettings(): ClaudianSettings {
  return { providerConfigs: {} } as unknown as ClaudianSettings;
}

describe('SettingsRegistry', () => {
  it('registers and lists visible tabs in order', () => {
    const r = new SettingsRegistry();
    const a: SettingsTab = { id: 'a', label: 'A', order: 20, visible: () => true };
    const b: SettingsTab = { id: 'b', label: 'B', order: 10, visible: () => true };
    const hidden: SettingsTab = { id: 'h', label: 'H', order: 30, visible: () => false };
    r.registerTab(a);
    r.registerTab(b);
    r.registerTab(hidden);
    expect(r.getTabs(makeSettings()).map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('rejects duplicate tab ids', () => {
    const r = new SettingsRegistry();
    r.registerTab({ id: 'a', label: 'A', order: 1, visible: () => true });
    expect(() =>
      r.registerTab({ id: 'a', label: 'A2', order: 2, visible: () => true }),
    ).toThrow(/duplicate tab id/i);
  });

  it('rejects duplicate field ids', () => {
    const r = new SettingsRegistry();
    const f: SettingsField<boolean> = {
      id: 'x.y',
      tabId: 'a',
      sectionId: 's',
      label: 'X',
      type: { kind: 'toggle' },
      default: false,
    };
    r.registerField(f);
    expect(() => r.registerField(f)).toThrow(/duplicate field id/i);
  });

  it('groups fields by tab and section in order', () => {
    const r = new SettingsRegistry();
    r.registerTab({ id: 'a', label: 'A', order: 1, visible: () => true });
    const s1: SettingsSection = { id: 's1', tabId: 'a', label: 'S1', order: 10 };
    const s2: SettingsSection = { id: 's2', tabId: 'a', label: 'S2', order: 20 };
    r.registerSection(s1);
    r.registerSection(s2);
    r.registerField({
      id: 'a.s1.x',
      tabId: 'a',
      sectionId: 's1',
      label: 'X',
      type: { kind: 'toggle' },
      default: false,
    });
    r.registerField({
      id: 'a.s2.y',
      tabId: 'a',
      sectionId: 's2',
      label: 'Y',
      type: { kind: 'toggle' },
      default: false,
    });
    expect(r.getSections('a', makeSettings()).map((s) => s.id)).toEqual(['s1', 's2']);
    expect(r.getFields('a', 's1', makeSettings()).map((f) => f.id)).toEqual(['a.s1.x']);
  });

  it('skips fields whose visible predicate returns false', () => {
    const r = new SettingsRegistry();
    r.registerTab({ id: 'a', label: 'A', order: 1, visible: () => true });
    r.registerSection({ id: 's', tabId: 'a', label: 'S', order: 1 });
    r.registerField({
      id: 'a.s.x',
      tabId: 'a',
      sectionId: 's',
      label: 'X',
      type: { kind: 'toggle' },
      default: false,
      visible: () => false,
    });
    expect(r.getFields('a', 's', makeSettings())).toEqual([]);
  });

  it('search returns fields matched by label, description, and keywords', () => {
    const r = new SettingsRegistry();
    r.registerTab({ id: 'a', label: 'A', order: 1, visible: () => true });
    r.registerSection({ id: 's', tabId: 'a', label: 'S', order: 1 });
    r.registerField({
      id: 'a.s.context',
      tabId: 'a',
      sectionId: 's',
      label: 'Context window',
      description: 'Maximum number of tokens',
      type: { kind: 'number' },
      default: 200_000,
      keywords: ['tokens', 'budget'],
    });
    expect(r.search('context', makeSettings()).map((f) => f.id)).toContain('a.s.context');
    expect(r.search('tokens', makeSettings()).map((f) => f.id)).toContain('a.s.context');
    expect(r.search('zzz', makeSettings())).toEqual([]);
  });

  it('search excludes fields hidden by visible predicate', () => {
    const r = new SettingsRegistry();
    r.registerTab({ id: 'a', label: 'A', order: 1, visible: () => true });
    r.registerSection({ id: 's', tabId: 'a', label: 'S', order: 1 });
    r.registerField({
      id: 'a.s.hidden',
      tabId: 'a',
      sectionId: 's',
      label: 'Hidden field',
      type: { kind: 'toggle' },
      default: false,
      visible: () => false,
    });
    expect(r.search('hidden', makeSettings())).toEqual([]);
  });
});
