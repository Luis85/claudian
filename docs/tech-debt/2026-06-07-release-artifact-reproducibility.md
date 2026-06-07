---
type: tech-debt
title: "Release artifact reproducibility is not checked in PR CI"
date: 2026-06-07
updated: 2026-06-07
status: open
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

- [ ] Pull-request CI runs the production build.
- [ ] CI and release use the same Node major or both supported majors are tested deliberately.
- [ ] Artifact smoke fails on stale version fields, missing files, or abnormal bundle size growth.
- [ ] The release workflow does not discover build failures for the first time at tag push.
