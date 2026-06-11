import type { SDKNativeMessage } from './sdkHistoryTypes';

type ParentResolver = (parentUuid: string | null | undefined) => string | null | undefined;

interface BranchIndex {
  byUuid: Map<string, SDKNativeMessage>;
  childrenOf: Map<string, Set<string>>;
  resolveParent: ParentResolver;
}

function isRealUserBranchChild(entry: SDKNativeMessage | undefined): boolean {
  return !!entry
    && entry.type === 'user'
    && !('toolUseResult' in entry)
    && !entry.isMeta
    && !('sourceToolUseID' in entry);
}

function isDirectRealUserBranchChild(parentUuid: string, entry: SDKNativeMessage | undefined): boolean {
  return !!entry && entry.parentUuid === parentUuid && isRealUserBranchChild(entry);
}

function dedupeByUuid(entries: SDKNativeMessage[]): SDKNativeMessage[] {
  const seen = new Set<string>();
  const deduped: SDKNativeMessage[] = [];
  for (const entry of entries) {
    if (entry.uuid) {
      if (seen.has(entry.uuid)) {
        continue;
      }
      seen.add(entry.uuid);
    }
    deduped.push(entry);
  }
  return deduped;
}

/**
 * Progress entries are interleaved into the parent chain but excluded from the
 * conversation tree; the resolver skips over them to the nearest non-progress
 * ancestor (guarded against malformed cycles).
 */
function createProgressParentResolver(deduped: SDKNativeMessage[]): ParentResolver {
  const progressUuids = new Set<string>();
  const progressParentOf = new Map<string, string | null>();
  for (const entry of deduped) {
    if ((entry.type as string) === 'progress' && entry.uuid) {
      progressUuids.add(entry.uuid);
      progressParentOf.set(entry.uuid, entry.parentUuid ?? null);
    }
  }

  return (parentUuid) => {
    if (!parentUuid) {
      return parentUuid;
    }

    let current: string | null = parentUuid;
    let guard = progressUuids.size + 1;
    while (current && progressUuids.has(current)) {
      if (--guard < 0) {
        break;
      }
      current = progressParentOf.get(current) ?? null;
    }

    return current;
  };
}

function buildBranchIndex(
  conversationEntries: SDKNativeMessage[],
  resolveParent: ParentResolver,
): BranchIndex {
  const byUuid = new Map<string, SDKNativeMessage>();
  const childrenOf = new Map<string, Set<string>>();

  for (const entry of conversationEntries) {
    if (entry.uuid) {
      byUuid.set(entry.uuid, entry);
    }

    const effectiveParent = resolveParent(entry.parentUuid) ?? null;
    if (effectiveParent && entry.uuid) {
      let children = childrenOf.get(effectiveParent);
      if (!children) {
        children = new Set();
        childrenOf.set(effectiveParent, children);
      }
      children.add(entry.uuid);
    }
  }

  return { byUuid, childrenOf, resolveParent };
}

function findLatestLeaf(
  conversationEntries: SDKNativeMessage[],
  childrenOf: Map<string, Set<string>>,
): SDKNativeMessage | undefined {
  for (let i = conversationEntries.length - 1; i >= 0; i--) {
    const uuid = conversationEntries[i].uuid;
    if (uuid && !childrenOf.has(uuid)) {
      return conversationEntries[i];
    }
  }
  return undefined;
}

function collectLatestBranch(
  latestLeaf: SDKNativeMessage | undefined,
  index: BranchIndex,
): { latestBranchUuids: Set<string>; activeChildOf: Map<string, string> } {
  const latestBranchUuids = new Set<string>();
  const activeChildOf = new Map<string, string>();

  let current = latestLeaf;
  while (current?.uuid) {
    latestBranchUuids.add(current.uuid);
    const parent = index.resolveParent(current.parentUuid);
    if (parent) {
      activeChildOf.set(parent, current.uuid);
    }
    current = parent ? index.byUuid.get(parent) : undefined;
  }

  return { latestBranchUuids, activeChildOf };
}

