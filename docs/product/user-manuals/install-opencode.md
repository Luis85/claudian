# Claudian — Install Opencode (Windows)

This manual walks Windows users through installing the **Opencode CLI**, the runtime Claudian drives when the Opencode provider is enabled. Claudian launches Opencode via `opencode acp`, so any working `opencode` install on `PATH` (or pointed at explicitly) is enough.

Opencode's upstream docs recommend WSL for the smoothest experience, but native Windows installs work for most flows. Pick one method below.

See [[settings]] for the Opencode tab layout, and [[cursor-model-families-and-modes]] for how multi-model providers expose families and modes in chat (Opencode uses the same shared picker contract).

---

## System requirements

| Requirement | Detail |
|-------------|--------|
| **OS** | Windows 10 / 11. WSL 2 recommended by Opencode upstream. |
| **Shell** | PowerShell, CMD, or a Linux shell inside WSL |
| **Node.js** | Required for the npm install path (Node 18+) |
| **Network** | Outbound HTTPS to `opencode.ai`, model provider APIs, and (optionally) GitHub for binary downloads |
| **Account** | An Opencode account at `opencode.ai/auth` or your own provider API keys |

---

## Install methods

### Option 1 — npm (cross-platform, simplest)

```powershell
npm install -g opencode-ai
```

The shim lands at `%USERPROFILE%\AppData\Roaming\npm\opencode.cmd`. Requires Node 18+.

### Option 2 — Scoop

```powershell
scoop install opencode
```

Scoop handles `PATH` and upgrades cleanly. Install Scoop first from [scoop.sh](https://scoop.sh) if you do not have it.

### Option 3 — Chocolatey

```powershell
choco install opencode
```

Requires an elevated PowerShell. Upgrade with `choco upgrade opencode`.

### Option 4 — Manual binary

Download the Windows release from [Opencode releases on GitHub](https://github.com/sst/opencode/releases/latest), unzip, and place `opencode.exe` somewhere on your `PATH` (e.g. `%USERPROFILE%\.local\bin\`).

### Option 5 — WSL (Opencode-recommended)

Inside your WSL distro:

```bash
curl -fsSL https://opencode.ai/install | bash
```

The script drops the Linux binary under `~/.opencode/bin/` and patches your shell init. Claudian on Windows currently launches the native binary directly; to drive a WSL-installed Opencode from Claudian, point the CLI path at a `wsl.exe` wrapper script or install natively as well.

---

## Verify the install

Open a fresh terminal and run:

```powershell
opencode --version
```

A version string means success. If `opencode` is not recognized, close and reopen the terminal so `PATH` reloads, then try again.

---

## Authenticate

Launch the TUI from a project directory:

```powershell
opencode
```

Inside the TUI:

1. Run `/connect`.
2. Pick the **opencode** provider.
3. Visit `opencode.ai/auth` in a browser, sign in, add billing, copy the API key.
4. Paste the key back into the TUI when prompted.

To use your own model provider keys instead (Anthropic, OpenAI, etc.), set the relevant env vars (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) in **Settings → Claudian → Opencode → Environment Variables**. Opencode reads them from the spawned process environment.

---

## Find the CLI path for Claudian

```powershell
(Get-Command opencode).Source
```

Typical results:

| Install method | Path |
|----------------|------|
| npm | `C:\Users\<you>\AppData\Roaming\npm\opencode.cmd` |
| Scoop | `C:\Users\<you>\scoop\shims\opencode.exe` |
| Chocolatey | `C:\ProgramData\chocolatey\bin\opencode.exe` |
| Manual | wherever you unzipped it |

Paste it into **Settings → Claudian → Opencode → CLI path** (or leave empty for auto-detect). Changing the path recycles every open Opencode chat tab.

---

## Discover models

After Claudian connects to Opencode, open the Opencode tab and expand **Browse models**. Opencode reports the full catalog it knows about (Anthropic, OpenAI, Google, xAI, etc., conditional on which provider keys are present). Tick the families you want surfaced in the chat picker.

If the catalog comes back empty, the Opencode tab shows a notice. Most common causes:

- Opencode is not signed in — re-run the `/connect` flow above.
- The required provider API key env var is missing — set it under **Opencode → Environment Variables**.
- The Opencode CLI is offline or the wrong binary — re-check the CLI path.

---

## Vault assets

Opencode auto-detects vault Claude slash commands and skills from `.claude/commands/`, `.claude/skills/`, `.codex/skills/`, and `.agents/skills/`. Manage those in the Claude or Codex tabs — the Opencode tab only offers a **Hidden Commands and Skills** filter for muting noisy entries.

Subagents live under `.opencode/agent/` (legacy: `.opencode/agents/`). The Opencode tab exposes a CRUD editor for them.

---

## Updating

| Install method | Update command |
|----------------|----------------|
| npm | `npm install -g opencode-ai@latest` |
| Scoop | `scoop update opencode` |
| Chocolatey | `choco upgrade opencode` |
| Manual | Redownload the release and replace the file. |
| WSL | Re-run `curl -fsSL https://opencode.ai/install \| bash` inside the distro |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `opencode` not recognized | Open a new terminal so `PATH` reloads. Confirm with `(Get-Command opencode).Source`. |
| Claudian shows no Opencode models | Sign in via `opencode` → `/connect`, or set provider API keys in the Opencode environment scope. |
| Models picker stuck on **Browse models** loading | The CLI is unreachable. Re-check the CLI path and try `opencode --version` in a terminal. |
| MCP servers missing | Opencode manages its own MCP. Configure them in Opencode's own config — Claudian does not edit them. |
| Subagents not appearing | The editor only renders when a vault workspace is detected. Make sure the vault folder is also a project root from Opencode's perspective. |
| `OPENCODE_ENABLE_EXA=1` should be off | Remove that line from **Opencode → Environment Variables**. |

---

## Next steps

- Toggle **Enable Opencode** under **Settings → Claudian → General → Providers**.
- Pick visible models in the Opencode tab — see [[settings]].
- Plan mode and rewind are gated for Opencode. Image attachments, `#` instruction mode, subagents, and history reload are supported.
- Start a chat tab and pick an Opencode model from the provider picker.
