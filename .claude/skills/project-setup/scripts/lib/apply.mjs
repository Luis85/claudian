// .claude/skills/project-setup/scripts/lib/apply.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { backupFile, mergeJsonFile, mergeTextLines } from './merge.mjs';

export function apply(actions, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const dryRun = opts.dryRun ?? false;
  const backupDir = opts.backupDir ?? join(cwd, '.project-setup-backup', String(Date.now()));
  const changed = [];
  const planned = [];

  for (const action of actions) {
    const abs = join(cwd, action.path);
    planned.push(action.path); // every action is part of the plan

    if (action.type === 'mergeText') {
      const existing = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
      const { text, changed: didChange } = mergeTextLines(existing, action.lines, action.marker);
      if (didChange && !dryRun) {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, text);
      }
      if (didChange) changed.push(action.path);
    } else if (action.type === 'mergeJson') {
      const { text, changed: didChange } = mergeJsonFile(abs, action.patch);
      if (didChange && !dryRun) {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, text);
      }
      if (didChange) changed.push(action.path);
    } else if (action.type === 'writeFile') {
      const exists = existsSync(abs);
      if (action.mode === 'skip-if-exists' && exists) continue;
      if (exists && readFileSync(abs, 'utf8') === action.content) continue; // idempotent
      if (action.mode === 'overwrite-backup' && exists && !dryRun) backupFile(abs, backupDir, cwd);
      if (!dryRun) {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, action.content);
      }
      changed.push(action.path);
    } else {
      throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  return { changed, planned, dryRun };
}
