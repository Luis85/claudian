import { exec } from 'child_process';

import { GitService } from '@/features/chat/services/GitService';

jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

const execMock = exec as jest.MockedFunction<typeof exec>;

function mockExec(error: unknown, stdout: string, stderr = '') {
  execMock.mockImplementation((_cmd: any, _opts: any, cb: any) => {
    cb(error, stdout, stderr);
    return undefined as any;
  });
}

describe('GitService', () => {
  let service: GitService;

  beforeEach(() => {
    service = new GitService('/test/dir', '/usr/bin');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('runs git status --porcelain at the configured cwd and PATH', async () => {
    mockExec(null, '');
    await service.getStatus();
    expect(execMock).toHaveBeenCalledWith(
      'git status --porcelain',
      expect.objectContaining({
        cwd: '/test/dir',
        env: expect.objectContaining({ PATH: '/usr/bin' }),
      }),
      expect.any(Function),
    );
  });

  it('reports a clean repo as isRepo true with zero dirty files', async () => {
    mockExec(null, '');
    expect(await service.getStatus()).toEqual({ isRepo: true, dirtyCount: 0 });
  });

  it('counts each porcelain line as one changed file (including untracked)', async () => {
    mockExec(null, ' M src/a.ts\n?? new.txt\nA  staged.ts\n');
    expect(await service.getStatus()).toEqual({ isRepo: true, dirtyCount: 3 });
  });

  it('returns isRepo false when not inside a git repo', async () => {
    const err: any = new Error('fatal: not a git repository');
    err.code = 128;
    mockExec(err, '', 'fatal: not a git repository');
    expect(await service.getStatus()).toEqual({ isRepo: false, dirtyCount: 0 });
  });

  it('returns isRepo false when git is not installed', async () => {
    const err: any = new Error('spawn git ENOENT');
    err.code = 'ENOENT';
    mockExec(err, '');
    expect(await service.getStatus()).toEqual({ isRepo: false, dirtyCount: 0 });
  });
});
