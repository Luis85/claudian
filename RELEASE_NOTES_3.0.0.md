# Claudian 3.0.0 Release Notes

## Overview

Claudian 3.0.0 introduces a complete overhaul of the settings experience with improved provider management, unified search, and per-provider customization capabilities. This release marks the transition to a more flexible multi-provider architecture where users have granular control over enabled providers and their configurations.

---

## Breaking Changes

### Settings Storage Migration
- **Legacy path deprecated**: `.claude/claudian-settings.json` is no longer read. Settings are now exclusively stored in `.claudian/claudian-settings.json`.
  - Migration is automatic and one-shot: on first load, the plugin reads the legacy path and migrates settings to the new location.
  - This consolidation simplifies plugin storage and aligns with Obsidian vault conventions.

### Agent Board Default Provider
- **`agentBoardDefaultProvider` is now nullable** (previously defaulted to `'codex'`).
  - Users must explicitly select a provider for agent board operations, or use the first-run modal to set a default.
  - This change enables the new default-provider resolver flow, where users can single-click without picking a provider each time if they've set a default.

### Agent Board Default Model
- **`agentBoardDefaultModel` is now nullable** (previously defaulted to `''`).
  - Aligns with the nullable provider setting for consistent agent board initialization.
  - Users can set a default model per provider in the new custom models table.

### Custom Model Storage
- **Custom model IDs are now stored per-provider** (previously stored globally).
  - Each provider (`claude`, `codex`, `opencode`, `cursor`) maintains its own custom model registry.
  - This supports per-provider context-window overrides and custom model definitions without cross-provider conflicts.

### Settings UI Reorganization
- **Per-tab toggles removed**: Provider enable/disable is now controlled via unified toggles on the General settings tab.
- **Disabled provider tabs are hidden**: If a provider is disabled, its settings tab will not render, reducing UI clutter.
- **Only enabled providers appear**: The settings interface dynamically reflects active providers, improving clarity.

---

## New Features

### First-Run Banner & Provider Selection Modal
- On fresh start (no prior settings), users are greeted with a provider selection modal.
- Users can select one or more providers to enable, establishing their multi-provider workspace from the beginning.
- Reduces onboarding friction and makes it clear which providers are available.

### Provider Enable/Disable Toggles
- New unified toggle controls on the General settings tab.
- Enable or disable Claude, Codex, Opencode, and Cursor without switching between tabs.
- Changes take effect immediately; disabled providers' tabs are automatically hidden.

### Settings Search with Shortcut
- New search box in the settings panel with keyboard shortcut support (`/`).
- Quickly find settings by keyword (e.g., "token", "model", "timeout").
- Search results are highlighted and displayed inline, making settings discovery faster.

### Default-Provider Resolver
- Smart default-provider selection for agent board operations.
- Once a default provider is set (via first-run modal or settings), users can single-click to create agent work orders without picking a provider each time.
- Improves workflow efficiency for users who primarily use one provider.

### Custom Models Table Per Provider
- New per-provider custom models table in each provider's settings tab.
- Users can:
  - View all available models for the provider
  - Add custom model definitions
  - Override context windows for custom or official models
  - Manage model parameters per provider
- Replaces the legacy global custom models approach with provider-aware configuration.

### Live Hotkey Bindings View
- New inline hotkey bindings display on the General settings tab.
- Shows all registered plugin commands and their current keyboard shortcuts.
- Provides at-a-glance visibility into available hotkeys and helps users discover keyboard navigation options.

---

## Migration Guide

### For Existing Users

1. **Settings Location**: On first load after upgrading, your settings will be automatically migrated from `.claude/claudian-settings.json` to `.claudian/claudian-settings.json`. No manual action required.

2. **Provider Defaults**: Review your agent board default provider setting:
   - If previously set to a specific provider, it will be preserved.
   - If unset, you may see the first-run modal or be prompted to select a default.

3. **Custom Models**: Custom models you've defined will migrate automatically, but they are now stored per-provider. Visit each provider's settings tab to verify your custom model configurations.

4. **Hotkeys**: Existing hotkey bindings are preserved. View the new Live Hotkey Bindings display on the General settings tab to verify your setup.

### For Fresh Installations

1. Launch the plugin and complete the first-run provider selection modal.
2. Configure provider-specific settings in their respective tabs.
3. Set default provider and model in the General tab for single-click agent board operations.
4. Use the settings search (`/`) to quickly locate specific configurations.

---

## Known Limitations

- Settings search is currently limited to setting names and descriptions (full-text search across values coming in future releases).
- Custom model context-window overrides apply only to official provider models (custom user-defined models use their specified context windows).

---

## Feedback & Support

For issues, feature requests, or feedback on the new settings experience, please visit the [Claudian GitHub repository](https://github.com/Luis85/claudian) or open an issue describing your experience.
