<!-- .claude/skills/project-setup/scripts/README.md -->
# project-setup engine

Deterministic setup engine. Node ≥20 (the harness installs ESLint 9 /
typescript-eslint 8, which require it), zero runtime deps.

## Commands

    node setup.mjs detect                  # print project-state JSON
    node setup.mjs plan   --config a.json  # print the action plan (no mutation)
    node setup.mjs apply  --config a.json  # apply idempotently (--dry-run to preview)
    node setup.mjs report                  # write the advisory quality report
    node setup.mjs verify --config a.json  # run the enabled gates once

## Tests

    node --test tests/*.test.js

All tests are `node:test` specs operating on temp-dir fixtures — no network,
no global state.
