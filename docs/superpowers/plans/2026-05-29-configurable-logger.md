---
status: done
---
# Configurable Logger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed, leveled, namespaced internal logger (console + bounded ring buffer + export) configurable in General settings, replacing ad-hoc `console.*` and capturing the intermittent Claude 400 thinking-block turn on demand.

**Architecture:** A provider-neutral `Logger` lives in `core/logging/` with no Obsidian dependency. A `LoggerCore` holds threshold/enabled/ring-buffer/sink; `Logger` is a thin facade carrying a scope prefix so `logger.scope('claude.runtime')` shares the root state. The plugin owns one root logger as `plugin.logger`, configured from settings and re-read live on settings change. Console output is the only sanctioned `console.*` site, isolated behind `consoleSink.ts`. Redaction runs before every console/buffer write. Export and clipboard/Notice mechanics stay in the Obsidian layer (`main.ts`); the core stays pure.

**Tech Stack:** TypeScript, Obsidian plugin API, Jest (`--selectProjects unit`), ESLint flat config (`eslint.config.mjs`).

---

## File Structure

**Create:**
- `src/core/logging/types.ts` — `LogLevel`, `LogEntry`, `LogSink`, `LoggerOptions`, `LEVEL_RANK`, `levelAllows()`.
- `src/core/logging/redact.ts` — `redactArgs()`, `truncateBody()`.
- `src/core/logging/consoleSink.ts` — `createConsoleSink()` (the single sanctioned `console.*` site).
- `src/core/logging/formatLogEntries.ts` — `formatLogEntries(entries)` pure formatter for export.
- `src/core/logging/Logger.ts` — `LoggerCore` + `Logger` facade.
- `src/features/settings/ui/LoggingSettingsSection.ts` — General-tab logging section.
- Tests mirrored under `tests/unit/core/logging/` and additions to `tests/unit/core/events/`.

**Modify:**
- `src/core/types/settings.ts` — add `loggingEnabled`, `logLevel` fields.
- `src/app/settings/defaultSettings.ts` — add defaults.
- `src/core/events/EventBus.ts` — add `setErrorSink()`; route swallowed errors.
- `src/main.ts` — `logger` field, configure after `loadSettings`, copy/clear commands, wire EventBus sink.
- `src/features/settings/ClaudianSettings.ts` — call the logging section from `renderGeneralTab`.
- `src/providers/cursor/app/CursorWorkspaceServices.ts` — migrate the lone `console.warn`.
- `src/providers/claude/runtime/ClaudeChatRuntime.ts` — reintroduce 400 diagnostics via logger.
- `eslint.config.mjs` — add `no-console` for `src/**/*.ts`.

> **i18n note:** the logging settings section uses literal English strings (same as the existing Providers and Agent Board sections, which use literals like `'Providers'` and `'Enable …'`). Do NOT add `t()` keys — that would churn 10 locale files and is out of scope.

---

## Task 1: Log level types and `levelAllows`

**Files:**
- Create: `src/core/logging/types.ts`
- Test: `tests/unit/core/logging/levelAllows.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/logging/levelAllows.test.ts
import { levelAllows } from '../../../../src/core/logging/types';

describe('levelAllows', () => {
  it('allows a message when its level is at or below the threshold rank', () => {
    expect(levelAllows('warn', 'error')).toBe(true); // error passes a warn threshold
    expect(levelAllows('warn', 'warn')).toBe(true);
  });

  it('blocks a message below the threshold', () => {
    expect(levelAllows('warn', 'info')).toBe(false);
    expect(levelAllows('warn', 'debug')).toBe(false);
  });

  it('blocks everything when the threshold is off', () => {
    expect(levelAllows('off', 'error')).toBe(false);
    expect(levelAllows('off', 'debug')).toBe(false);
  });

  it('allows everything at debug threshold', () => {
    for (const lvl of ['error', 'warn', 'info', 'debug'] as const) {
      expect(levelAllows('debug', lvl)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t levelAllows`
Expected: FAIL — `Cannot find module '.../src/core/logging/types'`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t levelAllows`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/logging/types.ts tests/unit/core/logging/levelAllows.test.ts
git commit -m "feat(logging): add log level types and levelAllows"
```

---

## Task 2: Redaction helpers

