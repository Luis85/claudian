import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type { ClaudeWorkspaceServices } from './ClaudeWorkspaceServices';

export function maybeGetClaudeWorkspaceServices(): ClaudeWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('claude') as ClaudeWorkspaceServices | null;
}

export function getClaudeWorkspaceServices(): ClaudeWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices('claude') as ClaudeWorkspaceServices;
}
