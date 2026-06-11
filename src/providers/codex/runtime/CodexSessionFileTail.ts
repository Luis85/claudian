import * as fs from 'fs';

import type { StreamChunk } from '../../../core/types/chat';
import { findCodexSessionFile } from '../history/CodexHistoryStore';
import { CODEX_DEFAULT_CONTEXT_WINDOW, codexModelContextWindow } from './codexModelWindowCatalog';
import { mapEventMsgEvent, mapResponseItemEvent } from './codexSessionTailMapping';
import type { SessionTailState } from './codexSessionTailState';
import { createSessionTailState } from './codexSessionTailState';

export { mapEventMsgEvent, mapResponseItemEvent } from './codexSessionTailMapping';
export type {
  CallEnrichmentData,
  ResponseItemTailState,
  SessionTailState,
} from './codexSessionTailState';
export {
  createSessionTailState,
  extractResponseItemMessageText,
  extractResponseItemReasoningText,
  getNonEmptyString,
  isRecord,
  resolveTurnId,
  stringifyPayloadValue,
} from './codexSessionTailState';

// ---------------------------------------------------------------------------
// Model-specific context windows
// ---------------------------------------------------------------------------

export function getCodexContextWindow(model?: string): number {
  if (!model) return CODEX_DEFAULT_CONTEXT_WINDOW;
  return codexModelContextWindow(model) || CODEX_DEFAULT_CONTEXT_WINDOW;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function parsePayloadValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Unhandled event type tracking (log-once)
// ---------------------------------------------------------------------------

const reportedUnhandledSessionEventTypes = new Set<string>();

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

export function mapSessionFileEvent(
  event: Record<string, unknown>,
  sessionId: string,
  lineIndex: number,
  state: SessionTailState,
): StreamChunk[] {
  const eventType = event.type as string | undefined;

  if (eventType === 'event_msg') {
    const payload = (event.payload ?? event) as Record<string, unknown>;
    return mapEventMsgEvent(payload, sessionId, state);
  }

  if (eventType === 'response_item') {
    return mapResponseItemEvent(event, sessionId, lineIndex, state);
  }

  if (eventType && !reportedUnhandledSessionEventTypes.has(eventType)) {
    reportedUnhandledSessionEventTypes.add(eventType);
  }

  return [];
}

// ---------------------------------------------------------------------------
// File-tail polling engine
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

export class CodexFileTailEngine {
  private tailState: SessionTailState;
  private tailSessionFile: string | null = null;
  private tailLineCursor = 0;
  private pendingEvents: StreamChunk[] = [];
  private pollingActive = false;
  private pollPromise: Promise<void> | null = null;
  private pollingError: Error | null = null;
  private lastEventAt = 0;
  private lastPollAt = 0;
  private consecutiveReadFailures = 0;

  private _turnCompleteEmitted = false;
  private _usageEmitted = false;

  constructor(
    private sessionsDir: string,
    private defaultContextWindow: number,
    private getActiveModel?: () => string,
  ) {
    this.tailState = createSessionTailState(defaultContextWindow, getActiveModel);
  }

  get turnCompleteEmitted(): boolean {
    return this._turnCompleteEmitted;
  }

  get usageEmitted(): boolean {
    return this._usageEmitted;
  }

  async primeCursor(sessionId: string, sessionFilePath?: string): Promise<boolean> {
    const filePath = this.findSessionFile(sessionId, sessionFilePath);
    if (!filePath) return false;

    const lines = this.readFileLines(filePath);
    this.tailLineCursor = lines.length;
    return true;
  }

  startPolling(sessionId: string, sessionFilePath?: string): boolean {
    const filePath = this.findSessionFile(sessionId, sessionFilePath);
    if (!filePath) {
      return false;
    }

    this.tailSessionFile = filePath;
    this.pollingActive = true;
    this.pollingError = null;
    this.pollPromise = this.pollLoop(sessionId);
    return true;
  }

  async stopPolling(): Promise<void> {
    this.pollingActive = false;
    if (this.pollPromise) {
      await this.pollPromise;
      this.pollPromise = null;
    }
  }

  async waitForSettle(): Promise<void> {
    const maxWait = 2500;
    const checkInterval = 80;
    const idleThreshold = 500;
    const pollRecencyThreshold = 250;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      const now = Date.now();
      const idle = this.lastEventAt > 0 ? now - this.lastEventAt : now - start;
      const pollRecent = this.lastPollAt > 0 && (now - this.lastPollAt) < pollRecencyThreshold;

      if (idle >= idleThreshold && pollRecent) {
        return;
      }

      await sleep(checkInterval);
    }
  }

  collectPendingEvents(): StreamChunk[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  consumePollingError(): Error | null {
    const error = this.pollingError;
    this.pollingError = null;
    return error;
  }

  resetForNewTurn(): void {
    this.tailState = createSessionTailState(this.defaultContextWindow, this.getActiveModel);
    this.pendingEvents = [];
    this._turnCompleteEmitted = false;
    this._usageEmitted = false;
    this.pollingError = null;
    this.lastEventAt = 0;
    this.lastPollAt = 0;
    this.consecutiveReadFailures = 0;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async pollLoop(sessionId: string): Promise<void> {
    try {
      while (this.pollingActive) {
        const events = this.drainSessionFileEvents(sessionId);
        if (events.length > 0) {
          this.pendingEvents.push(...events);
          this.lastEventAt = Date.now();
          this.trackTailFlags(events);
        }
        this.lastPollAt = Date.now();
        await sleep(100);
      }

      // Final drain after stop
      const finalEvents = this.drainSessionFileEvents(sessionId);
      if (finalEvents.length > 0) {
        this.pendingEvents.push(...finalEvents);
        this.trackTailFlags(finalEvents);
      }
    } catch (error: unknown) {
      this.pollingError = error instanceof Error
        ? error
        : new Error(String(error));
      this.pollingActive = false;
    } finally {
      this.lastPollAt = Date.now();
    }
  }

  private drainSessionFileEvents(sessionId: string): StreamChunk[] {
    if (!sessionId) return [];

    const filePath = this.findSessionFile(sessionId);
    if (!filePath) return [];

    let lines: string[];
    try {
      lines = this.readFileLines(filePath);
      this.consecutiveReadFailures = 0;
    } catch {
      this.consecutiveReadFailures += 1;
      if (this.consecutiveReadFailures >= 5) {
        throw new Error(`CodexFileTailEngine: 5 consecutive read failures for ${filePath}`);
      }
      return [];
    }

    // Handle rotation: cursor beyond file length
    if (this.tailLineCursor > lines.length) {
      this.tailLineCursor = 0;
    }

    if (this.tailLineCursor >= lines.length) return [];

    const newLines = lines.slice(this.tailLineCursor);
    const startIndex = this.tailLineCursor;
    this.tailLineCursor = lines.length;

    const chunks: StreamChunk[] = [];
    for (let i = 0; i < newLines.length; i++) {
      const line = newLines[i];
      if (!line.trim()) continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      const mapped = mapSessionFileEvent(parsed, sessionId, startIndex + i, this.tailState);
      chunks.push(...mapped);
    }

    return chunks;
  }

  private findSessionFile(sessionId: string, sessionFilePath?: string): string | null {
    if (sessionFilePath && fs.existsSync(sessionFilePath)) {
      this.tailSessionFile = sessionFilePath;
      return sessionFilePath;
    }

    if (this.tailSessionFile) {
      try {
        if (fs.existsSync(this.tailSessionFile)) {
          return this.tailSessionFile;
        }
      } catch {
        // fall through and refind
      }

      this.tailSessionFile = null;
    }

    const filePath = findCodexSessionFile(sessionId, this.sessionsDir);
    if (filePath) {
      this.tailSessionFile = filePath;
    }

    return filePath;
  }

  private readFileLines(filePath: string): string[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').filter(line => line.trim());
  }

  private trackTailFlags(events: StreamChunk[]): void {
    for (const event of events) {
      if (event.type === 'done') {
        this._turnCompleteEmitted = true;
      }
      if (event.type === 'usage') {
        this._usageEmitted = true;
      }
    }
  }
}
