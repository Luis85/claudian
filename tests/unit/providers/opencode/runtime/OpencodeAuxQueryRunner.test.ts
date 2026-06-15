import * as path from 'node:path';

import { OpencodeAuxQueryRunner } from '@/providers/opencode/runtime/OpencodeAuxQueryRunner';

// The pure model/session helpers don't touch the ACP subprocess, so a
// barebones-constructed runner (the constructor only stores its args) exercises
// them directly via the private seam.
function makeRunner(): Record<string, unknown> {
  const runner = new OpencodeAuxQueryRunner(
    {} as never,
    { agentProfile: 'passive', artifactPurpose: 'inline' },
  );
  return runner as unknown as Record<string, unknown>;
}

describe('OpencodeAuxQueryRunner.resolveApplicableModel', () => {
  type Resolve = (model: string | undefined) => string | null;

  it('returns null for an empty/undefined selection', () => {
    const r = makeRunner();
    expect((r.resolveApplicableModel as Resolve).call(r, undefined)).toBeNull();
    expect((r.resolveApplicableModel as Resolve).call(r, '')).toBeNull();
  });

  it('returns null when the selection already matches the current model', () => {
    const r = makeRunner();
    r.currentModelId = 'gpt-x';
    expect((r.resolveApplicableModel as Resolve).call(r, 'gpt-x')).toBeNull();
  });

  it('accepts any model before the available set is known', () => {
    const r = makeRunner();
    r.availableModelIds = new Set<string>();
    expect((r.resolveApplicableModel as Resolve).call(r, 'gpt-x')).toBe('gpt-x');
  });

  it('accepts a model in the available set and rejects one outside it', () => {
    const r = makeRunner();
    r.availableModelIds = new Set(['gpt-x']);
    expect((r.resolveApplicableModel as Resolve).call(r, 'gpt-x')).toBe('gpt-x');
    expect((r.resolveApplicableModel as Resolve).call(r, 'gpt-y')).toBeNull();
  });
});

describe('OpencodeAuxQueryRunner.syncSessionModelState', () => {
  type Sync = (params: { configOptions?: unknown; models?: unknown }) => void;

  it('captures the current + available models from the models payload', () => {
    const r = makeRunner();
    (r.syncSessionModelState as Sync).call(r, {
      models: {
        currentModelId: 'gpt-x',
        availableModels: [{ id: 'gpt-x', name: 'X' }, { id: 'gpt-y', name: 'Y' }],
      },
    });
    expect(r.currentModelId).toBe('gpt-x');
    expect(r.availableModelIds).toEqual(new Set(['gpt-x', 'gpt-y']));
  });

  it('falls back to an empty available set when no models are reported', () => {
    const r = makeRunner();
    (r.syncSessionModelState as Sync).call(r, {});
    expect(r.availableModelIds).toEqual(new Set());
  });
});

describe('OpencodeAuxQueryRunner.handlePermissionRequest', () => {
  it('selects the reject option (aux runs never auto-approve)', async () => {
    const r = makeRunner();
    type Handle = (req: unknown) => Promise<{ outcome: { optionId: string; outcome: string } }>;
    const response = await (r.handlePermissionRequest as Handle).call(r, {
      options: [
        { kind: 'allow_once', optionId: 'a', name: 'Allow' },
        { kind: 'reject_once', optionId: 'r', name: 'Reject' },
      ],
    });
    expect(response.outcome).toEqual({ optionId: 'r', outcome: 'selected' });
  });
});

describe('OpencodeAuxQueryRunner.resolveSessionPath', () => {
  type Resolve = (sessionId: string, rawPath: string) => string;

  it('resolves an in-workspace path against the session cwd', () => {
    const r = makeRunner();
    (r.sessionCwds as Map<string, string>).set('s1', '/vault');
    expect((r.resolveSessionPath as Resolve).call(r, 's1', 'notes/x.md'))
      .toBe(path.resolve('/vault', 'notes/x.md'));
  });

  it('rejects a path that escapes the workspace', () => {
    const r = makeRunner();
    (r.sessionCwds as Map<string, string>).set('s1', '/vault');
    expect(() => (r.resolveSessionPath as Resolve).call(r, 's1', '../escape.md')).toThrow();
  });
});
