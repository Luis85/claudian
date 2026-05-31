import type { ChatEventMap } from '../../features/chat/events';
import type { SettingsEventMap } from '../../features/settings/events';
import type { TaskEventMap } from '../../features/tasks/events';

export type ClaudianEventMap = ChatEventMap & SettingsEventMap & TaskEventMap;
