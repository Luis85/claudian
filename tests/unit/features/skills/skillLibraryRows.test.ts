import type { SkillTabEntry } from '@/features/quickActions/skills/types';
import { toSkillLibraryRows } from '@/features/skills/skillLibraryRows';

const entry = (over: Partial<SkillTabEntry>): SkillTabEntry => ({
  id: 'claude:tdd',
  providerId: 'claude',
  providerDisplayName: 'Claude',
  name: 'tdd',
  description: 'Test-driven dev',
  insertPrefix: '$',
  sourceFilePath: '.claude/skills/tdd/SKILL.md',
  providerEnabled: true,
  ...over,
});

describe('toSkillLibraryRows', () => {
  it('marks file-backed entries editable and runtime entries read-only', () => {
    const rows = toSkillLibraryRows([
      entry({ id: 'claude:tdd', sourceFilePath: '.claude/skills/tdd/SKILL.md' }),
      entry({ id: 'opencode:x', providerId: 'opencode', sourceFilePath: null }),
    ]);
    expect(rows.find((r) => r.id === 'claude:tdd')?.editable).toBe(true);
    expect(rows.find((r) => r.id === 'opencode:x')?.editable).toBe(false);
  });

  it('sorts by name', () => {
    const rows = toSkillLibraryRows([
      entry({ id: 'b', name: 'beta' }),
      entry({ id: 'a', name: 'alpha' }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(['alpha', 'beta']);
  });
});
