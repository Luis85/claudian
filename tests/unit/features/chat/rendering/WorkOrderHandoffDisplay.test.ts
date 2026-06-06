import {
  HANDOFF_PREVIEW_MAX_CHARS,
  splitWorkOrderHandoffForDisplay,
  truncateHandoffPreview,
} from '@/features/chat/rendering/WorkOrderHandoffDisplay';

const VALID_HANDOFF = `<claudian_handoff>
summary: Implemented the chat card and kept persisted transcripts unchanged.
verification: npm run typecheck passed.
risks: Visual polish may need one manual Obsidian check.
next_action: Human should run one work order and expand the card.
</claudian_handoff>`;

describe('WorkOrderHandoffDisplay', () => {
  it('splits a valid single handoff block with surrounding markdown', () => {
    const result = splitWorkOrderHandoffForDisplay(`Before text.\n\n${VALID_HANDOFF}\n\nAfter text.`);

    expect(result).toHaveLength(3);
    expect(result?.[0]).toEqual({ type: 'markdown', content: 'Before text.' });
    expect(result?.[1]).toMatchObject({
      type: 'handoff',
      preview: 'Implemented the chat card and kept persisted transcripts unchanged.',
      handoff: {
        summary: 'Implemented the chat card and kept persisted transcripts unchanged.',
        verification: 'npm run typecheck passed.',
        risks: 'Visual polish may need one manual Obsidian check.',
        nextAction: 'Human should run one work order and expand the card.',
      },
    });
    expect(result?.[2]).toEqual({ type: 'markdown', content: 'After text.' });
  });

  it('returns only a handoff segment when there is no surrounding markdown', () => {
    const result = splitWorkOrderHandoffForDisplay(VALID_HANDOFF);

    expect(result).toHaveLength(1);
    expect(result?.[0].type).toBe('handoff');
  });

  it('returns null for malformed handoff content', () => {
    const result = splitWorkOrderHandoffForDisplay(`<claudian_handoff>
summary: Missing fields
</claudian_handoff>`);

    expect(result).toBeNull();
  });

  it('returns null when no handoff block is present', () => {
    expect(splitWorkOrderHandoffForDisplay('plain assistant response')).toBeNull();
  });

  it('returns null when multiple handoff blocks are present', () => {
    const result = splitWorkOrderHandoffForDisplay(`${VALID_HANDOFF}\n${VALID_HANDOFF}`);

    expect(result).toBeNull();
  });

  it('returns null when a required field is repeated', () => {
    const result = splitWorkOrderHandoffForDisplay(`<claudian_handoff>
summary: First summary.
summary: Second summary.
verification: npm run test passed.
risks: No known risks.
next_action: Review the result.
</claudian_handoff>`);

    expect(result).toBeNull();
  });

  it('returns null when handoff delimiters are unmatched or nested', () => {
    const result = splitWorkOrderHandoffForDisplay(`<claudian_handoff> stray
<claudian_handoff>
summary: Finished the work.
verification: npm run test passed.
risks: No known risks.
next_action: Review the result.
</claudian_handoff>`);

    expect(result).toBeNull();
  });

  it('normalizes and truncates long summary previews', () => {
    const preview = truncateHandoffPreview(`${'word '.repeat(60)}final`);

    expect(preview.length).toBeLessThanOrEqual(HANDOFF_PREVIEW_MAX_CHARS);
    expect(preview.endsWith('…')).toBe(true);
    expect(preview).not.toContain('  ');
  });

  it('keeps short summary previews unchanged after whitespace normalization', () => {
    expect(truncateHandoffPreview('short\nsummary')).toBe('short summary');
  });
});
