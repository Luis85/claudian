import type { SpecoratorSettings } from '@/core/types/settings';
import type { SettingsField } from '@/features/settings/registry/SettingsField';
import { searchFields } from '@/features/settings/search/searchUtils';

function makeField(overrides: Partial<SettingsField> = {}): SettingsField {
  return {
    id: 'test.field',
    tabId: 'general',
    sectionId: 'providers',
    label: 'Test Field',
    type: { kind: 'toggle' },
    default: false,
    ...overrides,
  };
}

function makeSettings(): SpecoratorSettings {
  return { providerConfigs: {} } as unknown as SpecoratorSettings;
}

describe('searchFields', () => {
  it('returns [] for empty query', () => {
    const fields = [makeField()];
    expect(searchFields(fields, '')).toEqual([]);
    expect(searchFields(fields, '   ')).toEqual([]);
  });

  it('matches by label (case-insensitive)', () => {
    const fields = [
      makeField({ id: 'a', label: 'Enable Claude' }),
      makeField({ id: 'b', label: 'Enable Codex' }),
    ];
    expect(searchFields(fields, 'claude').map((f) => f.id)).toEqual(['a']);
    expect(searchFields(fields, 'CLAUDE').map((f) => f.id)).toEqual(['a']);
  });

  it('matches by description', () => {
    const fields = [
      makeField({ id: 'a', label: 'Tab bar', description: 'Where to put tabs' }),
    ];
    expect(searchFields(fields, 'put tabs')).toHaveLength(1);
  });

  it('matches by keywords', () => {
    const fields = [
      makeField({ id: 'a', label: 'Context window', keywords: ['tokens', 'budget'] }),
    ];
    expect(searchFields(fields, 'tokens').map((f) => f.id)).toEqual(['a']);
    expect(searchFields(fields, 'budget').map((f) => f.id)).toEqual(['a']);
  });

  it('returns no results when query does not match', () => {
    const fields = [makeField({ label: 'Enable Claude' })];
    expect(searchFields(fields, 'xyz')).toEqual([]);
  });

  it('excludes fields whose visible() predicate returns false', () => {
    const fields = [
      makeField({ id: 'visible', label: 'Visible field' }),
      makeField({ id: 'hidden', label: 'Hidden field', visible: () => false }),
    ];
    const settings = makeSettings();
    const results = searchFields(fields, 'field', settings);
    expect(results.map((f) => f.id)).toEqual(['visible']);
  });

  it('includes fields whose visible() returns true', () => {
    const fields = [
      makeField({ id: 'enabled', label: 'Enabled field', visible: () => true }),
    ];
    expect(searchFields(fields, 'enabled', makeSettings()).map((f) => f.id)).toEqual(['enabled']);
  });

  it('skips visibility check when settings argument omitted (back-compat)', () => {
    const fields = [
      makeField({ id: 'hidden', label: 'Hidden field', visible: () => false }),
    ];
    // Without settings, the visibility predicate is not evaluated.
    expect(searchFields(fields, 'hidden').map((f) => f.id)).toEqual(['hidden']);
  });
});
