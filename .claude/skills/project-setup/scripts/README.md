<!-- .claude/skills/project-setup/scripts/README.md -->
# project-setup engine

Deterministic setup engine. Node ≥18, zero runtime deps.

## Commands

    node setup.mjs detect                 # print project-state JSON
    node setup.mjs plan  --config a.json  # print the action plan (no mutation)
    node setup.mjs apply --config a.json  # apply idempotently (--dry-run to preview)

`report` and `verify` arrive in Plan 3.

## Tests

    node --test scripts/tests/

All tests are `node:test` specs operating on temp-dir fixtures — no network,
no global state.
