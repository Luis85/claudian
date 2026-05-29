import { createConsoleSink } from './consoleSink';
import { redactArgs, truncateBody } from './redact';
import type { EmittableLevel, LogEntry, LoggerOptions, LogLevel, LogSink } from './types';
import { levelAllows } from './types';

const DEFAULT_CAPACITY = 500;
const DEFAULT_MAX_BODY = 500;

/** Shared mutable state behind every scope of one logger tree. */
class LoggerCore {
  enabled: boolean;
  level: LogLevel;
  private readonly capacity: number;
  private readonly maxBodyChars: number;
  private readonly sink: LogSink;
  private readonly now: () => number;
  private readonly buffer: LogEntry[] = [];

  constructor(options: LoggerOptions) {
    this.enabled = options.enabled;
    this.level = options.level;
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.maxBodyChars = options.maxBodyChars ?? DEFAULT_MAX_BODY;
    this.sink = options.sink ?? createConsoleSink();
    this.now = options.now ?? (() => Date.now());
  }

  allows(level: EmittableLevel): boolean {
    return this.enabled && levelAllows(this.level, level);
  }

  write(scope: string, level: EmittableLevel, msg: string, args: unknown[]): void {
    const entry: LogEntry = {
      ts: this.now(),
      level,
      scope,
      msg: truncateBody(msg, this.maxBodyChars),
      args: redactArgs(args),
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) this.buffer.shift();
    try {
      this.sink(entry);
    } catch {
      // A failing sink must never throw into a logging caller.
    }
  }

  snapshot(): LogEntry[] {
    return this.buffer.slice();
  }

  clear(): void {
    this.buffer.length = 0;
  }
}

export class Logger {
  private readonly core: LoggerCore;
  private readonly prefix: string;

  constructor(optionsOrCore: LoggerOptions | LoggerCore, prefix = '') {
    this.core = optionsOrCore instanceof LoggerCore ? optionsOrCore : new LoggerCore(optionsOrCore);
    this.prefix = prefix;
  }

  error(msg: string, ...args: unknown[]): void { this.log('error', msg, args); }
  warn(msg: string, ...args: unknown[]): void { this.log('warn', msg, args); }
  info(msg: string, ...args: unknown[]): void { this.log('info', msg, args); }
  debug(msg: string, ...args: unknown[]): void { this.log('debug', msg, args); }

  isEnabled(level: LogLevel): boolean {
    return level !== 'off' && this.core.allows(level);
  }

  scope(ns: string): Logger {
    const next = this.prefix ? `${this.prefix}.${ns}` : ns;
    return new Logger(this.core, next);
  }

  setLevel(level: LogLevel): void { this.core.level = level; }
  setEnabled(enabled: boolean): void { this.core.enabled = enabled; }
  snapshot(): LogEntry[] { return this.core.snapshot(); }
  clear(): void { this.core.clear(); }

  private log(level: EmittableLevel, msg: string, args: unknown[]): void {
    if (!this.core.allows(level)) return; // cheap no-op before any redaction/sink work
    this.core.write(this.prefix || 'app', level, msg, args);
  }
}
