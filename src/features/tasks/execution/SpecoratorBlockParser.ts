import { parseKeyedProtocolBody } from '../../../utils/protocolBlock';

export type SpecoratorBlockKind = 'progress' | 'needs_input' | 'needs_approval';

export interface SpecoratorBlock {
  kind: SpecoratorBlockKind;
  fields: Record<string, string>;
  raw: string;
}

export interface ParserOutput {
  plainText: string;
  blocks: SpecoratorBlock[];
  warnings: string[];
}

const KIND_TO_OPEN: Record<SpecoratorBlockKind, string> = {
  progress: '<specorator_progress>',
  needs_input: '<specorator_needs_input>',
  needs_approval: '<specorator_needs_approval>',
};

const KIND_TO_CLOSE: Record<SpecoratorBlockKind, string> = {
  progress: '</specorator_progress>',
  needs_input: '</specorator_needs_input>',
  needs_approval: '</specorator_needs_approval>',
};

const REQUIRED_FIELDS: Record<SpecoratorBlockKind, string[]> = {
  progress: ['step'],
  needs_input: ['question'],
  needs_approval: ['action'],
};

const KNOWN_FIELDS: Record<SpecoratorBlockKind, Set<string>> = {
  progress: new Set(['step', 'done', 'note']),
  needs_input: new Set(['question', 'why', 'default']),
  needs_approval: new Set(['action', 'risk', 'reversible']),
};

const ALL_KINDS: SpecoratorBlockKind[] = ['progress', 'needs_input', 'needs_approval'];

const MAX_TAIL = 1024;

export class SpecoratorBlockParser {
  private buffer = '';
  private openKind: SpecoratorBlockKind | null = null;
  private openBody = '';

  feed(chunk: string): ParserOutput {
    this.buffer += chunk;
    const blocks: SpecoratorBlock[] = [];
    const warnings: string[] = [];
    let plainText = '';

    while (this.buffer.length > 0) {
      const step =
        this.openKind === null
          ? this.consumeUntilOpen()
          : this.consumeUntilClose(blocks, warnings);
      plainText += step.plainText;
      if (step.done) {
        break;
      }
    }

    // Anything left in `buffer` while no block is open should be drained next call;
    // but if `buffer` ends without a partial open tag prefix, drain it now.
    if (this.openKind === null && this.buffer.length > 0 && !this.bufferEndsWithPartialOpen()) {
      plainText += this.buffer;
      this.buffer = '';
    }

    return { plainText, blocks, warnings };
  }

  /**
   * No block open: emit text up to the next open tag, or break (`done`) when no
   * open tag is present, keeping a bounded tail in case one is split across chunks.
   */
  private consumeUntilOpen(): { plainText: string; done: boolean } {
    const next = this.findNextOpen();
    if (!next) {
      // Keep a tail buffer in case an open tag is split across chunks.
      if (this.buffer.length > MAX_TAIL) {
        const drained = this.buffer.slice(0, this.buffer.length - MAX_TAIL);
        this.buffer = this.buffer.slice(-MAX_TAIL);
        return { plainText: drained, done: true };
      }
      return { plainText: '', done: true };
    }
    const plainText = this.buffer.slice(0, next.index);
    this.openKind = next.kind;
    this.openBody = '';
    this.buffer = this.buffer.slice(next.index + KIND_TO_OPEN[next.kind].length);
    return { plainText, done: false };
  }

  /**
   * Block open: append body up to its close tag and emit the block, or break
   * (`done`) when the close tag is absent — buffering a possible partial close
   * suffix so the next chunk can complete it. Pushes into the shared
   * `blocks`/`warnings` accumulators in place to preserve emission order.
   */
  private consumeUntilClose(
    blocks: SpecoratorBlock[],
    warnings: string[],
  ): { plainText: string; done: boolean } {
    const openKind = this.openKind as SpecoratorBlockKind;
    const closeTag = KIND_TO_CLOSE[openKind];
    const idx = this.buffer.indexOf(closeTag);
    if (idx === -1) {
      // The close tag can be split across chunks (e.g. `</specorator_needs_in`
      // then `put>`). Append everything except a possible partial close-tag
      // suffix to the body, and keep that suffix in the buffer so the next
      // chunk can complete the tag — mirroring the open-tag tail handling.
      const tail = this.partialCloseTailLength(closeTag);
      this.openBody += this.buffer.slice(0, this.buffer.length - tail);
      this.buffer = tail > 0 ? this.buffer.slice(this.buffer.length - tail) : '';
      return { plainText: '', done: true };
    }
    this.openBody += this.buffer.slice(0, idx);
    const result = parseBody(openKind, this.openBody);
    if (result.ok) {
      blocks.push({ kind: openKind, fields: result.fields, raw: this.openBody.trim() });
    } else {
      warnings.push(result.error);
    }
    this.buffer = this.buffer.slice(idx + closeTag.length);
    this.openKind = null;
    this.openBody = '';
    return { plainText: '', done: false };
  }

  finalize(): ParserOutput {
    const warnings: string[] = [];
    let plainText = '';
    if (this.openKind !== null) {
      warnings.push(`${this.openKind} block was not closed before stream end`);
      this.openKind = null;
      this.openBody = '';
    }
    if (this.buffer.length > 0) {
      plainText = this.buffer;
      this.buffer = '';
    }
    return { plainText, blocks: [], warnings };
  }

  private findNextOpen(): { kind: SpecoratorBlockKind; index: number } | null {
    let best: { kind: SpecoratorBlockKind; index: number } | null = null;
    for (const kind of ALL_KINDS) {
      const idx = this.buffer.indexOf(KIND_TO_OPEN[kind]);
      if (idx === -1) continue;
      if (best === null || idx < best.index) best = { kind, index: idx };
    }
    return best;
  }

  private bufferEndsWithPartialOpen(): boolean {
    for (const kind of ALL_KINDS) {
      const tag = KIND_TO_OPEN[kind];
      for (let i = 1; i < tag.length; i++) {
        if (this.buffer.endsWith(tag.slice(0, i))) return true;
      }
    }
    return false;
  }

  /** Length of the buffer's longest suffix that is a (proper) prefix of the close tag. */
  private partialCloseTailLength(closeTag: string): number {
    const max = Math.min(this.buffer.length, closeTag.length - 1);
    for (let i = max; i >= 1; i--) {
      if (this.buffer.endsWith(closeTag.slice(0, i))) return i;
    }
    return 0;
  }
}

function parseBody(
  kind: SpecoratorBlockKind,
  body: string,
): { ok: true; fields: Record<string, string> } | { ok: false; error: string } {
  const fields = parseKeyedProtocolBody(body);

  for (const required of REQUIRED_FIELDS[kind]) {
    if (!fields.get(required)) return { ok: false, error: `${kind} missing required field: ${required}` };
  }

  const filtered: Record<string, string> = {};
  for (const [key, value] of fields) {
    if (KNOWN_FIELDS[kind].has(key)) filtered[key] = value;
  }
  return { ok: true, fields: filtered };
}
