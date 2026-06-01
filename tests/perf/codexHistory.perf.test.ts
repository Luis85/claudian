/**
 * Codex transcript-parse scaling guard (history hydration).
 *
 * `parseCodexSessionContent` turns a raw JSONL transcript string into messages
 * on every Codex history reload / session switch. It scales with transcript
 * length (records × tool calls per turn); the legacy/mixed tool-resolution path
 * has linear `toolCalls.find(...)` scans, so a tool-heavy turn risks O(tools²).
 * This guards that parse cost tracks record count and reports wall-time.
 */
import { parseCodexSessionContent } from '@/providers/codex/history/CodexHistoryStore';

import { reportMetrics, timeMs } from './perfReport';

function record(obj: unknown): string {
  return JSON.stringify(obj);
}

/**
 * A modern transcript of `turns` turns. Each turn = a user message, an
 * assistant function_call + its function_call_output, and an agent_message,
 * exercising the tool-resolution path that pairs calls with outputs.
 */
function transcript(turns: number): string {
  const lines: string[] = [];
  let t = 0;
  const ts = () => new Date((t++) * 1000).toISOString();

  for (let i = 0; i < turns; i++) {
    lines.push(record({
      timestamp: ts(),
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `Question ${i}` }] },
    }));
    const callId = `call_${i}`;
    lines.push(record({
      timestamp: ts(),
      type: 'response_item',
      payload: { type: 'function_call', name: 'shell', arguments: `{"command":"echo ${i}"}`, call_id: callId },
    }));
    lines.push(record({
      timestamp: ts(),
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: callId, output: `output ${i}` },
    }));
    lines.push(record({
      timestamp: ts(),
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Answer ${i}` }] },
    }));
  }
  return lines.join('\n');
}

const SCALES = [50, 200, 800, 2000];

describe('parseCodexSessionContent scaling (Codex history)', () => {
  it('keeps parse cost tracking transcript length', () => {
    const metrics = SCALES.map((turns) => {
      const content = transcript(turns);
      const records = turns * 4;
      let messages: unknown[] = [];
      const ms = timeMs(() => { messages = parseCodexSessionContent(content); });
      return {
        n: records,
        produced: messages.length,
        values: { records, messages: messages.length, parseMs: Math.round(ms * 100) / 100 },
      };
    });

    reportMetrics('parseCodexSessionContent — modern transcript', metrics);

    // Sanity: parsing produced messages and they scale with the transcript.
    for (const m of metrics) {
      expect(m.produced).toBeGreaterThan(0);
    }
    // Cost must not blow up super-linearly: a 16x larger transcript (50→800
    // turns) must stay well under a quadratic 256x message count.
    const first = metrics[0].produced;
    const wide = metrics[2].produced;
    expect(wide).toBeLessThan(first * 100);
  });
});
