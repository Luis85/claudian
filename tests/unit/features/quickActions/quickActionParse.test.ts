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
