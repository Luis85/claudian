import type { HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk';

import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type { InlineEditRequest } from '../../../core/providers/types';
import {
  isReadOnlyTool,
  READ_ONLY_TOOLS,
} from '../../../core/tools/toolNames';
import type ClaudianPlugin from '../../../main';
import { ClaudeAuxQueryRunner } from '../runtime/ClaudeAuxQueryRunner';

export type { InlineEditRequest };

export function createReadOnlyHook(): HookCallbackMatcher {
  return {
    hooks: [
      async (hookInput) => {
        const input = hookInput as {
          tool_name: string;
          tool_input: Record<string, unknown>;
        };
        const toolName = input.tool_name;

        if (isReadOnlyTool(toolName)) {
          return { continue: true };
        }

        return {
          continue: false,
          hookSpecificOutput: {
            hookEventName: 'PreToolUse' as const,
            permissionDecision: 'deny' as const,
            permissionDecisionReason: `Inline edit mode: tool "${toolName}" is not allowed (read-only)`,
          },
        };
      },
    ],
  };
}

export class InlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: ClaudianPlugin) {
    super(new ClaudeAuxQueryRunner(plugin, {
      hooks: { PreToolUse: [createReadOnlyHook()] },
      resolveProviderSettings: () => ProviderSettingsCoordinator.getProviderSettingsSnapshot(
        plugin.settings,
        'claude',
      ),
      tools: [...READ_ONLY_TOOLS],
    }));
  }
}
