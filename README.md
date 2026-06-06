# Claudian

![GitHub stars](https://img.shields.io/github/stars/Luis85/claudian?style=social)
![GitHub release](https://img.shields.io/github/v/release/Luis85/claudian)
![License](https://img.shields.io/github/license/Luis85/claudian)

![Preview](Preview.png)

An Obsidian plugin that embeds AI coding agents (Claude Code, Codex, Opencode, Cursor Agent and more to come) in your vault. Your vault becomes the agent's working directory — file read/write, search, bash, and multi-step workflows all work out of the box.

## Features & Usage

Open the chat sidebar from the ribbon icon or command palette. Select text and use the hotkey for inline edit. Everything works like your familiar coding agent — Claude Code, Codex, Opencode, or Cursor Agent — talk to the agent, and it reads, writes, edits, and searches files in your vault.

**Inline Edit** — Select text or start at the cursor position + hotkey to edit directly in notes with word-level diff preview.

**Slash Commands & Skills** — Type `/` or `$` for reusable prompt templates or Skills from user- and vault-level scopes.

**`@mention`** - Type `@` to mention anything you want the agent to work with, vault files, subagents, MCP servers, or files in external directories.

**Plan Mode** — Toggle via `Shift+Tab`. The agent explores and designs before implementing, then presents a plan for approval.

**Instruction Mode (`#`)** — Refined custom instructions added from the chat input.

**MCP Servers** — Connect external tools via Model Context Protocol (stdio, SSE, HTTP). Claude manages vault MCP in-app; Opencode uses Opencode-managed MCP; Codex and Cursor use their own CLI-managed MCP configuration.

**Multi-Tab & Conversations** — Multiple chat tabs, conversation history, fork, resume, and compact.

## Requirements

- **Claude provider**: [Claude Code CLI](https://code.claude.com/docs/en/overview) installed (native install recommended). Claude subscription/API or compatible provider ([Openrouter](https://openrouter.ai/docs/guides/guides/claude-code-integration), [Kimi](https://platform.moonshot.ai/docs/guide/agent-support), etc.).
- **Optional providers**: [Codex CLI](https://github.com/openai/codex), [Opencode](https://opencode.ai/), [Cursor Agent CLI](https://docs.cursor.com/en/cli/overview).
- Obsidian v1.7.2+
- Desktop only (macOS, Linux, Windows)

## Installation

### From Obsidian Community Plugins (recommended)

1. Open Obsidian → Settings → Community plugins → Browse
2. Search for "Claudian" and click Install
3. Enable the plugin

Or install directly from the [community plugin page](https://community.obsidian.md/plugins/realclaudian).

### From GitHub Release

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Luis85/claudian/releases/latest)
2. Create a folder called `claudian` in your vault's plugins folder:
   ```
   /path/to/vault/.obsidian/plugins/claudian/
   ```
3. Copy the downloaded files into the `claudian` folder
4. Enable the plugin in Obsidian:
   - Settings → Community plugins → Enable "Claudian"

### From source (development)

1. Clone this repository into your vault's plugins folder:
   ```bash
   cd /path/to/vault/.obsidian/plugins
   git clone https://github.com/Luis85/claudian.git
   cd claudian
   ```

2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

3. Enable the plugin in Obsidian:
   - Settings → Community plugins → Enable "Claudian"

### Development

```bash
# Watch mode
npm run dev

# Production build
npm run build

# Build and copy into vault/.obsidian/plugins/<manifest id> for manual testing
npm run test-build
```

## Privacy & Data Use

- **Sent to API**: Your input, attached files, images, and tool call outputs. Default: Anthropic (Claude) or OpenAI (Codex); configurable via provider settings and environment variables.
- **Local storage**: Claudian settings and session metadata in `vault/.claudian/`; Claude provider files in `vault/.claude/`; transcripts in `~/.claude/projects/` (Claude) and `~/.codex/sessions/` (Codex).
- **Environment variables**: Provider subprocesses inherit the Obsidian process environment plus any variables you configure in Claudian. This is needed for CLI authentication, proxies, certificates, and PATH resolution.
- **Secrets (API keys / tokens)**: Provider API keys and tokens are stored in Obsidian's keychain-backed **SecretStorage** (OS keychain, outside the vault), not in plaintext settings. The vault's `.claudian/claudian-settings.json` holds only a reference (the secret's name), never the value. Secret-shaped variables already typed into the environment fields are migrated into SecretStorage automatically. Requires Obsidian **1.11.5+** (where SecretStorage is encrypted at rest). Note the honest threat model: this keeps secrets out of synced/committed vault files and out of other OS users' reach (with a real keyring), but it does **not** isolate them from other Obsidian plugins or from processes running as you. Secrets are **device-local** — opening a synced vault on a new machine prompts you to re-enter them.
- **Device-specific paths**: Per-device CLI paths use an opaque local key stored in browser local storage, not your system hostname.
- **Background activity**: Claudian does not run telemetry beacons. UI polling timers read local Obsidian/editor selection state only. Network activity is limited to explicit provider runtime work, configured MCP endpoints, and provider SDK/CLI calls needed to answer your requests.

## Troubleshooting

### Claude CLI not found

If you encounter `spawn claude ENOENT` or `Claude CLI not found`, the plugin can't auto-detect your Claude installation. Common with Node version managers (nvm, fnm, volta).

**Solution**: Leave the setting empty first so Claudian can auto-detect Claude Code. If auto-detection fails, find your CLI path and set it in Settings → Advanced → Claude CLI path.

| Platform | Command | Example Path |
|----------|---------|--------------|
| macOS/Linux | `which claude` | `/Users/you/.volta/bin/claude` |
| Windows (native) | `where.exe claude` | `C:\Users\you\AppData\Local\Claude\claude.exe` |
| Windows (npm) | `npm root -g` | `{root}\@anthropic-ai\claude-code\cli-wrapper.cjs` |

> **Note**: On Windows, avoid `.cmd` and `.ps1` wrappers. Use `claude.exe` for native installs, or `cli-wrapper.cjs` for package-manager installs. `cli.js` is only a legacy fallback for older Claude Code npm packages.

**Alternative**: Add your Node.js bin directory to PATH in Settings → Environment → Custom variables.

### npm CLI and Node.js not in same directory

If using npm-installed CLI, check if `claude` and `node` are in the same directory:
```bash
dirname $(which claude)
dirname $(which node)
```

If different, GUI apps like Obsidian may not find Node.js.

**Solutions**:
1. Install native binary (recommended)
2. Add Node.js path to Settings → Environment: `PATH=/path/to/node/bin`

### Other providers

Codex, Opencode, and Cursor support are live but features might be incomplete, and still need more testing across platforms and installation methods. If you have feature request or run into any bugs, please [submit a GitHub issue](https://github.com/Luis85/claudian/issues).

## Architecture

```
src/
├── main.ts                      # Plugin entry point
├── app/                         # Shared defaults and plugin-level storage
├── core/                        # Provider-neutral runtime, registry, and type contracts
│   ├── runtime/                 # ChatRuntime interface and approval types
│   ├── providers/               # Provider registry and workspace services
│   ├── auxiliary/               # Shared provider auxiliary services
│   ├── bootstrap/               # Plugin bootstrap wiring
│   ├── security/                # Approval utilities
│   └── ...                      # commands, mcp, prompt, storage, tools, types
├── providers/
│   ├── claude/                  # Claude SDK adaptor, prompt encoding, storage, MCP, plugins
│   ├── codex/                   # Codex app-server adaptor, JSON-RPC transport, JSONL history
│   ├── opencode/                # Opencode adaptor over ACP
│   ├── cursor/                  # Cursor Agent adaptor over the cursor-agent stream-json CLI (not ACP), JSONL history hydration
│   └── acp/                     # Agent Client Protocol shared transport
├── features/
│   ├── chat/                    # Sidebar chat: tabs, controllers, renderers
│   ├── inline-edit/             # Inline edit modal and provider-backed edit services
│   ├── tasks/                   # Agent Board work orders and run coordination
│   ├── quickActions/            # Vault-defined quick actions
│   └── settings/                # Settings shell with provider tabs
├── shared/                      # Reusable UI components and modals
├── i18n/                        # Internationalization (10 locales)
├── types/                       # Shared ambient types
├── utils/                       # Cross-cutting utilities
└── style/                       # Modular CSS
```

## Roadmap

- [x] 1M Opus and Sonnet models
- [x] Codex provider integration
- [x] Opencode support
- [x] Cursor Agent support
- [ ] More to come!

## License

Licensed under the [MIT License](LICENSE).

## Star History

<a href="https://www.star-history.com/?repos=Luis85%2Fclaudian&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Luis85/claudian&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Luis85/claudian&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Luis85/claudian&type=date&legend=top-left" />
 </picture>
</a>

## Acknowledgments

- [Obsidian](https://obsidian.md) for the plugin API
- [Anthropic](https://anthropic.com) for Claude and the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview)
- [OpenAI](https://openai.com) for [Codex](https://github.com/openai/codex)
- [Opencode](https://opencode.ai/)
- [Cursor](https://cursor.com/) for the [Cursor Agent CLI](https://docs.cursor.com/en/cli/overview)

