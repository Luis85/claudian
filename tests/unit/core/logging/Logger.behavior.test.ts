import { Logger } from '../../../../src/core/logging/Logger';
import type { LogEntry } from '../../../../src/core/logging/types';

function makeLogger(capacity?: number) {
  const sink: LogEntry[] = [];
  const logger = new Logger({ enabled: true, level: 'debug', capacity, sink: (e) => sink.push(e), now: () => 0 });
  return { logger, sink };
}

describe('Logger behavior', () => {
  it('prepends the scope and nests joined scopes', () => {
    const { logger, sink } = makeLogger();
    logger.scope('claude').scope('runtime').warn('hi');
    expect(sink[0].scope).toBe('claude.runtime');
  });

  it('child scopes share the root buffer', () => {
    const { logger } = makeLogger();
    logger.scope('a').info('one');
    logger.scope('b').info('two');
    expect(logger.snapshot()).toHaveLength(2);
  });

  it('caps the ring buffer and evicts oldest', () => {
    const { logger } = makeLogger(2);
    logger.info('1');
    logger.info('2');
    logger.info('3');
    expect(logger.snapshot().map((e) => e.msg)).toEqual(['2', '3']);
  });

  it('snapshot returns a copy that does not mutate the buffer', () => {
    const { logger } = makeLogger();
    logger.info('1');
    logger.snapshot().push({ ts: 0, level: 'info', scope: 'x', msg: 'fake', args: [] });
    expect(logger.snapshot()).toHaveLength(1);
  });

  it('clear empties the buffer', () => {
    const { logger } = makeLogger();
    logger.info('1');
    logger.clear();
    expect(logger.snapshot()).toHaveLength(0);
  });

  it('redacts secret-shaped args before buffering', () => {
    const { logger } = makeLogger();
    logger.warn('auth', { token: 'abc' });
    expect((logger.snapshot()[0].args[0] as Record<string, unknown>).token).toBe('[redacted]');
  });

  it('setEnabled and setLevel change behavior live', () => {
    const { logger, sink } = makeLogger();
    logger.setEnabled(false);
    logger.error('a');
    expect(sink).toHaveLength(0);
    logger.setEnabled(true);
    logger.setLevel('error');
    logger.info('b'); // below threshold
    logger.error('c');
    expect(sink.map((e) => e.msg)).toEqual(['c']);
  });
});
