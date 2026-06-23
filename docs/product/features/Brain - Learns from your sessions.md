---
type: feature
name: Brain - Learns from your sessions
title: Brain — Learns from your sessions
status: planned
scope: product feature overview
parent: "[[Specorator - Product Vision]]"
related:
  - "[[2026-06-22-brain-feature-research]]"
  - "[[2026-06-22-feedback-signal-capture-design]]"
  - "[[2026-06-22-implicit-interaction-signal-capture-design]]"
  - "[[2026-06-22-brain-service-design]]"
  - "[[2026-06-22-brain-scheduler-and-publishing-design]]"
  - "[[Co-Worker - Chat]]"
  - "[[Agent Kanban Board]]"
tags: [feature, brain, memory, self-improvement, learning, local-first]
date: 2026-06-22
---

# Brain — Learns from your sessions

The Brain turns your past sessions into durable, reusable knowledge. It notices what worked and what didn't, distills the lessons into plain notes you own, and brings the relevant ones back into future sessions — so your assistant stops repeating the same mistakes and stops asking you to re-explain your project every time.

Unlike the memory features built into individual cloud tools, the Brain is **local, lives in your vault, and spans every provider**. A lesson learned in a Claude session is available to your Codex, Opencode, and Cursor sessions too. The memory is a set of Markdown notes you can read, edit, and delete — not a black box on someone else's server.

## What it solves

- Your assistant repeats a mistake it already made last week.
- You re-paste the same "here's how this repo works / don't do X" preamble into every new session.
- You switch providers mid-project and lose all continuity.
- A chat produces a genuinely good decision or pattern, and it evaporates when the session ends.
- You want your AI's memory to be something you own and can audit — not a hidden profile in a cloud product you can't inspect.

## User promise

Give a response a thumbs up or thumbs down — or just work as you normally do. The Brain watches the outcomes you signal (and the ones it can infer, like redoing or rewinding a turn), distills the lessons, and proposes them to you. You approve, edit, or reject each one. Approved lessons live as notes in your vault and quietly improve future sessions across every provider.

The Brain is **off until you turn it on**, and once on, it never saves anything without showing you first.

## Core behaviors

- **Consolidate a session:** turn a finished session into a short "what worked / what to avoid / decisions" note.
- **Prime a session:** bring the relevant lessons into a new session so the assistant starts from what you've already learned.
- **Consolidate on a schedule:** an optional scheduler prepares your knowledge in the background — at the end of a session, every so many sessions, or on a daily cadence — so lessons are always ready without you having to ask.
- **Lessons agents can find:** consolidated lessons are published to a folder you choose, as a plain "Lessons Learned" note that delegated agents (including [[Agent Kanban Board]] work orders) read in their very first prompt — so a fresh agent starts already knowing your project's hard-won rules.
- **Learns from your signals:** the thumbs up/down already in chat — plus implicit signals like retrying, rewinding, or copying a response — tell the Brain which turns were good and which missed.
- **Verified, not flattering:** a lesson is only trusted when a positive signal is backed by an objective one (the code ran, the tests passed, the change stuck) — so the Brain learns correctness, not agreeableness.
- **Propose, then approve:** every lesson is staged for your review before it's saved. Nothing is captured silently.
- **Provider-neutral memory:** lessons learned in one provider's sessions surface in all of them.
- **Your files, your control:** lessons are Markdown notes you can open, edit, pin, or delete; stale lessons fade out over time.

## What users see

The UI describes state in product terms, not implementation jargon:

- `Brain is off — turn it on to start learning from your sessions`
- `3 lessons ready for review`
- `Primed this session with 4 lessons from your past work`
- `This lesson came from your session on June 21 — edit or remove it anytime`
- `Lessons published to "Brain/Lessons Learned" — agents read it first`
- `Next scheduled consolidation: tonight at 4:00`
- `Some folders are excluded from the Brain`
- `Distilling a lesson sends part of this session to your selected model`

The everyday interaction stays simple: rate responses as you go, review the occasional proposed lesson, and let priming happen when you start related work. Power users can tune scope, the distillation model, and decay.

## Privacy and trust

The Brain watches what you do, so trust is the precondition, not an afterthought:

- **Off by default.** It only starts after you opt in and see exactly what it reads (transcripts of completed sessions in allowed folders) and stores (distilled lessons — never raw transcripts).
- **You approve every lesson** before it is saved, and every lesson injected into a session is attributable back to its source.
- **Everything is a vault file** you can read, edit, and delete. One switch pauses the Brain; one switch wipes it.
- **Secrets stay out.** Proposed lessons are scanned and scrubbed before you ever see them, and excluded folders are never read.
- **Honest about the model boundary.** Distilling a lesson sends session excerpts to your selected model — the same boundary as auto-titling already uses. A fully local model can be chosen for a no-network path.

## What it doesn't do

- It does not optimize for your thumbs. Feedback is used to *gate and rank* lessons, never as a target to maximize — so the assistant can't learn to flatter you for a thumbs-up.
- It does not fine-tune a model. Lessons are notes injected as context, not weight updates.
- It does not capture anything silently or inject anything invisibly.
- It is not a chat history search. The Brain stores *distilled lessons*, not a copy of your transcripts (those already live with each provider).

## Relationship to the roadmap

The Brain builds directly on substrate the product already has — recorded sessions, the per-run ledger and handoff, and the thumbs up/down in [[Co-Worker - Chat]] — and complements [[RAG Layer - Ask your Vault]]: Ask Vault recalls what you *wrote*, the Brain distills what you *did*.

Planned in stages:

- **Consolidate & Recall (first):** manual consolidate + prime, with propose-and-approve review, and a published "Lessons Learned" note that Agent Board runs read in their first prompt. Off by default.
- **Assisted memory:** a background scheduler consolidates on a cadence (session-end, every N sessions, or daily) and keeps the published lessons fresh; the Brain suggests lessons at the end of a session and surfaces relevant ones automatically when you start related work.
- **Self-improving Brain:** reusable lessons grow into shareable patterns and skills, fade when stale, the Brain tracks whether primed sessions actually did better, and lessons can be published per-project and relevance-selected per work order.

## Success criteria

- A user can consolidate a session into a lesson and prime a later session from it.
- No lesson is ever saved without the user approving it; every saved lesson is editable and deletable as a vault note.
- Lessons learned under one provider surface under the others.
- The assistant demonstrably repeats fewer known mistakes on primed sessions than on cold ones — measured before any automatic behavior is enabled.
- Users keep the Brain enabled and curate their lessons, rather than disabling it.
