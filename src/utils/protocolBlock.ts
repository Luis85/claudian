/**
 * Parses the `key: value` keyed body used by specorator work-order protocol
 * blocks (progress/handoff). Continuation lines append to the current key's
 * value; lines before the first key are dropped. Values are trimmed.
 */
export function parseKeyedProtocolBody(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  const lines = body.split(/\r?\n/);
  let currentKey: string | null = null;
  let currentValue: string[] = [];

  const commit = () => {
    if (currentKey === null) return;
    fields.set(currentKey, currentValue.join('\n').trim());
    currentKey = null;
    currentValue = [];
  };

  for (const line of lines) {
    const match = line.match(/^([a-z_]+):\s*(.*)$/);
    if (match) {
      commit();
      currentKey = match[1];
      currentValue = [match[2]];
    } else if (currentKey !== null) {
      currentValue.push(line);
    }
  }
  commit();
  return fields;
}
