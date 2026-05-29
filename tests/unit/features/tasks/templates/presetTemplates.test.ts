import { PRESET_TEMPLATES } from '../../../../../src/features/tasks/templates/presetTemplates';
import { TemplateNoteStore } from '../../../../../src/features/tasks/templates/TemplateNoteStore';

describe('PRESET_TEMPLATES', () => {
  const store = new TemplateNoteStore();

  it('exposes a non-empty list of templates', () => {
    expect(PRESET_TEMPLATES.length).toBeGreaterThanOrEqual(5);
  });

  it.each(PRESET_TEMPLATES)('round-trips preset $name through build + parse', (preset) => {
    const md = store.build(preset);
    const parsed = store.parse(`Agent Board/templates/${preset.name}.md`, md);
    expect(parsed.name).toBe(preset.name);
    expect(parsed.body).toContain('{{title}}');
    expect(parsed.icon).toBe(preset.icon);
    expect(parsed.priority).toBe(preset.priority);
  });

  it('every preset body declares all four canonical headings', () => {
    for (const preset of PRESET_TEMPLATES) {
      expect(preset.body).toContain('## Objective');
      expect(preset.body).toContain('## Acceptance Criteria');
      expect(preset.body).toContain('## Context');
      expect(preset.body).toContain('## Constraints');
    }
  });
});
