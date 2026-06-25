/**
 * Writer/reader contract for the work-order note's handoff region.
 *
 * `renderHandoffMarkdown` emits each field as a human-readable `## Heading`
 * followed by the body wrapped in collision-proof HTML-comment markers
 * (`<!-- specorator:handoff:<field>:start/end -->`). The markers are invisible in
 * Obsidian reading view, so the region still reads as four plain sections, but
 * `parseHandoffSections` keys on the markers — a body that literally contains
 * `## Verification` (or any other section heading) round-trips verbatim instead
 * of being misattributed to the wrong section.
 *
 * Notes written before the markers existed (bare `## Heading` sections) still
 * parse through the legacy sequential-heading path: read old format, write new
 * format. Read-only and lossless within a section either way; missing sections
 * come back as empty strings and the caller uses `hasAnyHandoffSection` to fall
 * back to the full raw markdown so no handoff text is ever dropped.
 */

export interface HandoffSections {
  summary: string;
  verification: string;
  risks: string;
  nextAction: string;
}

type SectionKey = keyof HandoffSections;

interface HandoffFieldSpec {
  key: SectionKey;
  heading: string;
  start: string;
  end: string;
}

const fieldMarker = (token: string, edge: 'start' | 'end'): string =>
  `<!-- specorator:handoff:${token}:${edge} -->`;

const HANDOFF_FIELDS: readonly HandoffFieldSpec[] = (
  [
    { key: 'summary', heading: 'Summary', token: 'summary' },
    { key: 'verification', heading: 'Verification', token: 'verification' },
    { key: 'risks', heading: 'Risks', token: 'risks' },
    { key: 'nextAction', heading: 'Next Action', token: 'next-action' },
  ] as const
).map(({ key, heading, token }) => ({
  key,
  heading,
  start: fieldMarker(token, 'start'),
  end: fieldMarker(token, 'end'),
}));

/**
 * Every structural marker `renderHandoffMarkdown` can emit. `TaskNoteStore`
 * scrubs exactly these before its embedded-marker guard so the sanctioned field
 * markers pass while any other `<!-- specorator:` content is still rejected.
 */
export const HANDOFF_FIELD_MARKER_STRINGS: readonly string[] = HANDOFF_FIELDS.flatMap(
  (field) => [field.start, field.end],
);

export function renderHandoffMarkdown(handoff: HandoffSections): string {
  return HANDOFF_FIELDS.map(
    (field) => `## ${field.heading}\n${field.start}\n${handoff[field.key]}\n${field.end}`,
  ).join('\n\n');
}

// Heading text → field. The keys are lowercased for case-insensitive matching;
// both "next action" spellings collapse to the same canonical heading.
const HEADING_TO_KEY: Record<string, SectionKey> = {
  summary: 'summary',
  verification: 'verification',
  risks: 'risks',
  'next action': 'nextAction',
};

// A `## Heading` line (any level of `#`), capturing the heading text. Tolerates
// trailing whitespace and surrounding blank lines.
const HEADING_PATTERN = /^#{1,6}\s+(.+?)\s*$/;

// The legacy writer always emitted exactly these four headings in this order.
const EXPECTED_ORDER: SectionKey[] = ['summary', 'verification', 'risks', 'nextAction'];

const emptySections = (): HandoffSections => ({
  summary: '',
  verification: '',
  risks: '',
  nextAction: '',
});

export function parseHandoffSections(markdown: string): HandoffSections {
  if (HANDOFF_FIELDS.some((field) => markdown.includes(field.start))) {
    return parseMarkerSections(markdown);
  }
  return parseLegacySections(markdown);
}

function parseMarkerSections(markdown: string): HandoffSections {
  const sections = emptySections();

  for (const field of HANDOFF_FIELDS) {
    const start = markdown.indexOf(field.start);
    if (start === -1) {
      continue;
    }
    const bodyStart = start + field.start.length;
    let bodyEnd = markdown.indexOf(field.end, bodyStart);
    if (bodyEnd === -1) {
      // Hand-mangled end marker: salvage up to the next field's start marker
      // (or end of region) rather than dropping the body.
      const nextStarts = HANDOFF_FIELDS.map((other) =>
        markdown.indexOf(other.start, bodyStart),
      ).filter((index) => index !== -1);
      bodyEnd = nextStarts.length > 0 ? Math.min(...nextStarts) : markdown.length;
    }
    sections[field.key] = markdown.slice(bodyStart, bodyEnd).trim();
  }

  return sections;
}

function parseLegacySections(markdown: string): HandoffSections {
  const sections = emptySections();

  const lines = markdown.split('\n');
  let nextExpected = 0;
  let activeKey: SectionKey | undefined;
  let buffer: string[] = [];

  const flush = (): void => {
    if (activeKey) {
      sections[activeKey] = buffer.join('\n').trim();
    }
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(HEADING_PATTERN);
    const headingKey = headingMatch
      ? HEADING_TO_KEY[headingMatch[1].trim().toLowerCase()]
      : undefined;

    // Only the next heading in the generated sequence delimits a section. A
    // heading inside a body — including one whose text matches a later section
    // name — is kept as body content, so the handoff renders losslessly even
    // when an agent writes "## Risks" inside its Summary. (A body containing
    // the *next expected* heading is still ambiguous here — that is exactly
    // what the marker-delimited format fixes for newly written notes.)
    if (headingKey && headingKey === EXPECTED_ORDER[nextExpected]) {
      flush();
      activeKey = headingKey;
      nextExpected += 1;
      continue;
    }

    if (activeKey) {
      buffer.push(line);
    }
  }
  flush();

  return sections;
}

/** Whether any known handoff section parsed with non-empty content. */
export function hasAnyHandoffSection(sections: HandoffSections): boolean {
  return Boolean(
    sections.summary || sections.verification || sections.risks || sections.nextAction,
  );
}