function entryHasOwnConversationContent(entry: SDKNativeMessage | undefined): boolean {
  if (entry?.type === 'assistant') {
    return true;
  }
  return entry?.type === 'user' && !entry.isMeta && !('sourceToolUseID' in entry);
}

function createConversationContentChecker(index: BranchIndex): (uuid: string) => boolean {
  const cache = new Map<string, boolean>();

  const hasConversationContent = (uuid: string): boolean => {
    const cached = cache.get(uuid);
    if (cached !== undefined) {
      return cached;
    }

    let result = entryHasOwnConversationContent(index.byUuid.get(uuid));
    if (!result) {
      const children = index.childrenOf.get(uuid);
      result = !!children && [...children].some(hasConversationContent);
    }

    cache.set(uuid, result);
    return result;
  };

  return hasConversationContent;
}

function hasDirectRealUserChild(uuid: string, children: Set<string>, index: BranchIndex): boolean {
  for (const childUuid of children) {
    if (isDirectRealUserBranchChild(uuid, index.byUuid.get(childUuid))) {
      return true;
    }
  }
  return false;
}

function hasAlternateConversationChild(
  children: Set<string>,
  activeChildUuid: string | undefined,
  hasConversationContent: (uuid: string) => boolean,
): boolean {
  for (const childUuid of children) {
    if (childUuid !== activeChildUuid && hasConversationContent(childUuid)) {
      return true;
    }
  }
  return false;
}

/**
 * A branch point is a node on the latest branch with a competing real user
 * message AND an alternate child that carries conversation content — i.e. a
 * rewind + re-prompt fork, not just a tool-result fan-out.
 */
function isBranchPoint(
  uuid: string,
  index: BranchIndex,
  activeChildOf: Map<string, string>,
  hasConversationContent: (uuid: string) => boolean,
): boolean {
  const children = index.childrenOf.get(uuid);
  if (!children || children.size <= 1) {
    return false;
  }

  return hasDirectRealUserChild(uuid, children, index)
    && hasAlternateConversationChild(children, activeChildOf.get(uuid), hasConversationContent);
}

function findAncestorWithUuid(
  start: SDKNativeMessage,
  targetUuid: string,
  index: BranchIndex,
): SDKNativeMessage | undefined {
  let current: SDKNativeMessage | undefined = start;
  while (current?.uuid) {
    if (current.uuid === targetUuid) {
      return current;
    }
    const parent = index.resolveParent(current.parentUuid);
    current = parent ? index.byUuid.get(parent) : undefined;
  }
  return undefined;
}

function resolveBranchingLeaf(
  latestLeaf: SDKNativeMessage | undefined,
  resumeAtMessageId: string | undefined,
  index: BranchIndex,
): SDKNativeMessage | undefined {
  if (resumeAtMessageId && latestLeaf?.uuid && index.byUuid.has(resumeAtMessageId)) {
    return findAncestorWithUuid(latestLeaf, resumeAtMessageId, index) ?? latestLeaf;
  }
  return latestLeaf;
}

function collectActiveAncestry(leaf: SDKNativeMessage, index: BranchIndex): Set<string> {
  const activeUuids = new Set<string>();
  let current: SDKNativeMessage | undefined = leaf;
  while (current?.uuid) {
    activeUuids.add(current.uuid);
    const parent = index.resolveParent(current.parentUuid);
    current = parent ? index.byUuid.get(parent) : undefined;
  }
  return activeUuids;
}

function addInactiveNonUserChildren(
  children: Set<string>,
  activeUuids: Set<string>,
  pending: string[],
  index: BranchIndex,
): void {
  for (const childUuid of children) {
    if (activeUuids.has(childUuid)) {
      continue;
    }

    const child = index.byUuid.get(childUuid);
    if (!child || isRealUserBranchChild(child)) {
      continue;
    }

    activeUuids.add(childUuid);
    pending.push(childUuid);
  }
}

