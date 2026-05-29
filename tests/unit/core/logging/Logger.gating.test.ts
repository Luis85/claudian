import { Logger } from '../../../../src/core/logging/Logger';
import type { LogEntry } from '../../../../src/core/logging/types';

function makeLogger(opts: { enabled: boolean; level: 'off' | 'error' | 'warn' | 'info' | 'debug' }) {
  const sink: LogEntry[] = [];
  const logger = new Logger({ ...opts, sink: (e) => sink.push(e), now: () => 0 });
  return { logger, sink };
}

describe('Logger gating', () => {
  it('emits at and above the threshold', () => {
    const { logger, sink } = makeLogger({ enabled: true, level: 'warn' });
    logger.error('a');
    logger.warn('b');
    logger.info('c'); // below threshold
    logger.debug('d'); // below threshold
    expect(sink.map((e) => e.msg)).toEqual(['a', 'b']);
  });

  it('is fully silent when disabled', () => {
    const { logger, sink } = makeLogger({ enabled: false, level: 'debug' });
    logger.error('a');
    expect(sink).toHaveLength(0);
  });

  it('is fully silent when level is off', () => {
    const { logger, sink } = makeLogger({ enabled: true, level: 'off' });
    logger.error('a');
    expect(sink).toHaveLength(0);
  });

  it('isEnabled matches gating', () => {
    const { logger } = makeLogger({ enabled: true, level: 'warn' });
    expect(logger.isEnabled('warn')).toBe(true);
    expect(logger.isEnabled('debug')).toBe(false);
  });

  it('does not build args for a filtered call when guarded by isEnabled', () => {
    const { logger } = makeLogger({ enabled: true, level: 'warn' });
    const build = jest.fn(() => 'expensive');
    if (logger.isEnabled('debug')) logger.debug('x', build());
    expect(build).not.toHaveBeenCalled();
  });
});
