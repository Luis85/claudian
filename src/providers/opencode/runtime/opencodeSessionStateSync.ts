import type {
  AcpSessionConfigOption,
  AcpSessionModelState,
  AcpSessionModeState,
} from '../../acp';

/**
 * The model/mode-bearing subset shared by `newSession` and `loadSession`
 * responses. Both response shapes carry the same optional fields.
 */
export interface OpencodeSessionStatePayload {
  configOptions?: AcpSessionConfigOption[] | null;
  models?: AcpSessionModelState | null;
  modes?: AcpSessionModeState | null;
}

/**
 * Fans a session-establishment response into the model- and mode-state syncs.
 * `createSession` and `loadSession` reconcile identically once a session id is
 * captured; centralizing the fan-out keeps the two call sites from drifting.
 */
export async function syncOpencodeSessionState(
  response: OpencodeSessionStatePayload,
  syncModelState: (params: {
    configOptions?: AcpSessionConfigOption[] | null;
    models?: AcpSessionModelState | null;
  }) => Promise<void>,
  syncModeState: (params: {
    configOptions?: AcpSessionConfigOption[] | null;
    modes?: AcpSessionModeState | null;
  }) => Promise<void>,
): Promise<void> {
  await syncModelState({
    configOptions: response.configOptions ?? null,
    models: response.models ?? null,
  });
  await syncModeState({
    configOptions: response.configOptions ?? null,
    modes: response.modes ?? null,
  });
}
