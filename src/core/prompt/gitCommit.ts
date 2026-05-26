export const GIT_COMMIT_PROMPT = [
  'Commit and push the current changes in this git repository.',
  '',
  'Steps:',
  '1. Inspect the working tree with `git status` and `git diff` to understand what changed.',
  '2. Stage the relevant changes.',
  '3. Write a concise Conventional Commit message that accurately reflects the diff.',
  '4. Create the commit.',
  '5. Push to the upstream branch.',
  '',
  'If there is no upstream branch or no remote configured, create the commit anyway and tell me that the push was skipped and why.',
  'When done, report the commit subject, the short hash, and the push result.',
].join('\n');
