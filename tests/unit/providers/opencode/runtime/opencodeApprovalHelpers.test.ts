import type { ApprovalDecision } from '@/core/types';
import {
  buildAcpApprovalDecisionOptions,
  buildOpencodePermissionPresentation,
  mapApprovalDecision,
  normalizeApprovalInput,
  type OpencodePermissionOption,
  type OpencodePermissionOptionKind,
  selectPermissionOption,
} from '@/providers/opencode/runtime/opencodeApprovalHelpers';

function options(...kinds: OpencodePermissionOptionKind[]): OpencodePermissionOption[] {
  return kinds.map((kind) => ({ kind, name: kind.replace(/_/g, ' '), optionId: `id-${kind}` }));
}

describe('normalizeApprovalInput', () => {
  it('returns the input unchanged when it is a plain object', () => {
    const input = { command: 'ls', flags: ['-la'] };
    expect(normalizeApprovalInput(input)).toBe(input);
  });

  it('returns {} for undefined input', () => {
    expect(normalizeApprovalInput(undefined)).toEqual({});
  });

  it('wraps primitives under a "value" key', () => {
    expect(normalizeApprovalInput('hello')).toEqual({ value: 'hello' });
    expect(normalizeApprovalInput(42)).toEqual({ value: 42 });
    expect(normalizeApprovalInput(true)).toEqual({ value: true });
  });

  it('wraps null as { value: null } (null is not undefined)', () => {
    expect(normalizeApprovalInput(null)).toEqual({ value: null });
  });

  it('wraps arrays under "value" because they are not Record shape', () => {
    const arr = [1, 2, 3];
    expect(normalizeApprovalInput(arr)).toEqual({ value: arr });
  });
});

describe('buildOpencodePermissionPresentation', () => {
  it('returns the bash preset with decisionReason', () => {
    const p = buildOpencodePermissionPresentation('bash', {}, null);
    expect(p).toEqual({
      decisionReason: 'Command execution permission required',
      description: 'OpenCode wants to run a shell command.',
      toolName: 'bash',
    });
  });

  it('normalizes the permission id (case + whitespace)', () => {
    const p = buildOpencodePermissionPresentation('  BASH  ', {}, null);
    expect(p.toolName).toBe('bash');
  });

  it('falls back to the "tool" preset id when title is empty or whitespace', () => {
    // Empty title → permissionId 'tool' → default branch with formatted label.
    const p = buildOpencodePermissionPresentation('', {}, null);
    expect(p.toolName).toBe('Tool');
    expect(p.description).toBe('OpenCode wants permission to use Tool.');
  });

  it('embeds the repeated tool name in the doom_loop description when input.tool is a string', () => {
    const p = buildOpencodePermissionPresentation('doom_loop', { tool: 'edit' }, null);
    expect(p.description).toBe('Allow another repeated `edit` call.');
  });

  it('falls back to a generic doom_loop description when input.tool is missing', () => {
    const p = buildOpencodePermissionPresentation('doom_loop', {}, null);
    expect(p.description).toBe('Allow another repeated tool call.');
  });

  it('attaches blockedPath for edit when input.filePath is a non-empty string', () => {
    const p = buildOpencodePermissionPresentation('edit', { filePath: 'notes/today.md' }, null);
    expect(p).toMatchObject({
      blockedPath: 'notes/today.md',
      description: 'OpenCode wants to modify this file.',
    });
  });

  it('falls back to a generic edit description when no path is resolvable', () => {
    const p = buildOpencodePermissionPresentation('edit', {}, null);
    expect(p.blockedPath).toBeUndefined();
    expect(p.description).toBe('OpenCode wants to apply file changes.');
  });

  it('checks filepath, filePath, path, parentDir in order', () => {
    // First non-empty wins; later keys are ignored.
    const p = buildOpencodePermissionPresentation(
      'read',
      { filepath: 'a', path: 'b', parentDir: 'c' },
      null,
    );
    expect(p.blockedPath).toBe('a');
  });

  it('falls back to locations[0].path when no input key carries one', () => {
    const p = buildOpencodePermissionPresentation('read', {}, [{ path: 'remote/file.md' }]);
    expect(p.blockedPath).toBe('remote/file.md');
  });

  it('skips empty/whitespace-only path candidates', () => {
    const p = buildOpencodePermissionPresentation(
      'read',
      { filepath: '   ', filePath: '' },
      [{ path: '   ' }],
    );
    expect(p.blockedPath).toBeUndefined();
  });

  it('summarizes workflow_tool_approval with the tool names', () => {
    const input = {
      tools: [
        { name: 'Read' },
        { name: 'Edit', args: JSON.stringify({ title: 'apply diff' }) },
      ],
    };
    const p = buildOpencodePermissionPresentation('workflow_tool_approval', input, null);
    expect(p.description).toBe(
      'Pre-approve workflow tools for this session: Read, Edit: apply diff.',
    );
  });

  it('truncates the workflow summary with a "+N more" suffix when more than three tools are present', () => {
    const input = {
      tools: [
        { name: 'A' },
        { name: 'B' },
        { name: 'C' },
        { name: 'D' },
        { name: 'E' },
      ],
    };
    const p = buildOpencodePermissionPresentation('workflow_tool_approval', input, null);
    expect(p.description).toBe(
      'Pre-approve workflow tools for this session: A, B, C +2 more.',
    );
  });

  it('falls back to a generic workflow description when no tool names resolve', () => {
    const p = buildOpencodePermissionPresentation('workflow_tool_approval', { tools: [] }, null);
    expect(p.description).toBe('Pre-approve workflow tools for this session.');
  });

  it('drops malformed workflow tool entries (non-string name, malformed args JSON)', () => {
    const input = {
      tools: [
        { name: 123 },                       // non-string name → skipped
        { name: 'Write', args: 'not json' }, // bad JSON → title falls back to empty
        null,                                // not an object → skipped
        { name: '' },                        // empty name → skipped
      ],
    };
    const p = buildOpencodePermissionPresentation('workflow_tool_approval', input, null);
    expect(p.description).toBe('Pre-approve workflow tools for this session: Write.');
  });

  it('uses the formatted permission label in the default branch', () => {
    const p = buildOpencodePermissionPresentation('custom_tool_name', {}, null);
    expect(p.toolName).toBe('Custom Tool Name');
    expect(p.description).toBe('OpenCode wants permission to use Custom Tool Name.');
  });

  it('includes blockedPath in the default-branch description when a path resolves', () => {
    const p = buildOpencodePermissionPresentation('custom_tool', { path: '/etc/hosts' }, null);
    expect(p.blockedPath).toBe('/etc/hosts');
    expect(p.description).toBe(
      'OpenCode wants permission to use Custom Tool on this path.',
    );
  });
});

