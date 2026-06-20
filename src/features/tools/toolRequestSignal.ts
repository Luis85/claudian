/**
 * Extracts the per-request `AbortSignal` an MCP tool handler receives via its
 * `extra` argument (the MCP SDK's `RequestHandlerExtra`). The argument is typed
 * `unknown` at both host boundaries (SDK + HTTP), so narrow defensively and fall
 * back to a fresh never-aborted signal when the host does not supply one.
 */
export function requestSignal(extra: unknown): AbortSignal {
  const candidate = (extra as { signal?: unknown } | undefined)?.signal;
  return candidate instanceof AbortSignal ? candidate : new AbortController().signal;
}
