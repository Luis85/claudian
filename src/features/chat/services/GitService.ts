import { exec } from 'child_process';

export interface GitStatus {
  isRepo: boolean;
  dirtyCount: number;
}

const TIMEOUT_MS = 15_000;
const MAX_BUFFER = 1024 * 1024; // 1MB

export class GitService {
  constructor(
    private readonly cwd: string,
    private readonly enhancedPath: string,
  ) {}

  getStatus(): Promise<GitStatus> {
    return new Promise((resolve) => {
      exec('git status --porcelain', {
        cwd: this.cwd,
        env: { ...process.env, PATH: this.enhancedPath },
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
      }, (error, stdout) => {
        if (error) {
          resolve({ isRepo: false, dirtyCount: 0 });
          return;
        }
        const dirtyCount = stdout
          .split('\n')
          .filter((line) => line.trim().length > 0)
          .length;
        resolve({ isRepo: true, dirtyCount });
      });
    });
  }
}
