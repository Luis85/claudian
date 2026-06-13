import type { EnvSnippet } from '../../core/types';

/**
 * Pure merge helpers for applying an env snippet's overrides onto the live
 * settings maps. Extracted from {@link EnvSnippetManager.insertSnippet} so the
 * manager keeps a small orchestration surface (and stays under the file LOC
 * cap). No Obsidian or plugin dependencies — leaf-zone safe.
 */

/** Snippet context limits merged over the existing map (snippet wins per key). */
export function mergeSnippetContextLimits(
  existing: Record<string, number> | undefined,
  snippetLimits: NonNullable<EnvSnippet['contextLimits']>,
): Record<string, number> {
  return { ...existing, ...snippetLimits };
}

/**
 * Snippet model aliases merged over the existing map. For each of the snippet's
 * own model ids, a non-empty alias is set and an empty/blank alias clears any
 * existing entry — mirroring the editor contract where leaving an alias field
 * empty removes it for that model.
 */
export function mergeSnippetModelAliases(
  existing: Record<string, string> | undefined,
  modelIds: Iterable<string>,
  snippetAliases: NonNullable<EnvSnippet['modelAliases']>,
): Record<string, string> {
  const next = { ...(existing ?? {}) };
  for (const modelId of modelIds) {
    const alias = snippetAliases[modelId]?.trim();
    if (alias) {
      next[modelId] = alias;
    } else {
      delete next[modelId];
    }
  }
  return next;
}
