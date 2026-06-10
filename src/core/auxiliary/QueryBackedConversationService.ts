import type { AuxQueryRunner } from './AuxQueryRunner';

/**
 * Shared lifecycle for aux services that hold a resettable, cancellable
 * conversation over an {@link AuxQueryRunner} (inline edit, instruction refine).
 */
export abstract class QueryBackedConversationService {
  protected abortController: AbortController | null = null;
  protected hasConversation = false;
  protected modelOverride: string | undefined;

  constructor(protected readonly runner: AuxQueryRunner) {}

  setModelOverride(model?: string): void {
    const trimmed = model?.trim();
    this.modelOverride = trimmed ? trimmed : undefined;
  }

  resetConversation(): void {
    this.runner.reset();
    this.hasConversation = false;
  }

  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}
