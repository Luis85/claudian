import {
  hasAnyHandoffSection,
  parseHandoffSections,
} from '../../../../../src/features/tasks/model/handoffSections';

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
      '## Next Action',
      'Done.',
    ].join('\n');
    const parsed = parseHandoffSections(md);
    expect(parsed.summary).toBe('Line one with [[Wikilink]].\n\n- bullet a\n- bullet b');
    expect(parsed.nextAction).toBe('Done.');
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
    expect(hasAnyHandoffSection(parseHandoffSections('## Risks\nWatch the migration.'))).toBe(true);
  });

  it('is false when nothing parsed into a known section', () => {
    expect(hasAnyHandoffSection(parseHandoffSections('No structured headings here.'))).toBe(false);
  });
});
