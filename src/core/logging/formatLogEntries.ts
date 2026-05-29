import type { LogEntry } from './types';

function safeStringify(args: unknown[]): string {
  try {
    return JSON.stringify(args);
  } catch {
    return '[unserializable]';
  }
}

/** Render buffer entries to a plain-text block for clipboard export. */
export function formatLogEntries(entries: LogEntry[]): string {
  return entries
    .map((e) => {
      const head = `${new Date(e.ts).toISOString()}  ${e.level.toUpperCase()}  [${e.scope}]  ${e.msg}`;
      return e.args.length > 0 ? `${head}  ${safeStringify(e.args)}` : head;
    })
    .join('\n');
}
