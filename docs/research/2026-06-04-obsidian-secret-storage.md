---
title: Obsidian SecretStorage / SecretComponent — research findings for SEC-A
date: 2026-06-04
status: complete
scope: Obsidian Secrets feature (app.secretStorage, SecretComponent) for SEC-A
method: 5 parallel web-research passes (API surface, storage/sync, cross-device, UI/migration, security) cross-checked against the official obsidian.d.ts, docs.obsidian.md, the 1.11.4/1.11.5 changelogs, and ~15 adopting plugins
related:
  - "[[docs/superpowers/plans/2026-06-03-secretstorage-secrets.md]]"
---

# Obsidian Secrets (SecretStorage) — findings that shape SEC-A

Confidence tags: **H** = official/authoritative (obsidian.d.ts, docs, changelog), **M** = reputable
community/staff-on-forum or cross-plugin corroboration, **L/?** = inference or undocumented.

## 1. Version & encryption boundary — the decisive finding

- The `SecretStorage`/`SecretComponent` **API landed in 1.11.4** (Early Access, 2026-01-07). All
  `@since 1.11.4` in `obsidian.d.ts`. **(H)**
- **In 1.11.4 secrets were stored as plaintext in localStorage/LevelDB** (keyed `{vaultId}-secrets`); a
  community PoC extracted them. An Obsidian dev (Licat) committed to migrate to Electron `safeStorage`. **(M-H)**
- **1.11.5 (2026-01-20) made Secret Storage encrypted at rest** via OS-provided encryption: *"Secret
  Storage is now encrypted while on disk. This relies on encryption provided by your operating system."*
  Linux needs `kwallet`/`kwallet5`/`kwallet6` or `gnome-libsecret`. **(H)**

➡️ **Decision impact: `minAppVersion` must be `1.11.5`, not `1.11.4`.** Requiring 1.11.4 would ship the
plaintext-localStorage behavior and defeat SEC-A. (Corrects the earlier 1.11.4 bump.)

## 2. API surface (authoritative, from obsidian.d.ts)

- `app.secretStorage: SecretStorage` where `class SecretStorage extends Events`. **(H)**
- **Synchronous**, three methods only: `setSecret(id, secret): void`, `getSecret(id): string | null`,
  `listSecrets(): string[]`. **No `removeSecret`/`deleteSecret`.** Clear by `setSecret(id, "")` (observed
  in `edonyzpc/personal-assistant`). **(H / clear-pattern M)**
- `id` must be **"lowercase alphanumeric ID with optional dashes"** and **throws** if invalid (exact
  validation regex undocumented). **(H)**
- `SecretComponent extends BaseComponent`; constructor `(app: App, containerEl)`; `setValue(id): this`,
  `onChange(cb: (value: string) => unknown): this`. **No `getValue`.** The component lets the user
  **select an existing secret or create a new one**; `setValue`/`onChange` carry the secret **name/id**,
  not the value. **(H)**
- Doc bug: the official *guide* example calls `app.secretStorage.get(...)`, which is not in the typed API;
  `getSecret` is authoritative (every adopting plugin uses `getSecret`). **(H)**

## 3. Storage location, sync, cross-device

- Secrets live in **per-device app storage keyed to the vault**, **outside** the vault folder / `data.json`.
  **They do NOT sync** (Obsidian Sync or third-party). **(H for not-in-data.json; M for no-sync — forum + architecture)**
- Therefore on a second device / fresh install, `getSecret(id)` returns **`null`** and `listSecrets()` does
  not list it. The plugin's own `data.json` (which *does* sync) should carry only the **secret name/id**;
  the value is re-entered per device. **(H signature; M cross-device behavior)**
- OS-keychain reset ⇒ secrets become unrecoverable; re-entry is the recovery path. Backup/restore and
  plugin-uninstall cleanup are **undocumented** (likely orphaned). **(L/?)**

## 4. Threat model — what SEC-A can honestly claim

