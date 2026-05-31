# Claudian — Install Cursor (Windows)

This manual walks Windows users through installing the **Cursor Agent CLI** (`cursor-agent` / `agent`), the runtime Claudian drives when the Cursor provider is enabled. Claudian talks to it over ACP (Agent Client Protocol); you only need the CLI on `PATH` (or pointed at explicitly).

See [[settings]] for the Cursor tab layout, and [[cursor-model-families-and-modes]] for how Cursor model families and modes show up in chat.

---

## System requirements

| Requirement | Detail |
|-------------|--------|
| **OS** | Windows 10 / 11 |
| **Shell** | PowerShell (native install) or a Linux shell (WSL install) |
| **Cursor account** | Required. Free tier works to start. |
| **Network** | Outbound HTTPS to `cursor.com` and `api.cursor.com` |
| **Cursor desktop app** | Optional. The CLI is independent of the desktop editor. |

---

## Install methods

### Option 1 — Native Windows (recommended)

In PowerShell:

```powershell
irm 'https://cursor.com/install?win32=true' | iex
```

The installer drops `cursor-agent.exe` (and an `agent.exe` shim) under `%USERPROFILE%\.cursor\bin\` and adds the directory to user `PATH`. No admin rights required.

### Option 2 — WSL

Inside your WSL distro:

```bash
curl https://cursor.com/install -fsS | bash
```

The Linux binary lands under `~/.cursor/bin/`. Claudian on Windows currently launches the native CLI directly; if you only have the WSL build, you need a `wsl.exe`-based wrapper to drive it from Claudian.

### Option 3 — Manual

Pull the Windows release from [Cursor's CLI downloads](https://cursor.com/cli) and place `agent.exe` somewhere on your `PATH` (e.g. `%USERPROFILE%\.local\bin\`).

---

## Verify the install

Open a fresh terminal so `PATH` reloads, then run:

```powershell
agent --version
```

A version string means success.

> The CLI ships two entry points — `cursor-agent` and `agent`. Both invoke the same binary. Claudian's auto-detect looks for `agent` first on Windows.

---

## Authenticate

```powershell
cursor-agent login
```

A browser tab opens for Cursor sign-in. Complete the OAuth flow and return to the terminal — the credentials cache under `%USERPROFILE%\.cursor\cli-config.json`.

To skip the browser flow, set `CURSOR_API_KEY` in **Settings → Claudian → Cursor → Cursor Agent environment** instead. Changing `CURSOR_API_KEY` or `CURSOR_BASE_URL` resets the active Cursor session so the next turn re-authenticates cleanly.

---

## Find the CLI path for Claudian

```powershell
(Get-Command agent).Source
```

Typical results:

| Install method | Path |
|----------------|------|
| Native installer | `C:\Users\<you>\.cursor\bin\agent.exe` |
| Manual | wherever you placed the binary |

Paste it into **Settings → Claudian → Cursor → Cursor Agent CLI path** (it is keyed per host — the field label includes your machine name). Leave empty to let Claudian auto-detect from `PATH`. The path is validated on input.

---

## Load model families

Cursor's catalog is account-scoped. After install + login:

1. Open **Settings → Claudian → Cursor**.
2. Click **Refresh models**. Claudian runs `agent --list-models` against the configured CLI.
3. A success notice reports how many families and variants were discovered.

If the notice says zero models came back, you are most likely not signed in to the CLI — run `cursor-agent login` and refresh again. The shared `cli-config.json` is serialized across processes on Windows so concurrent spawns do not corrupt it.

Once the catalog is loaded, tick the families you want surfaced in the chat picker under **Visible models**. The picker groups by family and supports search / **Select all** / **Select none**. `auto` is always available and excluded from the list.

---

## Updating

The native installer auto-updates on launch. To force a refresh, re-run the `irm` install line — it replaces the binary in place. After update, run `agent --version` to confirm.

WSL installs update by re-running the `curl ... | bash` line inside the distro.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `agent` not recognized after install | Open a new terminal — `PATH` reload is per-shell. |
| **Refresh models** returns 0 | Run `cursor-agent login` in a terminal, then refresh again. |
| Login browser tab loops | Delete `%USERPROFILE%\.cursor\cli-config.json` and re-run `cursor-agent login`. |
| `EACCES` writing `cli-config.json` | Antivirus or another Cursor process holds the file. Close other Cursor instances and retry. |
| Picker shows only **Auto** | No family is enabled. Tick at least one under **Cursor → Visible models**. |
| Effort gear missing on a family | That family only has one mode. The shared composer hides the gear when there is nothing to pick — see [[cursor-model-families-and-modes]]. |
| Model errors mid-turn | Stored `lastModel` may no longer be enabled. Claudian falls back to **Auto** automatically; re-pick a family for new chats. |

---

## Gated capabilities

Cursor in Claudian is narrower than Claude. The composer hides controls the Cursor runtime does not back:

- **Rewind** — not supported (`cursor-agent` reports `rewind: false`).
- **Fork** — not supported on Cursor conversations.
- **Provider slash commands** — Cursor does not expose runtime-discovered `/` commands. Claudian-defined `/` commands still work.
- **In-app MCP management** — Claudian does not edit Cursor's MCP config. Use Cursor's own tooling.
- **Subagents** — Cursor does not expose a `Task`-style subagent tool. Orchestrator workers still spawn as chat tabs, but they cannot fan out further.

Plan mode, the YOLO/Safe permission toggle, image attachments, the `#` instruction mode, and session resume from `~/.cursor/chats/<workspace>/<session>/` all work.

---

## Next steps

- Toggle **Enable Cursor** under **Settings → Claudian → General → Providers**.
- Refresh and curate visible families in the Cursor tab — see [[settings]].
- Read [[cursor-model-families-and-modes]] to understand how families and modes recombine into the raw `--model` id the CLI wants.
- Start a chat tab and pick a Cursor family from the provider picker.
