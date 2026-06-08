import { getCachedCursorModelIds } from './cursorModelCatalog';
import {
  combineCursorModelSelection,
  CURSOR_MODE_SUFFIXES,
  CURSOR_STANDARD_MODE,
  extractCursorModeValue,
  getCursorModelVariants,
  resolveCursorFamilyId,
  resolveCursorFamilyIdInCatalog,
} from './cursorModelFamily';
import { fromCursorModelValue } from './cursorModelId';

export interface CursorCliModelContext {
  catalogIds?: readonly string[];
  enabledIds?: readonly string[];
}

interface ResolvedCliModelContext {
  catalogIds: readonly string[];
  enabledIds: readonly string[];
  mergedIds: readonly string[];
}

function dedupeIds(ids: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/** Merges discovered catalog ids with user-enabled raw ids for CLI resolution. */
export function mergeCursorKnownModelIds(
  catalogIds: Iterable<string>,
  enabledIds: Iterable<string>,
): string[] {
  return dedupeIds([...catalogIds, ...enabledIds]);
}

function resolveCliModelContext(
  context?: readonly string[] | CursorCliModelContext,
): ResolvedCliModelContext {
  const catalogIds = getCachedCursorModelIds();
  if (!context) {
    return { catalogIds, enabledIds: [], mergedIds: catalogIds };
  }
  // `Array.isArray` doesn't narrow the negative branch of a `readonly string[]`
  // union member, so capture the array case explicitly and treat the remainder
  // as the structured context object.
  if (Array.isArray(context)) {
    const mergedIds = dedupeIds(context as readonly string[]);
    return { catalogIds: mergedIds, enabledIds: mergedIds, mergedIds };
  }
  const objectContext = context as CursorCliModelContext;
  const resolvedCatalog = objectContext.catalogIds ? dedupeIds(objectContext.catalogIds) : catalogIds;
  const enabledIds = objectContext.enabledIds ? dedupeIds(objectContext.enabledIds) : [];
  return {
    catalogIds: resolvedCatalog,
    enabledIds,
    mergedIds: mergeCursorKnownModelIds(resolvedCatalog, enabledIds),
  };
}

function familyHasBareRunnableId(
  familyId: string,
  { catalogIds, enabledIds, mergedIds }: ResolvedCliModelContext,
): boolean {
  const variants = getCursorModelVariants(familyId, mergedIds);
  const bareListed = mergedIds.includes(familyId)
    && variants.some((variant) => variant.value === CURSOR_STANDARD_MODE);
  if (!bareListed) {
    return false;
  }
  // When the user curated models, only honour bare ids they explicitly enabled.
  if (enabledIds.length > 0) {
    return enabledIds.includes(familyId);
  }
  return catalogIds.includes(familyId);
}

// Picks a runnable mode for a family that has no bare id in the known set.
function pickFirstRunnableVariant(
  familyId: string,
  mergedIds: readonly string[],
): string {
  const catalogFamilyId = resolveCursorFamilyIdInCatalog(familyId, mergedIds);
  const variants = getCursorModelVariants(catalogFamilyId, mergedIds);
  const firstReal = variants.find((variant) => variant.value !== CURSOR_STANDARD_MODE);
  if (firstReal) {
    return combineCursorModelSelection(catalogFamilyId, firstReal.value);
  }
  for (const id of mergedIds) {
    if (resolveCursorFamilyId(id, mergedIds) === catalogFamilyId) {
      return id;
    }
  }
  return catalogFamilyId;
}

function resolveRunnableSelection(
  familyId: string,
  mode: string | undefined,
  context: ResolvedCliModelContext,
): string {
  const { mergedIds } = context;
  const catalogFamilyId = resolveCursorFamilyIdInCatalog(familyId, mergedIds);
  const trimmedMode = mode?.trim();

  if (!trimmedMode || trimmedMode === CURSOR_STANDARD_MODE) {
    if (familyHasBareRunnableId(catalogFamilyId, context)) {
      return catalogFamilyId;
    }
    return pickFirstRunnableVariant(catalogFamilyId, mergedIds);
  }

  const knownModes = new Set(
    getCursorModelVariants(catalogFamilyId, mergedIds).map((variant) => variant.value),
  );
  const combined = combineCursorModelSelection(catalogFamilyId, trimmedMode);
  if (mergedIds.includes(combined)) {
    return combined;
  }
  if (knownModes.has(trimmedMode) || CURSOR_MODE_SUFFIXES.has(trimmedMode.toLowerCase())) {
    return combined;
  }
  if (familyHasBareRunnableId(catalogFamilyId, context)) {
    return catalogFamilyId;
  }
  return pickFirstRunnableVariant(catalogFamilyId, mergedIds);
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
// the raw id passed to `--model`. Pass enabled model ids from settings so
// picker choices stay runnable even before catalog discovery catches up.
export function resolveCursorModelSelectionForCli(
  model: string | undefined,
  mode: string | undefined,
  context?: readonly string[] | CursorCliModelContext,
): string | undefined {
  if (!model?.trim()) {
    return undefined;
  }
  const rawId = fromCursorModelValue(model);
  if (!rawId) {
    return undefined;
  }
  if (rawId === 'auto') {
    return 'auto';
  }

  const resolvedContext = resolveCliModelContext(context);
  const familyId = resolveCursorFamilyId(rawId, resolvedContext.mergedIds);
  const embeddedMode = extractCursorModeValue(rawId, resolvedContext.mergedIds);
  const effectiveMode = embeddedMode
    && (!mode?.trim() || mode.trim() === CURSOR_STANDARD_MODE)
    ? embeddedMode
    : mode;

  return resolveRunnableSelection(familyId, effectiveMode, resolvedContext);
}
