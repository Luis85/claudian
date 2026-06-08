import { formatCursorModeLabel, formatCursorModelLabel } from '../modelLabels';

// The bare family id (no suffix) is represented in the mode dropdown by this
// sentinel value. It maps back to "no suffix" when recombining for the CLI.
export const CURSOR_STANDARD_MODE = 'standard';

// Strong mode tokens always count as a mode suffix when they appear at the end.
// `extra-high` is also a strong mode but lives as two hyphen-separated tokens
// in raw ids (`gpt-5.5-extra-high`) and is handled via a multi-token rule.
const STRONG_MODE_TOKENS: ReadonlySet<string> = new Set([
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'thinking',
  'fast',
]);

// `max` is ambiguous in the live catalog: it is a *mode* on Claude Opus
// (`claude-opus-4-7-max` ↔ `claude-opus-4-7-low`) and a *model size* on Codex
// 5.1 (`gpt-5.1-codex-max-low` shares a base only with `gpt-5.1-codex-mini-*`,
// not with bare effort siblings). The resolver only strips `max` when other
// strong-token siblings exist for the candidate base, otherwise it stays part
// of the family id.
const WEAK_MODE_TOKENS: ReadonlySet<string> = new Set(['max']);

// Public set used by `resolveCursorModelSelectionForCli` to validate user-typed
// modes that are not yet in the discovered catalog. Includes both strong and
// weak tokens, plus the multi-word `extra-high` written as a single string.
export const CURSOR_MODE_SUFFIXES: ReadonlySet<string> = new Set([
  ...STRONG_MODE_TOKENS,
  ...WEAK_MODE_TOKENS,
  'extra-high',
]);

const CURSOR_MODE_ORDER = [
  'standard',
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'extra-high',
  'max',
];
const CURSOR_MODE_RANK = new Map(
  CURSOR_MODE_ORDER.map((value, index) => [value, index] as const),
);

const CURSOR_VENDOR_ORDER = ['Cursor', 'Anthropic', 'OpenAI', 'Google', 'xAI', 'Other'];
const CURSOR_VENDOR_RANK = new Map(
  CURSOR_VENDOR_ORDER.map((value, index) => [value, index] as const),
);

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

