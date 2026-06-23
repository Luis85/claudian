import {
  hasAnyHandoffSection,
  parseHandoffSections,
  renderHandoffMarkdown,
} from '../../../../../src/features/tasks/model/handoffSections';

describe('renderHandoffMarkdown + parseHandoffSections (marker-delimited format)', () => {
  const fields = {
    summary: 'Shipped the activity block.',
    verification: 'All four gates pass.',
    risks: 'None observed.',
    nextAction: 'Review and merge.',
  };

  it('round-trips the four fields verbatim', () => {
    expect(parseHandoffSections(renderHandoffMarkdown(fields))).toEqual(fields);
  });

  it('keeps human-readable headings in the rendered region', () => {
    const md = renderHandoffMarkdown(fields);
    expect(md).toContain('## Summary');
    expect(md).toContain('## Verification');
    expect(md).toContain('## Risks');
    expect(md).toContain('## Next Action');
  });

  it('round-trips a body containing the next expected section heading', () => {
    // The core collision the heading-delimited format could not represent: a
    // Summary that literally contains a "## Verification" line.
    const colliding = {
      ...fields,
      summary: 'We verified manually first.\n## Verification\nThat heading is summary content.',
    };
    const parsed = parseHandoffSections(renderHandoffMarkdown(colliding));
    expect(parsed).toEqual(colliding);
  });

  it('round-trips bodies containing every section heading and markdown structure', () => {
    const adversarial = {
      summary: '## Summary\n## Verification\n## Risks\n## Next Action',
      verification: '- [x] `npm test`\n\n## Risks\nnested heading',
      risks: '# Risks\nNone.',
      nextAction: '## Next action\nMerge.',
    };
    expect(parseHandoffSections(renderHandoffMarkdown(adversarial))).toEqual(adversarial);
  });

  it('treats a field whose marker pair is absent as empty', () => {
    const md = renderHandoffMarkdown(fields)
      .split('\n')
      .filter((line) => !line.includes('specorator:handoff:risks'))
      .join('\n');
    const parsed = parseHandoffSections(md);
    expect(parsed.risks).toBe('');
    expect(parsed.summary).toBe(fields.summary);
    expect(parsed.nextAction).toBe(fields.nextAction);
  });

  it('salvages a field whose end marker was hand-removed instead of dropping it', () => {
    const md = renderHandoffMarkdown(fields)
      .split('\n')
      .filter((line) => line !== '<!-- specorator:handoff:summary:end -->')
      .join('\n');
    const parsed = parseHandoffSections(md);
    expect(parsed.summary).toContain(fields.summary);
    expect(parsed.verification).toBe(fields.verification);
  });
});

describe('parseHandoffSections', () => {
  const canonical = [
    '## Summary',
    'Shipped the activity block.',
    '',
    '## Verification',
    'All four gates pass.',
    '',
    '## Risks',
    'None observed.',
    '',
    '## Next Action',
    'Review and merge.',
  ].join('\n');

  it('splits the canonical renderHandoffMarkdown shape into the four fields', () => {
    const parsed = parseHandoffSections(canonical);
    expect(parsed.summary).toBe('Shipped the activity block.');
    expect(parsed.verification).toBe('All four gates pass.');
    expect(parsed.risks).toBe('None observed.');
    expect(parsed.nextAction).toBe('Review and merge.');
  });

  it('matches headings case-insensitively and accepts "Next action" or "Next Action"', () => {
    const lower = [
      '## summary',
      'S.',
      '## VERIFICATION',
      'V.',
      '## risks',
      'R.',
      '## next action',
      'N.',
    ].join('\n');
    const parsed = parseHandoffSections(lower);
    expect(parsed.summary).toBe('S.');
    expect(parsed.verification).toBe('V.');
    expect(parsed.risks).toBe('R.');
    expect(parsed.nextAction).toBe('N.');
  });

  it('preserves multi-line and markdown body content within a section', () => {
    const md = [
      '## Summary',
      'Line one with [[Wikilink]].',
      '',
      '- bullet a',
      '- bullet b',
      '',
      '## Verification',
      'Done.',
    ].join('\n');
    const parsed = parseHandoffSections(md);
    expect(parsed.summary).toBe('Line one with [[Wikilink]].\n\n- bullet a\n- bullet b');
    expect(parsed.verification).toBe('Done.');
  });

  it('keeps in-body headings as content (only the generated sequence delimits)', () => {
    // An agent writes "## Risks" inside its Summary, before the real Verification.
    const md = [
      '## Summary',
      'We mitigated several risks.',
      '## Risks',
      'Still investigating.',
      '## Verification',
      'Gates pass.',
      '## Risks',
      'Migration risk noted.',
      '## Next Action',
      'Merge.',
    ].join('\n');
    const parsed = parseHandoffSections(md);
    // The in-body "## Risks" stays inside Summary; only the in-sequence Risks delimits.
    expect(parsed.summary).toBe('We mitigated several risks.\n## Risks\nStill investigating.');
    expect(parsed.verification).toBe('Gates pass.');
    expect(parsed.risks).toBe('Migration risk noted.');
    expect(parsed.nextAction).toBe('Merge.');
  });

  it('tolerates missing sections by returning empty strings for them', () => {
    const md = ['## Summary', 'Only a summary.'].join('\n');
    const parsed = parseHandoffSections(md);
    expect(parsed.summary).toBe('Only a summary.');
    expect(parsed.verification).toBe('');
    expect(parsed.risks).toBe('');
    expect(parsed.nextAction).toBe('');
  });

  it('returns all-empty fields when no known headings are present', () => {
    const parsed = parseHandoffSections('Just some prose with no headings at all.');
    expect(parsed.summary).toBe('');
    expect(parsed.verification).toBe('');
    expect(parsed.risks).toBe('');
    expect(parsed.nextAction).toBe('');
  });
});

describe('hasAnyHandoffSection', () => {
  it('is true when at least one known section parses with content', () => {
    expect(hasAnyHandoffSection(parseHandoffSections('## Summary\nWatch the migration.'))).toBe(true);
  });

  it('is false when nothing parsed into a known section', () => {
    expect(hasAnyHandoffSection(parseHandoffSections('No structured headings here.'))).toBe(false);
  });
});
