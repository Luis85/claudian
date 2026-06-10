import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type { CodexWorkspaceServices } from './CodexWorkspaceServices';

export function maybeGetCodexWorkspaceServices(): CodexWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('codex') as CodexWorkspaceServices | null;
}

export function getCodexWorkspaceServices(): CodexWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices('codex') as CodexWorkspaceServices;
}
