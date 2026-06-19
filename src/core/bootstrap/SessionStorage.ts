import { promises as fs } from 'node:fs';
import * as nodePath from 'node:path';

import { ProviderRegistry } from '../providers/ProviderRegistry';
import { DEFAULT_CHAT_PROVIDER_ID } from '../providers/types';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import type {
  Conversation,
  ConversationMeta,
  SessionMetadata,
} from '../types';
import { SESSIONS_PATH } from './StoragePaths';

export {
  SESSIONS_PATH,
};

const INDEX_FILE_NAME = '_index.json';
const INDEX_VERSION = 1;

interface SessionIndexFile {
  version: number;
  entries: SessionMetadata[];
}

export class SessionStorage {
  /**
   * Serializes index reads + writes so concurrent saveMetadata/deleteMetadata
   * calls don't race on the read-modify-write cycle and lose entries.
   */
  private indexWriteQueue: Promise<void> = Promise.resolve();

  constructor(private adapter: VaultFileAdapter) {}

  getMetadataPath(id: string): string {
    return `${SESSIONS_PATH}/${id}.meta.json`;
  }

  async saveMetadata(metadata: SessionMetadata): Promise<void> {
    const filePath = this.getMetadataPath(metadata.id);
    const content = JSON.stringify(metadata, null, 2);
    await this.adapter.write(filePath, content);
    // Fire-and-forget: the user-facing save is durable in the per-session file
    // regardless of whether the index update lands. A mismatched index is
    // self-healed by `listMetadata` on the next startup that detects a count
    // mismatch against the sessions directory.
    void this.enqueueIndexUpdate((entries) => {
      const filtered = entries.filter((entry) => entry.id !== metadata.id);
      filtered.push(metadata);
      return filtered;
    });
  }

  async loadMetadata(id: string): Promise<SessionMetadata | null> {
    const filePath = this.getMetadataPath(id);

    try {
      if (!await this.adapter.exists(filePath)) {
        return null;
      }

      const content = await this.adapter.read(filePath);
      const metadata = JSON.parse(content) as SessionMetadata;

      return metadata;
    } catch {
      return null;
    }
  }

  async deleteMetadata(id: string): Promise<void> {
    await this.adapter.delete(this.getMetadataPath(id));
    void this.enqueueIndexUpdate((entries) => entries.filter((entry) => entry.id !== id));
  }

  async listMetadata(): Promise<SessionMetadata[]> {
    // Method-existence guard: unit tests stub `VaultFileAdapter` with a partial
    // shape that predates `getAbsolutePath`. Treat a missing method as "no
    // filesystem fast path" and fall through to the vault adapter route.
    const absSessionsDir = typeof this.adapter.getAbsolutePath === 'function'
      ? this.adapter.getAbsolutePath(SESSIONS_PATH)
      : null;

    // Fast path A: read the prebuilt index file. Validates by comparing the
    // id set derived from `readdir` against index entry ids, so external
    // `.meta.json` adds, removes, or id-swaps all trigger a self-healing
    // rebuild. Both operations run in parallel; validation is O(n) in JS.
    if (absSessionsDir) {
      try {
        const [indexEntries, dirEntries] = await Promise.all([
          this.readIndex(absSessionsDir),
          fs.readdir(absSessionsDir).catch((err: unknown) => {
            if ((err as { code?: string })?.code === 'ENOENT') return [] as string[];
            throw err;
          }),
        ]);
        if (indexEntries) {
          const diskIds = new Set(
            dirEntries
              .filter((name) => name.endsWith('.meta.json'))
              .map((name) => name.slice(0, -'.meta.json'.length)),
          );
          const indexIds = new Set(indexEntries.map((e) => e.id));
          const inSync = diskIds.size === indexIds.size
            && [...diskIds].every((id) => indexIds.has(id));
          if (inSync) {
            return indexEntries;
          }
          // Id-set mismatch → fall through to scan + rebuild.
        }
      } catch {
        // Fall through to scan path.
      }
    }

    // Fast path B: bypass Obsidian's vault adapter when a real filesystem backs
    // the vault. The vault adapter serializes reads through Obsidian's internal
    // queue, which on Windows costs ~20ms per file even with Promise.all — a
    // 200-session vault would block plugin onload for ~4 seconds. Node `fs`
    // parallelism drops this to single-digit milliseconds per file. Mobile and
    // tests fall through to the vault adapter path below.
    if (absSessionsDir) {
      try {
        const entries = await fs.readdir(absSessionsDir);
        const metaFiles = entries.filter((name) => name.endsWith('.meta.json'));
        const results = await Promise.all(
          metaFiles.map(async (name) => {
            try {
              const content = await fs.readFile(nodePath.join(absSessionsDir, name), 'utf8');
              return JSON.parse(content) as SessionMetadata;
            } catch {
              return null;
            }
          }),
        );
        const scanned = results.filter((meta): meta is SessionMetadata => meta !== null);
        // Rebuild the index so the next startup takes Fast path A.
        void this.enqueueIndexUpdate(() => scanned);
        return scanned;
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === 'ENOENT') return [];
        // Unexpected fs error — fall through to vault adapter as a safety net.
      }
    }