// True when removing a `max`-style weak suffix exposes a base that has at least
// one OTHER strong-mode sibling in the discovered set. Used to decide whether
// `max` is a mode (Claude Opus) or part of the model name (Codex 5.1 Max).
function hasOtherModeSibling(
  candidateBase: string,
  allIds: ReadonlySet<string>,
): boolean {
  const prefix = `${candidateBase}-`;
  for (const id of allIds) {
    if (!id.startsWith(prefix)) {
      continue;
    }
    const tail = id.slice(prefix.length);
    if (!tail) {
      continue;
    }
    const firstToken = tail.split('-', 1)[0];
    if (STRONG_MODE_TOKENS.has(firstToken)) {
      return true;
    }
    if (firstToken === 'extra' && tail.startsWith('extra-high')) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the family id for a raw Cursor model id by iteratively peeling
 * recognised mode tokens from the right. Strong tokens (`none`, `low`,
 * `medium`, `high`, `xhigh`, `thinking`, `fast`) and the multi-token
 * `extra-high` always strip; the weak token `max` only strips when the
 * remaining base has other strong-mode siblings in the discovered set.
 */
export function resolveCursorFamilyId(rawId: string, allRawIds: Iterable<string>): string {
  const trimmed = rawId.trim();
  if (!trimmed) {
    return trimmed;
  }
  const allSet = toRawIdSet(allRawIds);
  allSet.add(trimmed);

  const parts = trimmed.split('-');
  let baseLen = parts.length;

  while (baseLen > 1) {
    if (
      baseLen >= 3
      && parts[baseLen - 2] === 'extra'
      && parts[baseLen - 1] === 'high'
    ) {
      baseLen -= 2;
      continue;
    }

    const last = parts[baseLen - 1];
    if (STRONG_MODE_TOKENS.has(last)) {
      baseLen -= 1;
      continue;
    }

    if (WEAK_MODE_TOKENS.has(last)) {
      const candidate = parts.slice(0, baseLen - 1).join('-');
      if (candidate && hasOtherModeSibling(candidate, allSet)) {
        baseLen -= 1;
        continue;
      }
    }

    break;
  }

  return parts.slice(0, baseLen).join('-');
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
export function combineCursorModelSelection(
  familyId: string,
  mode: string | null | undefined,
): string {
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

interface DecomposedMode {
  effort: string;
  thinking: boolean;
  fast: boolean;
}

// Decomposes a compound mode value (e.g. `thinking-low-fast`) into the three
// orthogonal axes the picker actually cares about. `effort` defaults to
// `standard` when no effort token is present.
function decomposeMode(mode: string): DecomposedMode {
  if (mode === CURSOR_STANDARD_MODE) {
    return { effort: 'standard', thinking: false, fast: false };
  }
  const parts = mode.split('-');
  let thinking = false;
  let fast = false;
  let effort = 'standard';
  let i = 0;
  while (i < parts.length) {
    const token = parts[i];
    if (token === 'thinking') {
      thinking = true;
      i += 1;
    } else if (token === 'fast') {
      fast = true;
      i += 1;
    } else if (token === 'extra' && parts[i + 1] === 'high') {
      effort = 'extra-high';
      i += 2;
    } else if (CURSOR_MODE_RANK.has(token) && token !== 'standard') {
      effort = token;
      i += 1;
    } else {
      i += 1;
    }
  }
  return { effort, thinking, fast };
}

// Sort modes so the dropdown reads naturally: non-thinking variants first
// (grouped by effort, fast last), then their thinking counterparts in the same
// order. This keeps the common path at the top and pushes the high-cost
// reasoning variants to the bottom.
function compareModeValues(left: string, right: string): number {
  const a = decomposeMode(left);
  const b = decomposeMode(right);
  if (a.thinking !== b.thinking) return a.thinking ? 1 : -1;
  const aRank = CURSOR_MODE_RANK.get(a.effort) ?? CURSOR_MODE_ORDER.length;
  const bRank = CURSOR_MODE_RANK.get(b.effort) ?? CURSOR_MODE_ORDER.length;
  if (aRank !== bRank) return aRank - bRank;
  if (a.fast !== b.fast) return a.fast ? 1 : -1;
  return left.localeCompare(right);
}

/**
 * Groups raw ids into families with ordered mode variants. Excludes `auto`.
 * `standard` only appears in a family's variant list when the bare family id
 * itself is in the discovered set (so the picker never advertises a `--model`
 * value that the CLI would reject).
 */
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
    const variantValues = new Set<string>();
    if (all.has(familyId)) {
      variantValues.add(CURSOR_STANDARD_MODE);
    }
    for (const member of members) {
      const mode = extractCursorModeValue(member, all);
      if (mode) {
        variantValues.add(mode);
      }
    }
    if (variantValues.size === 0) {
      variantValues.add(CURSOR_STANDARD_MODE);
    }
    const variants = [...variantValues]
      .sort(compareModeValues)
      .map((value) => ({
        value,
        label: value === CURSOR_STANDARD_MODE
          ? 'Standard'
          : formatCursorModeLabel(value),
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
export function getCursorModelVariants(
  familyId: string,
  rawIds: Iterable<string>,
): CursorModeVariant[] {
  return (
    buildCursorFamilies(rawIds).find((family) => family.familyId === familyId)?.variants
    ?? [{ value: CURSOR_STANDARD_MODE, label: 'Standard' }]
  );
}

// Cursor has shipped Claude families under both `claude-opus-4-7` and
// `claude-4.6-opus` shapes. When the picker still carries the legacy family id
// but the live catalog only exposes the dotted form, remap before combining.
function flipClaudeFamilyNaming(familyId: string): string | null {
  const opusLegacy = familyId.match(/^claude-opus-(\d+)-(\d+)$/);
  if (opusLegacy) {
    return `claude-${opusLegacy[1]}.${opusLegacy[2]}-opus`;
  }
  const opusDotted = familyId.match(/^claude-(\d+)\.(\d+)-opus$/);
  if (opusDotted) {
    return `claude-opus-${opusDotted[1]}-${opusDotted[2]}`;
  }
  const sonnetLegacy = familyId.match(/^claude-sonnet-(\d+)-(\d+)$/);
  if (sonnetLegacy) {
    return `claude-${sonnetLegacy[1]}.${sonnetLegacy[2]}-sonnet`;
  }
  const sonnetDotted = familyId.match(/^claude-(\d+)\.(\d+)-sonnet$/);
  if (sonnetDotted) {
    return `claude-sonnet-${sonnetDotted[1]}-${sonnetDotted[2]}`;
  }
  return null;
}

/** Resolves a picker family id to the taxonomy present in the known id set. */
export function resolveCursorFamilyIdInCatalog(
  familyId: string,
  rawIds: Iterable<string>,
): string {
  const trimmed = familyId.trim();
  if (!trimmed) {
    return trimmed;
  }
  const families = buildCursorFamilies(rawIds);
  if (families.some((family) => family.familyId === trimmed)) {
    return trimmed;
  }
  const alternate = flipClaudeFamilyNaming(trimmed);
  if (alternate && families.some((family) => family.familyId === alternate)) {
    return alternate;
  }
  return trimmed;
}
