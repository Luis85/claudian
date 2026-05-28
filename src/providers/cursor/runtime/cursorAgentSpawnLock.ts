/**
 * Serializes Cursor Agent CLI process lifetimes. Multiple concurrent spawns
 * contend on ~/.cursor/cli-config.json (atomic rename) and can fail with EPERM on Windows.
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
