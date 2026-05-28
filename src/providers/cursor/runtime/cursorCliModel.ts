import { getCachedCursorModelIds } from './cursorModelCatalog';
import {
  combineCursorModelSelection,
  CURSOR_MODE_SUFFIXES,
  CURSOR_STANDARD_MODE,
  getCursorModelVariants,
} from './cursorModelFamily';
import { fromCursorModelValue } from './cursorModelId';

// Picks a runnable mode for a family that has no bare id in the discovered set
// (e.g. `claude-opus-4-7`, where only `-low`/`-medium`/... exist). Returns the
// first non-standard variant so the runtime never sends a `--model` value the
// CLI rejects. Falls back to the bare family id when no variants are known.
function pickFirstRunnableVariant(familyId: string, allIds: readonly string[]): string {
  const variants = getCursorModelVariants(familyId, allIds);
  const firstReal = variants.find((variant) => variant.value !== CURSOR_STANDARD_MODE);
  if (firstReal) {
    return combineCursorModelSelection(familyId, firstReal.value);
  }
  return familyId;
}

// Resolves a (possibly `cursor:`-namespaced) selected model into the raw id
// passed to the CLI `--model` flag. Strips the prefix first, then trims.
export function resolveCursorModelForCli(model: string | undefined): string | undefined {
  if (!model?.trim()) {
    return undefined;
  }
  const raw = fromCursorModelValue(model);
  return raw ? raw : undefined;
}

// Resolves a (possibly namespaced) family model value plus a selected mode into
// the raw id passed to `--model`. The mode is validated against the family's
// known variants; unknown modes fall back to the bare family (so a curated
// suffix that is not in the live cache still works, but garbage does not).
export function resolveCursorModelSelectionForCli(
  model: string | undefined,
  mode: string | undefined,
): string | undefined {
  if (!model?.trim()) {
    return undefined;
  }
  const familyId = fromCursorModelValue(model);
  if (!familyId) {
    return undefined;
  }
  if (familyId === 'auto') {
    return 'auto';
  }

  const cachedIds = getCachedCursorModelIds();
  const trimmedMode = mode?.trim();
  if (!trimmedMode || trimmedMode === CURSOR_STANDARD_MODE) {
    if (cachedIds.includes(familyId)) {
      return familyId;
    }
    return pickFirstRunnableVariant(familyId, cachedIds);
  }

  const knownModes = new Set(
    getCursorModelVariants(familyId, cachedIds).map((variant) => variant.value),
  );
  if (knownModes.has(trimmedMode) || CURSOR_MODE_SUFFIXES.has(trimmedMode.toLowerCase())) {
    return combineCursorModelSelection(familyId, trimmedMode);
  }
  // Stale or invalid mode for this family — fall back to a runnable variant
  // rather than producing a `--model` value the CLI rejects.
  if (cachedIds.includes(familyId)) {
    return familyId;
  }
  return pickFirstRunnableVariant(familyId, cachedIds);
}
