import type { ProviderId } from '../providers/types';
import type { UsageEntryKind } from './types';

export interface UsageEventMap {
  'usage.recorded': {
    kind: UsageEntryKind;
    name: string;
    providerId?: ProviderId;
  };
  'usage.cleared': void;
}
