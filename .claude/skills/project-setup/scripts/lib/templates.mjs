// scripts/lib/templates.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

export function renderTemplate(content, vars) {
  return content.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!(name in vars)) throw new Error(`Template variable not provided: ${name}`);
    return String(vars[name]);
  });
}

export function loadTemplate(name) {
  return readFileSync(join(TEMPLATES_DIR, name), 'utf8');
}
