import type { SpecoratorSettings } from '../../../core/types/settings';
import type SpecoratorPlugin from '../../../main';

// `plugin` lets F4/F5 custom widgets subscribe to the event bus, dispatch
// commands, and sync runtime services (logger, MCP). It also unblocks the
// stubbed onClicks in agentBoard / diagnostics field definitions to invoke
// the corresponding Specorator commands once their owners wire them up.
export interface SettingsCtx {
  settings: SpecoratorSettings;
  saveSettings: () => Promise<void>;
  refresh: () => void;
  plugin: SpecoratorPlugin;
}

export type SettingsFieldType =
  | { kind: 'toggle' }
  | { kind: 'text'; placeholder?: string }
  | { kind: 'textarea'; placeholder?: string; rows?: number }
  | { kind: 'number'; min?: number; max?: number; step?: number }
  | {
      kind: 'dropdown';
      options: (settings: SpecoratorSettings) => Array<{ value: string; label: string }>;
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
  visible?: (settings: SpecoratorSettings) => boolean;
  keywords?: string[];
}

export interface SettingsTab {
  id: string;
  label: string;
  order: number;
  visible: (settings: SpecoratorSettings) => boolean;
}

export interface SettingsSection {
  id: string;
  tabId: string;
  label: string;
  order: number;
  description?: string;
  visible?: (settings: SpecoratorSettings) => boolean;
}
