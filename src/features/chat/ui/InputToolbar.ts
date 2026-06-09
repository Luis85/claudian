/**
 * Barrel + factory for the input toolbar widgets.
 * Each widget lives in its own module under ./toolbar/.
 */
import { ContextUsageMeter } from './toolbar/ContextUsageMeter';
import { ExternalContextSelector } from './toolbar/ExternalContextSelector';
import { McpServerSelector } from './toolbar/McpServerSelector';
import { ModelSelector } from './toolbar/ModelSelector';
import { ModeSelector } from './toolbar/ModeSelector';
import { PermissionToggle } from './toolbar/PermissionToggle';
import { PlanModeToggle } from './toolbar/PlanModeToggle';
import { ServiceTierToggle } from './toolbar/ServiceTierToggle';
import type { ToolbarCallbacks } from './toolbar/shared';
import { ThinkingBudgetSelector } from './toolbar/ThinkingBudgetSelector';

export { ContextUsageMeter } from './toolbar/ContextUsageMeter';
export { type AddExternalContextResult, ExternalContextSelector } from './toolbar/ExternalContextSelector';
export { McpServerSelector } from './toolbar/McpServerSelector';
export { ModelSelector } from './toolbar/ModelSelector';
export { ModeSelector } from './toolbar/ModeSelector';
export { PermissionToggle } from './toolbar/PermissionToggle';
export { PlanModeToggle } from './toolbar/PlanModeToggle';
export { ServiceTierToggle } from './toolbar/ServiceTierToggle';
export { formatTokens, type ToolbarCallbacks, type ToolbarSettings } from './toolbar/shared';
export { ThinkingBudgetSelector } from './toolbar/ThinkingBudgetSelector';

export function createInputToolbar(
  parentEl: HTMLElement,
  callbacks: ToolbarCallbacks
): {
  modelSelector: ModelSelector;
  modeSelector: ModeSelector;
  thinkingBudgetSelector: ThinkingBudgetSelector;
  contextUsageMeter: ContextUsageMeter | null;
  externalContextSelector: ExternalContextSelector;
  mcpServerSelector: McpServerSelector;
  permissionToggle: PermissionToggle;
  planModeToggle: PlanModeToggle;
  serviceTierToggle: ServiceTierToggle;
} {
  const modelSelector = new ModelSelector(parentEl, callbacks);
  const thinkingBudgetSelector = new ThinkingBudgetSelector(parentEl, callbacks);
  const serviceTierToggle = new ServiceTierToggle(parentEl, callbacks);
  const contextUsageMeter = new ContextUsageMeter(parentEl);
  const externalContextSelector = new ExternalContextSelector(parentEl, callbacks);
  const mcpServerSelector = new McpServerSelector(parentEl);
  const permissionToggle = new PermissionToggle(parentEl, callbacks);
  const planModeToggle = new PlanModeToggle(parentEl, callbacks);
  const modeSelector = new ModeSelector(parentEl, callbacks);

  return {
    modelSelector,
    modeSelector,
    thinkingBudgetSelector,
    serviceTierToggle,
    contextUsageMeter,
    externalContextSelector,
    mcpServerSelector,
    permissionToggle,
    planModeToggle,
  };
}
