import { buildPlanArtifactFromChatState, readPlanMarkdownFromArtifact } from '@/utils/planArtifact';

describe('planArtifact', () => {
  it('buildPlanArtifactFromChatState returns path artifact', () => {
    expect(buildPlanArtifactFromChatState({ planFilePath: '  .cursor/plans/foo.md  ' })).toEqual({
      path: '.cursor/plans/foo.md',
    });
  });

  it('readPlanMarkdownFromArtifact prefers inline markdown', () => {
    const result = readPlanMarkdownFromArtifact(
      { markdown: '# Plan\n\nStep 1' },
      '/.claude/plans/',
    );
    expect(result.content).toBe('# Plan\n\nStep 1');
    expect(result.error).toBeNull();
  });
});
