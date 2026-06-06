/**
 * Filename stem (no extension, no folder path). Used as the stable
 * identity key for usage tracking — survives moves, breaks on rename.
 */
export function quickActionStemFromPath(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.md$/i, '');
}
