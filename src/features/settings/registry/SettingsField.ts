import type { ClaudianSettings } from '../../../core/types/settings';

export interface SettingsCtx {
  settings: ClaudianSettings;
  saveSettings: () => Promise<void>;
  refresh: () => void;
}

export type SettingsFieldType =
  | { kind: 'toggle' }
  | { kind: 'text'; placeholder?: string }
  | { kind: 'textarea'; placeholder?: string; rows?: number }
  | { kind: 'number'; min?: number; max?: number; step?: number }
  | {
      kind: 'dropdown';
      options: (settings: ClaudianSettings) => Array<{ value: string; label: string }>;
    }
  | { kind: 'folder'; placeholder?: string }
  | { kind: 'button'; label: string; onClick: (ctx: SettingsCtx) => void | Promise<void> }
  | {
      kind: 'custom';
      render: (ctx: SettingsCtx, host: HTMLElement) => void | (() => void);
    };

export interface SettingsField<T = unknown> {
  id: string;
  tabId: string;
  sectionId: string;
  label: string;
  description?: string;
  type: SettingsFieldType;
  default: T;
  visible?: (settings: ClaudianSettings) => boolean;
  keywords?: string[];
}

export interface SettingsTab {
  id: string;
  label: string;
  order: number;
  visible: (settings: ClaudianSettings) => boolean;
}

export interface SettingsSection {
  id: string;
  tabId: string;
  label: string;
  order: number;
  description?: string;
  visible?: (settings: ClaudianSettings) => boolean;
}
