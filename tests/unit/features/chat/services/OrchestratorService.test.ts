import { OrchestratorService } from '@/features/chat/services/OrchestratorService';

describe('OrchestratorService', () => {
  let service: OrchestratorService;
  let sentMessages: Array<{ tabId: string; message: string }>;

  beforeEach(() => {
    sentMessages = [];
    service = new OrchestratorService({
      sendToTab: (tabId, message) => {
        sentMessages.push({ tabId, message });
      },
    });
  });

  describe('reportResult', () => {
    it('reports worker results to orchestrator and signals synthesis when done', () => {
      service.registerWorker('orchestrator-1', 'worker-1', 'Test Worker');
      service.reportResult('worker-1', 'Success result');

      expect(sentMessages).toHaveLength(2);
      expect(sentMessages[0]).toEqual({
        tabId: 'orchestrator-1',
        message: "Worker 'Test Worker' finished: Success result",
      });
      expect(sentMessages[1].message).toContain('All workers have reported');
    });

    it('reports errors with failed label', () => {
      service.registerWorker('orchestrator-1', 'worker-1', 'Error Worker');
      service.reportResult('worker-1', 'Error: connection refused', true);

      expect(sentMessages[0].message).toContain("Worker 'Error Worker' failed");
      expect(sentMessages[0].message).toContain('connection refused');
    });

    it('ignores duplicate reports for already-done worker', () => {
      service.registerWorker('orchestrator-1', 'worker-1', 'W1');
      service.registerWorker('orchestrator-1', 'worker-2', 'W2');

      service.reportResult('worker-1', 'first');
      service.reportResult('worker-1', 'second'); // Duplicate, should be ignored

      // worker-1's result + nothing for duplicate + worker-2 still pending
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].message).toContain('first');
    });

    it('ignores reports for unknown workers', () => {
      service.reportResult('unknown-worker', 'orphan result');
      expect(sentMessages).toHaveLength(0);
    });
  });

  describe('truncation (issue #8)', () => {
    it('does not truncate results under the limit', () => {
      service.registerWorker('orchestrator-1', 'worker-1', 'Small Worker');
      const small = 'a'.repeat(3_999);
      service.reportResult('worker-1', small);

      const message = sentMessages[0].message;
      expect(message).toContain(small);
      expect(message).not.toContain('elided');
    });

    it('truncates results over the limit, preserving head and tail', () => {
      service.registerWorker('orchestrator-1', 'worker-1', 'Big Worker');
      const head = 'A'.repeat(3_000);
      const middle = 'M'.repeat(5_000);
      const tail = 'Z'.repeat(2_000);
      const largeResult = `${head}${middle}${tail}`; // 10,000 chars total

      service.reportResult('worker-1', largeResult);
      const message = sentMessages[0].message;

      // Head preserved (start of result kept)
      expect(message).toContain('A'.repeat(2_500));
      // Tail preserved (end of result kept — typically contains conclusions/summary)
      expect(message).toContain('Z'.repeat(1_500));
      // Elision marker present with total size
      expect(message).toContain('elided');
      expect(message).toContain('10000 total');
      // Result smaller than original
      expect(message.length).toBeLessThan(largeResult.length);
    });

    it('caps message growth across multiple large workers', () => {
      // 5 workers x 20k chars each would be 100k total without truncation.
      // After truncation, accumulated should stay well under Windows 32k cmd.exe limit.
      for (let i = 0; i < 5; i++) {
        service.registerWorker('orchestrator-1', `worker-${i}`, `W${i}`);
      }
      for (let i = 0; i < 5; i++) {
        service.reportResult(`worker-${i}`, 'x'.repeat(20_000));
      }

      const workerMessages = sentMessages.filter((m) => m.message.includes('finished'));
      const totalAccumulated = workerMessages.reduce((sum, m) => sum + m.message.length, 0);
      expect(totalAccumulated).toBeLessThan(32_768);
    });
  });

  describe('synthesis signaling', () => {
    it('signals synthesis only after all workers complete', () => {
      service.registerWorker('orchestrator-1', 'worker-1', 'W1');
      service.registerWorker('orchestrator-1', 'worker-2', 'W2');

      service.reportResult('worker-1', 'r1');
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages.some((m) => m.message.includes('synthesize'))).toBe(false);

      service.reportResult('worker-2', 'r2');
      expect(sentMessages).toHaveLength(3);
      expect(sentMessages[2].message).toContain('All workers have reported');
    });

    it('signals synthesis when a closed worker is the last to complete', () => {
      service.registerWorker('orchestrator-1', 'worker-1', 'W1');
      service.registerWorker('orchestrator-1', 'worker-2', 'W2');

      service.reportResult('worker-1', 'r1');
      service.handleTabClosed('worker-2');

      // Result + closed notice + synthesis signal
      expect(sentMessages).toHaveLength(3);
      expect(sentMessages[1].message).toContain('was closed');
      expect(sentMessages[2].message).toContain('All workers have reported');
    });

    it('signals synthesis when a reported worker is closed mid-orchestration', () => {
      service.registerWorker('orchestrator-1', 'worker-1', 'W1');
      service.registerWorker('orchestrator-1', 'worker-2', 'W2');

      service.handleTabClosed('worker-1');
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].message).toContain('was closed');

      service.reportResult('worker-2', 'Result 2');
      expect(sentMessages).toHaveLength(3);
      expect(sentMessages[2].message).toContain('All workers have reported');
    });
  });

  describe('handleTabClosed', () => {
    it('cleans up worker meta when worker tab closes', () => {
      service.registerWorker('orchestrator-1', 'worker-1', 'W1');
      service.handleTabClosed('worker-1');

      // After cleanup, reporting same worker should be no-op
      service.reportResult('worker-1', 'late result');
      expect(sentMessages.filter((m) => m.message.includes('late result'))).toHaveLength(0);
    });

    it('cleans up entire fleet when orchestrator tab closes', () => {
      service.registerWorker('orchestrator-1', 'worker-1', 'W1');
      service.registerWorker('orchestrator-1', 'worker-2', 'W2');

      service.handleTabClosed('orchestrator-1');

      // Workers orphaned — subsequent reports should be no-ops
      service.reportResult('worker-1', 'r1');
      service.reportResult('worker-2', 'r2');
      expect(sentMessages).toHaveLength(0);
    });

    it('handles closing an unknown tab gracefully', () => {
      expect(() => service.handleTabClosed('unknown-tab')).not.toThrow();
      expect(sentMessages).toHaveLength(0);
    });
  });

  describe('getOrchestratorTabId', () => {
    it('returns the orchestrator tab for a registered worker', () => {
      service.registerWorker('orchestrator-1', 'worker-1', 'W1');
      expect(service.getOrchestratorTabId('worker-1')).toBe('orchestrator-1');
    });

    it('returns null for unknown workers', () => {
      expect(service.getOrchestratorTabId('unknown')).toBeNull();
    });
  });
});
