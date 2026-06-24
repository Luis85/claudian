---
date: 2026-06-04
status: shipped
type: user-manual
parent: "[[Multi Provider Support]]"
---
# Specorator — Cursor model families & modes

This manual covers how the Cursor provider exposes **model families** and **modes** in Specorator — what they mean, where to pick them, and how your choices persist.

Cursor's CLI (`cursor-agent`) encodes a model's reasoning/effort behaviour as a suffix on the model id (for example `sonnet-4` and `sonnet-4-thinking` are two ids that refer to the same underlying Anthropic Sonnet model in different modes). Specorator collapses these into a cleaner two-level picker:

- A **family** is one entry per underlying model (e.g. _Claude Sonnet 4_, _GPT-5_, _Composer 2_).
- A **mode** is the suffix that controls how that family runs (e.g. _Standard_, _Thinking_, _Fast_, _Low_, _Medium_, _High_, _XHigh_, _Extra High_, _Max_).

You pick a family in the chat model picker and (when the family has more than one mode) a mode in the composer's **Effort** gear next to it. Behind the scenes Specorator recombines them back into the raw `--model` id the CLI wants.

---

## Before you start

Open **Settings → Specorator → Cursor**. You need two things in place before the family list will populate:

| Setting | What it does | Default |
|---------|--------------|---------|
| **Cursor Agent CLI path** | Path to the `agent` binary (per host). Leave empty to search PATH. | empty |
| **Cursor Agent environment** | Variables such as `CURSOR_API_KEY` and (optionally) `CURSOR_MODEL`. | empty |

The Cursor CLI also has to be **signed in**. If `cursor-agent --list-models` returns nothing because you are not logged in, the **Refresh models** action surfaces a notice telling you to run `cursor-agent login`.

See also [[agent-board-chat-interop-and-capture]] for Agent Board provider/model defaults, which are separate from the per-conversation pick described here.

---

## Choosing a model

Cursor families live in the standard chat **model picker** (the model dropdown in the composer toolbar, same slot Claude and Codex use).

What you see in the picker:

- **Auto** — always pinned first, ungrouped. No mode dropdown applies.
- One row **per family**, grouped by vendor in this order: **Cursor**, **Anthropic**, **OpenAI**, **Google**, **xAI**, **Other**.
- Each row's description shows the vendor and, when the family has more than one mode, the mode count (e.g. `Anthropic · 3 modes`).
- A family pulled in from a `CURSOR_MODEL` environment override that you did not curate is labelled `Custom (env)`.

Only families you have enabled in **Settings → Specorator → Cursor → Visible models** show up here. Use the settings tab's search, **Select all**, and **Select none** to manage the list; the counter reads `N of M families selected`.

Picking a family in the chat picker is **per-conversation**. The selection is stored against the active conversation and survives reloads. Specorator also remembers it as your `lastModel` so new conversations start with the same family pre-selected.

---

## Choosing a mode

When the picked family has more than one mode, the composer's **Effort** gear renders next to the model picker, identical to the control Claude and Codex use. It is the same shared widget, just populated from the Cursor family's variants.

- The gear shows the current mode label (e.g. _Standard_, _Thinking_, _High_).
- Hover or tap to expose every mode the family supports.
- Modes are ordered so the common path is on top: non-thinking variants first (by effort: _Standard_, _None_, _Low_, _Medium_, _High_, _XHigh_, _Extra High_, _Max_), then the thinking counterparts in the same order, with _Fast_ variants pushed down.
- If a family has only one runnable mode, the **Effort** gear is hidden — there is nothing to choose.
- For **Auto**, the Effort gear is hidden too.

Mode meaning at a user level:

| Mode | What it means |
|------|---------------|
| **Standard** | The bare family with no suffix — the default mode. |
| **Low / Medium / High / XHigh / Extra High** | Increasing reasoning effort. Higher = more deliberate, slower, more costly. |
| **Max** | The family's maximum-capability mode (when offered). |
| **Thinking** | The thinking-tier variant of the family. |
| **Fast** | The fast variant of the family — lower latency, less deliberation. |

Cursor decides which combinations exist for each family; Specorator only surfaces what the CLI reports. The `Standard` row appears only when the bare family id itself was discovered, so the picker never offers a `--model` value the CLI would reject.

---

## Defaults & persistence

Where the choices live:

- **Per-conversation model and mode** — stored on the conversation projection as `model` (a `cursor:<familyId>` value) and `effortLevel` (the mode token). These survive reloads.
- **Per-family preferred mode** — stored in `Settings → Cursor → preferredModeByFamily` as a map from family id to mode. When you re-pick a family later, Specorator restores your last mode for that family.
- **Enabled families** — stored per host in `enabledModelsByHost`. Enabling a family in settings writes its bare id and every variant id Specorator knows about; disabling removes them.
- **Last family** — stored as `lastModel` and used as the starting selection for new conversations.

Two reconciliation behaviours worth knowing:

1. **Legacy migration**: a persisted `cursor:sonnet-4-thinking` from older builds is automatically collapsed to family `cursor:sonnet-4` with `effortLevel: thinking`, and seeded into `preferredModeByFamily[sonnet-4]`.
2. **Env override**: setting `CURSOR_MODEL=sonnet-4-thinking` is split the same way — Specorator stores the family value and seeds the mode preference. Changing `CURSOR_API_KEY` or `CURSOR_BASE_URL` resets the active Cursor session so the next turn re-authenticates cleanly.

If a stored selection no longer matches an enabled family (for example you disabled it in settings), Specorator falls back to the first option in the picker — usually **Auto**.

---

## Gated capabilities

Cursor in Specorator is intentionally narrower than Claude. The shared composer hides controls that Cursor's runtime does not back, so you will not see them on a Cursor chat:

- **Rewind** — not supported (`cursor-agent` reports `"rewind": false`).
- **Fork** — not supported on Cursor conversations.
- **Provider slash commands** — Cursor does not expose runtime-discovered `/` commands. Specorator-defined `/` commands still work; provider-native ones do not.
- **In-app MCP management** — Specorator does not edit Cursor's MCP config. Use Cursor's own tooling.

Plan mode, the YOLO/Safe permission toggle, image attachments, the `#` instruction mode, and session resume from `~/.cursor/chats/` all do work for Cursor.

---

## Typical flow

1. In **Settings → Specorator → Cursor**, set the **Cursor Agent CLI path** and any environment variables, then click **Refresh models**. If nothing comes back, run `cursor-agent login` in your terminal and try again.
2. In **Visible models**, tick the families you want in the chat picker (e.g. _Composer 2_, _Claude Sonnet 4_, _GPT-5_).
3. Open a chat tab, switch the provider to Cursor, and pick a family from the model dropdown.
4. If the family shows an **Effort** gear, choose a mode (e.g. _Thinking_ for deeper reasoning, _Fast_ for snappier turns).
5. Send your message. Specorator recombines your family + mode into the raw `--model` id and spawns `cursor-agent` for you.
6. Next time you pick that family, your last mode for it comes back automatically.
