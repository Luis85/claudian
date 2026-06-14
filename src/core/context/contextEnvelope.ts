import type { BrowserSelectionContext } from '../../utils/browser';
import { formatBrowserContext } from '../../utils/browser';
import type { CanvasSelectionContext } from '../../utils/canvas';
import { formatCanvasContext } from '../../utils/canvas';
import { formatCurrentNote } from '../../utils/context';
import type { EditorSelectionContext } from '../../utils/editor';
import { formatEditorContext } from '../../utils/editor';
import type { ChatTurnRequest } from '../runtime/types';
import { type ContextTrust, wrapUntrustedExternalData } from './untrustedContent';

/**
 * Provider-neutral context assembly for a turn (ADR-0001-adjacent; see
 * docs/tech-debt/2026-06-07-context-trust-envelope.md § "Settled design").
 *
 * `buildContextEnvelope` is the single seam that gathers the turn's attached
 * sources and assigns each its trust provenance, a token estimate, and a stable
 * citation handle. The four turn encoders render the envelope to their wire
 * format instead of each re-implementing the gather:
 *   - Claude + Opencode → `renderContextEnvelopeXml` (the `utils` `format*` helpers)
 *   - Codex + Cursor    → `renderContextEnvelopeSectioned` (bracketed sections)
 *
 * Trust *assignment* lives here; the untrusted-content *wrap* stays in the
 * renderers because XML and sectioned output escape differently — see
 * `renderContextEnvelopeSectioned`. The current-note hint is deliberately NOT
 * part of the sectioned render (it is each provider's `buildContextHints`
 * callback: Codex emits a terse hint, Cursor a longer instruction).
 */

export type ContextSourceType =
  | 'vault-note'
  | 'editor-selection'
  | 'browser-selection'
  | 'canvas-selection';

interface ContextSourceBase {
  trust: ContextTrust;
  /** Rough size for a pre-send preview (chars/4 for v1). */
  tokenEstimate: number;
  /** Stable id a later citation feature can reference. */
  citationHandle: string;
}

export interface VaultNoteSource extends ContextSourceBase {
  sourceType: 'vault-note';
  notePath: string;
}
export interface EditorSelectionSource extends ContextSourceBase {
  sourceType: 'editor-selection';
  selection: EditorSelectionContext;
}
export interface BrowserSelectionSource extends ContextSourceBase {
  sourceType: 'browser-selection';
  selection: BrowserSelectionContext;
}
export interface CanvasSelectionSource extends ContextSourceBase {
  sourceType: 'canvas-selection';
  selection: CanvasSelectionContext;
}

export type ContextSource =
  | VaultNoteSource
  | EditorSelectionSource
  | BrowserSelectionSource
  | CanvasSelectionSource;

export interface ContextEnvelope {
  sources: ContextSource[];
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function editorRange(selection: EditorSelectionContext): string {
  return selection.startLine && selection.lineCount
    ? `:${selection.startLine}-${selection.startLine + selection.lineCount - 1}`
    : '';
}

/**
 * Gathers the turn's attached context into a normalized, trust-tagged envelope.
 * Compact turns are the encoders' concern (they skip rendering); this just
 * reflects whatever sources the request carries.
 */
export function buildContextEnvelope(request: ChatTurnRequest): ContextEnvelope {
  const sources: ContextSource[] = [];

  if (request.currentNotePath) {
    sources.push({
      sourceType: 'vault-note',
      notePath: request.currentNotePath,
      trust: 'vault',
      tokenEstimate: estimateTokens(request.currentNotePath),
      citationHandle: `ctx:note:${request.currentNotePath}`,
    });
  }

  if (request.editorSelection) {
    const selection = request.editorSelection;
    sources.push({
      sourceType: 'editor-selection',
      selection,
      trust: 'vault',
      tokenEstimate: estimateTokens(selection.selectedText ?? ''),
      citationHandle: `ctx:editor:${selection.notePath}${editorRange(selection)}`,
    });
  }

  if (request.browserSelection) {
    const selection = request.browserSelection;
    sources.push({
      sourceType: 'browser-selection',
      selection,
      // Web content crosses the trust boundary.
      trust: 'untrusted-external',
      tokenEstimate: estimateTokens(selection.selectedText),
      citationHandle: `ctx:browser:${selection.url ?? selection.source}`,
    });
  }

  if (request.canvasSelection) {
    const selection = request.canvasSelection;
    sources.push({
      sourceType: 'canvas-selection',
      selection,
      trust: 'vault',
      tokenEstimate: estimateTokens(selection.nodeIds.join(', ')),
      citationHandle: `ctx:canvas:${selection.canvasPath}`,
    });
  }

  return { sources };
}

function renderXmlBlock(source: ContextSource): string {
  switch (source.sourceType) {
    case 'vault-note':
      return formatCurrentNote(source.notePath);
    case 'editor-selection':
      return formatEditorContext(source.selection);
    case 'browser-selection':
      return formatBrowserContext(source.selection);
    case 'canvas-selection':
      return formatCanvasContext(source.selection);
  }
}

/**
 * XML blocks (Claude / Opencode), in source order, empties dropped. Callers
 * join `[text, ...blocks]` with `\n\n` — byte-identical to the old `append*`
 * chain. `format*` owns the untrusted-content wrap + XML escaping.
 */
export function renderContextEnvelopeXml(envelope: ContextEnvelope): string[] {
  return envelope.sources.map(renderXmlBlock).filter((block) => block.length > 0);
}

/**
 * Bracketed sections for the *selection* sources (Codex / Cursor). The
 * vault-note source is intentionally excluded — its hint is each provider's
 * `buildContextHints`. The untrusted browser body is wrapped here (no XML
 * escaping in this style), keeping the wrap renderer-owned.
 */
export function renderContextEnvelopeSectioned(envelope: ContextEnvelope): string[] {
  const sections: string[] = [];
  for (const source of envelope.sources) {
    if (source.sourceType === 'editor-selection' && source.selection.selectedText) {
      sections.push(
        `\n[Editor selection from ${source.selection.notePath || 'current note'}:\n${source.selection.selectedText}\n]`,
      );
    } else if (source.sourceType === 'browser-selection' && source.selection.selectedText) {
      const wrapped = wrapUntrustedExternalData(source.selection.selectedText);
      sections.push(
        `\n[Browser selection from ${source.selection.url ?? 'unknown page'}:\n${wrapped}\n]`,
      );
    } else if (source.sourceType === 'canvas-selection') {
      const nodeList = source.selection.nodeIds.join(', ');
      if (nodeList) {
        sections.push(
          `\n[Canvas selection from ${source.selection.canvasPath}:\n${nodeList}\n]`,
        );
      }
    }
  }
  return sections;
}
