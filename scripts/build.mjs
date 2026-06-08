#!/usr/bin/env node
/**
 * Combined build script - runs CSS build then esbuild
 * Avoids npm echoing commands
 */

import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Use the absolute path of the running node, not the bare command name. On
// Windows a PATH polluted with dead version-manager shims (nvm/fnm/scoop/App
// Execution Alias stubs ordered ahead of the real install) makes `cmd` resolve
// `node` to a non-functional entry and fail with "command not found". Spawning
// process.execPath directly (no shell) sidesteps PATH resolution entirely.
const node = process.execPath;

// Forward extra args (e.g. `production`) so minify kicks in.
const args = process.argv.slice(2);
execFileSync(node, ['scripts/build-css.mjs', ...args], { cwd: ROOT, stdio: 'inherit' });

// Run esbuild with args passed through.
execFileSync(node, ['esbuild.config.mjs', ...args], { cwd: ROOT, stdio: 'inherit' });
