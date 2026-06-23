import type { Vault } from 'obsidian';

import { LoopNoteStore } from './LoopNoteStore';
import type { LoopDefinition } from './loopTypes';

/**
 * Reads loop notes from the configured folder. `folder` is a getter so a live
 * settings change is picked up without re-instantiating the catalog.
 */
export class LoopCatalog {
  private readonly store = new LoopNoteStore();

  constructor(
    private readonly vault: Vault,
    private readonly folder: () => string,
  ) {}

  async listLoops(): Promise<LoopDefinition[]> {
    const { loops } = await this.store.list(this.vault, this.folder());
    return loops;
  }

  /** Resolve a stored slug to its definition; an unknown/empty slug yields null. */
  async resolveLoop(id: string | undefined | null): Promise<LoopDefinition | null> {
    if (!id) return null;
    const loops = await this.listLoops();
    return loops.find((loop) => loop.id === id) ?? null;
  }
}
