import * as fs from 'fs';
import * as nodePath from 'path';

import type { PlanArtifact } from '../core/types/plan';

export function readPlanMarkdownFromArtifact(
  artifact: PlanArtifact | undefined,
  planPathPrefix?: string,
): { content: string | null; error: string | null } {
  const inline = artifact?.markdown?.trim();
  if (inline) {
    return { content: inline, error: null };
  }

  const rawPath = artifact?.path?.trim();
  if (!rawPath) {
    return { content: null, error: null };
  }

  if (planPathPrefix) {
    const resolved = nodePath.resolve(rawPath).replace(/\\/g, '/');
    if (!resolved.includes(planPathPrefix.replace(/\\/g, '/'))) {
      return { content: null, error: null };
    }
  }

  try {
    return { content: fs.readFileSync(rawPath, 'utf-8'), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: null, error: message };
  }
}

export function buildPlanArtifactFromChatState(params: {
  planFilePath: string | null;
}): PlanArtifact | undefined {
  const trimmed = params.planFilePath?.trim();
  if (!trimmed) {
    return undefined;
  }
  return { path: trimmed };
}