describe('mapApprovalDecision', () => {
  it('"allow" prefers allow_once and falls back to allow_always', () => {
    expect(mapApprovalDecision('allow', options('allow_once', 'allow_always'))).toEqual({
      outcome: { optionId: 'id-allow_once', outcome: 'selected' },
    });
    expect(mapApprovalDecision('allow', options('allow_always'))).toEqual({
      outcome: { optionId: 'id-allow_always', outcome: 'selected' },
    });
  });

  it('"allow-always" prefers allow_always and falls back to allow_once', () => {
    expect(mapApprovalDecision('allow-always', options('allow_once', 'allow_always'))).toEqual({
      outcome: { optionId: 'id-allow_always', outcome: 'selected' },
    });
    expect(mapApprovalDecision('allow-always', options('allow_once'))).toEqual({
      outcome: { optionId: 'id-allow_once', outcome: 'selected' },
    });
  });

  it('"deny" prefers reject_once and falls back to reject_always', () => {
    expect(mapApprovalDecision('deny', options('reject_once', 'reject_always'))).toEqual({
      outcome: { optionId: 'id-reject_once', outcome: 'selected' },
    });
    expect(mapApprovalDecision('deny', options('reject_always'))).toEqual({
      outcome: { optionId: 'id-reject_always', outcome: 'selected' },
    });
  });

  it('"select-option" returns the carried optionId as outcome:"selected"', () => {
    const decision: ApprovalDecision = { type: 'select-option', value: 'opt-custom' };
    expect(mapApprovalDecision(decision, options('allow_once'))).toEqual({
      outcome: { optionId: 'opt-custom', outcome: 'selected' },
    });
  });

  it('"cancel" (and any unrecognized decision) maps to outcome:"cancelled"', () => {
    expect(mapApprovalDecision('cancel', options('allow_once'))).toEqual({
      outcome: { outcome: 'cancelled' },
    });
  });

  it('falls back to outcome:"cancelled" when preferred kinds are missing from the option list', () => {
    expect(mapApprovalDecision('allow', options('reject_once'))).toEqual({
      outcome: { outcome: 'cancelled' },
    });
  });
});

describe('buildAcpApprovalDecisionOptions', () => {
  it('tags allow_once with decision "allow"', () => {
    const [opt] = buildAcpApprovalDecisionOptions(options('allow_once'));
    expect(opt).toEqual({ decision: 'allow', label: 'allow once', value: 'id-allow_once' });
  });

  it('tags allow_always with decision "allow-always"', () => {
    const [opt] = buildAcpApprovalDecisionOptions(options('allow_always'));
    expect(opt).toEqual({ decision: 'allow-always', label: 'allow always', value: 'id-allow_always' });
  });

  it('omits the decision field for reject_once and reject_always (no shortcut keybinding)', () => {
    const [once, always] = buildAcpApprovalDecisionOptions(options('reject_once', 'reject_always'));
    expect(once).toEqual({ label: 'reject once', value: 'id-reject_once' });
    expect(always).toEqual({ label: 'reject always', value: 'id-reject_always' });
  });

  it('preserves the input order', () => {
    const ordered = buildAcpApprovalDecisionOptions(
      options('reject_always', 'allow_once', 'reject_once', 'allow_always'),
    );
    expect(ordered.map((o) => o.value)).toEqual([
      'id-reject_always',
      'id-allow_once',
      'id-reject_once',
      'id-allow_always',
    ]);
  });
});

describe('selectPermissionOption', () => {
  it('returns the first preferred kind that exists in options', () => {
    const result = selectPermissionOption(options('reject_once', 'allow_once'), [
      'allow_once',
      'allow_always',
    ]);
    expect(result).toEqual({
      outcome: { optionId: 'id-allow_once', outcome: 'selected' },
    });
  });

  it('honors preferredKinds order over option-list order', () => {
    const result = selectPermissionOption(options('allow_always', 'allow_once'), [
      'allow_once',
      'allow_always',
    ]);
    expect(result).toEqual({
      outcome: { optionId: 'id-allow_once', outcome: 'selected' },
    });
  });

  it('returns outcome:"cancelled" when no preferred kind appears in options', () => {
    const result = selectPermissionOption(options('reject_once'), ['allow_once', 'allow_always']);
    expect(result).toEqual({ outcome: { outcome: 'cancelled' } });
  });

  it('returns outcome:"cancelled" for an empty option list', () => {
    const result = selectPermissionOption([], ['allow_once']);
    expect(result).toEqual({ outcome: { outcome: 'cancelled' } });
  });
});
