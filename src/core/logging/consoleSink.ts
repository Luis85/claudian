import type { EmittableLevel, LogEntry, LogSink } from './types';

interface ConsoleLike {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

/**
 * The single sanctioned console site in the plugin. All other code logs through
 * the Logger; the `no-console` lint rule enforces this everywhere else.
 */
export function createConsoleSink(
  // eslint-disable-next-line no-console -- the logger's console destination
  target: ConsoleLike = console,
): LogSink {
  const methods: Record<EmittableLevel, (...args: unknown[]) => void> = {
    error: target.error.bind(target),
    warn: target.warn.bind(target),
    info: target.info.bind(target),
    debug: target.debug.bind(target),
  };
  return (entry: LogEntry) => {
    methods[entry.level](`[${entry.scope}] ${entry.msg}`, ...entry.args);
  };
}
