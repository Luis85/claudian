/**
 * Claudian - apply-patch expanded-render helpers.
 *
 * Extracted from ToolCallRenderer to keep `renderApplyPatchExpanded` below the
 * complexity thresholds. Each helper owns one fallback branch and reports
 * whether it produced output, so the parent stays a thin short-circuit chain.
 */

/** True when the result text looks like an apply-patch verification failure. */
export function isApplyPatchErrorResult(result: string | undefined): boolean {
  return Boolean(result) && /verification failed|^[Ee]rror:/.test((result as string).trim());
}

/**
 * Renders the terminal `result` fallback for apply-patch expansion: parse file
 * paths out of the free-text result, falling back to raw lines, or emit the
 * empty placeholder when there is no result. `renderLines` defers to the
 * caller's line renderer so this helper stays free of ToolCallRenderer state.
 */
export function renderApplyPatchResultFallback(
  container: HTMLElement,
  result: string | undefined,
  renderLines: (text: string, maxLines: number) => void,
): void {
  if (!result) {
    container.createDiv({ cls: 'claudian-tool-empty', text: 'No result' });
    return;
  }
  if (!renderApplyPatchResultFileMatches(container, result)) {
    renderLines(result, 20);
  }
}

function readMoveTarget(kind: unknown): string | undefined {
  if (!kind || typeof kind !== 'object' || Array.isArray(kind)) {
    return undefined;
  }
  const record = kind as Record<string, unknown>;
  return typeof record.move_path === 'string' ? record.move_path : undefined;
}

/**
 * Renders the `input.changes` path list (one line per file, with `path -> move`
 * when a rename is present). Returns true when at least the list container was
 * emitted, matching the original branch's "changes.length > 0" gate.
 */
export function renderApplyPatchChangeList(
  container: HTMLElement,
  changes: unknown,
): boolean {
  const list = Array.isArray(changes) ? changes : [];
  if (list.length === 0) return false;

  const linesEl = container.createDiv({ cls: 'claudian-tool-lines' });
  for (const change of list as unknown[]) {
    if (!change || typeof change !== 'object' || Array.isArray(change)) continue;
    const changeRecord = change as Record<string, unknown>;
    const path = typeof changeRecord.path === 'string' ? changeRecord.path : '';
    if (!path) continue;
    const movedTo = readMoveTarget(changeRecord.kind);
    const pathText = movedTo ? `${path} -> ${movedTo}` : path;
    linesEl.createDiv({ cls: 'claudian-tool-line', text: pathText });
  }
  return true;
}

/**
 * Renders file paths parsed out of a free-text apply-patch result. Returns true
 * when at least one path was found and rendered; false otherwise so the caller
 * can fall back to raw lines.
 */
export function renderApplyPatchResultFileMatches(
  container: HTMLElement,
  result: string,
): boolean {
  const fileMatches = [...result.matchAll(/(?:update|add|delete|create|modify|Applied:\s*)(?:\w+:\s*)?([^\n,]+)/gi)];
  if (fileMatches.length === 0) return false;

  const linesEl = container.createDiv({ cls: 'claudian-tool-lines' });
  for (const match of fileMatches) {
    const filePath = match[1]?.trim();
    if (filePath) {
      linesEl.createDiv({ cls: 'claudian-tool-line' }).setText(filePath);
    }
  }
  return true;
}
