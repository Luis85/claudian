import { Notice } from 'obsidian';

/**
 * Runs a mutating UI action, surfacing failures to the user as a `Notice`
 * instead of an unhandled promise rejection. The optional `onError` hook is for
 * logging the underlying error (callers pass `plugin.logger.scope(...).error`).
 */
export async function withErrorNotice(
  action: () => Promise<void>,
  message: string,
  onError?: (error: unknown) => void,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    onError?.(error);
    new Notice(message);
  }
}
