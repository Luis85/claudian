export class SearchBar {
  private input!: HTMLInputElement;
  private timer: number | null = null;
  private activeDocument!: Document;

  constructor(private readonly host: HTMLElement, private readonly onChange: (q: string) => void) {}

  render(): void {
    this.activeDocument = this.host.ownerDocument;
    this.host.empty();
    this.input = this.host.createEl('input', {
      attr: { type: 'search', placeholder: 'Search settings…' },
    });
    this.input.addEventListener('input', () => this.scheduleEmit());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.input.value = '';
        this.emit();
      }
    });
    this.activeDocument.addEventListener('keydown', this.captureSlash);
  }

  private captureSlash = (e: KeyboardEvent): void => {
    if (e.key === '/' && this.activeDocument.activeElement !== this.input) {
      e.preventDefault();
      this.input.focus();
    }
  };

  private scheduleEmit(): void {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.emit(), 120);
  }

  private emit(): void {
    this.onChange(this.input.value.trim());
  }

  dispose(): void {
    this.activeDocument.removeEventListener('keydown', this.captureSlash);
  }
}
