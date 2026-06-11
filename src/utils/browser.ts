import type { ContextTrust } from '../core/context/untrustedContent';
import { wrapUntrustedExternalData } from '../core/context/untrustedContent';

export interface BrowserSelectionContext {
  source: string;
  selectedText: string;
  title?: string;
  url?: string;
}

// Web selections are the one context source that crosses the trust boundary;
// the attribute makes the provenance machine-readable in transcripts.
const BROWSER_SELECTION_TRUST: ContextTrust = 'untrusted-external';

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildAttributeList(context: BrowserSelectionContext): string {
  const attrs: string[] = [];
  const source = context.source.trim() || 'unknown';
  attrs.push(`source="${escapeXmlAttribute(source)}"`);

  if (context.title?.trim()) {
    attrs.push(`title="${escapeXmlAttribute(context.title.trim())}"`);
  }

  if (context.url?.trim()) {
    attrs.push(`url="${escapeXmlAttribute(context.url.trim())}"`);
  }

  attrs.push(`trust="${BROWSER_SELECTION_TRUST}"`);

  return attrs.join(' ');
}

function escapeXmlBody(text: string): string {
  return text.replace(/<\/browser_selection>/gi, '&lt;/browser_selection&gt;');
}

export function formatBrowserContext(context: BrowserSelectionContext): string {
  const selectedText = context.selectedText.trim();
  if (!selectedText) return '';
  const attrs = buildAttributeList(context);
  const body = wrapUntrustedExternalData(escapeXmlBody(selectedText));
  return `<browser_selection ${attrs}>\n${body}\n</browser_selection>`;
}

export function appendBrowserContext(prompt: string, context: BrowserSelectionContext): string {
  const formatted = formatBrowserContext(context);
  return formatted ? `${prompt}\n\n${formatted}` : prompt;
}
