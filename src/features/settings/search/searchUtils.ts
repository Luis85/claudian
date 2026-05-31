import type { SettingsField } from '../registry/SettingsField';

/**
 * Searches settings fields by query string.
 * Matches against field label, description, and keywords (case-insensitive).
 */
export function searchFields(fields: SettingsField[], query: string): SettingsField[] {
  if (!query.trim()) {
    return [];
  }

  const lowercaseQuery = query.toLowerCase();

  return fields.filter((field) => {
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
