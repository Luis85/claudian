---
date: 2026-06-04
status: shipped
type: user-install-guide
parent: "[[Multi Provider Support]]"
---
# Specorator — Install Claude (Windows)

This manual walks Windows users through installing the **Claude Code CLI**, the runtime Specorator drives when the Claude provider is enabled. Mac and Linux are not covered here.

Specorator does not bundle Claude Code. The CLI must already exist on your machine before the Claude provider can spawn a session. Once installed, point Specorator at it under **Settings → Specorator → Claude → Claude CLI path** (or leave empty to auto-detect from `PATH`). See [[settings]] for the Claude tab layout.

---

## System requirements

| Requirement | Detail |
|-------------|--------|
| **OS** | Windows 10 1809+ or Windows Server 2019+ |
| **RAM** | 4 GB+ |
| **CPU** | x64 or ARM64 |
| **Shell** | PowerShell or CMD (both supported by the installer) |
| **Network** | Outbound HTTPS to `claude.ai` and `downloads.claude.ai` |
| **Account** | Claude Pro, Max, Team, Enterprise, or Console. The free Claude.ai plan does **not** grant CLI access. |

[Git for Windows](https://git-scm.com/downloads/win) is optional. With it, Claude Code uses Git Bash for its `Bash` tool. Without it, Claude Code falls back to PowerShell.

---

## Install methods

Pick one. Native installer is recommended — it auto-updates in the background.

### Option 1 — Native installer (recommended)

**PowerShell** (prompt shows `PS C:\`):

```powershell
irm https://claude.ai/install.ps1 | iex
```

**CMD** (prompt shows `C:\` without `PS`):

```batch
curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd
```

If PowerShell errors with `'irm' is not recognized`, you are in CMD — use the CMD line. If CMD errors with `The token '&&' is not a valid statement separator`, you are in PowerShell — use the PowerShell line.

The installer drops `claude.exe` under `%USERPROFILE%\.local\bin\` and adds that directory to your user `PATH`. No admin rights required.

### Option 2 — WinGet

```powershell
winget install Anthropic.ClaudeCode
```

WinGet does **not** auto-update. Run `winget upgrade Anthropic.ClaudeCode` periodically.

### Option 3 — npm (requires Node.js 18+)

```powershell
npm install -g @anthropic-ai/claude-code
```

Do **not** use `sudo` / elevated shells for global npm installs. Permission rebuilds are messy. To upgrade later, run `npm install -g @anthropic-ai/claude-code@latest` — not `npm update -g`.

### Option 4 — WSL

Open your WSL distro and run the Linux installer:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

In WSL mode, `claude` lives inside the Linux filesystem. Launch it from the WSL shell, not from PowerShell. Sandboxing works only on WSL 2.

---

## Verify the install

Open a fresh terminal (so the new `PATH` is picked up) and run:

```powershell
claude --version
```

A version string (e.g. `2.1.89`) means success. For a deeper check:

```powershell
claude doctor
```

`claude doctor` lists install location, update channel, missing dependencies, and known fixes.

---

## Authenticate

Run:

```powershell
claude
```

A browser tab opens for Anthropic sign-in. Complete the login and return to the terminal — the session continues automatically. The token is cached under `%USERPROFILE%\.claude\`.

For Bedrock, Vertex, or Foundry auth, see Anthropic's [Authentication docs](https://code.claude.com/docs/en/authentication).

---

## Find the CLI path for Specorator

Specorator needs the path to register Claude as a provider. After install, find the absolute path:

```powershell
(Get-Command claude).Source
```

Typical results:

| Install method | Path |
|----------------|------|
| Native installer | `C:\Users\<you>\.local\bin\claude.exe` |
| WinGet | `C:\Users\<you>\AppData\Local\Microsoft\WinGet\Links\claude.exe` |
| npm global | `C:\Users\<you>\AppData\Roaming\npm\claude.cmd` (with `cli-wrapper.cjs` sibling) |
| WSL | inside the distro at `~/.local/bin/claude` — Specorator does not currently launch WSL Claude |

Paste the result into **Settings → Specorator → Claude → Claude CLI path**, or leave empty to let Specorator auto-detect from `PATH`.

> On npm installs, prefer the `cli-wrapper.cjs` file next to `claude.cmd` if Specorator's auto-detect picks the wrapper. It avoids a CMD launch hop and survives `npm` updates better. See [[settings]].

---

## Updating

| Install method | Update command |
|----------------|----------------|
| Native installer | Auto-updates on startup. Force with `claude update`. |
| WinGet | `winget upgrade Anthropic.ClaudeCode` |
| npm | `npm install -g @anthropic-ai/claude-code@latest` |
| WSL | Re-run the Linux installer inside the distro |

To pin a channel, set `autoUpdatesChannel` to `"stable"` or `"latest"` in `~/.claude/settings.json`. To halt background updates, set the env var `DISABLE_AUTOUPDATER=1`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `claude` not recognized after install | Open a new terminal — `PATH` reload is per-shell. |
| Specorator says CLI not found | Run `(Get-Command claude).Source` and paste the path into the Claude tab. |
| Auth loop in browser | Delete `%USERPROFILE%\.claude.json` and re-run `claude`. |
| `Bash` tool errors with `bash not found` | Install [Git for Windows](https://git-scm.com/downloads/win), or set `CLAUDE_CODE_GIT_BASH_PATH` in `~/.claude/settings.json`. |
| Search results empty | Native install ships ripgrep. On bespoke setups, set `USE_BUILTIN_RIPGREP=0` and install ripgrep system-wide. |

For deeper troubleshooting, run `claude doctor` and consult Anthropic's [troubleshoot install](https://code.claude.com/docs/en/troubleshoot-install) page.

---

## Next steps

- Open **Settings → Specorator → General → Providers** and toggle **Enable Claude**.
- Open the Claude tab and confirm the CLI path is detected. Set safety mode, custom models, MCP servers, and plugins as needed — see [[settings]].
- Start a chat tab and pick a Claude model from the provider picker.
