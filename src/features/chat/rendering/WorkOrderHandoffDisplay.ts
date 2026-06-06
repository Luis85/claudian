export const HANDOFF_PREVIEW_MAX_CHARS = 160;

export interface ParsedHandoffForDisplay {
  summary: string;
  verification: string;
  risks: string;
  nextAction: string;
}

export interface WorkOrderHandoffDisplaySegment {
  type: 'handoff';
  handoff: ParsedHandoffForDisplay;
  preview: string;
}

export interface WorkOrderMarkdownDisplaySegment {
  type: 'markdown';
  content: string;
}

export type WorkOrderHandoffSegment =
  | WorkOrderMarkdownDisplaySegment
  | WorkOrderHandoffDisplaySegment;

// A small parser is inlined here (not imported from `features/tasks/`) to keep
// the chat feature from depending on the tasks/Agent Board feature, per the
// boundary enforced by tests/unit/features/chat/ClaudianView.test.ts and called
// out as an acceptable duplication in the design spec. Persistence-side parsing
// still lives in TaskHandoffParser and keeps last-wins semantics; this display
// splitter is stricter and rejects duplicates / multiples / unmatched
// delimiters so ambiguous output fails open to the raw transcript.

const HANDOFF_BLOCK_PATTERN = /<claudian_handoff>\s*[\s\S]*?\s*<\/claudian_handoff>/g;
const REQUIRED_HANDOFF_LABELS = ['summary', 'verification', 'risks', 'next_action'] as const;

type HandoffLabel = (typeof REQUIRED_HANDOFF_LABELS)[number];

export function splitWorkOrderHandoffForDisplay(content: string): WorkOrderHandoffSegment[] | null {
  // Reject unmatched or nested delimiters before matching: a stray opening tag
  // before the real block would otherwise be swallowed by the single-block
  // regex and hidden behind a card instead of failing open.
  const openCount = (content.match(/<claudian_handoff>/g) ?? []).length;
  const closeCount = (content.match(/<\/claudian_handoff>/g) ?? []).length;
  if (openCount !== 1 || closeCount !== 1) return null;

  const matches = [...content.matchAll(HANDOFF_BLOCK_PATTERN)];
  if (matches.length !== 1) return null;

  const match = matches[0];
  if (match.index === undefined) return null;

  const rawBlock = match[0];
  if (hasDuplicateHandoffField(rawBlock)) return null;
  const parsed = parseHandoffBlock(rawBlock);
  if (!parsed) return null;

  const before = content.slice(0, match.index).trim();
  const after = content.slice(match.index + rawBlock.length).trim();
  const segments: WorkOrderHandoffSegment[] = [];

  if (before) segments.push({ type: 'markdown', content: before });
  segments.push({
    type: 'handoff',
    handoff: parsed,
    preview: truncateHandoffPreview(parsed.summary),
  });
  if (after) segments.push({ type: 'markdown', content: after });

  return segments;
}

function hasDuplicateHandoffField(block: string): boolean {
  return REQUIRED_HANDOFF_LABELS.some((label) => {
    const matches = block.match(new RegExp(`^${label}:`, 'gm'));
    return (matches?.length ?? 0) > 1;
  });
}

function parseHandoffBlock(rawBlock: string): ParsedHandoffForDisplay | null {
  const inner = rawBlock
    .replace(/^<claudian_handoff>\s*/, '')
    .replace(/\s*<\/claudian_handoff>$/, '');
  const fields = parseHandoffFields(inner);
  for (const label of REQUIRED_HANDOFF_LABELS) {
    const value = fields.get(label)?.trim();
    if (!value) return null;
  }
  return {
    summary: fields.get('summary')!.trim(),
    verification: fields.get('verification')!.trim(),
    risks: fields.get('risks')!.trim(),
    nextAction: fields.get('next_action')!.trim(),
  };
}

function parseHandoffFields(block: string): Map<HandoffLabel, string> {
  const fields = new Map<HandoffLabel, string>();
  const labels = REQUIRED_HANDOFF_LABELS.join('|');
  const fieldPattern = new RegExp(`^(${labels}):\\s*`, 'm');
  const starts: Array<{ field: HandoffLabel; index: number; valueStart: number }> = [];
  let remaining = block;
  let offset = 0;

  while (true) {
    const match = remaining.match(fieldPattern);
    if (!match || match.index === undefined) break;

    starts.push({
      field: match[1] as HandoffLabel,
      index: offset + match.index,
      valueStart: offset + match.index + match[0].length,
    });
    offset += match.index + match[0].length;
    remaining = block.slice(offset);
  }

  for (let i = 0; i < starts.length; i++) {
    const current = starts[i];
    const next = starts[i + 1];
    const valueEnd = next ? next.index : block.length;
    fields.set(current.field, block.slice(current.valueStart, valueEnd).trim());
  }

  return fields;
}

export function truncateHandoffPreview(
  summary: string,
  maxLength = HANDOFF_PREVIEW_MAX_CHARS,
): string {
  const normalized = summary.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
