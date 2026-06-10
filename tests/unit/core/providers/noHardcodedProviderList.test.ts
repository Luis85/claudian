import '@/providers';

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';

/**
 * Guardrail: no new hardcoded provider-id enumerations.
 *
 * Adding a provider should mean registering it (src/providers/index.ts) and
 * nothing else — never editing a scattered `['claude', 'codex', ...]` array, an
 * array of `{ id: 'claude', ... }` objects, or a `switch (providerId)` that
 * lists every provider. Those drift the moment a provider is added and quietly
 * route the new one to the wrong branch. The registry (`ProviderId = string`,
 * enumerated only at runtime via `getRegisteredProviderIds()`) is the single
 * source of truth; this test keeps it that way.
 *
 * Detection is shape-agnostic on purpose (an earlier comma/whitespace-only
 * regex missed object-shaped lists): strip comments, then flag any file that
 * names >= 3 distinct provider ids in code. That catches array literals,
 * arrays of objects, and switch/comparison chains alike, while a 1–2 provider
 * reference (plausibly legitimate pair handling) stays quiet. Comment stripping
 * is naive and errs toward *under*-counting (a `//` inside a string can hide a
 * later literal) — acceptable for a guard, since that risks a miss, never a
 * false block.
 *
 * The id set comes from the registry, so this can never go stale against the
 * provider list it guards.
 */
const SRC = join(__dirname, '..', '..', '..', '..', 'src');

// Repo-relative POSIX paths exempt from the rule, each with a reason.
const ALLOWLIST = new Map<string, string>([
  [
    'src/providers/index.ts',
    'Sanctioned registration aggregator — the one place that names every provider.',
  ],
]);

const DISTINCT_THRESHOLD = 3;

const PROVIDER_IDS = ProviderRegistry.getRegisteredProviderIds();
const ID_ALT = PROVIDER_IDS.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(abs, acc);
    else if (entry.isFile() && entry.name.endsWith('.ts')) acc.push(abs);
  }
  return acc;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// Single-, double-, and backtick-quoted ids: TypeScript accepts a
// no-substitution template literal (`'claude'` vs `` `claude` ``) anywhere a
// string is accepted, so a backtick list must count too.
const QUOTE = "['\"`]";

function distinctProviderIds(code: string): string[] {
  const re = new RegExp(`${QUOTE}(${ID_ALT})${QUOTE}`, 'g');
  const distinct = new Set<string>();
  for (const m of code.matchAll(re)) distinct.add(m[1]);
  return [...distinct].sort();
}

describe('no hardcoded provider-id enumerations', () => {
  it('derives its id set from the registry (guard cannot go stale)', () => {
    expect(PROVIDER_IDS.length).toBeGreaterThanOrEqual(4);
  });

  it('flags no scattered provider-id enumerations outside the allowlist', () => {
    const offenders: string[] = [];

    for (const abs of collectSourceFiles(SRC)) {
      const rel = toPosix(relative(join(SRC, '..'), abs));
      if (ALLOWLIST.has(rel)) continue;

      const distinct = distinctProviderIds(stripComments(readFileSync(abs, 'utf8')));
      if (distinct.length >= DISTINCT_THRESHOLD) {
        offenders.push(`${rel}: enumerates ${distinct.length} provider ids (${distinct.join(', ')})`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps the allowlist honest (every entry is still a real enumeration)', () => {
    const stale: string[] = [];
    for (const rel of ALLOWLIST.keys()) {
      const distinct = distinctProviderIds(
        stripComments(readFileSync(join(SRC, '..', rel), 'utf8')),
      );
      if (distinct.length < DISTINCT_THRESHOLD) stale.push(rel);
    }
    // A stale entry means the file was cleaned up — drop it from ALLOWLIST so
    // the exemption list stays minimal (mirrors the check:loc ratchet).
    expect(stale).toEqual([]);
  });
});
