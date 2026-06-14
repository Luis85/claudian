// .claude/skills/project-setup/scripts/tests/helpers.js
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Create an isolated temp project dir. Returns { dir, write, cleanup }.
export function tmpProject(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'project-setup-'));
  const write = (rel, content) => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    return abs;
  };
  for (const [rel, content] of Object.entries(files)) write(rel, content);
  return { dir, write, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
