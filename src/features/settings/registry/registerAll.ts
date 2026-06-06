import { registerAgentBoardTabFields } from './fields/agentBoard';
import { registerClaudeTabFields } from './fields/claude';
import { registerCodexTabFields } from './fields/codex';
import { registerCursorTabFields } from './fields/cursor';
import { registerDiagnosticsTabFields } from './fields/diagnostics';
import { registerGeneralTabFields } from './fields/general';
import { registerOpencodeTabFields } from './fields/opencode';

export function registerAllSettings(): void {
  registerGeneralTabFields();
  registerClaudeTabFields();
  registerCodexTabFields();
  registerOpencodeTabFields();
  registerCursorTabFields();
  registerAgentBoardTabFields();
  registerDiagnosticsTabFields();
}
