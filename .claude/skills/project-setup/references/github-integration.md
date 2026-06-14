# GitHub integration reference

GitHub integration is opt-in. When a GitHub remote is detected (or the user wants one), ask before adding any GitHub-specific file. Never write `.github/` or `.mcp.json` without explicit consent.

## What gets added

| File | Guardrail | When |
|------|-----------|------|
| `.github/workflows/ci.yml` | `guardrails.ci: true` | `github.integrate: true` only |
| `.mcp.json` | `github.mcp: true` | `github.integrate: true` AND `github.mcp: true` |

Both files use `skip-if-exists` mode — existing CI configs and MCP configs are never overwritten.

## Interview flow

When `detect` shows a GitHub remote (or the user mentions GitHub):
1. Ask: "Do you want to add a CI workflow to `.github/workflows/ci.yml`?" → sets `github.integrate`.
2. If yes, ask: "Do you want to register the fallow MCP server in `.mcp.json` for agent-driven quality analysis?" → sets `github.mcp`.

If no GitHub remote is detected, GitHub integration defaults to `false` and no GitHub questions are asked unless the user raises it.

## fallow MCP (`github.mcp: true`)

`.mcp.json` registers `npx fallow-mcp` as an MCP server named `fallow`. This allows agents (Claude, Codex, etc.) to invoke fallow quality analysis tools during code review and refactoring sessions.

**`fix_apply` caveat:** The fallow MCP exposes a `fix_apply` tool that can write files directly. If the team does not want unsupervised agent writes, deny `fix_apply` in the agent's settings (e.g. in `.claude/settings.json` under `permissions.deny`):

```json
{
  "permissions": {
    "deny": ["mcp__fallow__fix_apply"]
  }
}
```

Raise this explicitly with the user before enabling the MCP server so the decision is deliberate.

## Branch protection

Branch protection rules (require PR reviews, require status checks, restrict force-push) cannot be set by the engine — GitHub requires admin API access, which the engine does not request.

After applying, advise the user to enable branch protection manually:
1. Go to `Settings → Branches → Add rule` for the default branch.
2. Enable **"Require status checks to pass before merging"** and add the CI job name (typically `ci`).
3. Enable **"Require a pull request before merging"** with at least one approval.
4. Enable **"Restrict who can push to matching branches"** if the team uses a push model.

These steps cannot be automated without a GitHub token with `repo` or `admin:repo_hook` scope, which is outside the scope of this skill.
