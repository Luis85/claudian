# Claudian — Install Codex (Windows)

This manual walks Windows users through installing the **OpenAI Codex CLI**, the runtime Claudian drives when the Codex provider is enabled. Two flavours are supported: **Native Windows** (`codex.exe`) and **WSL** (Linux `codex` inside a WSL distro). Pick one method per machine and configure Claudian accordingly under **Settings → Claudian → Codex**.

See [[settings]] for the Codex tab layout, including the **Installation method** toggle and the optional WSL distro override.

---

## System requirements

| Requirement | Detail |
|-------------|--------|
| **OS** | Windows 10 / 11 (native) or Windows 10 / 11 with WSL 2 |
| **Shell** | PowerShell (native) or any Linux shell (WSL) |
| **Account** | ChatGPT Plus / Pro / Business / Edu / Enterprise, **or** an OpenAI API key |
| **Network** | Outbound HTTPS to `chatgpt.com` and `api.openai.com` |
| **Node.js** | Required only for the npm install path (Node 18+) |

WSL gives a Linux-native `codex` binary and sidesteps the occasional Windows path quirk. Native is simpler if your projects already live on Windows paths.

---

## Option A — Native Windows install

### Install methods

#### A1. PowerShell installer (recommended)

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
```

Drops `codex.exe` under `%USERPROFILE%\.codex\bin\` and adds it to user `PATH`. No admin rights required.

#### A2. npm

```powershell
npm install -g @openai/codex
```

The shim lands at `%USERPROFILE%\AppData\Roaming\npm\codex.cmd`. Requires Node 18+.

#### A3. Manual download

Grab the latest `codex-x86_64-pc-windows-msvc.zip` from [GitHub releases](https://github.com/openai/codex/releases/latest), unzip, and place `codex.exe` somewhere on your `PATH` (e.g. `%USERPROFILE%\.local\bin\`).

### Verify

```powershell
codex --version
```

A version string means success.

### Authenticate

```powershell
codex
```

The TUI launches with a sign-in prompt. Pick **Sign in with ChatGPT** for plan-backed access, or **API key** to paste an `OPENAI_API_KEY`. Credentials cache under `%USERPROFILE%\.codex\auth.json`.

### Point Claudian at the CLI

1. Run `(Get-Command codex).Source` in PowerShell.
2. Open **Settings → Claudian → Codex**.
3. Set **Installation method** to **Native Windows**.
4. Paste the path into **Codex CLI path** (or leave empty for auto-detect).

Typical native paths:

| Install method | Path |
|----------------|------|
| PowerShell installer | `C:\Users\<you>\.codex\bin\codex.exe` |
| npm | `C:\Users\<you>\AppData\Roaming\npm\codex.cmd` |
| Manual | wherever you unzipped it |

---

## Option B — WSL install

### Prerequisites

Install WSL 2 if not already present:

```powershell
wsl --install
```

Reboot, then launch your distro (Ubuntu by default). Run inside WSL:

```bash
sudo apt update && sudo apt install -y curl
```

### Install methods (run inside WSL)

#### B1. npm

```bash
sudo apt install -y nodejs npm
npm install -g @openai/codex
```

#### B2. Manual binary

Pull the Linux x86_64 release from [GitHub releases](https://github.com/openai/codex/releases/latest) and drop it on your `PATH`:

```bash
curl -fsSL -o /tmp/codex.tar.gz "https://github.com/openai/codex/releases/latest/download/codex-x86_64-unknown-linux-musl.tar.gz"
tar -xzf /tmp/codex.tar.gz -C ~/.local/bin
chmod +x ~/.local/bin/codex
```

### Verify (inside WSL)

```bash
codex --version
```

### Authenticate (inside WSL)

```bash
codex
```

Same sign-in flow as native. Credentials cache under `~/.codex/auth.json` inside the distro — separate from any native Windows install.

### Point Claudian at the CLI

1. Open **Settings → Claudian → Codex**.
2. Set **Installation method** to **WSL**.
3. **Codex CLI path** accepts either a bare command (`codex`) or a Linux absolute path (`/home/<you>/.local/bin/codex`). A Windows-style path like `C:\...` is rejected in WSL mode.
4. Optionally fill **WSL distro override** with the exact distro name (e.g. `Ubuntu-22.04`). Leave empty to infer from the workspace path or fall back to the WSL default distro. List distros with `wsl -l -v`.

---

## Updating

| Install method | Update command |
|----------------|----------------|
| PowerShell installer | Re-run the `irm` line — the installer replaces the binary in place. |
| npm | `npm install -g @openai/codex@latest` |
| Manual | Download the newer release and replace the file. |
| WSL npm | Same `npm install -g @openai/codex@latest` inside the distro. |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `codex` not recognized after install | Open a fresh terminal so `PATH` reloads. |
| Claudian rejects the CLI path | In WSL mode, paths must be Linux-style. In Native mode, paths must end in `.exe` or `.cmd`. |
| WSL distro picked is wrong | Set **WSL distro override** to the exact `wsl -l -v` name. |
| Auth loop | Delete `~/.codex/auth.json` (or `%USERPROFILE%\.codex\auth.json`) and re-run `codex`. |
| `EACCES` on npm global install | Do not use `sudo`. Fix the npm prefix with `npm config set prefix "$env:USERPROFILE\npm-global"` and re-add to `PATH`. |
| Reasoning trace looks wrong | The **Reasoning summary** dropdown in the Codex tab is forced to **Off** for the Spark model. For others, **Detailed** is the default. |

---

## Next steps

- Toggle **Enable Codex** under **Settings → Claudian → General → Providers**.
- Configure safety mode, custom models, skills, and subagents in the Codex tab — see [[settings]].
- Note that Codex MCP servers are managed via the `codex mcp` CLI, not in Claudian.
- Start a chat tab and pick a Codex model from the provider picker.
