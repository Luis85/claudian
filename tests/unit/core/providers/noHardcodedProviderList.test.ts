import '@/providers';

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';

/**
 * Guardrail: no new hardcoded provider-id enumerations.
 *
 * Adding a provider should mean registering it (src/providers/index.ts) and
 * nothing else — never editing a scattered `['claude', 'codex', ...]` array or
 * a `switch (providerId)` that lists every provider. Those drift the moment a
 * provider is added and quietly route the new one to the wrong branch. The
 * registry (`ProviderId = string`, enumerated only at runtime via
 * `getRegisteredProviderIds()`) is the single source of truth; this test keeps
 * it that way.
 *
 * Detects two structural shapes (the tech-debt's "scattered switch/array
 * literals"), not incidental single mentions:
 *   A. an array/argument sequence of >= 2 adjacent provider-id string literals;
 *   B. a file that compares/`case`s against >= 3 distinct provider ids.
 *
 * The id set comes from the registry, so this can never go stale against the
 * provider list it guards.
 */
const SRC = join(__dirname, '..', '..', '..', '..', 'src');

// The one sanctioned place that names every provider: the registration
// aggregator. Paths are repo-relative with POSIX separators.
const ALLOWLIST = new Set(['src/providers/index.ts']);

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

function findArraySequence(text: string): boolean {
  // Two or more provider-id string literals separated only by commas/whitespace
  // — i.e. an array or argument list enumerating providers.
  const re = new RegExp(`(['"](?:${ID_ALT})['"]\\s*,\\s*)+['"](?:${ID_ALT})['"]`);
  return re.test(text);
}

function findComparisonEnumeration(text: string): string[] {
  // `=== 'id'`, `!== 'id'`, or `case 'id'` for >= 3 distinct ids in one file.
  const re = new RegExp(`(?:===|!==|\\bcase)\\s*['"](${ID_ALT})['"]`, 'g');
  const distinct = new Set<string>();
  for (const m of text.matchAll(re)) distinct.add(m[1]);
  return distinct.size >= 3 ? [...distinct].sort() : [];
}

describe('no hardcoded provider-id enumerations', () => {
  it('derives its id set from the registry (guard cannot go stale)', () => {
    expect(PROVIDER_IDS.length).toBeGreaterThanOrEqual(4);
  });

  it('finds no scattered provider-id lists or switches outside the registration aggregator', () => {
    const offenders: string[] = [];

    for (const abs of collectSourceFiles(SRC)) {
      const rel = toPosix(relative(join(SRC, '..'), abs));
      if (ALLOWLIST.has(rel)) continue;

      const text = readFileSync(abs, 'utf8');
      if (findArraySequence(text)) {
        offenders.push(`${rel}: array/sequence literal enumerating providers`);
      }
      const cmp = findComparisonEnumeration(text);
      if (cmp.length > 0) {
        offenders.push(`${rel}: compares against ${cmp.length} provider ids (${cmp.join(', ')})`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
