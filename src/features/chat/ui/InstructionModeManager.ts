import { TriggerInputMode } from './triggerInputMode';

export interface InstructionModeCallbacks {
  onSubmit: (rawInstruction: string) => Promise<void>;
  getInputWrapper: () => HTMLElement | null;
  resetInputHeight?: () => void;
}

const INSTRUCTION_MODE_PLACEHOLDER = '# Save in custom system prompt';

export class InstructionModeManager {
  private inputEl: HTMLTextAreaElement;
  private callbacks: InstructionModeCallbacks;
  private mode: TriggerInputMode;
  private isSubmitting = false;

  constructor(
    inputEl: HTMLTextAreaElement,
    callbacks: InstructionModeCallbacks
  ) {
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    this.mode = new TriggerInputMode(inputEl, callbacks.getInputWrapper, {
      triggerKey: '#',
      wrapperClass: 'specorator-input-instruction-mode',
      activePlaceholder: INSTRUCTION_MODE_PLACEHOLDER,
    });
  }

  /**
   * Handles keydown to detect # trigger.
   * Returns true if the event was consumed (should prevent default).
   */
  handleTriggerKey(e: KeyboardEvent): boolean {
    // Only trigger on # keystroke when input is empty and not already in mode
    if (this.mode.shouldTrigger(e)) {
      if (this.mode.enter()) {
        e.preventDefault();
        return true;
      }
    }
    return false;
  }

  /** Handles input changes to track instruction text. */
  handleInputChange(): void {
    if (!this.mode.isActive()) return;

    const text = this.inputEl.value;
    if (text === '') {
      // Clearing the field exits instruction mode (unlike bang-bash, which stays
      // active so the user can re-type a command).
      this.mode.exit();
    } else {
      this.mode.setRaw(text);
    }
  }

  /** Handles keydown events. Returns true if handled. */
  handleKeydown(e: KeyboardEvent): boolean {
    if (!this.mode.isActive()) return false;

    // Check !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      // Don't handle if instruction is empty
      if (!this.mode.getRaw().trim()) {
        return false;
      }

      e.preventDefault();
      void this.submit();
      return true;
    }

    // Check !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
    if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      this.cancel();
      return true;
    }

    return false;
  }

  /** Checks if instruction mode is active. */
  isActive(): boolean {
    return this.mode.isActive();
  }

  /** Gets the current raw instruction text. */
  getRawInstruction(): string {
    return this.mode.getRaw();
  }

  /** Submits the instruction for refinement. */
  private async submit(): Promise<void> {
    if (this.isSubmitting) return;

    const rawInstruction = this.mode.getRaw().trim();
    if (!rawInstruction) return;

    this.isSubmitting = true;

    try {
      await this.callbacks.onSubmit(rawInstruction);
    } finally {
      this.isSubmitting = false;
    }
  }

  /** Cancels instruction mode and clears input. */
  private cancel(): void {
    this.inputEl.value = '';
    this.mode.exit();
    this.callbacks.resetInputHeight?.();
  }

  /** Clears the input and resets state (called after successful submission). */
  clear(): void {
    this.inputEl.value = '';
    this.mode.exit();
    this.callbacks.resetInputHeight?.();
  }

  /** Cleans up event listeners. */
  destroy(): void {
    this.mode.exit();
  }
}
