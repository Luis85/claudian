import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type { OpencodeWorkspaceServices } from './OpencodeWorkspaceServices';

export function maybeGetOpencodeWorkspaceServices(): OpencodeWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('opencode') as OpencodeWorkspaceServices | null;
}
