import {
  parseQuickActionContent,
  serializeQuickAction,
} from '@/features/quickActions/quickActionParse';
import { QUICK_ACTION_FRONTMATTER_TYPE } from '@/features/quickActions/types';

describe('quickActionParse', () => {
  it('serializes type quick-action in frontmatter', () => {
    const content = serializeQuickAction({
      name: 'Summarize',
      description: 'Summarize selection',
      prompt: 'Summarize the current note.',
    });
    expect(content).toContain(`type: ${QUICK_ACTION_FRONTMATTER_TYPE}`);
    expect(content).toContain('name: Summarize');
  });

  it('parses quick-action files with type frontmatter', () => {
    const content = `---
type: ${QUICK_ACTION_FRONTMATTER_TYPE}
name: Summarize
description: Summarize selection
---

Summarize the current note.
`;
    const action = parseQuickActionContent(content, 'Quick Actions/summarize.md');
    expect(action).toMatchObject({
      name: 'Summarize',
      description: 'Summarize selection',
      prompt: 'Summarize the current note.',
    });
  });

  it('still parses legacy files without type', () => {
    const content = `---
name: Legacy
---

Do the thing.
`;
    expect(parseQuickActionContent(content, 'Quick Actions/legacy.md')).toMatchObject({
      name: 'Legacy',
      prompt: 'Do the thing.',
    });
  });

  it('parses tags from frontmatter', () => {
    const content = `---
type: ${QUICK_ACTION_FRONTMATTER_TYPE}
name: Tagged
tags:
  - research
  - agents
---

Body.
`;
    const action = parseQuickActionContent(content, 'Quick Actions/tagged.md');
    expect(action?.tags).toEqual(['research', 'agents']);
  });

  it('serializes tags as YAML list', () => {
    const content = serializeQuickAction({
      name: 'Tagged',
      prompt: 'Body.',
      tags: ['research', 'agents'],
    });
    expect(content).toContain('tags:');
    expect(content).toContain('  - research');
    expect(content).toContain('  - agents');
  });

  it('round-trips tags through parse and serialize', () => {
    const serialized = serializeQuickAction({
      name: 'Round',
      prompt: 'Body.',
      tags: ['a', 'b'],
    });
    const parsed = parseQuickActionContent(serialized, 'Quick Actions/round.md');
    expect(parsed?.tags).toEqual(['a', 'b']);
  });

  it('ignores markdown with a different type', () => {
    const content = `---
type: note
name: Not a quick action
---

Body.
`;
    expect(parseQuickActionContent(content, 'Quick Actions/note.md')).toBeNull();
  });
});
