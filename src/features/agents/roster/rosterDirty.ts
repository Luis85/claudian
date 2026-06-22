import type { RosterAgent, RosterAgentModelSelection } from './rosterTypes';

// Fields the detail editor can change; comparing only these avoids false dirty
// from timestamps (createdAt/updatedAt) or stored-but-unedited fields.
const SCALAR_KEYS = ['name', 'description', 'prompt', 'color', 'initials', 'icon', 'providerOverride', 'permissionMode'] as const;

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every((value) => seen.has(value));
}

function sameModel(a?: RosterAgentModelSelection, b?: RosterAgentModelSelection): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.modelId === b.modelId && a.providerId === b.providerId;
}

/** True when `draft` differs from `original` in any editor-editable field. */
export function isRosterAgentDirty(original: RosterAgent, draft: RosterAgent): boolean {
  for (const key of SCALAR_KEYS) {
    if ((original[key] ?? '') !== (draft[key] ?? '')) return true;
  }
  return (
    !sameSet(original.skills, draft.skills) ||
    !sameSet(original.tools, draft.tools) ||
    !sameSet(original.roles, draft.roles) ||
    !sameModel(original.modelSelection, draft.modelSelection)
  );
}
