/**
 * Specorator - WebSearch expanded-render decision helpers.
 *
 * Extracted from ToolCallRenderer to keep `renderWebSearchExpanded` below the
 * complexity thresholds: the structured-data predicate and the parsed-links
 * branch are pure/standalone and carry most of the branching weight.
 */

export interface WebSearchExpandedData {
  actionType: string;
  query: string;
  queries: string[];
  url: string;
  pattern: string;
}

/** Mirrors the `result` placeholder check so callers stay branch-light. */
export function isPlaceholderWebSearchResult(result: string | undefined): boolean {
  if (!result) return true;
  const normalized = result.trim().toLowerCase();
  return normalized === '' || normalized === 'search complete';
}

/** True when the normalized input carries any renderable structured field. */
export function hasStructuredWebSearchData(data: WebSearchExpandedData): boolean {
  return Boolean(data.actionType || data.query || data.queries.length || data.url || data.pattern);
}

/**
 * Whether the action card should render ahead of any raw result. Page-open and
 * find-in-page always prefer the card; otherwise it renders only when the
 * result is absent or a placeholder.
 */
export function shouldRenderWebSearchAction(
  data: WebSearchExpandedData,
  result: string | undefined,
): boolean {
  if (!hasStructuredWebSearchData(data)) return false;
  return (
    !result
    || isPlaceholderWebSearchResult(result)
    || data.actionType === 'open_page'
    || data.actionType === 'find_in_page'
  );
}
