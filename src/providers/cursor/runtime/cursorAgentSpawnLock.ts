/**
 * Serializes Cursor Agent CLI process lifetimes. Multiple concurrent spawns
 * contend on ~/.cursor/cli-config.json (atomic rename) and can fail with EPERM on Windows.
 * NOTE: this lock is intra-process only. A cross-process file lock is tracked
 * in .context/cursor-hardening-deferred.md.
 */
let queue: Promise<void> = Promise.resolve();

export async function acquireCursorAgentSpawnLock(): Promise<() => void> {
  let release!: () => void;
  const slot = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waitFor = queue;
  queue = waitFor.then(() => slot);
  await waitFor;
  return release;
}

/**
 * Acquire-and-release wrapper. Use this in new code; existing manual
 * acquire/release patterns can keep their shape until they are migrated.
 */
export async function runWithCursorAgentSpawnLock<T>(body: () => Promise<T>): Promise<T> {
  const release = await acquireCursorAgentSpawnLock();
  try {
    return await body();
  } finally {
    release();
  }
}
