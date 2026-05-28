import { getCachedCursorModelIds } from './cursorModelCatalog';
import {
  combineCursorModelSelection,
  CURSOR_MODE_SUFFIXES,
  CURSOR_STANDARD_MODE,
  getCursorModelVariants,
} from './cursorModelFamily';
import { fromCursorModelValue } from './cursorModelId';

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

  const trimmedMode = mode?.trim();
  if (!trimmedMode || trimmedMode === CURSOR_STANDARD_MODE) {
    return familyId;
  }

  const knownModes = new Set(
    getCursorModelVariants(familyId, getCachedCursorModelIds()).map((variant) => variant.value),
  );
  if (knownModes.has(trimmedMode) || CURSOR_MODE_SUFFIXES.has(trimmedMode.toLowerCase())) {
    return combineCursorModelSelection(familyId, trimmedMode);
  }
  return familyId;
}
