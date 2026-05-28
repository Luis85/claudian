import type { TodoItem } from '../tools/todo';

/** Provider-neutral plan output for approval UIs. */
export interface PlanArtifact {
  path?: string;
  markdown?: string;
  todos?: TodoItem[];
}

export function resolvePlanArtifactMarkdown(artifact: PlanArtifact | undefined): string | null {
  if (!artifact) {
    return null;
  }
  if (artifact.markdown?.trim()) {
    return artifact.markdown.trim();
  }
  return null;
}
