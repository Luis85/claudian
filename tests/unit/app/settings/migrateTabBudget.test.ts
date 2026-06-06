import { migrateTabBudget } from '../../../../src/app/settings/migrateTabBudget';

describe('migrateTabBudget', () => {
  it('copies legacy maxTabs to maxChatTabs and drops the old key', () => {
    const raw: Record<string, unknown> = { maxTabs: 7 };
    migrateTabBudget(raw);
    expect(raw.maxChatTabs).toBe(7);
    expect('maxTabs' in raw).toBe(false);
  });

  it('drops the legacy maxWorkOrderTabs key (queue cap now sole source)', () => {
    const raw: Record<string, unknown> = { maxWorkOrderTabs: 6 };
    migrateTabBudget(raw);
    expect('maxWorkOrderTabs' in raw).toBe(false);
  });

  it('does not overwrite an existing maxChatTabs', () => {
    const raw: Record<string, unknown> = { maxTabs: 9, maxChatTabs: 4 };
    migrateTabBudget(raw);
    expect(raw.maxChatTabs).toBe(4);
    expect('maxTabs' in raw).toBe(false);
  });

  it('drops both legacy keys when both are present', () => {
    const raw: Record<string, unknown> = { maxTabs: 9, maxWorkOrderTabs: 6 };
    migrateTabBudget(raw);
    expect(raw.maxChatTabs).toBe(9);
    expect('maxTabs' in raw).toBe(false);
    expect('maxWorkOrderTabs' in raw).toBe(false);
  });

  it('is idempotent on already-migrated state', () => {
    const raw: Record<string, unknown> = { maxChatTabs: 5 };
    migrateTabBudget(raw);
    migrateTabBudget(raw);
    expect(raw.maxChatTabs).toBe(5);
    expect('maxTabs' in raw).toBe(false);
    expect('maxWorkOrderTabs' in raw).toBe(false);
  });

  it('leaves the record alone when no tab-budget keys exist', () => {
    const raw: Record<string, unknown> = {};
    migrateTabBudget(raw);
    expect('maxTabs' in raw).toBe(false);
    expect('maxChatTabs' in raw).toBe(false);
    expect('maxWorkOrderTabs' in raw).toBe(false);
  });
});
