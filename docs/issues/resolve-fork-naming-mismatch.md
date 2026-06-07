---
type: issue
id: issue-20260603-fork-naming-mismatch
title: Resolve the three-way fork/upstream naming mismatch before any release-facing work
status: done
priority: 3 - low
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (OBS-E)"
related:
  - "[[2026-05-28-standalone-product-vision]]"
scope: release-hygiene
tags:
  - release
  - metadata
  - naming
---

# Resolve fork/upstream naming mismatch

## Problem

Repository identity is inconsistent three ways:

- `manifest.json` id `claudian-cursor`, author `YishenTu`;
- `README.md` links to `YishenTu/claudian`;
- `scripts/release.mjs` targets `Luis85/claudian`.

This is a confirmed defect that should be resolved before any release-facing work. It also interacts with
the Specorator migration decision (do not change `manifest.id`/storage paths without a migration plan).

## Proposed change

Decide the canonical identity (Claudian, current id) and align `manifest.json`, `README.md`, and
`scripts/release.mjs`. Do **not** change `manifest.id` or `.claudian/` storage path without an explicit
migration plan — see the Specorator standalone vision.

## Acceptance criteria

- `manifest.json`, `README.md`, and `scripts/release.mjs` reference one consistent repo/identity.
- No silent `manifest.id` / storage-path change (migration handled separately if ever done).
