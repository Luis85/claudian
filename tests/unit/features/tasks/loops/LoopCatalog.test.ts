import { LoopCatalog } from '../../../../../src/features/tasks/loops/LoopCatalog';
import { LoopNoteStore } from '../../../../../src/features/tasks/loops/LoopNoteStore';

function vaultWith(files: Record<string, string>) {
  return {
    getMarkdownFiles: () => Object.keys(files).map((path) => ({ path })),
    read: async (file: { path: string }) => files[file.path],
  } as never;
}

const LOOP_A = new LoopNoteStore().build({
  name: 'Alpha loop', useWhen: 'a', approach: 'do a', steps: '', verify: '', notes: '',
});

describe('LoopCatalog', () => {
  it('resolves a known slug to its definition', async () => {
    const vault = vaultWith({ 'Agent Board/loops/alpha-loop.md': LOOP_A });
    const catalog = new LoopCatalog(vault, () => 'Agent Board/loops');
    const loop = await catalog.resolveLoop('alpha-loop');
    expect(loop?.name).toBe('Alpha loop');
  });

  it('resolves an unknown slug to null', async () => {
    const vault = vaultWith({ 'Agent Board/loops/alpha-loop.md': LOOP_A });
    const catalog = new LoopCatalog(vault, () => 'Agent Board/loops');
    expect(await catalog.resolveLoop('missing')).toBeNull();
    expect(await catalog.resolveLoop(undefined)).toBeNull();
    expect(await catalog.resolveLoop('')).toBeNull();
  });

  it('lists all loops from the folder', async () => {
    const vault = vaultWith({ 'Agent Board/loops/alpha-loop.md': LOOP_A });
    const catalog = new LoopCatalog(vault, () => 'Agent Board/loops');
    const loops = await catalog.listLoops();
    expect(loops.map((l) => l.name)).toEqual(['Alpha loop']);
  });
});
