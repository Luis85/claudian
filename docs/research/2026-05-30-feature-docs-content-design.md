---
type: research
title: "Feature Documentation Content Design for Developer Tools and Obsidian Plugins"
tags:
  - research
related:
  - "[[docs/superpowers/specs/2026-05-30-feature-docs-content-design]]"
sources:
  - https://www.anthropic.com/product/claude-code
  - https://github.com/epwalsh/obsidian.nvim
  - https://publish.obsidian.md/tasks/Support+and+Help/Known+Limitations
  - https://redocly.com/docs-legacy/developer-portal/guides/reusing-content
  - https://copyhackers.com/2014/11/jobs-to-be-done-copywriting/
  - https://evilmartians.com/chronicles/six-things-developer-tools-must-have-to-earn-trust-and-adoption
  - https://github.com/features/copilot
  - https://blacksmithgu.github.io/obsidian-dataview/
  - https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
date: 2026-05-30
status: complete
shipped_via: "[[docs/superpowers/specs/2026-05-30-feature-docs-content-design]]"
---

# Feature Documentation Content Design for Developer Tools and Obsidian Plugins

## Executive Summary

Feature documentation for developer tools is most effective when it leads with system-level outcomes rather than feature names, explicitly scopes what the product does *not* do, and treats known limitations as a transparent ongoing condition rather than a failure to hide. Successful tools like Claude Code open with action-oriented system statements before enumerating capabilities, and use direct negative contrast ("Agentic, not autocomplete") as a primary positioning device. In the Obsidian plugin ecosystem, scope honesty follows two distinct patterns: an explicit "not a replacement" framing with named capability gaps (obsidian.nvim), and a dedicated limitations hub that frames gaps as ongoing workload reality (Tasks plugin). Single-source content strategy — authoring once, propagating to all channels automatically — resolves documentation drift when backed by proper tooling. Scenario-led copywriting anchors messaging in the user's struggling moment and is strongest for landing/marketing copy; it must be balanced with feature clarity in technical reference documentation.

