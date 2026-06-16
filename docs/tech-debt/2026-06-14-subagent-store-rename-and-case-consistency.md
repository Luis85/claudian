---
type: tech-debt
title: "Subagent store rename safety and case-insensitive identity"
date: 2026-06-14
status: open
priority: "2 - normal"
severity: medium
scope: providers
---

# Subagent store rename safety and case-insensitive identity

Captured from the Codex review of PR #81 (Cursor subagent foundation). The Cursor
store was hardened in that PR; the items below are the same class of issue in the
sibling provider stores (out of scope for a Cursor PR) plus one near-unreachable
edge that the Cursor fix left open by design. Recorded here so the fixes are a
quick, deliberate follow-up rather than rediscovered later.

## 1. Case-only rename can delete the agent on case-insensitive filesystems

`save()` in the Opencode and Codex subagent stores writes the new file, then
deletes the previous path when the strings differ:

```ts
if (previousPath && previousPath !== filePath) {
  await this.vaultAdapter.delete(previousPath);
}
```

- `src/providers/opencode/storage/OpencodeAgentStorage.ts` (`save`, ~L79-89)
- `src/providers/codex/storage/CodexSubagentStorage.ts` (`save`, ~L63-73)

On a case-insensitive filesystem (Windows, default macOS) a case-only rename
(`Foo` → `foo`) produces different path *strings* that resolve to the **same
on-disk file**, so the delete removes what was just written and the agent
disappears after Save.

**Reachability differs by provider:**

- **Opencode — reachable.** `validateOpencodeAgentName`
  (`opencodeAgentValidation.ts`) only rejects `/[<>:"\\|?*]/`, so mixed-case
  names are allowed and a user can perform a case-only rename through the
  settings UI.
- **Codex — latent only.** `CODEX_AGENT_NAME_PATTERN = /^[a-z0-9_-]+$/`
  (`CodexSubagentSettings.ts`) forbids uppercase, so the rename is only reachable
  via manually-created uppercase files on disk.

**Fix:** port the guard already shipped for Cursor in PR #81
(`CursorAgentStorage.save`): after deleting `previousPath`, restore the target
when it no longer exists — which only happens when the delete aliased away the
file just written. It is a no-op on case-sensitive filesystems (the distinct old
file is gone, the target survives), so no stale old-cased file is left behind.

```ts
await this.vaultAdapter.delete(previousPath);
if (!(await this.vaultAdapter.exists(filePath))) {
  await this.vaultAdapter.write(filePath, content);
}
```

## 2. Case-insensitive identity vs case-preserving paths

The stores de-duplicate by `name.toLowerCase()` in `loadAll()` while filenames
preserve case, so `Foo` and `foo` are one *identity* but two possible *files*.

Cursor's `wouldOverwriteDifferentAgent` (the destination-clobber guard added in
PR #81) exempts case-only-different target paths via a lowercase comparison. On a
**case-sensitive** vault that already holds both `Foo.md` and `foo.md`, a
case-only rename of the visible agent therefore reads as "not a clobber" and
overwrites the distinct file.

This is **near-unreachable today**: the create-time duplicate check is
case-insensitive, so the UI refuses to create the two case-twins in the first
place — reaching it requires manually creating case-colliding files on a
case-sensitive filesystem. The same dedup-by-lowercase-but-allow-mixed-case
inconsistency exists in Opencode (single source, so no cross-source clobber).

**Fix options:**

- **(a) Normalize identity.** Enforce a canonical case (lowercase filenames, or
  reject mixed-case names as Codex already does), so two case-twins can never
  coexist. Simplest and removes the ambiguity at the root.
- **(b) Prove filesystem aliasing.** Before treating two case-only-different
  paths as the same file, list the directory and check whether both exact names
  exist as distinct entries (case-sensitive) or collapse to one
  (case-insensitive). More code, keeps mixed-case names working.

Option (a) is preferred unless mixed-case subagent names are a product
requirement.

## Already fixed in PR #81 (for reference)

Codex also flagged that a scalar-looking description (`true`, `false`, `null`,
`123`) was serialized unquoted by the shared `yamlString`, so it parsed back as a
boolean/number and the agent was dropped on the next scan. That was a systemic
issue across all providers' frontmatter serialization and was fixed in PR #81 by
quoting reserved/numeric scalar tokens in `src/utils/slashCommand.ts`
(`yamlString`); no follow-up needed.

## References

- PR: https://github.com/Luis85/claudian/pull/81
- Codex review threads: `CursorAgentStorage.ts` L208 (case-only clobber),
  L96 (scalar description); `CursorAgentSettings.ts` L176/L194 (hidden-twin
  clobber / metadata-on-edit — both fixed in PR #81).
