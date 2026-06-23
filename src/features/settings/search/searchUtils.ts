import type { SpecoratorSettings } from '../../../core/types/settings';
import type { SettingsField } from '../registry/SettingsField';

/**
 * Searches settings fields by query string.
 * Matches against field label, description, and keywords (case-insensitive).
 * Excludes fields whose `visible(settings)` predicate returns false so the
 * search surface mirrors what the user can actually configure right now.
 */
export function searchFields(
  fields: SettingsField[],
  query: string,
  settings?: SpecoratorSettings,
): SettingsField[] {
  if (!query.trim()) {
    return [];
  }

  const lowercaseQuery = query.toLowerCase();

  return fields.filter((field) => {
    if (settings && field.visible && !field.visible(settings)) {
      return false;
    }
    const label = field.label.toLowerCase();
    const description = field.description?.toLowerCase() || '';
    const keywords = (field.keywords || []).map((k) => k.toLowerCase()).join(' ');

    return (
      label.includes(lowercaseQuery) ||
      description.includes(lowercaseQuery) ||
      keywords.includes(lowercaseQuery)
    );
  });
}
