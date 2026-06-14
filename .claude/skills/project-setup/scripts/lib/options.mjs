// .claude/skills/project-setup/scripts/lib/options.mjs
import { readFileSync } from 'node:fs';

const DEFAULTS = {
  packageManager: null, // null => use detected
  typescript: true,
  testFramework: null, // null => use detected
  guardrails: { fallowRatchet: true, locGuard: true, eslintSeverityStaging: true, coverageFloors: true, ci: true },
  github: { integrate: false, mcp: false, fixApply: false },
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
  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  return mergeDefaults(DEFAULTS, raw);
}
