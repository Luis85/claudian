---
type: tech-debt
title: "Release artifact reproducibility is not checked in PR CI"
date: 2026-06-07
updated: 2026-06-09
status: done
priority: "2 - normal"
severity: medium
scope: release-build
tags:
  - tech-debt
  - build
  - release
  - ci
related:
  - "[[2026-06-07-agentic-quality-gates]]"
  - "[[2026-05-28-plugin-improvement-research-proposal]]"
---

# Release artifact reproducibility is not checked in PR CI

## Summary

The Obsidian plugin ships `main.js`, `manifest.json`, and `styles.css`, but pull-request CI does not prove those artifacts can be produced or that they match the source tree. The release workflow runs a build, but that is late feedback and uses a different Node version from CI.

## Evidence

- `package.json` exposes `npm run build`, `npm run build:css`, and `npm run test-build`.
- `.github/workflows/ci.yml` does not run `npm run build`.
- `.github/workflows/release.yml` uses Node 20; `.github/workflows/ci.yml` uses Node 22.
- `package.json` has no `engines` field and `.npmrc` does not pin a Node version.
- `scripts/build-css.mjs` validates CSS import registration and writes root `styles.css`; this validation is not exercised by CI unless build is run.
- `esbuild.config.mjs` patches SDK import-meta and renderer-unsafe timer `.unref()` sites; this validation is not exercised by CI unless build is run.

## Why it matters

A source-only change can pass tests and still fail the production bundle, miss a CSS import, or produce stale release assets. This is especially easy for agents: many project plans say to run `npm run build`, but the central CI gate does not enforce it.

## Suggested remediation

1. Add a `build` job to PR CI.
2. Align CI and release Node versions, or explicitly document/test both.
3. Add a small `artifact:smoke` script that checks artifact presence, version sync, `minAppVersion`, expected manifest id, and size budget.
4. Consider a `git diff --exit-code main.js styles.css manifest.json` check after build if artifacts are intended to be tracked.

## Acceptance criteria

- [x] Pull-request CI runs the production build. — `build` job in `.github/workflows/ci.yml` runs `npm run build`.
- [x] CI and release use the same Node major or both supported majors are tested deliberately. — `.github/workflows/release.yml` bumped from Node 20 to Node 22 (2026-06-09), matching all CI jobs; `package.json` now declares `"engines": { "node": ">=22" }`.
- [x] Artifact smoke fails on stale version fields, missing files, or abnormal bundle size growth. — `npm run check:artifacts` (`scripts/check-artifacts.mjs`) runs after build in the `build` job.
- [x] The release workflow does not discover build failures for the first time at tag push. — the same `npm run build` now gates every PR on the same Node major the release uses.

## Resolution (2026-06-09)

Closed. Remediation items 1 and 3 had already shipped with the agentic
quality-gates first slice (2026-06-07): the CI `build` job runs the production
build and `npm run check:artifacts` smoke-checks presence, version sync,
`minAppVersion`, and bundle-size budget — see
`docs/build-ci/quality-gates.md`.

This pass delivered item 2: `.github/workflows/release.yml` was still on
Node 20 while CI ran Node 22; release now uses Node 22 with a sync comment
pointing at CI, and `package.json` gained `"engines": { "node": ">=22" }` so
the supported floor is declared in one machine-readable place.

Item 4 (`git diff --exit-code main.js styles.css manifest.json` after build)
is **not applicable**: `main.js` and `styles.css` are not tracked in git
(`git ls-files` shows only `manifest.json` and `versions.json`). Built
artifacts are produced fresh in the release workflow and attached to the
GitHub release, so there is no tracked-artifact staleness to diff against.
The version-sync portion of that idea is covered by `check:artifacts`
comparing `package.json` and `manifest.json` versions.
