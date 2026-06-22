import type { SaveLoopInput } from './loopTypes';

export const PRESET_LOOPS: SaveLoopInput[] = [
  {
    name: 'Reproduce → fix → verify',
    description: 'Tight bug-fix loop with a verify gate.',
    icon: 'bug',
    useWhen: 'A defect is reproducible and you need a disciplined, minimal fix.',
    approach: 'Reproduce the defect first, isolate the root cause, apply the smallest fix, then prove it with the same check that first failed.',
    steps: '1. Reproduce the defect with a failing check.\n2. Isolate the root cause; state it in one sentence.\n3. Apply the smallest fix that addresses the root cause.\n4. Re-run the check and the surrounding tests.',
    verify: 'The previously failing check now passes and no unrelated tests regress.',
    notes: 'Do not refactor adjacent code in the same loop. If the root cause is unclear after two passes, stop and report what you ruled out.',
  },
  {
    name: 'Characterize → refactor',
    description: 'Refactor safely behind a characterization test.',
    icon: 'wrench',
    useWhen: 'You must change the structure of code that lacks tests, without changing behavior.',
    approach: 'Pin current behavior with a characterization test, refactor in small steps, and keep the test green throughout.',
    steps: '1. Write a characterization test that captures current observable behavior.\n2. Confirm it passes against the unchanged code.\n3. Refactor in small, reversible steps.\n4. Re-run the test after each step.',
    verify: 'The characterization test stays green and no public API changes.',
    notes: 'Commit after each green step so any regression is bisectable.',
  },
  {
    name: 'Research spike',
    description: 'Time-boxed investigation, no production code.',
    icon: 'search',
    useWhen: 'A question must be answered before committing to an approach.',
    approach: 'State the question precisely, survey options against sources, and end with a written recommendation.',
    steps: '1. Restate the question in one sentence.\n2. Survey at least two viable options.\n3. Capture trade-offs with sources.\n4. Recommend one option and say why.',
    verify: 'A written summary exists with a clear recommendation and cited sources.',
    notes: 'No production code changes. Cite every claim.',
  },
  {
    name: 'Test backfill',
    description: 'Add tests for under-covered code without changing behavior.',
    icon: 'flask-conical',
    useWhen: 'A unit has too little coverage and you need a safety net before further change.',
    approach: 'List the coverage gaps, then write happy-path and edge-case tests against the existing behavior.',
    steps: '1. Identify the uncovered branches.\n2. Write happy-path tests first.\n3. Add edge-case and error-path tests.\n4. Run the suite and confirm all new tests pass.',
    verify: 'New tests pass and exercise the previously uncovered branches; no production behavior changed.',
    notes: 'Only touch production code if it is untestable as written, and say so explicitly.',
  },
];
