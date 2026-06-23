import { LoopNoteStore } from '../../../../../src/features/tasks/loops/LoopNoteStore';
import { PRESET_LOOPS } from '../../../../../src/features/tasks/loops/presetLoops';

const REQUIRED_FIELDS = ['name', 'description', 'icon', 'useWhen', 'approach', 'steps', 'verify', 'notes'] as const;

describe('PRESET_LOOPS', () => {
  it('ships a non-empty curated set', () => {
    expect(PRESET_LOOPS.length).toBeGreaterThan(0);
  });

  it('has unique names', () => {
    const names = PRESET_LOOPS.map((preset) => preset.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(PRESET_LOOPS.map((preset) => [preset.name, preset] as const))(
    '%s has every curated field populated',
    (_name, preset) => {
      for (const field of REQUIRED_FIELDS) {
        const value = (preset as unknown as Record<string, unknown>)[field];
        expect(typeof value).toBe('string');
        expect((value as string).trim().length).toBeGreaterThan(0);
      }
    },
  );

  it.each(PRESET_LOOPS.map((preset) => [preset.name, preset] as const))(
    '%s round-trips through build → parse',
    (_name, preset) => {
      const store = new LoopNoteStore();
      const built = store.build(preset);
      const parsed = store.parse(`Agent Board/loops/${preset.name}.md`, built);
      expect(parsed.name).toBe(preset.name);
      expect(parsed.approach).toBe(preset.approach.trim());
      expect(parsed.steps).toBe(preset.steps.trim());
      expect(parsed.verify).toBe(preset.verify.trim());
    },
  );
});