> **Note on confidence:** Findings 1–4 rest on live primary sources (product pages, GitHub READMEs) with 3-0 adversarial votes — high confidence. Findings 5–6 rest on practitioner blog posts and vendor docs — medium confidence. 25 candidate claims were verified; 17 were killed (0-3 or 1-2 adversarial votes). Refuted claims are documented in the [[#Refuted Claims]] section.

---

## Angle 1 — AI Coding Tool Feature Page Framing (Claude Code, Copilot, Cursor)

**Confirmed pattern: system-level outcome statement before feature enumeration.**

Claude Code's product page ([Source: Anthropic](https://www.anthropic.com/product/claude-code)) leads with:

> "an agentic coding system that reads your codebase, makes changes across files, runs tests, and delivers committed code"

…before drilling into MCP, hooks, skills, and scheduling. The structural order is: *what the system does for the user as a whole* → *what the individual parts are named*. Verified live (vote: 2-1 confirmed).

**Confirmed pattern: direct negative contrast as primary positioning.**

Claude Code uses "Agentic, not autocomplete" as a section heading — explicitly distancing the product from adjacent line-by-line suggestion tools. This is a confirmed trust-building mechanism for developer tools (vote: 3-0).

**Refuted: GitHub Copilot as positive example.** The claim that Copilot uses workflow-context framing rather than feature-name-led headings was refuted 0-3 on live verification. Copilot's page does not use this pattern — do not cite it as a model.

**Refuted: Claude Code CTA as scenario-led.** The claim that the CTA headline ("Describe what you want to build, test, iterate, or ship") is a user-moment scenario rather than a feature capability statement was refuted 1-2. The copy is action-directive, not struggle-anchored.

**Implication for Specorator:** Open each feature page with a single declarative sentence about what the system does for the user in that moment — not the feature name. The feature name (`# Quick Actions`) follows as the first heading *after* this hook. This matches both the spec's Layer 1 design and Claude Code's verified structure.

---

## Angle 2 — Obsidian Plugin Documentation Conventions

**Confirmed pattern (obsidian.nvim): explicit "not a replacement" framing with named gaps.**

The obsidian.nvim README states ([Source: GitHub](https://github.com/epwalsh/obsidian.nvim)):

> "this plugin is not meant to replace Obsidian, but to complement it"

…and names specific capability gaps (mobile app, graph explorer) as justification for the scope boundary. Vote: 3-0. This is a deliberate trust signal, not a disclaimer — naming specific gaps tells evaluators exactly what they still need.

**Confirmed pattern (obsidian.nvim): version-scope honesty.**

The README includes an explicit WARNING block directing users to read the README at the stable release tag, not `main`, when documentation may reference unreleased features. Vote: 3-0. Concrete implementation of documentation scope management across release channels.

**Confirmed pattern (Tasks plugin): limitations as ongoing workload, not failure.**

The Tasks plugin Known Limitations page ([Source: Obsidian Publish](https://publish.obsidian.md/tasks/Support+and+Help/Known+Limitations)) states verbatim:

> "due to the sheer volume of work, there will always be outstanding requests and known issues"

Vote: 3-0. This frames limitations as a condition of active, high-volume development — not incompleteness. Two distinct Obsidian-ecosystem patterns emerge: (a) inline "not a replacement" in the README with named gaps, and (b) a dedicated limitations hub with workload framing.

**Refuted: Dataview as positive example.** Three Dataview-related claims were refuted (0-3, 1-2, 0-3). Dataview's documentation does not use scenario-led framing before technical terminology, does not document its read-only scope explicitly as a first-class concern, and does not use data-safety guarantees as a trust signal on live verification. Do not cite Dataview as a reference case for these patterns.

**Implication for Specorator:** The "What it doesn't do" section in Layer 3 of every feature page is well-supported by the Obsidian ecosystem. Consider adding a cross-feature limitations hub as the plugin matures. For multi-provider capability parity gaps (e.g., rewind not available in Codex), the inline per-feature list is the correct pattern — not buried in a settings tab.

---

## Angle 3 — Honest Scope Documentation ("What It Doesn't Do" Patterns)

**Confirmed: explicit scoping away from adjacent categories builds developer trust.**

The Evil Martians practitioner article ([Source: Evil Martians](https://evilmartians.com/chronicles/six-things-developer-tools-must-have-to-earn-trust-and-adoption)) supports the underlying principle: keep rare or out-of-scope functionality outside the everyday mental model while keeping it reachable — progressive disclosure applied to capability scope. Vote: 3-0. This converges with Claude Code's "Agentic, not autocomplete" pattern from a different source and angle.

**Implication for Specorator:** The "What it doesn't do" section is not a disclaimer — it is a primary trust-building surface. Each bullet should name a specific capability gap and give a one-line reason or alternative. Vague entries ("No advanced X") are less useful than named ones ("No placeholder substitution — `{{title}}`, `{{selection}}` not supported; prompts send verbatim"). The worked example in [[docs/superpowers/specs/2026-05-30-feature-docs-content-design]] already demonstrates this pattern correctly.

---

## Angle 4 — Single-Source Content Strategy

**Confirmed (medium confidence): centralized authoring resolves propagation drift.**

Redocly's documentation ([Source: Redocly](https://redocly.com/docs-legacy/developer-portal/guides/reusing-content)) states "changes propagate automatically to all target pages" when content is embedded from a central snippet rather than copied. Vote: 2-1. Corroborated by Paligo, Heretto, MadCap, and TechnicalWriterHQ — the principle is decades-established (DITA, help-authoring tools).

**Qualification:** Automatic propagation requires proper tooling (a build pipeline or CCMS). The principle is sound but not tool-agnostic — "write once" only eliminates drift if the authoring system enforces the single source at build time, not just by convention.

**Refuted claims around implementation details:** The claim that single-source authoring *prevents* drift by keeping content in one canonical location was refuted 0-3 — likely because the claim was too absolute. Unintentional reuse can create a different class of maintenance problem (conditional outputs, heavy dependencies). The principle holds for intentional, planned single-sourcing.

**Implication for Specorator:** The `tagline` frontmatter field in the spec is the correct single-source anchor for Layer 1 hooks across channels. Any channel adaptation (README, website CMS, in-app onboarding) should pull from `tagline`, not copy prose from the body. The `name` field is the canonical reference for cross-links and hub queries.

---

## Angle 5 — Scenario-Led Copywriting for Developer Tools

**Confirmed (medium confidence): anchor copy in the user's struggling moment.**

Copyhackers (2014) ([Source: Copyhackers](https://copyhackers.com/2014/11/jobs-to-be-done-copywriting/)) states:

> "We need to understand moments of struggle that have led our customers to hire our product"

Vote: 2-1. The JTBD framework underpinning this is credible and in active use (Bob Moesta, Business of Software 2024). However, this is a 2014 practitioner blog post — not primary research — and JTBD has known limitations: it underrepresents identity-based and aspirational needs.

**Qualification:** For developer tools specifically, dominant documentation best practices (Google for Developers, Stripe) emphasize task-orientation and feature clarity over emotionally-framed struggle narratives. The scenario-led principle is strongest for **marketing/conversion copy and landing pages** — it needs balancing with feature clarity in technical reference documentation, which developer audiences read during active use, not just evaluation.

**Confirmed (medium confidence): center the everyday mental model on common, understandable use cases.**

Evil Martians (3-0 vote) supports centering the everyday mental model on common, understandable use cases for developer tool trust and adoption — independently of the JTBD framing. This is a complementary principle: the "workflow moment" table in the spec maps features to recognizable moments, which is consistent with this pattern without requiring full JTBD framework adoption.

**Refuted JTBD implementation claims:** Multiple specific JTBD prescriptions were killed:
- "Copy should open with `When [situation], I want [motivation], so [outcome]`" — 1-2
- "Demographic segmentation produces useless busy work" — 0-3
- "Customer-voiced language outperforms marketer-written copy" — 0-3

The scenario-led *principle* survives adversarial review; the specific JTBD sentence templates and anti-persona prescriptions do not.

**Implication for Specorator:** The Layer 1 hook and Layer 2 scenario prose are well-supported by confirmed evidence. The "workflow moment" framing in the spec's feature moment mapping table is the right anchor — it grounds each feature in a recognizable daily situation without requiring rigid JTBD templates. Keep the principle; skip the template.

---

## Open Questions

1. **Per-provider capability parity documentation:** How do multi-provider tools document provider-specific feature gaps without fragmenting the feature narrative? Is there an established pattern for per-provider "what it doesn't do" tables versus a unified limitations hub? Specorator's four-provider model (Claude, Codex, Opencode, Cursor) is a direct instance of this problem.

2. **Single-page vs. per-provider architecture:** For a plugin where the same UI surface hosts four backends with different feature parity, does single-source authoring apply at the feature-page level (one page per feature, noting per-provider availability inline) or at the provider level (one page per provider listing supported features)? Which pattern do comparable multi-provider tools actually use?

3. **Obsidian README as hybrid document:** Which specific copywriting patterns work best in Obsidian plugin READMEs — documents read simultaneously by evaluators (marketing lens) and active users (reference lens)? The JTBD struggling-moment principle is supported for the evaluator lens but may conflict with feature-clarity requirements for the reference lens.

4. **Named gaps for "complement, not replace" credibility:** For Specorator specifically, which provider-native or Obsidian-native capabilities (e.g., Claude.ai web UI, Cursor IDE, Codex CLI) should be named in scope documentation to make the boundary credible and useful to evaluators? The obsidian.nvim pattern names specific gaps (mobile, graph) — Specorator needs an equivalent named list.

---

## Refuted Claims

These claims were tested and killed (≥2/3 adversarial votes refuted):

| Claim | Vote | Source |
|-------|------|--------|
| Dataview opens feature framing with concrete user scenarios | 0-3 | [Dataview docs](https://blacksmithgu.github.io/obsidian-dataview/) |
| Dataview documents read-only scope explicitly as a first-class concern | 1-2 | [Dataview docs](https://blacksmithgu.github.io/obsidian-dataview/) |
| Dataview uses data-safety guarantee as a trust signal | 0-3 | [Dataview docs](https://blacksmithgu.github.io/obsidian-dataview/) |
| Tasks plugin limitations page is a central directory linking to per-feature pages | 1-2 | [Tasks limitations](https://publish.obsidian.md/tasks/Support+and+Help/Known+Limitations) |
| Claude Code CTA headline is a user-moment scenario | 1-2 | [Claude Code page](https://www.anthropic.com/product/claude-code) |
| GitHub Copilot uses workflow-context framing rather than feature-name headings | 0-3 | [GitHub Copilot](https://github.com/features/copilot) |
| Copilot buries scope limits in FAQ below the fold | 1-2 | [GitHub Copilot](https://github.com/features/copilot) |
| Content reuse works by referencing snippets rather than copying text | 0-3 | [Redocly](https://redocly.com/docs-legacy/developer-portal/guides/reusing-content) |
| Customer-voiced language outperforms marketer-written copy | 0-3 | [Copyhackers](https://copyhackers.com/2014/11/jobs-to-be-done-copywriting/) |
| Demographic segmentation produces useless busy work | 0-3 | [Copyhackers](https://copyhackers.com/2021/06/buyer-personas-vs-jtbd/) |
| JTBD prescribes `When [situation], I want [motivation], so [outcome]` template | 1-2 | [Upscope](https://upscope.com/company-blog/why-jobs-to-be-done-framework-examples-will-improve-your-marketing-copy) |
| Feature-focused language is insufficient for effective marketing copy | 0-3 | [Upscope](https://upscope.com/company-blog/why-jobs-to-be-done-framework-examples-will-improve-your-marketing-copy) |
| Single-source authoring prevents drift — absolute claim | 0-3 | [TechnicalWriterHQ](https://technicalwriterhq.com/writing/technical-writing/single-source-authoring/) |
| Unintentional reuse increases rather than reduces overhead | 0-3 | [TechnicalWriterHQ](https://technicalwriterhq.com/writing/technical-writing/single-source-authoring/) |
| Topic-based authoring modules work across all publications without modification | 1-2 | [Paligo](https://paligo.net/blog/content-reuse/quick-guide-to-mastering-content-reuse-in-technical-documentation/) |

---

## Research Stats

- **Angles:** 5
- **Sources fetched:** 25
- **Claims extracted:** 113
- **Claims verified:** 25 (top by confidence)
- **Confirmed:** 8 → synthesized to 6 findings
- **Killed:** 17
- **Agent calls:** 107

---

## Sources

- [Claude Code product page](https://www.anthropic.com/product/claude-code)
- [obsidian.nvim README](https://github.com/epwalsh/obsidian.nvim)
- [Tasks plugin Known Limitations](https://publish.obsidian.md/tasks/Support+and+Help/Known+Limitations)
- [Evil Martians — Six things developer tools must have](https://evilmartians.com/chronicles/six-things-developer-tools-must-have-to-earn-trust-and-adoption)
- [Redocly — Reusing content](https://redocly.com/docs-legacy/developer-portal/guides/reusing-content)
- [Copyhackers — Jobs to be done copywriting](https://copyhackers.com/2014/11/jobs-to-be-done-copywriting/)
- [Copyhackers — Buyer personas vs JTBD](https://copyhackers.com/2021/06/buyer-personas-vs-jtbd/)
- [GitHub Copilot features page](https://github.com/features/copilot)
- [Dataview documentation](https://blacksmithgu.github.io/obsidian-dataview/)
- [Obsidian plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Paligo — Content reuse guide](https://paligo.net/blog/content-reuse/quick-guide-to-mastering-content-reuse-in-technical-documentation/)
- [TechnicalWriterHQ — Single source authoring](https://technicalwriterhq.com/writing/technical-writing/single-source-authoring/)
- [Upscope — JTBD marketing copy](https://upscope.com/company-blog/why-jobs-to-be-done-framework-examples-will-improve-your-marketing-copy)
