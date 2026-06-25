import type { SpecoratorSettings } from '../../../core/types/settings';
import type { SettingsField, SettingsSection, SettingsTab } from './SettingsField';

function subsequenceScore(query: string, target: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let lastHit = -1;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t[ti] === q[qi]) {
      const gap = lastHit < 0 ? 0 : ti - lastHit - 1;
      score += 100 - gap;
      lastHit = ti;
      qi += 1;
    }
  }
  return qi === q.length ? Math.max(score, 1) : 0;
}

export class SettingsRegistry {
  private readonly tabs = new Map<string, SettingsTab>();
  private readonly sections = new Map<string, SettingsSection>();
  private readonly fields = new Map<string, SettingsField>();

  registerTab(tab: SettingsTab): void {
    if (this.tabs.has(tab.id)) {
      throw new Error(`duplicate tab id: ${tab.id}`);
    }
    this.tabs.set(tab.id, tab);
  }

  registerSection(section: SettingsSection): void {
    const key = `${section.tabId}.${section.id}`;
    if (this.sections.has(key)) {
      throw new Error(`duplicate section id: ${key}`);
    }
    this.sections.set(key, section);
  }

  registerField(field: SettingsField): void {
    if (this.fields.has(field.id)) {
      throw new Error(`duplicate field id: ${field.id}`);
    }
    this.fields.set(field.id, field);
  }

  getTabs(settings: SpecoratorSettings): SettingsTab[] {
    return Array.from(this.tabs.values())
      .filter((tab) => tab.visible(settings))
      .sort((a, b) => a.order - b.order);
  }

  getSections(tabId: string, settings: SpecoratorSettings): SettingsSection[] {
    return Array.from(this.sections.values())
      .filter((s) => s.tabId === tabId)
      .filter((s) => (s.visible ? s.visible(settings) : true))
      .sort((a, b) => a.order - b.order);
  }

  getFields(tabId: string, sectionId: string, settings: SpecoratorSettings): SettingsField[] {
    return Array.from(this.fields.values())
      .filter((f) => f.tabId === tabId && f.sectionId === sectionId)
      .filter((f) => (f.visible ? f.visible(settings) : true));
  }

  getAllFields(): SettingsField[] {
    return Array.from(this.fields.values());
  }

  search(query: string, settings: SpecoratorSettings): SettingsField[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const matches: Array<{ field: SettingsField; score: number }> = [];
    for (const field of this.fields.values()) {
      if (field.visible && !field.visible(settings)) continue;
      const score =
        subsequenceScore(trimmed, field.label) * 3 +
        subsequenceScore(trimmed, field.description ?? '') * 2 +
        subsequenceScore(trimmed, (field.keywords ?? []).join(' ')) * 2 +
        subsequenceScore(trimmed, `${field.tabId} ${field.sectionId}`);
      if (score > 0) matches.push({ field, score });
    }
    return matches.sort((a, b) => b.score - a.score).map((m) => m.field);
  }
}