/**
 * Pulls non-user-branch siblings (tool results, side effects belonging to
 * ancestors) into the active set, then transitively includes their subtrees.
 */
function includeNonBranchSiblings(
  activeUuids: Set<string>,
  activeChildOf: Map<string, string>,
  index: BranchIndex,
): void {
  const pending: string[] = [];

  for (const uuid of [...activeUuids]) {
    const children = index.childrenOf.get(uuid);
    if (!children || children.size <= 1) {
      continue;
    }

    const activeChildUuid = activeChildOf.get(uuid);
    if (activeChildUuid && isDirectRealUserBranchChild(uuid, index.byUuid.get(activeChildUuid))) {
      continue;
    }

    addInactiveNonUserChildren(children, activeUuids, pending, index);
  }

  while (pending.length > 0) {
    const parentUuid = pending.pop()!;
    const children = index.childrenOf.get(parentUuid);
    if (children) {
      addInactiveNonUserChildren(children, activeUuids, pending, index);
    }
  }
}

/**
 * Keeps active entries; uuid-less entries survive only when sandwiched
 * between active neighbors (they belong to the surrounding active run).
 */
function filterEntriesByActiveSet(
  conversationEntries: SDKNativeMessage[],
  activeUuids: Set<string>,
): SDKNativeMessage[] {
  const entryCount = conversationEntries.length;
  const prevIsActive = new Array<boolean>(entryCount);
  const nextIsActive = new Array<boolean>(entryCount);

  let lastPrevActive = false;
  for (let i = 0; i < entryCount; i++) {
    if (conversationEntries[i].uuid) {
      lastPrevActive = activeUuids.has(conversationEntries[i].uuid!);
    }
    prevIsActive[i] = lastPrevActive;
  }

  let lastNextActive = false;
  for (let i = entryCount - 1; i >= 0; i--) {
    if (conversationEntries[i].uuid) {
      lastNextActive = activeUuids.has(conversationEntries[i].uuid!);
    }
    nextIsActive[i] = lastNextActive;
  }

  return conversationEntries.filter((entry, idx) => {
    if (entry.uuid) {
      return activeUuids.has(entry.uuid);
    }
    return prevIsActive[idx] && nextIsActive[idx];
  });
}

export function filterActiveBranch(
  entries: SDKNativeMessage[],
  resumeAtMessageId?: string,
): SDKNativeMessage[] {
  if (entries.length === 0) {
    return [];
  }

  const deduped = dedupeByUuid(entries);
  const resolveParent = createProgressParentResolver(deduped);
  const conversationEntries = deduped.filter(entry => (entry.type as string) !== 'progress');
  const index = buildBranchIndex(conversationEntries, resolveParent);

  const latestLeaf = findLatestLeaf(conversationEntries, index.childrenOf);
  const { latestBranchUuids, activeChildOf } = collectLatestBranch(latestLeaf, index);
  const hasConversationContent = createConversationContentChecker(index);

  const hasBranching = [...latestBranchUuids].some(
    uuid => isBranchPoint(uuid, index, activeChildOf, hasConversationContent),
  );

  let leaf: SDKNativeMessage | undefined;
  if (hasBranching) {
    leaf = resolveBranchingLeaf(latestLeaf, resumeAtMessageId, index);
  } else if (resumeAtMessageId) {
    leaf = index.byUuid.get(resumeAtMessageId);
  } else {
    return conversationEntries;
  }

  if (!leaf?.uuid) {
    return conversationEntries;
  }

  const activeUuids = collectActiveAncestry(leaf, index);
  if (hasBranching) {
    includeNonBranchSiblings(activeUuids, activeChildOf, index);
  }

  return filterEntriesByActiveSet(conversationEntries, activeUuids);
}
