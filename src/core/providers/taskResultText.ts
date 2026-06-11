/**
 * Reads the conventional `result`-then-`output` string fallback off a Task tool
 * payload. Providers share this shape when surfacing subagent terminal text.
 */
export function readTaskResultOrOutput(record: Record<string, unknown>): string | null {
  const result = typeof record.result === 'string' ? record.result.trim() : '';
  if (result.length > 0) {
    return result;
  }

  const output = typeof record.output === 'string' ? record.output.trim() : '';
  return output.length > 0 ? output : null;
}
