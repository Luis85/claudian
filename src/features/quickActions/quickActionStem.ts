/**
 * Filename stem (no extension, no folder path), lowercased so the lookup is
 * case-insensitive. Used as the stable identity key for usage tracking and
 * last-used provider+model preferences — survives moves and case-only renames
 * (`summarize.md` ↔ `Summarize.md`), breaks on a true content rename.
 */
export function quickActionStemFromPath(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.md$/i, '').toLowerCase();
}
