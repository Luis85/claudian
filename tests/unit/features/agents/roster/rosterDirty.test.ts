import { createRosterAgent } from '@/features/agents/roster/rosterCapabilities';
import { isRosterAgentDirty } from '@/features/agents/roster/rosterDirty';

const base = () => ({ ...createRosterAgent('Reviewer', 1), prompt: 'p', skills: ['s1'], tools: ['t1'], roles: ['worker' as const] });

describe('isRosterAgentDirty', () => {
  it('is false for an unchanged copy', () => {
    const a = base();
    expect(isRosterAgentDirty(a, { ...a, skills: [...a.skills], tools: [...a.tools], roles: [...a.roles] })).toBe(false);
  });

  it('detects a scalar field change', () => {
    const a = base();
    expect(isRosterAgentDirty(a, { ...a, name: 'New' })).toBe(true);
    expect(isRosterAgentDirty(a, { ...a, prompt: 'changed' })).toBe(true);
    expect(isRosterAgentDirty(a, { ...a, color: 'var(--color-red)' })).toBe(true);
  });

  it('detects skills/tools/roles set changes regardless of order', () => {
    const a = base();
    expect(isRosterAgentDirty(a, { ...a, skills: ['s1', 's2'] })).toBe(true);
    expect(isRosterAgentDirty(a, { ...a, tools: [] })).toBe(true);
    expect(isRosterAgentDirty(a, { ...a, roles: ['worker', 'verifier'] })).toBe(true);
  });

  it('treats set fields as order-insensitive', () => {
    const a = { ...base(), skills: ['s1', 's2'] };
    expect(isRosterAgentDirty(a, { ...a, skills: ['s2', 's1'] })).toBe(false);
  });

  it('detects model selection add/remove/change', () => {
    const a = base();
    const withModel = { ...a, modelSelection: { modelId: 'm', providerId: 'claude' as const } };
    expect(isRosterAgentDirty(a, withModel)).toBe(true);
    expect(isRosterAgentDirty(withModel, a)).toBe(true);
    expect(isRosterAgentDirty(withModel, { ...withModel, modelSelection: { modelId: 'm2', providerId: 'claude' as const } })).toBe(true);
  });

  it('detects an icon change', () => {
    const a = base();
    expect(isRosterAgentDirty(a, { ...a, icon: 'wrench' })).toBe(true);
    expect(isRosterAgentDirty({ ...a, icon: 'wrench' }, { ...a, icon: 'bug' })).toBe(true);
    expect(isRosterAgentDirty({ ...a, icon: 'wrench' }, { ...a, icon: 'wrench' })).toBe(false);
  });
});
