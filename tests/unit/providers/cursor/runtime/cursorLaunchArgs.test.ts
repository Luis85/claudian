import {
  buildCursorAgentFlagArgs,
  buildCursorAgentJsonModeFlagArgs,
  resolveCursorSandboxMode,
} from '@/providers/cursor/runtime/cursorLaunchArgs';

describe('cursorLaunchArgs', () => {
  const workspace = '/vault';

  it('builds stream-json argv with trust and sandbox for normal mode', () => {
    const args = buildCursorAgentFlagArgs({
      workspaceDir: workspace,
      permissionMode: 'normal',
      resumeSessionId: null,
    });
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--stream-partial-output');
    expect(args).toContain('--workspace');
    expect(args).toContain(workspace);
    expect(args).toContain('--trust');
    expect(args).toContain('--sandbox');
    expect(args).toContain(resolveCursorSandboxMode());
  });

  it('adds force and disabled sandbox for yolo', () => {
    const args = buildCursorAgentFlagArgs({
      workspaceDir: workspace,
      permissionMode: 'yolo',
    });
    expect(args).toContain('--force');
    expect(args).toContain('disabled');
  });

  it('adds plan mode for plan permission', () => {
    const args = buildCursorAgentFlagArgs({
      workspaceDir: workspace,
      permissionMode: 'plan',
    });
    expect(args).toContain('--mode');
    expect(args).toContain('plan');
  });

  it('uses disabled sandbox on Windows for normal and plan modes', () => {
    expect(resolveCursorSandboxMode('win32')).toBe('disabled');
    const normal = buildCursorAgentFlagArgs({
      workspaceDir: workspace,
      permissionMode: 'normal',
      platform: 'win32',
    });
    expect(normal).toContain('--sandbox');
    expect(normal).toContain('disabled');
    expect(normal).not.toContain('enabled');

    const plan = buildCursorAgentFlagArgs({
      workspaceDir: workspace,
      permissionMode: 'plan',
      platform: 'win32',
    });
    expect(plan).toContain('--mode');
    expect(plan).toContain('plan');
    expect(plan).toContain('--sandbox');
    expect(plan).toContain('disabled');
  });

  it('uses enabled sandbox on macOS and Linux for normal and plan modes', () => {
    expect(resolveCursorSandboxMode('darwin')).toBe('enabled');
    expect(resolveCursorSandboxMode('linux')).toBe('enabled');

    const normal = buildCursorAgentFlagArgs({
      workspaceDir: workspace,
      permissionMode: 'normal',
      platform: 'darwin',
    });
    expect(normal).toContain('--sandbox');
    expect(normal).toContain('enabled');
  });

  it('appends resume and model when provided', () => {
    const args = buildCursorAgentFlagArgs({
      workspaceDir: workspace,
      permissionMode: 'normal',
      model: 'composer-2-fast',
      resumeSessionId: 'sess-1',
    });
    expect(args).toContain('--resume');
    expect(args).toContain('sess-1');
    expect(args).toContain('--model');
    expect(args).toContain('composer-2-fast');
  });

  it('json mode omits stream partial flags', () => {
    const args = buildCursorAgentJsonModeFlagArgs({
      workspaceDir: workspace,
      permissionMode: 'normal',
    });
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
    expect(args).not.toContain('stream-json');
    expect(args).not.toContain('--stream-partial-output');
  });
});
