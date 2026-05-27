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

    const pathStart = index + 1;
    // Cap candidates at the next @-mention boundary so a greedy space-containing
    // path does not accidentally consume a subsequent mention.
    let nextMentionAt = text.length;
    for (let j = pathStart; j < text.length; j++) {
      if (isMentionStart(text, j)) { nextMentionAt = j; break; }
    }
    const candidates = collectMentionEndCandidates(text, pathStart)
      .filter(end => end <= nextMentionAt);
    for (const end of candidates) {
      const raw = text.slice(pathStart, end);
      // Strip trailing punctuation, then trailing whitespace, before normalizing —
      // a folder mention sent as the whole message (e.g. "@a/b/ ") carries a trailing space.
      const trailingPunct = raw.match(TRAILING_PUNCTUATION_RE)?.[0] ?? '';
      const rawClean = (trailingPunct ? raw.slice(0, -trailingPunct.length) : raw).trim();
      const normalized = normalizeMentionPath(rawClean);
      if (!normalized) continue;

      const kind = resolve(normalized);
      if (!kind) continue;

      const key = `${kind}:${normalized}`;
      if (!seen.has(key)) {
        seen.add(key);
        (kind === 'folder' ? folders : files).push(normalized);
      }
      index = end - 1; // skip past the consumed mention
      break;
    }
  }

  return { files, folders };
}
