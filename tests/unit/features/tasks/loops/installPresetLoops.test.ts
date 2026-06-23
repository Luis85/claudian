import { installPresetLoops } from '../../../../../src/features/tasks/loops/installPresetLoops';
import { PRESET_LOOPS } from '../../../../../src/features/tasks/loops/presetLoops';

function makePlugin() {
  const created = new Map<string, string>();
  const folders = new Set<string>();
  const vault = {
    getAbstractFileByPath: (p: string) => (created.has(p) || folders.has(p) ? ({ path: p }) : null),
    createFolder: async (p: string) => { folders.add(p); },
    create: async (p: string, c: string) => { created.set(p, c); return { path: p }; },
  };
  return { plugin: { app: { vault }, settings: { agentBoardLoopFolder: 'Agent Board/loops' } } as never, created };
}

describe('installPresetLoops', () => {
  it('installs every preset on a clean vault', async () => {
    const { plugin, created } = makePlugin();
    const result = await installPresetLoops(plugin);
    expect(result.installed).toBe(PRESET_LOOPS.length);
    expect(result.skipped).toBe(0);
    expect(created.size).toBe(PRESET_LOOPS.length);
  });

  it('skips loops that already exist', async () => {
    const { plugin } = makePlugin();
    await installPresetLoops(plugin);
    const second = await installPresetLoops(plugin);
    expect(second.installed).toBe(0);
    expect(second.skipped).toBe(PRESET_LOOPS.length);
  });
});
