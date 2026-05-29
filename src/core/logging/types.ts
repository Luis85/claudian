// src/core/logging/types.ts
export type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug';

/** A level that actually produces output (everything except 'off'). */
export type EmittableLevel = Exclude<LogLevel, 'off'>;

export const LEVEL_RANK: Record<LogLevel, number> = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

/** True when a message at `level` should emit under `threshold`. */
export function levelAllows(threshold: LogLevel, level: EmittableLevel): boolean {
  if (threshold === 'off') return false;
  return LEVEL_RANK[threshold] >= LEVEL_RANK[level];
}

export interface LogEntry {
  ts: number;
  level: EmittableLevel;
  scope: string;
  msg: string;
  args: unknown[]; // already redacted
}

export type LogSink = (entry: LogEntry) => void;

export interface LoggerOptions {
  enabled: boolean;
  level: LogLevel;
  /** Max ring-buffer entries. Default 500. */
  capacity?: number;
  /** Output sink. Defaults to a console-backed sink in Logger. */
  sink?: LogSink;
  /** Max chars for a logged string body before truncation. Default 500. */
  maxBodyChars?: number;
  /** Injected clock for tests. Defaults to Date.now. */
  now?: () => number;
}