    try {
      const files = await this.adapter.listFiles(SESSIONS_PATH);
      const metaFiles = files.filter((filePath) => filePath.endsWith('.meta.json'));

      // Read all metadata files in parallel. Plugin onload + chat-view open
      // both await this list; serial reads turn into an N×read-latency stall
      // that freezes the UI on vaults with many conversations.
      const results = await Promise.all(
        metaFiles.map(async (filePath) => {
          try {
            const content = await this.adapter.read(filePath);
            return JSON.parse(content) as SessionMetadata;
          } catch {
            return null;
          }
        }),
      );

      return results.filter((meta): meta is SessionMetadata => meta !== null);
    } catch {
      // Folder doesn't exist yet.
      return [];
    }
  }

  async listAllConversations(): Promise<ConversationMeta[]> {
    const nativeMetas = await this.listMetadata();

    const metas: ConversationMeta[] = nativeMetas.map((meta) => ({
      id: meta.id,
      providerId: meta.providerId ?? DEFAULT_CHAT_PROVIDER_ID,
      title: meta.title,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      lastResponseAt: meta.lastResponseAt,
      messageCount: 0,
      preview: 'SDK session',
      titleGenerationStatus: meta.titleGenerationStatus,
    }));

    return metas.sort((a, b) =>
      (b.lastResponseAt ?? b.createdAt) - (a.lastResponseAt ?? a.createdAt)
    );
  }

  toSessionMetadata(conversation: Conversation): SessionMetadata {
    const providerState = ProviderRegistry
      .getConversationHistoryService(conversation.providerId)
      .buildPersistedProviderState?.(conversation)
      ?? conversation.providerState;

    return {
      id: conversation.id,
      providerId: conversation.providerId,
      title: conversation.title,
      titleGenerationStatus: conversation.titleGenerationStatus,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastResponseAt: conversation.lastResponseAt,
      sessionId: conversation.sessionId,
      providerState: providerState && Object.keys(providerState).length > 0 ? providerState : undefined,
      currentNote: conversation.currentNote,
      externalContextPaths: conversation.externalContextPaths,
      enabledMcpServers: conversation.enabledMcpServers,
      usage: conversation.usage,
      resumeAtMessageId: conversation.resumeAtMessageId,
      workOrderPath: conversation.workOrderPath,
      boundAgentId: conversation.boundAgentId,
    };
  }

  /** Read and validate the session index file. Returns null when missing,
   *  corrupted, or schema-mismatched (callers fall through to a full scan). */
  private async readIndex(absSessionsDir: string): Promise<SessionMetadata[] | null> {
    try {
      const content = await fs.readFile(nodePath.join(absSessionsDir, INDEX_FILE_NAME), 'utf8');
      const parsed = JSON.parse(content) as Partial<SessionIndexFile>;
      if (parsed.version !== INDEX_VERSION || !Array.isArray(parsed.entries)) return null;
      return parsed.entries as SessionMetadata[];
    } catch {
      return null;
    }
  }

  /**
   * Append an async index mutation to the serial write queue. The queue
   * guarantees the read-modify-write cycle is atomic across concurrent
   * saveMetadata/deleteMetadata calls. On adapters without a filesystem fast
   * path (mobile, tests) this is a cheap no-op.
   */
  private enqueueIndexUpdate(
    mutator: (entries: SessionMetadata[]) => SessionMetadata[],
  ): Promise<void> {
    const absSessionsDir = typeof this.adapter.getAbsolutePath === 'function'
      ? this.adapter.getAbsolutePath(SESSIONS_PATH)
      : null;
    if (!absSessionsDir) {
      return Promise.resolve();
    }

    this.indexWriteQueue = this.indexWriteQueue.then(async () => {
      try {
        const current = (await this.readIndex(absSessionsDir)) ?? [];
        const next = mutator(current);
        const payload: SessionIndexFile = { version: INDEX_VERSION, entries: next };
        await fs.mkdir(absSessionsDir, { recursive: true });
        await fs.writeFile(
          nodePath.join(absSessionsDir, INDEX_FILE_NAME),
          JSON.stringify(payload),
          'utf8',
        );
      } catch {
        // Best-effort: a failed index write self-heals on next listMetadata
        // (count-mismatch detection triggers a scan + rebuild).
      }
    }).catch(() => {
      // Defensive: keep the queue alive even if a previous mutator threw.
    });
    return this.indexWriteQueue;
  }

}
