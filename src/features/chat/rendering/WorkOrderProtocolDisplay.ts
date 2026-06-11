import { parseKeyedProtocolBody } from '../../../utils/protocolBlock';

export interface ProgressData {
  step: string;
  done?: { complete: number; total: number };
  note?: string;
}

export interface NeedsInputData {
  question: string;
  why?: string;
  defaultValue?: string;
}

export interface NeedsApprovalData {
  action: string;
  risk?: string;
  reversible?: boolean;
}

export interface ParsedHandoffForDisplay {
  summary: string;
  verification: string;
  risks: string;
  nextAction: string;
}

export type WorkOrderProtocolSegment =
  | { type: 'markdown'; content: string }
  | { type: 'progress'; progress: ProgressData }
  | { type: 'needs_input'; needsInput: NeedsInputData }
  | { type: 'needs_approval'; needsApproval: NeedsApprovalData }
  | { type: 'handoff'; handoff: ParsedHandoffForDisplay; preview: string };

const FENCE_PATTERN = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm;

function findFencedRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  FENCE_PATTERN.lastIndex = 0;
  for (const m of content.matchAll(FENCE_PATTERN)) {
    if (m.index === undefined) continue;
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

function isInsideAnyRange(pos: number, ranges: Array<[number, number]>): boolean {
  for (const [start, end] of ranges) {
    if (pos >= start && pos < end) return true;
  }
  return false;
}

const BLOCK_PATTERNS: Array<{ kind: 'progress' | 'needs_input' | 'needs_approval' | 'handoff'; regex: RegExp }> = [
  { kind: 'progress', regex: /<claudian_progress>([\s\S]*?)<\/claudian_progress>/g },
  { kind: 'needs_input', regex: /<claudian_needs_input>([\s\S]*?)<\/claudian_needs_input>/g },
  { kind: 'needs_approval', regex: /<claudian_needs_approval>([\s\S]*?)<\/claudian_needs_approval>/g },
  { kind: 'handoff', regex: /<claudian_handoff>([\s\S]*?)<\/claudian_handoff>/g },
];

export const HANDOFF_PREVIEW_MAX_CHARS = 160;

/**
 * Splits an assistant text block into rendered segments by extracting
 * `<claudian_progress>`, `<claudian_needs_input>`, `<claudian_needs_approval>`,
 * and `<claudian_handoff>` blocks. Blocks inside fenced code (``` or ~~~) are
 * left untouched so agents can show protocol docs without triggering cards.
 *
 * Semantics (deliberately more permissive than the deleted `splitWorkOrderHandoffForDisplay`):
 * - Duplicate keys in a block overwrite; last wins. The old splitter rejected the block.
 * - A stray opening tag before a valid block is silently dropped. The old splitter rejected.
 * - Multiple handoff blocks each render as a card. The old splitter accepted at most one.
 * Malformed blocks (missing required field) are emitted as raw markdown so
 * users see something rather than a silent swallow.
 */
export function splitWorkOrderProtocolForDisplay(content: string): WorkOrderProtocolSegment[] {
  const matches: Array<{
    kind: 'progress' | 'needs_input' | 'needs_approval' | 'handoff';
    start: number;
    end: number;
    body: string;
  }> = [];

  for (const { kind, regex } of BLOCK_PATTERNS) {
    regex.lastIndex = 0;
    for (const m of content.matchAll(regex)) {
      if (m.index === undefined) continue;
      matches.push({ kind, start: m.index, end: m.index + m[0].length, body: m[1] });
    }
  }
  matches.sort((a, b) => a.start - b.start);

  const fenceRanges = findFencedRanges(content);
  const filteredMatches = matches.filter((m) => !isInsideAnyRange(m.start, fenceRanges));

  if (filteredMatches.length === 0) {
    return [{ type: 'markdown', content }];
  }

  const segments: WorkOrderProtocolSegment[] = [];
  let cursor = 0;
  for (const match of filteredMatches) {
    if (match.start > cursor) {
      const between = content.slice(cursor, match.start).trim();
      if (between.length > 0) segments.push({ type: 'markdown', content: between });
    }
    const parsed = parseBlock(match.kind, match.body);
    if (parsed) {
      segments.push(parsed);
    } else {
      segments.push({ type: 'markdown', content: content.slice(match.start, match.end) });
    }
    cursor = match.end;
  }
  if (cursor < content.length) {
    const tail = content.slice(cursor).trim();
    if (tail.length > 0) segments.push({ type: 'markdown', content: tail });
  }

  return segments;
}

function parseBlock(
  kind: 'progress' | 'needs_input' | 'needs_approval' | 'handoff',
  body: string,
): WorkOrderProtocolSegment | null {
  const fields = parseKeyedProtocolBody(body);
  if (kind === 'progress') {
    const step = fields.get('step');
    if (!step) return null;
    const doneStr = fields.get('done');
    const doneMatch = doneStr?.match(/^(\d+)\s*\/\s*(\d+)$/);
    const done = doneMatch ? { complete: parseInt(doneMatch[1], 10), total: parseInt(doneMatch[2], 10) } : undefined;
    return { type: 'progress', progress: { step, done, note: fields.get('note') } };
  }
  if (kind === 'needs_input') {
    const question = fields.get('question');
    if (!question) return null;
    return {
      type: 'needs_input',
      needsInput: { question, why: fields.get('why'), defaultValue: fields.get('default') },
    };
  }
  if (kind === 'needs_approval') {
    const action = fields.get('action');
    if (!action) return null;
    const reversibleStr = fields.get('reversible');
    const reversible = reversibleStr === 'true' ? true : reversibleStr === 'false' ? false : undefined;
    return {
      type: 'needs_approval',
      needsApproval: { action, risk: fields.get('risk'), reversible },
    };
  }
  // handoff
  const required: Array<'summary' | 'verification' | 'risks' | 'next_action'> = [
    'summary',
    'verification',
    'risks',
    'next_action',
  ];
  for (const label of required) {
    if (!fields.get(label)) return null;
  }
  return {
    type: 'handoff',
    handoff: {
      summary: fields.get('summary')!,
      verification: fields.get('verification')!,
      risks: fields.get('risks')!,
      nextAction: fields.get('next_action')!,
    },
    preview: truncatePreview(fields.get('summary')!),
  };
}


function truncatePreview(summary: string, maxLength = HANDOFF_PREVIEW_MAX_CHARS): string {
  const normalized = summary.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
