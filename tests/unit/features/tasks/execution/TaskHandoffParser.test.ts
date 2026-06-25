import { parseTaskHandoff } from '../../../../../src/features/tasks/execution/TaskHandoffParser';
import { parseHandoffSections } from '../../../../../src/features/tasks/model/handoffSections';

describe('parseTaskHandoff', () => {
  it('accepts a valid handoff block and renders marker-delimited markdown sections', () => {
    const result = parseTaskHandoff(`Some prior assistant text.

<specorator_handoff>
summary: Implemented parser and prompt renderer.
verification: npx jest --selectProjects unit --testMatch "**/tests/unit/features/tasks/**/*.test.ts" passed.
risks: No known risks.
next_action: Review the local commit.
</specorator_handoff>

Trailing text.`);

    expect(result).toEqual({
      ok: true,
      handoff: {
        summary: 'Implemented parser and prompt renderer.',
        verification: 'npx jest --selectProjects unit --testMatch "**/tests/unit/features/tasks/**/*.test.ts" passed.',
        risks: 'No known risks.',
        nextAction: 'Review the local commit.',
        markdown: `## Summary
<!-- specorator:handoff:summary:start -->
Implemented parser and prompt renderer.
<!-- specorator:handoff:summary:end -->

## Verification
<!-- specorator:handoff:verification:start -->
npx jest --selectProjects unit --testMatch "**/tests/unit/features/tasks/**/*.test.ts" passed.
<!-- specorator:handoff:verification:end -->

## Risks
<!-- specorator:handoff:risks:start -->
No known risks.
<!-- specorator:handoff:risks:end -->

## Next Action
<!-- specorator:handoff:next-action:start -->
Review the local commit.
<!-- specorator:handoff:next-action:end -->`,
      },
    });
  });

  it('round-trips a field body containing the next expected section heading', () => {
    // Regression for the heading-collision misparse: a Summary that literally
    // contains a "## Verification" line must stay attributed to Summary when
    // the stored markdown is parsed back for the modal Activity block.
    const result = parseTaskHandoff(`<specorator_handoff>
summary: Reworked the parser.
## Verification
That in-body heading is summary content.
verification: npx jest passed.
risks: None.
next_action: Review.
</specorator_handoff>`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sections = parseHandoffSections(result.handoff.markdown);
    expect(sections.summary).toBe('Reworked the parser.\n## Verification\nThat in-body heading is summary content.');
    expect(sections.verification).toBe('npx jest passed.');
    expect(sections.risks).toBe('None.');
    expect(sections.nextAction).toBe('Review.');
  });

  it('rejects a handoff whose field embeds a Specorator marker', () => {
    // TaskNoteStore refuses to write `<!-- specorator:` content into a generated
    // region (it could spoof region or field markers); rejecting here keeps the
    // run on the graceful needs_handoff path instead of a hard write failure.
    expect(parseTaskHandoff(`<specorator_handoff>
summary: Contains a <!-- specorator:handoff-end --> marker.
verification: v
risks: r
next_action: n
</specorator_handoff>`)).toEqual({
      ok: false,
      error: 'Handoff field contains a reserved Specorator marker: summary',
    });
  });

  it('rejects content without a handoff block', () => {
    expect(parseTaskHandoff('No structured handoff here.')).toEqual({
      ok: false,
      error: 'Missing specorator_handoff block',
    });
  });

  it('rejects a handoff block missing next_action', () => {
    expect(parseTaskHandoff(`<specorator_handoff>
summary: Done.
verification: Tests passed.
risks: None.
</specorator_handoff>`)).toEqual({
      ok: false,
      error: 'Missing handoff field: next_action',
    });
  });
});