import { spawn } from 'child_process';

/**
 * Force-terminates a process and all descendants. On Windows `SIGKILL` only
 * targets the parent and leaves detached bash/git grandchildren orphaned, so
 * reap the whole tree with `taskkill /T /F`. Other platforms get `SIGKILL`,
 * which propagates to the process group when the child was spawned detached.
 *
 * Shared by the chat runtime, the auxiliary one-shot runner, and the model
 * catalog probe so every `cursor-agent` spawn site tears down identically.
 */
export function forceKillCursorProcessTree(child: ReturnType<typeof spawn>): void {
  if (process.platform === 'win32' && typeof child.pid === 'number') {
    try {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('error', () => {
        // taskkill missing/blocked — fall back to a direct SIGKILL on the parent.
        try {
          child.kill('SIGKILL');
        } catch {
          // already gone
        }
      });
      return;
    } catch {
      // spawn failed synchronously — fall through to SIGKILL below.
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // already exited / not killable
  }
}
