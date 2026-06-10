import { renderHandoffMarkdown } from '../model/handoffSections';
import type { ParsedHandoff } from '../model/taskTypes';

export type TaskHandoffParseResult =
  | { ok: true; handoff: ParsedHandoff }
  | { ok: false; error: string };

const HANDOFF_BLOCK_PATTERN = /<claudian_handoff>\s*([\s\S]*?)\s*<\/claudian_handoff>/;
const REQUIRED_FIELDS = ['summary', 'verification', 'risks', 'next_action'] as const;

// Mirrors TaskNoteStore's embedded-marker guard. A body carrying this prefix
// could spoof the note's region or field markers, so reject it here and let the
// run take the graceful needs_handoff path instead of failing the note write.
const CLAUDIAN_MARKER_PREFIX = '<!-- claudian:';

type HandoffField = typeof REQUIRED_FIELDS[number];

export function parseTaskHandoff(content: string): TaskHandoffParseResult {
  const blockMatch = content.match(HANDOFF_BLOCK_PATTERN);
  if (!blockMatch) {
    return { ok: false, error: 'Missing claudian_handoff block' };
  }

  const fields = parseFields(blockMatch[1]);
  for (const field of REQUIRED_FIELDS) {
    const value = fields.get(field)?.trim();
    if (!value) {
      return { ok: false, error: `Missing handoff field: ${field}` };
    }
    if (value.includes(CLAUDIAN_MARKER_PREFIX)) {
      return { ok: false, error: `Handoff field contains a reserved Claudian marker: ${field}` };
    }
  }

  const summary = fields.get('summary')!.trim();
  const verification = fields.get('verification')!.trim();
  const risks = fields.get('risks')!.trim();
  const nextAction = fields.get('next_action')!.trim();

  return {
    ok: true,
    handoff: {
      summary,
      verification,
      risks,
      nextAction,
      markdown: renderHandoffMarkdown({ summary, verification, risks, nextAction }),
    },
  };
}

function parseFields(block: string): Map<HandoffField, string> {
  const fields = new Map<HandoffField, string>();
  const labels = REQUIRED_FIELDS.join('|');
  const fieldPattern = new RegExp(`^(${labels}):\\s*`, 'm');
  const starts: Array<{ field: HandoffField; index: number; valueStart: number }> = [];
  let remaining = block;
  let offset = 0;

  while (true) {
    const match = remaining.match(fieldPattern);
    if (!match || match.index === undefined) {
      break;
    }

    starts.push({
      field: match[1] as HandoffField,
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