// .claude/skills/project-setup/scripts/lib/options.mjs
import { readFileSync } from 'node:fs';

import { safePackageManager } from './packageManager.mjs';

const DEFAULTS = {
  packageManager: null, // null => use detected
  typescript: null, // null => use detected
  testFramework: null, // null => use detected
  guardrails: { fallowRatchet: true, locGuard: true, eslintSeverityStaging: true, coverageFloors: true, ci: true },
  // integrate/mcp gate generated files; fixApply is orchestration-only (SKILL.md), engine ignores.
  github: { integrate: false, mcp: false, fixApply: false },
  // scaffold gates the docs; grill is orchestration-only (SKILL.md/references), engine ignores.
  docs: { scaffold: true, grill: false },
  locCap: 500,
};

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function mergeDefaults(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    out[k] = isObject(base[k]) && isObject(v) ? mergeDefaults(base[k], v) : v;
  }
  return out;
}

export function loadOptions(configPath) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (e) {
    throw new Error(`Could not read answers JSON at ${configPath}: ${e.message}`);
  }
  if (!isObject(raw)) throw new Error('answers JSON must be a JSON object.');
  const options = mergeDefaults(DEFAULTS, raw);
  // Harden values that get rendered into generated executables. locCap is
  // templated raw into check-loc.mjs (`const MAX_LOC = <locCap>`), so a non-numeric
  // value would inject code — force a safe positive integer.
  const cap = Number(options.locCap);
  options.locCap = Number.isInteger(cap) && cap > 0 && cap <= 1_000_000 ? cap : 500;
  return options;
}

// Resolve install-volatile fields against the FIRST apply's resolution (explicit
// answer -> prior report -> detected -> default), so a post-install re-detect can't
// flip them (which would rewrite the report / re-baseline). packageManager is also
// whitelisted here — it's exec'd. Shared by `apply` and `verify`.
export function freezeOptions(options, frozen, state) {
  options.testFramework = options.testFramework ?? frozen?.testFramework ?? state?.testFramework ?? 'jest';
  options.packageManager = safePackageManager(options.packageManager ?? frozen?.packageManager ?? state?.packageManager ?? 'npm');
  options.typescript = options.typescript ?? frozen?.typescript ?? state?.typescript ?? true;
  return options;
}
