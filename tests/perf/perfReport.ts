/**
 * Report-only metrics helpers for the performance suite.
 *
 * These never assert — they print a readable table to the console and, when
 * SPECORATOR_PERF_JSON points at a path, append a machine-readable record so
 * runs can be diffed over time. The deterministic guard rails live in the
 * `.perf.test.ts` specs themselves; this module is purely the monitoring side.
 */
import { appendFileSync } from 'fs';

export interface PerfMetric {
  /** The scale dimension under test, e.g. message count. */
  n: number;
  /** Arbitrary measured values, e.g. { domNodes, listeners, ms }. */
  values: Record<string, number>;
}

/** Times a synchronous operation, returning its elapsed milliseconds. */
export function timeMs(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

/** Prints a labeled metrics table and, if configured, persists a JSON record. */
export function reportMetrics(label: string, metrics: PerfMetric[]): void {
  const columns = metrics.length > 0 ? Object.keys(metrics[0].values) : [];

  const rows = metrics.map((m) => {
    const row: Record<string, number> = { n: m.n };
    for (const col of columns) row[col] = m.values[col];
    return row;
  });

  console.log(`\n[perf] ${label}`);
  // console.table is the clearest console primitive for a metrics grid; console
  // is allowed in tests (no-console is scoped to src/).
  console.table(rows);

  const jsonPath = process.env.SPECORATOR_PERF_JSON;
  if (jsonPath) {
    const record = {
      label,
      timestamp: new Date().toISOString(),
      gitSha: process.env.GITHUB_SHA ?? process.env.SPECORATOR_GIT_SHA ?? null,
      metrics,
    };
    appendFileSync(jsonPath, `${JSON.stringify(record)}\n`);
  }
}
