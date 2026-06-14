// .claude/skills/project-setup/scripts/lib/merge.mjs
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Additive merge: existing values win on conflict; missing keys are filled;
// arrays union (dedup by structural equality). To REPLACE a value, use a
// backup-overwrite write instead — merge never clobbers user data.
export function deepMerge(base, patch) {
  if (isObject(base) && isObject(patch)) {
    const out = { ...base };
    for (const [k, v] of Object.entries(patch)) {
      out[k] = k in base ? deepMerge(base[k], v) : v;
    }
    return out;
  }
  if (Array.isArray(base) && Array.isArray(patch)) {
    const out = [...base];
    for (const item of patch) {
      if (!out.some((x) => JSON.stringify(x) === JSON.stringify(item))) out.push(item);
    }
    return out;
  }
  return base === undefined ? patch : base;
}

// `current` is optional, for tests that pass an in-memory object instead of reading disk.
export function mergeJsonFile(path, patch, current) {
  const base = current ?? (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {});
  const merged = deepMerge(base, patch);
  const changed = JSON.stringify(base) !== JSON.stringify(merged);
  return { merged, changed, text: JSON.stringify(merged, null, 2) + '\n' };
}

export function mergeTextLines(existing, lines, marker) {
  const present = new Set(existing.split('\n').map((l) => l.trim()));
  const additions = lines.filter((l) => !present.has(l.trim()));
  if (additions.length === 0) return { text: existing, changed: false };
  const block = (marker ? [`# ${marker}`] : []).concat(additions).join('\n');
  const sep = existing === '' || existing.endsWith('\n') ? '' : '\n';
  return { text: `${existing}${sep}${block}\n`, changed: true };
}

export function backupFile(absPath, backupDir, cwd) {
  if (!existsSync(absPath)) return null;
  // Path-preserve under backupDir (mirror the file's location relative to cwd)
  // so two files with the same basename never collide; fall back to basename
  // when cwd is not provided.
  const sub = cwd ? relative(cwd, absPath) : basename(absPath);
  const dest = join(backupDir, sub);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(absPath, dest);
  return dest;
}
