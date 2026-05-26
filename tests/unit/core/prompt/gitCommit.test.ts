import { GIT_COMMIT_PROMPT } from '@/core/prompt/gitCommit';

describe('GIT_COMMIT_PROMPT', () => {
  it('instructs the agent to stage, commit with a generated message, and push', () => {
    const lower = GIT_COMMIT_PROMPT.toLowerCase();
    expect(lower).toContain('stage');
    expect(lower).toContain('commit');
    expect(lower).toContain('push');
    expect(lower).toContain('conventional commit');
  });

  it('tells the agent to skip push gracefully when there is no upstream', () => {
    expect(GIT_COMMIT_PROMPT.toLowerCase()).toContain('upstream');
  });
});
