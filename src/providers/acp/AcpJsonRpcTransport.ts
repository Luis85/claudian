// Opencode's ACP transport is the shared `core/transport/JsonRpcStdioClient`
// (ADR-0001 Move 2). It was already provider-agnostic — riding a
// `JsonRpcMessageStreams` abstraction rather than ACP-specific streams — so it
// moved to core verbatim. This module preserves the historical import path and
// the `AcpJsonRpcTransport` name for Opencode's consumers.
export type {
  JsonRpcId,
  JsonRpcMessageStreams,
  JsonRpcNotificationHandler,
  JsonRpcRequestHandler,
  JsonRpcRequestOptions,
} from '../../core/transport/JsonRpcStdioClient';
export {
  JsonRpcStdioClient as AcpJsonRpcTransport,
  JsonRpcErrorResponse,
  JsonRpcTransportClosedError,
} from '../../core/transport/JsonRpcStdioClient';
