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
