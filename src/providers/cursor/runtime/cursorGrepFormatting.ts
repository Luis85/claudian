/**
 * Cursor grep-result formatting.
 *
 * Extracted from `cursorToolNormalization` so the success-formatter for
 * `grepToolCall` (a multi-level `workspaceResults` → `content` → `matches`
 * walk) stays readable and isolated. The two value coercions it relies on
 * (`stringValue`, `numericValue`) are passed in by the caller so this module
 * shares a single source of truth with the normalization layer rather than
 * duplicating those primitives.
 */

export interface CursorGrepValueCoercions {
  stringValue: (value: unknown) => string;
  numericValue: (value: unknown) => number | null;
}

interface CursorGrepWorkspaceContent {
  totalLines: number;
  totalMatched: number;
  matches: unknown;
}

/** Reads the `content` block out of one workspace payload, or null if absent. */
function readWorkspaceContent(
  payload: unknown,
  coerce: CursorGrepValueCoercions,
): CursorGrepWorkspaceContent | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const content = (payload as { content?: unknown }).content;
  if (!content || typeof content !== 'object') {
    return null;
  }
  return {
    totalLines: coerce.numericValue((content as { totalLines?: unknown }).totalLines) ?? 0,
    totalMatched: coerce.numericValue((content as { totalMatchedLines?: unknown }).totalMatchedLines) ?? 0,
    matches: (content as { matches?: unknown }).matches,
  };
}

/** Formats the per-workspace summary line, prefixing the name only when multiple workspaces are present. */
function formatWorkspaceSummary(
  workspace: string,
  content: CursorGrepWorkspaceContent,
  multipleWorkspaces: boolean,
): string {
  const summary = `${content.totalMatched} matches across ${content.totalLines} lines`;
  return multipleWorkspaces ? `[${workspace}] ${summary}` : summary;
}

/** Formats a single match row as `file:line: text`, dropping empty prefix parts. */
function formatMatchLine(match: unknown, coerce: CursorGrepValueCoercions): string | null {
  if (!match || typeof match !== 'object') {
    return null;
  }
  const file = coerce.stringValue((match as { file?: unknown }).file);
  const line = coerce.numericValue((match as { line?: unknown }).line);
  const text = coerce.stringValue((match as { text?: unknown }).text);
  const prefix = [file, line].filter(Boolean).join(':');
  return prefix ? `${prefix}: ${text}` : text;
}

export function formatCursorGrepSuccess(
  success: Record<string, unknown>,
  coerce: CursorGrepValueCoercions,
): string {
  const workspaceResults = success.workspaceResults;
  if (!workspaceResults || typeof workspaceResults !== 'object') {
    return '';
  }

  const entries = Object.entries(workspaceResults as Record<string, unknown>);
  const multipleWorkspaces = entries.length > 1;
  const lines: string[] = [];

  for (const [workspace, payload] of entries) {
    const content = readWorkspaceContent(payload, coerce);
    if (!content) {
      continue;
    }

    lines.push(formatWorkspaceSummary(workspace, content, multipleWorkspaces));

    if (Array.isArray(content.matches)) {
      for (const match of content.matches) {
        const matchLine = formatMatchLine(match, coerce);
        if (matchLine !== null) {
          lines.push(matchLine);
        }
      }
    }
  }

  return lines.join('\n').trim();
}
