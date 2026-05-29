import type { ChatEventMap } from '../../features/chat/events';
import type { TaskEventMap } from '../../features/tasks/events';

export type ClaudianEventMap = ChatEventMap & TaskEventMap;