**Files:**
- Create: `src/core/logging/redact.ts`
- Test: `tests/unit/core/logging/redact.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/logging/redact.test.ts
import { redactArgs, truncateBody } from '../../../../src/core/logging/redact';

describe('redactArgs', () => {
  it('masks secret-shaped keys', () => {
    const [out] = redactArgs([{ token: 'abc', apiKey: 'x', name: 'ok' }]) as [Record<string, unknown>];
    expect(out.token).toBe('[redacted]');
    expect(out.apiKey).toBe('[redacted]');
    expect(out.name).toBe('ok');
  });

  it('masks nested secret keys', () => {
    const [out] = redactArgs([{ auth: { authorization: 'Bearer z', ok: 1 } }]) as [{ auth: Record<string, unknown> }];
    expect(out.auth.authorization).toBe('[redacted]');
    expect(out.auth.ok).toBe(1);
  });

  it('does not mutate the caller object', () => {
    const original = { secret: 's' };
    redactArgs([original]);
    expect(original.secret).toBe('s');
  });

  it('leaves primitives untouched', () => {
    expect(redactArgs(['plain', 42, true])).toEqual(['plain', 42, true]);
  });

  it('handles cycles without throwing', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(() => redactArgs([a])).not.toThrow();
  });
});

describe('truncateBody', () => {
  it('returns short strings unchanged', () => {
    expect(truncateBody('short', 100)).toBe('short');
  });

  it('truncates and annotates overflow', () => {
    const out = truncateBody('abcdef', 3);
    expect(out).toBe('abc…[+3]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t redact`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/logging/redact.ts
const SECRET_KEY = /(token|key|secret|password|credential|api[-_]?key|authorization|cookie)/i;
const REDACTED = '[redacted]';

/** Deep-clone args, masking secret-shaped object keys. Never mutates inputs. */
export function redactArgs(args: unknown[]): unknown[] {
  return args.map((arg) => redactValue(arg, new WeakSet()));
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? REDACTED : redactValue(val, seen);
  }
  return out;
}

