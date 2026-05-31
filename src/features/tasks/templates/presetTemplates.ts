import type { SaveTemplateInput } from './TemplateNoteStore';

const BUG_FIX_BODY = `# {{title}}

## Objective

Diagnose and fix the bug described below.

## Acceptance Criteria

- [ ] Repro confirmed
- [ ] Root cause identified
- [ ] Fix covered by a regression test
- [ ] No unrelated changes

## Context

{{source}}

_Captured {{date}}._

## Constraints

- Do not modify unrelated files.
- Keep direct chat behavior intact.
`;

const FEATURE_BODY = `# {{title}}

## Objective

Build the feature described below.

## Acceptance Criteria

- [ ] Happy path implemented
- [ ] Edge cases listed and handled
- [ ] Tests added (unit + integration where it matters)
- [ ] Docs / manual updated

## Context

{{source}}

## Constraints

- Do not modify unrelated files.
- Keep direct chat behavior intact.
`;

const REFACTOR_BODY = `# {{title}}

## Objective

Refactor the area described below without changing behavior.

## Acceptance Criteria

- [ ] Behavior unchanged (existing tests stay green)
- [ ] Smell named and reduced
- [ ] No new public API surface
- [ ] typecheck + lint clean

## Context

{{source}}

## Constraints

- Do not change observable behavior.
- Do not modify unrelated files.
`;

const RESEARCH_SPIKE_BODY = `# {{title}}

## Objective

Answer the research question below. Time-boxed; output is a written summary, not production code.

## Acceptance Criteria

- [ ] Question stated precisely
- [ ] Options surveyed (with sources)
- [ ] Findings documented
- [ ] Recommendation made

## Context

{{source}}

## Constraints

- No production code changes.
- Cite sources for every claim.
`;

const DOCUMENTATION_BODY = `# {{title}}

## Objective

Document the topic described below.

## Acceptance Criteria

- [ ] Audience identified
- [ ] Outline drafted
- [ ] Examples included where they help
- [ ] Links to related notes added

## Context

{{source}}

## Constraints

- No code changes unless an example requires one.
- Match the project's existing doc style.
`;

const TEST_BACKFILL_BODY = `# {{title}}

## Objective

Backfill tests for the area described below.

## Acceptance Criteria

- [ ] Coverage gaps listed
- [ ] Test cases written (happy + edge)
- [ ] All new tests pass
- [ ] No production code changed unless required to make code testable

## Context

{{source}}

## Constraints

- Do not change production behavior.
- Do not modify unrelated files.
`;

export const PRESET_TEMPLATES: SaveTemplateInput[] = [
  {
    name: 'Bug fix',
    description: 'Reproduce, diagnose, and fix a defect.',
    icon: 'bug',
    priority: '1 - high',
    body: BUG_FIX_BODY,
  },
  {
    name: 'Feature',
    description: 'Ship a new user-facing capability.',
    icon: 'sparkles',
    priority: '2 - normal',
    body: FEATURE_BODY,
  },
  {
    name: 'Refactor',
    description: 'Improve structure without changing behavior.',
    icon: 'wrench',
    priority: '2 - normal',
    body: REFACTOR_BODY,
  },
  {
    name: 'Research spike',
    description: 'Time-boxed investigation, no production code.',
    icon: 'search',
    priority: '2 - normal',
    body: RESEARCH_SPIKE_BODY,
  },
  {
    name: 'Documentation',
    description: 'Add or update documentation.',
    icon: 'book-open',
    priority: '3 - low',
    body: DOCUMENTATION_BODY,
  },
  {
    name: 'Test backfill',
    description: 'Add tests for under-covered code without changing behavior.',
    icon: 'flask-conical',
    priority: '2 - normal',
    body: TEST_BACKFILL_BODY,
  },
];
