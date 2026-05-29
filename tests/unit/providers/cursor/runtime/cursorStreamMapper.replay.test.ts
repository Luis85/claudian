import * as fs from 'fs';
import * as path from 'path';

import { CursorNdjsonStreamReducer } from '@/providers/cursor/runtime/cursorStreamMapper';

function replayNdjsonFile(relativePath: string): string {
  const filePath = path.join(__dirname, '../../../../..', relativePath);
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const reducer = new CursorNdjsonStreamReducer();
  const textChunks: string[] = [];

  for (const line of lines) {
    const { chunks } = reducer.reduceLine(line);
    for (const chunk of chunks) {
      if (chunk.type === 'text') {
        textChunks.push(chunk.content);
      }
    }
  }

  return textChunks.join('');
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

describe('CursorNdjsonStreamReducer real NDJSON replays', () => {
  it('replays cursor-stream-tools.ndjson without doubled assistant text', () => {
    const text = replayNdjsonFile('.context/cursor-stream-tools.ndjson');
    const expected = 'Shell output: `hello-cursor`\n\nTwo JSON files at the root:\n- `versions.json`\n- `manifest.json`';
    expect(text).toBe(expected);
    expect(countOccurrences(text, 'hello-cursor')).toBe(1);
  });
});
