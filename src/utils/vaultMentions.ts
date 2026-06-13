import {
  collectMentionEndCandidates,
  isMentionStart,
  normalizeMentionPath,
} from './contextMentionResolver';

// Matches the same punctuation set used by findBestMentionLookupMatch in contextMentionResolver.
const TRAILING_PUNCTUATION_RE = /[),.!?:;]+$/;

export type VaultMentionKind = 'file' | 'folder';

export interface VaultMentions {
  files: string[];
  folders: string[];
}

/**
 * The next @-mention boundary at or after `pathStart`, capping candidate paths so a
 * greedy space-containing path does not accidentally consume a subsequent mention.
 */
function findNextMentionBoundary(text: string, pathStart: number): number {
  for (let j = pathStart; j < text.length; j++) {
    if (isMentionStart(text, j)) return j;
  }
  return text.length;
}

/** Normalizes a candidate slice, stripping trailing punctuation then whitespace before normalizing. */
function normalizeCandidate(raw: string): string | null {
  // A folder mention sent as the whole message (e.g. "@a/b/ ") carries a trailing space,
  // so strip trailing punctuation, then trailing whitespace, before normalizing.
  const trailingPunct = raw.match(TRAILING_PUNCTUATION_RE)?.[0] ?? '';
  const rawClean = (trailingPunct ? raw.slice(0, -trailingPunct.length) : raw).trim();
  return normalizeMentionPath(rawClean);
}

interface ResolvedMention {
  kind: VaultMentionKind;
  normalized: string;
  /** Index of the last consumed character, so the caller can skip past the mention. */
  end: number;
}

/**
 * Tries each end candidate (longest-first) for the mention starting at `pathStart`,
 * returning the first that normalizes to a real vault entry, or null if none resolve.
 */
function resolveMentionAt(
  text: string,
  pathStart: number,
  resolve: (normalizedPath: string) => VaultMentionKind | null,
): ResolvedMention | null {
  const nextMentionAt = findNextMentionBoundary(text, pathStart);
  const candidates = collectMentionEndCandidates(text, pathStart)
    .filter(end => end <= nextMentionAt);

  for (const end of candidates) {
    const normalized = normalizeCandidate(text.slice(pathStart, end));
    if (!normalized) continue;

    const kind = resolve(normalized);
    if (!kind) continue;

    return { kind, normalized, end };
  }

  return null;
}

/**
 * Extracts vault @-mentions from message text, validating each against the vault.
 * `resolve` returns 'file' | 'folder' for a normalized path, or null if it is not a
 * vault entry. Candidates are tried longest-first so paths with spaces resolve.
 */
export function extractVaultMentions(
  text: string,
  resolve: (normalizedPath: string) => VaultMentionKind | null,
): VaultMentions {
  const files: string[] = [];
  const folders: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < text.length; index++) {
    if (!isMentionStart(text, index)) continue;

    const resolved = resolveMentionAt(text, index + 1, resolve);
    if (!resolved) continue;

    const key = `${resolved.kind}:${resolved.normalized}`;
    if (!seen.has(key)) {
      seen.add(key);
      (resolved.kind === 'folder' ? folders : files).push(resolved.normalized);
    }
    index = resolved.end - 1; // skip past the consumed mention
  }

  return { files, folders };
}
