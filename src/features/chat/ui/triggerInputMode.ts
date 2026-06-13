/**
 * Shared lifecycle for the single-character composer "trigger modes" — bang-bash
 * (`!`) and instruction (`#`). Both managers entered/exited an identical mode:
 * toggle a wrapper CSS class, swap the textarea placeholder, and track an
 * `{ active, raw }` state pair captured from a remembered original placeholder.
 * Only the trigger key, wrapper class, and active-mode placeholder differ, so
 * those are config; the per-mode keydown/submit semantics stay in each manager.
 */
export interface TriggerInputModeConfig {
  /** Single character that activates the mode when typed into an empty input. */
  triggerKey: string;
  /** CSS class toggled on the input wrapper while active. */
  wrapperClass: string;
  /** Placeholder shown while the mode is active. */
  activePlaceholder: string;
}

export class TriggerInputMode {
  private active = false;
  private raw = '';
  private readonly originalPlaceholder: string;

  constructor(
    private readonly inputEl: HTMLTextAreaElement,
    private readonly getInputWrapper: () => HTMLElement | null,
    private readonly config: TriggerInputModeConfig,
  ) {
    this.originalPlaceholder = inputEl.placeholder;
  }

  isActive(): boolean {
    return this.active;
  }

  getRaw(): string {
    return this.raw;
  }

  setRaw(value: string): void {
    this.raw = value;
  }

  /** True when an empty input received the trigger key and the mode is idle. */
  shouldTrigger(e: KeyboardEvent): boolean {
    return !this.active && this.inputEl.value === '' && e.key === this.config.triggerKey;
  }

  /** Enters the mode; returns false (and stays idle) when the wrapper is absent. */
  enter(): boolean {
    const wrapper = this.getInputWrapper();
    if (!wrapper) return false;

    wrapper.addClass(this.config.wrapperClass);
    this.active = true;
    this.raw = '';
    this.inputEl.placeholder = this.config.activePlaceholder;
    return true;
  }

  /** Exits the mode, restoring the wrapper class and original placeholder. */
  exit(): void {
    const wrapper = this.getInputWrapper();
    if (wrapper) {
      wrapper.removeClass(this.config.wrapperClass);
    }
    this.active = false;
    this.raw = '';
    this.inputEl.placeholder = this.originalPlaceholder;
  }
}
