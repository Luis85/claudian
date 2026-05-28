import { formatCursorModeLabel, formatCursorModelLabel } from '../modelLabels';

// The bare family id (no suffix) is represented in the mode dropdown by this
// sentinel value. It maps back to "no suffix" when recombining for the CLI.
export const CURSOR_STANDARD_MODE = 'standard';

// Curated fallback vocabulary used only when the bare family id is NOT present
// in the discovered list. Derivation from the list takes priority.
export const CURSOR_MODE_SUFFIXES: ReadonlySet<string> = new Set([
  'thinking', 'fast', 'max', 'high', 'medium', 'low',
]);

const CURSOR_MODE_ORDER = ['standard', 'low', 'medium', 'high', 'max', 'thinking', 'fast'];
const CURSOR_MODE_RANK = new Map(CURSOR_MODE_ORDER.map((value, index) => [value, index] as const));

const CURSOR_VENDOR_ORDER = ['Cursor', 'Anthropic', 'OpenAI', 'Google', 'xAI', 'Other'];
const CURSOR_VENDOR_RANK = new Map(CURSOR_VENDOR_ORDER.map((value, index) => [value, index] as const));

export interface CursorModeVariant {
  value: string;
  label: string;
}

export interface CursorModelFamily {
  familyId: string;
  label: string;
  vendor: string;
  variants: CursorModeVariant[];
}

function toRawIdSet(allRawIds: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const id of allRawIds) {
    const trimmed = id.trim();
    if (trimmed) {
      set.add(trimmed);
    }
  }
  return set;
}

/**
 * Resolves the family id for a raw Cursor model id. Hybrid strategy:
 *  - derive: if `rawId === base + "-" + suffix` and `base` is itself a discovered
 *    id, the family is `base`;
 *  - fallback: else if the trailing token is a curated mode suffix, split there;
 *  - else the whole id is its own family.
 */
export function resolveCursorFamilyId(rawId: string, allRawIds: Iterable<string>): string {
  const trimmed = rawId.trim();
  if (!trimmed) {
    return trimmed;
  }

  const splitIndex = trimmed.lastIndexOf('-');
  if (splitIndex <= 0 || splitIndex >= trimmed.length - 1) {
    return trimmed;
  }

  const base = trimmed.slice(0, splitIndex);
  const suffix = trimmed.slice(splitIndex + 1).toLowerCase();

  if (toRawIdSet(allRawIds).has(base)) {
    return base;
  }
  if (CURSOR_MODE_SUFFIXES.has(suffix)) {
    return base;
  }
  return trimmed;
}

/** Returns the mode token for a variant id, or null for a bare family id. */
export function extractCursorModeValue(rawId: string, allRawIds: Iterable<string>): string | null {
  const trimmed = rawId.trim();
  const familyId = resolveCursorFamilyId(trimmed, allRawIds);
  if (!familyId || familyId === trimmed) {
    return null;
  }
  return trimmed.slice(familyId.length + 1) || null;
}

/** Recombines a family id and mode into the raw id passed to `--model`. */
export function combineCursorModelSelection(familyId: string, mode: string | null | undefined): string {
  const trimmedFamily = familyId.trim();
  const trimmedMode = mode?.trim();
  if (!trimmedMode || trimmedMode === CURSOR_STANDARD_MODE) {
    return trimmedFamily;
  }
  return `${trimmedFamily}-${trimmedMode}`;
}

export function resolveCursorVendor(familyId: string): string {
  const lower = familyId.toLowerCase();
  if (/composer|sonic|cursor/.test(lower)) {
    return 'Cursor';
  }
  if (/claude|sonnet|opus|haiku/.test(lower)) {
    return 'Anthropic';
  }
  if (/^gpt|^o\d/.test(lower)) {
    return 'OpenAI';
  }
  if (/gemini/.test(lower)) {
    return 'Google';
  }
  if (/grok/.test(lower)) {
    return 'xAI';
  }
  return 'Other';
}

function compareModeValues(left: string, right: string): number {
  const leftRank = CURSOR_MODE_RANK.get(left.toLowerCase());
  const rightRank = CURSOR_MODE_RANK.get(right.toLowerCase());
  if (leftRank !== undefined && rightRank !== undefined) {
    return leftRank - rightRank;
  }
  if (leftRank !== undefined) return -1;
  if (rightRank !== undefined) return 1;
  return left.localeCompare(right);
}

/** Groups raw ids into families with ordered mode variants. Excludes `auto`. */
export function buildCursorFamilies(rawIds: Iterable<string>): CursorModelFamily[] {
  const all = toRawIdSet(rawIds);
  all.delete('auto');

  const grouped = new Map<string, Set<string>>();
  for (const rawId of all) {
    const familyId = resolveCursorFamilyId(rawId, all);
    const bucket = grouped.get(familyId) ?? new Set<string>();
    bucket.add(rawId);
    grouped.set(familyId, bucket);
  }

  const families: CursorModelFamily[] = [];
  for (const [familyId, members] of grouped) {
    const variantValues = new Set<string>([CURSOR_STANDARD_MODE]);
    for (const member of members) {
      const mode = extractCursorModeValue(member, all);
      if (mode) {
        variantValues.add(mode);
      }
    }
    const variants = [...variantValues]
      .sort(compareModeValues)
      .map((value) => ({
        value,
        label: formatCursorModeLabel(value),
      }));

    families.push({
      familyId,
      label: formatCursorModelLabel(familyId),
      vendor: resolveCursorVendor(familyId),
      variants,
    });
  }

  return families.sort((left, right) => {
    const vendorDelta = (CURSOR_VENDOR_RANK.get(left.vendor) ?? 99)
      - (CURSOR_VENDOR_RANK.get(right.vendor) ?? 99);
    return vendorDelta !== 0 ? vendorDelta : left.label.localeCompare(right.label);
  });
}

/** Returns the mode variants for a single family id. */
export function getCursorModelVariants(familyId: string, rawIds: Iterable<string>): CursorModeVariant[] {
  return buildCursorFamilies(rawIds).find((family) => family.familyId === familyId)?.variants
    ?? [{ value: CURSOR_STANDARD_MODE, label: formatCursorModeLabel(CURSOR_STANDARD_MODE) }];
}