- The id space is **GLOBAL and shared across plugins** by design (*"any plugin can reference it by that
  name"*; `listSecrets()` enumerates everything). **Any installed plugin can read Claudian's secrets.**
  No per-plugin isolation. **(H)**
- `safeStorage` protects against **other OS users** and keeps secrets **out of synced/committed files**;
  it does **not** protect against same-user processes or other plugins. On Linux with no keyring it
  degrades to `basic_text` (hardcoded key = obfuscation). **(H, Electron-level)**

➡️ **Honest framing for SEC-A:** the defensible win is *"provider secrets and MCP auth no longer persist in
the syncable/committable vault files (`.claudian/claudian-settings.json`, `.claude/mcp.json`)"* — **not**
"hardened against local attackers or other plugins."

➡️ **Decision impact:** namespace our derived ids (`claudian-…`) to avoid colliding in the global space; but
let `SecretComponent` own naming for shared keys (a user may point Claudian at an existing `openai-key`).

## 5. Idiomatic usage (from docs + ~15 adopting plugins: BRAT, steward, flint, crystalbear, ocr-extractor…)

- **No `Setting.addSecret()`** — attach via `Setting.addComponent(host => new SecretComponent(this.app, host)…)`
  (the component needs `App` to reach SecretStorage, which `addText` can't provide). **(H)**
- Settings persist the **secret id/name** (a reference), never the value:
  ```ts
  new Setting(el)
    .setName('Anthropic API key')
    .addComponent(host => new SecretComponent(this.app, host)
      .setValue(this.settings.anthropicKeySecretId)          // id/name, not the key
      .onChange(id => { this.settings.anthropicKeySecretId = id; this.saveSettings(); }));
  ```
- Runtime read is synchronous:
  ```ts
  const key = this.app.secretStorage.getSecret(this.settings.anthropicKeySecretId) ?? '';
  ```
- Community feature-detect guard (`if (app.secretStorage)`) is common, but since we bump `minAppVersion`
  to 1.11.5 we can rely on it; a cheap defensive guard is still fine.
- **Migration**: no official recipe. De-facto pattern — detect plaintext in own settings → `setSecret(derivedId, value)`
  → repoint setting to id → clear plaintext → save. **(M)**
- Policy: data.json plaintext is *discouraged* as best practice; no confirmed hard review-rejection rule. **(M)**

## 6. Net design implications for SEC-A (feed into the plan)

1. `minAppVersion` → **1.11.5**.
2. Adopt **`SecretComponent`** for provider API-key fields; persist the **secret id/name** in
   `.claudian/claudian-settings.json`; `getSecret(id)` at env-build/runtime; inject into the child env under
   the canonical var name (e.g. `ANTHROPIC_API_KEY`). The env blob keeps only non-secret config.
3. `SecretStore` wrapper adds `clear(id) = setSecret(id, '')` (no native delete).
4. The pure core shrinks to **id derivation + migration detection only** (no `${secret:…}` token, no
   blob rewriting, no steady-state name-guessing). Namespace derived ids with `claudian-`.
5. Migration = detect→set→repoint→clear→save, with the detection used **only to suggest** candidates the
   user confirms.
6. Document the **honest threat model** (out-of-synced-files, not local-attacker-proof; Linux keyring
   requirement; device-local / re-enter on new device).

## Sources
- obsidian.d.ts (official types) — https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts
- Store secrets (guide) — https://docs.obsidian.md/plugins/guides/secret-storage
- API ref — https://docs.obsidian.md/Reference/TypeScript+API/SecretStorage (+ getSecret/setSecret/listSecrets, SecretComponent)
- Changelog 1.11.4 — https://obsidian.md/changelog/2026-01-07-desktop-v1.11.4/
- Changelog 1.11.5 — https://obsidian.md/changelog/2026-01-20-desktop-v1.11.5/
- Forum (secure storage thread, posts #15–21) — https://forum.obsidian.md/t/cross-platform-secure-storage-for-secrets-and-tokens-that-can-be-syncd/100716
- Electron safeStorage — https://www.electronjs.org/docs/latest/api/safe-storage
- Adopting plugins — TfTHacker/obsidian42-brat, googlicius/obsidian-steward, aliou/obsidian-flint, messeb/obsidian-crystalbear-plugin, jritzi/ocr-extractor, edonyzpc/personal-assistant, jlentink/obsidian-taakje
