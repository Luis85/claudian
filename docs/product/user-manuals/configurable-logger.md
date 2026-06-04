---
parent: Infrastructure
---
# Claudian — Configurable logger

This manual covers Claudian's **diagnostic logger**: a built-in, off-by-default capture of what the plugin is doing internally, so you can troubleshoot a problem or hand a maintainer a clean log when you file a bug report.

The logger is silent unless you turn it on. When it's on, Claudian writes leveled, scoped entries to the developer console **and** to a bounded in-memory ring buffer (the last 500 entries). The buffer is the bit you actually share — copy it to your clipboard with one click or one command.

---

## Before you start

The logger settings live in **Settings → Claudian → General → Diagnostics**.

| Setting | What it does | Default |
|---------|--------------|---------|
| **Enable logging** | Master switch. When off, the logger is a no-op — nothing reaches the console or the buffer. | Off |
| **Log level** | Minimum level captured. See [Log levels](#log-levels). | `Warn` |
| **Diagnostic log buffer** | Two buttons: **Copy logs** writes the buffer to the clipboard; **Clear logs** empties it. | — |

Changes apply live — no reload. Toggling the switch off mid-session immediately stops new entries; existing buffer contents remain until you clear them or restart Obsidian.

> The buffer lives in memory only. Closing Obsidian (or disabling the plugin) drops it. Copy logs **before** you restart if you want to keep them.

---

## Log levels

A single global threshold gates every log call. A message at level `L` is captured when logging is enabled **and** `L` is at or above the threshold.

| Level | Captures | Use when |
|-------|----------|----------|
| `Off` | Nothing. Equivalent to the master switch being off. | You want the threshold set to silent but prefer not to disable the toggle. |
| `Error` | Failures only — exceptions, rejected runtime calls, event-handler crashes. | You only care about hard failures. |
| `Warn` | Errors plus warnings (recoverable problems, e.g. a provider's model discovery failed but the plugin carried on). | Default; good baseline for catching the occasional problem without noise. |
| `Info` | Errors, warnings, and informational milestones. | You want a coarse trace of what the plugin is doing. |
| `Debug` | Everything, including verbose per-turn diagnostics (e.g. the Claude runtime's query start with session id and history flags). | You're reproducing a specific bug and need full detail. Expect lots of output. |

Levels rank `off (0) < error (1) < warn (2) < info (3) < debug (4)`. A `Debug` threshold lets every level through; `Error` only lets errors through.

---

## Reading logs

Two destinations, both fed from the same redacted stream.

### Developer console

When logging is on, every captured entry is also printed to Obsidian's developer console using the matching console method (`console.error`, `console.warn`, `console.info`, `console.debug`). Open it with **Ctrl+Shift+I** (Windows/Linux) or **Cmd+Option+I** (macOS) and switch to the **Console** tab.

Each line is prefixed with the scope in brackets:

```text
[claude.runtime] query start { orchestratorMode: false, hasHistory: true, sessionId: '…' }
[events] handler for "chat.message" threw  Error: …
[cursor.workspace] model discovery failed  Error: timed out
```

The scope tells you which part of Claudian emitted the entry — handy when filtering the console.

### In-memory ring buffer

The same entries are pushed into a fixed-size buffer (500 most recent). When the buffer is full, the oldest entry is evicted. This is what **Copy logs** exports.

Each exported line is a single record:

```text
2026-05-29T14:02:11.873Z  WARN  [cursor.workspace]  model discovery failed  [{"message":"timed out"}]
```

Fields, in order: ISO timestamp, level, `[scope]`, message, and (if any) a JSON-encoded args array.

> The plugin has **no on-disk log file**. Logs go to the console and the in-memory buffer only — that's by design, so secrets don't end up in vault files. Use **Copy logs** to share them.

---

## Gathering logs for a bug report

A short recipe that produces a clean, focused log you can paste into an issue.

1. Open **Settings → Claudian → General → Diagnostics**.
2. Click **Clear logs** (so the buffer only contains what's relevant).
3. Set **Log level** to **Debug** and make sure **Enable logging** is on.
4. Reproduce the problem once. Stay in the same Obsidian session.
5. Click **Copy logs** (or run **Copy diagnostic logs** from the command palette).
6. Paste the result into the issue.

What the logger guarantees before anything reaches the console or the buffer:

- **Redaction.** Object keys matching `token`, `key`, `secret`, `password`, `credential`, `api-key` / `api_key`, `authorization`, or `cookie` are replaced with `[redacted]`. The walk is deep and non-mutating — your real objects are never touched.
- **Body truncation.** Long string bodies are capped at 500 characters and annotated with `…[+N]` so the buffer stays bounded.
- **Prompt and transcript content** is gated to the `Debug` level — anything more verbose than a milestone won't appear at lower thresholds.

Still, skim the export before you paste it into a public issue. Redaction is heuristic; an unrecognized field name will not be masked.

When you're done, set the level back to **Warn** (or **Off**) so debug output stops piling into the buffer.

---

## Typical flow

1. Day to day: leave logging **off**. The plugin is a no-op for diagnostics — no cost, no captured entries.
2. Hit a problem worth investigating: open **Settings → Claudian → General → Diagnostics**, turn **Enable logging** on, pick a level (start at **Warn**; go to **Debug** if you need detail), and reproduce.
3. Watch the developer console for live output, or click **Copy logs** to capture the buffer.
4. When you're done, click **Clear logs** and turn **Enable logging** back off.

---

## Command reference

| Command | What it does |
|---------|--------------|
| **Copy diagnostic logs** | Formats the in-memory buffer and writes it to the clipboard. Shows a notice with the entry count (or "No diagnostic log entries" if the buffer is empty). Equivalent to the **Copy logs** button. |
| **Clear diagnostic logs** | Empties the in-memory buffer. Shows a notice on completion. Equivalent to the **Clear logs** button. |

There are no commands to toggle logging or change the level — those live in [[#Before you start|the Diagnostics settings section]].
