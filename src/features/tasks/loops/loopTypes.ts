export interface LoopDefinition {
  path: string;
  /** Slug derived from the filename; the value stored in `loop` frontmatter. */
  id: string;
  name: string;
  description?: string;
  icon?: string;
  /** Selection guidance shown in the picker only — never injected at run time. */
  useWhen: string;
  approach: string;
  steps: string;
  verify: string;
  notes: string;
}

export interface SaveLoopInput {
  name: string;
  description?: string;
  icon?: string;
  useWhen: string;
  approach: string;
  steps: string;
  verify: string;
  notes: string;
}
