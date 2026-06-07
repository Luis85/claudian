/**
 * Splits the handoff region markdown — the `## Summary\n…\n\n## Verification\n…`
 * shape produced by the handoff writer (see `renderHandoffMarkdown` in
 * `execution/TaskHandoffParser.ts`) — into its four named bodies for the
 * work-order modal's collapsible Agent-handoff cards.
 *
 * Read-only and lossless within a section: each body keeps its original
 * markdown (multi-line, lists, links) so the modal can render it through
 * `MarkdownRenderer`. Headings match case-insensitively and `Next Action` /
 * `Next action` both bind to `nextAction`. Missing sections come back as empty
 * strings; the caller uses `hasAnyHandoffSection` to decide whether the
 * structured cards apply or whether to fall back to the full raw markdown so no
 * handoff text is ever dropped.
 */

export interface HandoffSections {
  summary: string;
  verification: string;
  risks: string;
  nextAction: string;
}

type SectionKey = keyof HandoffSections;

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

// `renderHandoffMarkdown` always emits exactly these four headings in this order.
const EXPECTED_ORDER: SectionKey[] = ['summary', 'verification', 'risks', 'nextAction'];

export function parseHandoffSections(markdown: string): HandoffSections {
  const sections: HandoffSections = {
    summary: '',
    verification: '',
    risks: '',
    nextAction: '',
  };

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
    // when an agent writes "## Risks" inside its Summary.
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
