export interface AcceptanceProgress {
  done: number;
  total: number;
}

const CHECKBOX = /^\s*[-*]\s+\[( |x|X)\]\s+/;

/**
 * Counts Markdown checklist items in an acceptance-criteria block.
 * `- [ ]` / `* [ ]` count toward total; `- [x]` / `- [X]` also count as done.
 */
export function parseAcceptanceProgress(markdown: string): AcceptanceProgress {
  let done = 0;
  let total = 0;
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(CHECKBOX);
    if (!match) continue;
    total += 1;
    if (match[1].toLowerCase() === 'x') done += 1;
  }
  return { done, total };
}
