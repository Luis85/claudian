import type { UsageEventMap } from '../../core/usage/events';
import type { ChatEventMap } from '../../features/chat/events';
import type { AgentsEventMap } from '../../features/agents/events';
import type { QuickActionsEventMap } from '../../features/quickActions/events';
import type { SettingsEventMap } from '../../features/settings/events';
import type { TaskEventMap } from '../../features/tasks/events';

export type ClaudianEventMap = ChatEventMap
  & QuickActionsEventMap
  & SettingsEventMap
  & TaskEventMap
  & UsageEventMap
  & AgentsEventMap;
