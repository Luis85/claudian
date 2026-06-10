import type { AppTabManagerState } from '../providers/types';

type AppTabState = AppTabManagerState['openTabs'][number];

function validateTabState(tab: unknown): AppTabState | null {
  if (!tab || typeof tab !== 'object') {
    return null;
  }
  const tabObj = tab as Record<string, unknown>;
  if (typeof tabObj.tabId !== 'string') {
    return null;
  }
  return {
    tabId: tabObj.tabId,
    conversationId: typeof tabObj.conversationId === 'string' ? tabObj.conversationId : null,
    ...(typeof tabObj.draftModel === 'string' ? { draftModel: tabObj.draftModel } : {}),
    // Tab restore and WO slot accounting both read `kind`; dropping it here
    // would demote persisted work-order tabs to chat on startup.
    ...(tabObj.kind === 'chat' || tabObj.kind === 'work-order' ? { kind: tabObj.kind } : {}),
  };
}

/** Validates persisted tab manager state from data.json, skipping invalid entries. */
export function validateTabManagerState(data: unknown): AppTabManagerState | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const state = data as Record<string, unknown>;
  if (!Array.isArray(state.openTabs)) {
    return null;
  }

  const openTabs: AppTabState[] = [];
  for (const tab of state.openTabs) {
    const validated = validateTabState(tab);
    if (validated) {
      openTabs.push(validated);
    }
  }

  return {
    openTabs,
    activeTabId: typeof state.activeTabId === 'string' ? state.activeTabId : null,
  };
}
