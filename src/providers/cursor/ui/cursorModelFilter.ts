import { formatCursorModelLabel } from '../modelLabels';

// Pure predicate for the settings model list. Matches case-insensitively
// against both the raw id and its pretty label. An empty query matches all.
export function matchesCursorModelQuery(rawId: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const id = rawId.toLowerCase();
  const label = formatCursorModelLabel(rawId).toLowerCase();
  return id.includes(needle) || label.includes(needle);
}
