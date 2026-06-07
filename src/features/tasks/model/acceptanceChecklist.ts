export interface AcceptanceChecklistItem {
  checked: boolean;
  /** The criterion text with the leading `- [ ]` / `- [x]` marker stripped. */
  text: string;
}

const CHECKBOX_ITEM = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/;
// A flat, top-level checkbox line carries no leading indentation.
const TOP_LEVEL_CHECKBOX = /^[-*]\s+\[( |x|X)\]\s+/;

/**
 * Splits an acceptance-criteria block into checklist rows for the read-only
 * checklist card. Mirrors the checkbox grammar of `parseAcceptanceProgress`
 * (which owns the done/total counts) but additionally captures each item's
 * label so the modal can render rows directly without a markdown round-trip.
 * Lines that are not checkbox items are ignored.
 */
export function parseAcceptanceChecklist(markdown: string): AcceptanceChecklistItem[] {
  const items: AcceptanceChecklistItem[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(CHECKBOX_ITEM);
    if (!match) continue;
    items.push({ checked: match[1].toLowerCase() === 'x', text: match[2].trim() });
  }
  return items;
}

/**
 * True only when the section is a flat task-list: at least one top-level
 * checkbox item and no other non-blank lines. Mixed content (checkboxes
 * interleaved with prose), nested/indented checkboxes, and continuation lines
 * all return false so callers render the full markdown instead of flattening
 * the hierarchy or dropping the non-checkbox lines.
 */
export function isPureAcceptanceChecklist(markdown: string): boolean {
  let sawCheckbox = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    if (!TOP_LEVEL_CHECKBOX.test(line)) return false;
    sawCheckbox = true;
  }
  return sawCheckbox;
}
