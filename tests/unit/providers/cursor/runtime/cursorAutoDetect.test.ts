import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { findCursorAgentBinaryPath } from '@/providers/cursor/runtime/CursorBinaryLocator';

// Regression: an `npm i -g` install drops agent.cmd in %APPDATA%\npm. With an
// empty configured path, auto-detect must find it even when that directory is
// not on PATH (Windows can hand a stale PATH to GUI apps even after a restart).
// Uses the real env utilities; Windows-only because it exercises the win32
// extra-path list (%APPDATA%\npm).
const itWin = process.platform === 'win32' ? it : it.skip;

describe('cursor empty-path auto-detect', () => {
  itWin('resolves agent.cmd from %APPDATA%\\npm without relying on PATH', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-appdata-'));
    fs.mkdirSync(path.join(tmp, 'npm'));
    const cmd = path.join(tmp, 'npm', 'agent.cmd');
    fs.writeFileSync(cmd, '@echo off\n');

    const prevAppData = process.env.APPDATA;
    const prevPath = process.env.PATH;
    process.env.APPDATA = tmp;
    process.env.PATH = '';
    try {
      expect(findCursorAgentBinaryPath(undefined, 'win32')).toBe(cmd);
    } finally {
      process.env.APPDATA = prevAppData;
      process.env.PATH = prevPath;
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