/** Truncate a string body, annotating dropped characters. */
export function truncateBody(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…[+${text.length - maxChars}]`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t redact`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/logging/redact.ts tests/unit/core/logging/redact.test.ts
git commit -m "feat(logging): add redaction helpers"
```

---

## Task 3: Console sink (isolated `console.*` site)

**Files:**
- Create: `src/core/logging/consoleSink.ts`
- Test: `tests/unit/core/logging/consoleSink.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/logging/consoleSink.test.ts
import { createConsoleSink } from '../../../../src/core/logging/consoleSink';
import type { LogEntry } from '../../../../src/core/logging/types';

function entry(level: LogEntry['level']): LogEntry {
  return { ts: 0, level, scope: 'area', msg: 'hi', args: [{ a: 1 }] };
}

describe('createConsoleSink', () => {
  it('routes each level to the matching console method with a scoped prefix', () => {
    const calls: Array<[string, unknown[]]> = [];
    const fake = {
      error: (...a: unknown[]) => calls.push(['error', a]),
      warn: (...a: unknown[]) => calls.push(['warn', a]),
      info: (...a: unknown[]) => calls.push(['info', a]),
      debug: (...a: unknown[]) => calls.push(['debug', a]),
    };
    const sink = createConsoleSink(fake);

    sink(entry('error'));
    sink(entry('debug'));

    expect(calls[0][0]).toBe('error');
    expect(calls[0][1][0]).toBe('[area] hi');
    expect(calls[0][1][1]).toEqual({ a: 1 });
    expect(calls[1][0]).toBe('debug');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t createConsoleSink`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/logging/consoleSink.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t createConsoleSink`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/logging/consoleSink.ts tests/unit/core/logging/consoleSink.test.ts
git commit -m "feat(logging): add isolated console sink"
```

---

## Task 4: Export formatter

**Files:**
- Create: `src/core/logging/formatLogEntries.ts`
- Test: `tests/unit/core/logging/formatLogEntries.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/logging/formatLogEntries.test.ts
import { formatLogEntries } from '../../../../src/core/logging/formatLogEntries';
import type { LogEntry } from '../../../../src/core/logging/types';

describe('formatLogEntries', () => {
  it('formats entries as ISO ts, level, scope, msg, and JSON args', () => {
    const entries: LogEntry[] = [
      { ts: 0, level: 'warn', scope: 'claude.runtime', msg: 'boom', args: [{ code: 400 }] },
    ];
    const out = formatLogEntries(entries);
    expect(out).toBe('1970-01-01T00:00:00.000Z  WARN  [claude.runtime]  boom  [{"code":400}]');
  });

  it('omits the args column when there are no args', () => {
    const entries: LogEntry[] = [{ ts: 0, level: 'info', scope: 'x', msg: 'hello', args: [] }];
    expect(formatLogEntries(entries)).toBe('1970-01-01T00:00:00.000Z  INFO  [x]  hello');
  });

  it('joins multiple entries with newlines', () => {
    const entries: LogEntry[] = [
      { ts: 0, level: 'info', scope: 'a', msg: 'one', args: [] },
      { ts: 0, level: 'info', scope: 'b', msg: 'two', args: [] },
    ];
    expect(formatLogEntries(entries).split('\n')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t formatLogEntries`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/logging/formatLogEntries.ts
import type { LogEntry } from './types';

function safeStringify(args: unknown[]): string {
  try {
    return JSON.stringify(args);
  } catch {
    return '[unserializable]';
  }
}

/** Render buffer entries to a plain-text block for clipboard export. */
export function formatLogEntries(entries: LogEntry[]): string {
  return entries
    .map((e) => {
      const head = `${new Date(e.ts).toISOString()}  ${e.level.toUpperCase()}  [${e.scope}]  ${e.msg}`;
      return e.args.length > 0 ? `${head}  ${safeStringify(e.args)}` : head;
    })
    .join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t formatLogEntries`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/logging/formatLogEntries.ts tests/unit/core/logging/formatLogEntries.test.ts
git commit -m "feat(logging): add export formatter"
```

---

## Task 5: Logger core — level gating and cheap-when-off

**Files:**
- Create: `src/core/logging/Logger.ts`
- Test: `tests/unit/core/logging/Logger.gating.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/logging/Logger.gating.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "Logger gating"`
Expected: FAIL — `Cannot find module '.../Logger'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/logging/Logger.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t "Logger gating"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/logging/Logger.ts tests/unit/core/logging/Logger.gating.test.ts
git commit -m "feat(logging): add Logger core with level gating"
```

---

## Task 6: Logger scope, ring buffer, redaction integration, live setters

**Files:**
- Modify: `src/core/logging/Logger.ts` (no code change expected — verify behavior)
- Test: `tests/unit/core/logging/Logger.behavior.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/logging/Logger.behavior.test.ts
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
```

- [ ] **Step 2: Run test to verify it passes (no new code needed)**

Run: `npm run test -- --selectProjects unit -t "Logger behavior"`
Expected: PASS — Task 5's implementation already covers these behaviors. If any assertion fails, fix `Logger.ts` minimally to satisfy it (do not change the public surface).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/core/logging/Logger.behavior.test.ts src/core/logging/Logger.ts
git commit -m "test(logging): cover scope, ring buffer, redaction, live setters"
```

---

## Task 7: EventBus error sink

**Files:**
- Modify: `src/core/events/EventBus.ts`
- Test: `tests/unit/core/events/EventBus.test.ts` (add a case; create if absent)

- [ ] **Step 1: Write the failing test**

Add this block to the existing `EventBus` describe (or create the file with the import + describe wrapper if it does not exist):

```ts
// tests/unit/core/events/EventBus.test.ts (add inside the top-level describe)
import { EventBus } from '../../../../src/core/events/EventBus';

it('routes a throwing handler to the error sink without breaking others', () => {
  const bus = new EventBus<{ ping: void }>();
  const seen: Array<{ error: unknown; event: string }> = [];
  bus.setErrorSink((error, event) => seen.push({ error, event }));

  const ok = jest.fn();
  bus.on('ping', () => { throw new Error('boom'); });
  bus.on('ping', ok);

  bus.emit('ping');

  expect(ok).toHaveBeenCalledTimes(1);
  expect(seen).toHaveLength(1);
  expect(seen[0].event).toBe('ping');
  expect((seen[0].error as Error).message).toBe('boom');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "error sink"`
Expected: FAIL — `bus.setErrorSink is not a function`.

- [ ] **Step 3: Write minimal implementation**

Edit `src/core/events/EventBus.ts`:

```ts
export class EventBus<M extends Record<string, any> = Record<string, unknown>> {
  private readonly handlers = new Map<keyof M, Set<EventHandler<never>>>();
  private errorSink?: (error: unknown, event: string) => void;

  setErrorSink(sink: (error: unknown, event: string) => void): void {
    this.errorSink = sink;
  }

  on<K extends keyof M>(event: K, handler: EventHandler<M[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof M>(event: K, handler: EventHandler<M[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<never>);
  }

  emit<K extends keyof M>(event: K, ...args: M[K] extends void ? [] : [M[K]]): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;
    const payload = (args.length > 0 ? args[0] : undefined) as M[K];
    for (const handler of [...set]) {
      try {
        (handler as EventHandler<M[K]>)(payload);
      } catch (error) {
        // One bad subscriber must not break others or the producer.
        this.errorSink?.(error, String(event));
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t "error sink"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/events/EventBus.ts tests/unit/core/events/EventBus.test.ts
git commit -m "feat(events): add EventBus error sink"
```

---

## Task 8: Settings fields and defaults

**Files:**
- Modify: `src/core/types/settings.ts`
- Modify: `src/app/settings/defaultSettings.ts`
- Test: `tests/unit/app/settings/defaultSettings.test.ts` (add or create)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/app/settings/defaultSettings.test.ts (add or create)
import { DEFAULT_CLAUDIAN_SETTINGS } from '../../../../src/app/settings/defaultSettings';

describe('logging defaults', () => {
  it('defaults logging to disabled at warn level', () => {
    expect(DEFAULT_CLAUDIAN_SETTINGS.loggingEnabled).toBe(false);
    expect(DEFAULT_CLAUDIAN_SETTINGS.logLevel).toBe('warn');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "logging defaults"`
Expected: FAIL — `loggingEnabled` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/core/types/settings.ts`, add the import near the top (after the existing first line):

```ts
import type { LogLevel } from '../logging/types';
```

Add these fields to the `ClaudianSettings` interface (place after the `quickActionsFolder?` field, before the index signature):

```ts
  /** Enable the diagnostic logger (console + ring buffer). */
  loggingEnabled?: boolean;
  /** Global log threshold. */
  logLevel?: LogLevel;
```

In `src/app/settings/defaultSettings.ts`, add to the `DEFAULT_CLAUDIAN_SETTINGS` object (after `quickActionsFolder: 'Quick Actions',`):

```ts
  loggingEnabled: false,
  logLevel: 'warn',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t "logging defaults"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/types/settings.ts src/app/settings/defaultSettings.ts tests/unit/app/settings/defaultSettings.test.ts
git commit -m "feat(logging): add logging settings fields and defaults"
```

---

## Task 9: Plugin wiring — logger field, configure, commands, EventBus sink

**Files:**
- Modify: `src/main.ts`

> No unit test: `main.ts` is the Obsidian composition root (not unit-tested in this repo). Verified by typecheck/build and the manual smoke test at the end.

- [ ] **Step 1: Add the imports**

In `src/main.ts`, add both logger imports with the other `./core/...` imports. Exact placement does not matter — run `npm run lint:fix` after editing to settle `simple-import-sort` order.

```ts
import { formatLogEntries } from './core/logging/formatLogEntries';
import { Logger } from './core/logging/Logger';
```

- [ ] **Step 2: Add the logger field**

Add below the existing `readonly events` field (line ~60):

```ts
  readonly logger = new Logger({ enabled: false, level: 'warn' });
```

- [ ] **Step 3: Configure logger and wire the EventBus sink in `onload`**

In `onload()`, immediately after `await this.loadSettings();`:

```ts
    this.logger.setEnabled(this.settings.loggingEnabled ?? false);
    this.logger.setLevel(this.settings.logLevel ?? 'warn');
    this.events.setErrorSink((error, event) => {
      this.logger.scope('events').error(`handler for "${event}" threw`, error);
    });
```

- [ ] **Step 4: Add the copy/clear commands**

In `onload()`, alongside the other `this.addCommand(...)` calls (e.g., after the `create-work-order-from-current-note` command):

```ts
    this.addCommand({
      id: 'copy-diagnostic-logs',
      name: 'Copy diagnostic logs',
      callback: () => { void this.copyDiagnosticLogs(); },
    });

    this.addCommand({
      id: 'clear-diagnostic-logs',
      name: 'Clear diagnostic logs',
      callback: () => {
        this.logger.clear();
        new Notice('Diagnostic logs cleared');
      },
    });
```

- [ ] **Step 5: Add the `copyDiagnosticLogs` method**

Add this public method to the `ClaudianPlugin` class (e.g., after `saveSettings()`):

```ts
  async copyDiagnosticLogs(): Promise<void> {
    const entries = this.logger.snapshot();
    if (entries.length === 0) {
      new Notice('No diagnostic log entries');
      return;
    }
    await navigator.clipboard.writeText(formatLogEntries(entries));
    new Notice(`Copied ${entries.length} log entries`);
  }
```

(`formatLogEntries` was imported in Step 1.)

- [ ] **Step 6: Verify typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat(logging): own logger on the plugin, add export commands, wire event bus sink"
```

---

## Task 10: General settings logging section

**Files:**
- Create: `src/features/settings/ui/LoggingSettingsSection.ts`
- Modify: `src/features/settings/ClaudianSettings.ts`

> No unit test: Obsidian `Setting` UI is not unit-tested in this repo (matches `QuickActionsSettingsTab`, `AgentBoardSettingsSection`). Verified by typecheck/build/lint and the smoke test.

- [ ] **Step 1: Create the section**

```ts
// src/features/settings/ui/LoggingSettingsSection.ts
import { Notice, Setting } from 'obsidian';

import type { LogLevel } from '../../../core/logging/types';
import type ClaudianPlugin from '../../../main';

const LEVEL_OPTIONS: Array<{ value: LogLevel; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warn' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
];

export function renderLoggingSettingsSection(
  container: HTMLElement,
  plugin: ClaudianPlugin,
): void {
  new Setting(container).setName('Diagnostics').setHeading();

  new Setting(container)
    .setName('Enable logging')
    .setDesc('Capture diagnostic logs to the developer console and an in-memory buffer.')
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.loggingEnabled ?? false)
        .onChange(async (value) => {
          plugin.settings.loggingEnabled = value;
          plugin.logger.setEnabled(value);
          await plugin.saveSettings();
        }),
    );

  new Setting(container)
    .setName('Log level')
    .setDesc('Minimum level captured. Debug is the most verbose.')
    .addDropdown((dropdown) => {
      for (const option of LEVEL_OPTIONS) {
        dropdown.addOption(option.value, option.label);
      }
      dropdown
        .setValue(plugin.settings.logLevel ?? 'warn')
        .onChange(async (value) => {
          plugin.settings.logLevel = value as LogLevel;
          plugin.logger.setLevel(value as LogLevel);
          await plugin.saveSettings();
        });
    });

  new Setting(container)
    .setName('Diagnostic log buffer')
    .setDesc('Copy recent log entries to the clipboard, or clear the buffer.')
    .addButton((button) =>
      button
        .setButtonText('Copy logs')
        .onClick(() => { void plugin.copyDiagnosticLogs(); }),
    )
    .addButton((button) =>
      button
        .setButtonText('Clear logs')
        .onClick(() => {
          plugin.logger.clear();
          new Notice('Diagnostic logs cleared');
        }),
    );
}
```

- [ ] **Step 2: Call it from the General tab**

In `src/features/settings/ClaudianSettings.ts`, add the import with the other `./ui/...` imports (keep sort order):

```ts
import { renderLoggingSettingsSection } from './ui/LoggingSettingsSection';
```

At the end of `renderGeneralTab(...)`, after the `renderEnvironmentSettingsSection({ ... })` call:

```ts
    // --- Diagnostics ---

    renderLoggingSettingsSection(container, this.plugin);
```

- [ ] **Step 3: Verify typecheck, lint, build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/settings/ui/LoggingSettingsSection.ts src/features/settings/ClaudianSettings.ts
git commit -m "feat(logging): add diagnostics section to general settings"
```

---

## Task 11: Migrate the lone `console.warn` to the logger

**Files:**
- Modify: `src/providers/cursor/app/CursorWorkspaceServices.ts`

> No unit test: this is a one-line sink swap inside a fire-and-forget catch; behavior is unchanged. Covered by typecheck/build and the `no-console` rule landing green in Task 12.

- [ ] **Step 1: Replace the console call**

In `warmCursorModelCatalog`, change the catch body. Current:

```ts
    if (/timed out/i.test(message)) {
      return;
    }
    console.warn('[cursor] model discovery failed:', err);
```

Replace the `console.warn(...)` line with:

```ts
    if (/timed out/i.test(message)) {
      return;
    }
    plugin.logger.scope('cursor.workspace').warn('model discovery failed', err);
```

(`plugin` is already a parameter of `warmCursorModelCatalog`; no new import needed.)

- [ ] **Step 2: Verify typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/providers/cursor/app/CursorWorkspaceServices.ts
git commit -m "refactor(cursor): log model-discovery failure through the logger"
```

---

## Task 12: Enforce the `no-console` convention

**Files:**
- Modify: `eslint.config.mjs`

- [ ] **Step 1: Add the rule**

In `eslint.config.mjs`, find the block scoped to both src and tests:

```js
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
```

Add a new block immediately after that block's closing `},` (so the rule applies to `src/**/*.ts` only, not tests):

```js
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },
```

- [ ] **Step 2: Run lint to verify it passes**

Run: `npm run lint`
Expected: PASS — the only `console.*` left in `src/` is the eslint-disabled line in `consoleSink.ts` (Task 3), and the cursor call was migrated (Task 11). If lint reports a `no-console` error anywhere else, migrate that call to `plugin.logger` / the nearest available logger scope, then re-run.

- [ ] **Step 3: Commit**

```bash
git add eslint.config.mjs
git commit -m "chore(lint): forbid console in src, route through the logger"
```

---

## Task 13: Reintroduce the Claude 400 diagnostics

**Files:**
- Modify: `src/providers/claude/runtime/ClaudeChatRuntime.ts`

> No unit test: this adds diagnostic log calls inside the live `query` generator (the runtime is exercised by contract/integration paths, not unit tests of `query`). The payoff is captured-on-repro buffer content; verified by the smoke test (trigger an error with debug logging on).

- [ ] **Step 1: Log query start (debug)**

In the `query` method, immediately after the line `this.currentOrchestratorMode = normalized.request.orchestratorMode === true;` (~line 1125), add:

```ts
    const log = this.plugin.logger.scope('claude.runtime');
    if (log.isEnabled('debug')) {
      log.debug('query start', {
        orchestratorMode: this.currentOrchestratorMode,
        hasHistory: (conversationHistory?.length ?? 0) > 0,
        sessionId: this.sessionManager.getSessionId() ?? null,
      });
    }
```

- [ ] **Step 2: Log the persistent-path rethrow (error)**

In the persistent path, find the `throw error;` at the end of the `catch (error)` block (~line 1235). Add a log call immediately before it:

```ts
          log.error('persistent query failed', error);
          throw error;
```

- [ ] **Step 3: Log the cold-start final error (error)**

In the cold-start path's `catch (error)` block, find where the final error message is built (~line 1268, `const msg = error instanceof Error ? error.message : 'Unknown error';` followed by yielding an error chunk). Add a log call before that `const msg` line:

```ts
      log.error('cold-start query failed', error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
```

(Only add to the OUTER catch's final error path — the one after the session-expired `if (...) { ... return; }` block, not inside the retry.)

- [ ] **Step 4: Verify typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/claude/runtime/ClaudeChatRuntime.ts
git commit -m "feat(claude): log query start and failure paths through the logger"
```

---

## Task 14: Full verification

- [ ] **Step 1: Run the full suite**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all PASS; lint reports zero `no-console` violations in `src/`.

- [ ] **Step 2: Manual smoke test (in Obsidian dev build)**

1. Open Claudian settings → General → Diagnostics. Toggle "Enable logging" on, set level to `Debug`.
2. Send a chat message / run a work order → open DevTools console; entries appear prefixed `[claude.runtime] ...` and other scopes.
3. Run command `Claudian: Copy diagnostic logs` → paste into a note; confirm formatted lines with ts/level/scope.
4. Pass a secret-shaped value somewhere logged (e.g., an object arg with an `apiKey` field) → confirm it shows `[redacted]`.
5. Set level to `Off` → console goes quiet; chat still streams normally (no behavior change, no cost).
6. Run `Claudian: Clear diagnostic logs` → re-copy shows "No diagnostic log entries".

- [ ] **Step 3: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore(logging): verification cleanup"
```

(Skip if the working tree is clean.)

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** types+gating (T1,5), redaction (T2), console sink (T3), export (T4,9), scope/buffer/live setters (T6), settings+UI (T8,10), EventBus sink (T7), migrate console (T11), no-console (T12), Claude 400 diag (T13). All spec acceptance criteria map to a task.
- **Type consistency:** `LogLevel`, `EmittableLevel`, `LogEntry`, `LogSink`, `LoggerOptions` defined once in `types.ts`; `levelAllows(threshold, level)` arg order is `(threshold, level)` everywhere; `Logger` public surface (`error/warn/info/debug/isEnabled/scope/setLevel/setEnabled/snapshot/clear`) matches the spec and the UI/plugin call sites.
- **No placeholders:** every code step shows full content.
