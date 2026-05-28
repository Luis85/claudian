import { parseTaskHandoff } from '../../../../../src/features/tasks/execution/TaskHandoffParser';

describe('parseTaskHandoff', () => {
  it('accepts a valid handoff block and renders markdown sections', () => {
    const result = parseTaskHandoff(`Some prior assistant text.

<claudian_handoff>
summary: Implemented parser and prompt renderer.
verification: npx jest --selectProjects unit --testMatch "**/tests/unit/features/tasks/**/*.test.ts" passed.
risks: No known risks.
next_action: Review the local commit.
</claudian_handoff>

Trailing text.`);

    expect(result).toEqual({
      ok: true,
      handoff: {
        summary: 'Implemented parser and prompt renderer.',
        verification: 'npx jest --selectProjects unit --testMatch "**/tests/unit/features/tasks/**/*.test.ts" passed.',
        risks: 'No known risks.',
        nextAction: 'Review the local commit.',
        markdown: `## Summary
Implemented parser and prompt renderer.

## Verification
npx jest --selectProjects unit --testMatch "**/tests/unit/features/tasks/**/*.test.ts" passed.

## Risks
No known risks.

## Next Action
Review the local commit.`,
      },
    });
  });

  it('rejects content without a handoff block', () => {
    expect(parseTaskHandoff('No structured handoff here.')).toEqual({
      ok: false,
      error: 'Missing claudian_handoff block',
    });
  });

  it('rejects a handoff block missing next_action', () => {
    expect(parseTaskHandoff(`<claudian_handoff>
summary: Done.
verification: Tests passed.
risks: None.
</claudian_handoff>`)).toEqual({
      ok: false,
      error: 'Missing handoff field: next_action',
    });
  });
});