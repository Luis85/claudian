export class SearchBar {
  private input!: HTMLInputElement;
  private timer: number | null = null;
  private activeDocument!: Document;

  constructor(private readonly host: HTMLElement, private readonly onChange: (q: string) => void) {}

  render(): void {
    this.activeDocument = this.host.ownerDocument;
    this.host.empty();
    this.input = this.host.createEl('input', {
      attr: { type: 'search', placeholder: 'Search settings…', 'aria-label': 'Search settings' },
    });
    this.input.addEventListener('input', () => this.scheduleEmit());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.input.value = '';
        this.emit();
      }
    });
    this.activeDocument.addEventListener('keydown', this.captureSlash);
  }

  /**
   * `/` focuses the search bar from anywhere in the settings panel — except
   * while the user is typing into another input, so `/` literals still work
   * in textareas, plain inputs, and contenteditable surfaces.
   */
  private captureSlash = (e: KeyboardEvent): void => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const active = this.activeDocument.activeElement;
    if (active === this.input) return;
    if (active instanceof HTMLInputElement) {
      const type = active.type.toLowerCase();
      // Plain text/search/email/etc inputs still need '/'; only steal focus
      // when no text-entry field has focus.
      if (type !== 'checkbox' && type !== 'radio' && type !== 'button') return;
    }
    if (active instanceof HTMLTextAreaElement) return;
    if (active instanceof HTMLElement && active.isContentEditable) return;
    e.preventDefault();
    this.input.focus();
  };

  private scheduleEmit(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.emit();
    }, 120);
  }

  private emit(): void {
    this.onChange(this.input.value.trim());
  }

  dispose(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.activeDocument.removeEventListener('keydown', this.captureSlash);
  }
}
