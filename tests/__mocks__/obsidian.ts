// Mock for Obsidian API

export class Plugin {
  app: any;
  manifest: any;

  constructor(app?: any, manifest?: any) {
    this.app = app;
    this.manifest = manifest;
  }

  addRibbonIcon = jest.fn();
  addCommand = jest.fn();
  addSettingTab = jest.fn();
  registerView = jest.fn();
  registerEvent = jest.fn();
  loadData = jest.fn().mockResolvedValue({});
  saveData = jest.fn().mockResolvedValue(undefined);
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: any = {
    empty: jest.fn(),
    createEl: jest.fn().mockReturnValue({ createEl: jest.fn(), createDiv: jest.fn() }),
    createDiv: jest.fn().mockReturnValue({ createEl: jest.fn(), createDiv: jest.fn() }),
  };

  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
  }

  display() {}
}

export class ItemView {
  app: any;
  leaf: any;
  containerEl: any = {
    children: [{}, { empty: jest.fn(), addClass: jest.fn(), createDiv: jest.fn().mockReturnValue({
      createEl: jest.fn().mockReturnValue({ addEventListener: jest.fn(), setAttribute: jest.fn() }),
      createDiv: jest.fn().mockReturnValue({ createEl: jest.fn().mockReturnValue({ addEventListener: jest.fn() }) }),
    }) }],
  };

  constructor(leaf: any) {
    this.leaf = leaf;
  }

  getViewType(): string {
    return '';
  }

  getDisplayText(): string {
    return '';
  }

  getIcon(): string {
    return '';
  }
}

export class WorkspaceLeaf {}

export class Scope {
  static instances: Scope[] = [];

  parent?: Scope;
  handlers: Array<{
    modifiers: string[] | null;
    key: string | null;
    func: (evt: KeyboardEvent, ctx?: unknown) => false | unknown;
  }> = [];

  constructor(parent?: Scope) {
    this.parent = parent;
    Scope.instances.push(this);
  }

  register = jest.fn((
    modifiers: string[] | null,
    key: string | null,
    func: (evt: KeyboardEvent, ctx?: unknown) => false | unknown
  ) => {
    const handler = { modifiers, key, func };
    this.handlers.push(handler);
    return handler;
  });

  unregister = jest.fn((handler: unknown) => {
    this.handlers = this.handlers.filter((entry) => entry !== handler);
  });
}

export const Platform = {
  isMacOS: true,
};

// Obsidian's debounce returns a debounced version of the callback.
export function debounce<T extends unknown[]>(
  fn: (...args: T) => unknown,
  _wait?: number,
  _immediate?: boolean,
): (...args: T) => void {
  return (...args: T) => fn(...args);
}

export class App {
  vault: any = {
    adapter: {
      basePath: '/mock/vault/path',
    },
    on: jest.fn().mockReturnValue({ id: 'mock-event-ref' }),
  };
  workspace: any = {
    getLeavesOfType: jest.fn().mockReturnValue([]),
    getRightLeaf: jest.fn().mockReturnValue({
      setViewState: jest.fn().mockResolvedValue(undefined),
    }),
    getLeftLeaf: jest.fn().mockReturnValue({
      setViewState: jest.fn().mockResolvedValue(undefined),
    }),
    getLeaf: jest.fn().mockReturnValue({
      setViewState: jest.fn().mockResolvedValue(undefined),
    }),
    setActiveLeaf: jest.fn(),
    revealLeaf: jest.fn(),
    // onLayoutReady runs the callback synchronously in tests so that deferred
    // onload work executes within the same microtask the plugin booted in.
    // Production semantics fire after Obsidian finishes restoring leaves; here
    // there are no leaves to restore, so immediate dispatch is equivalent.
    onLayoutReady: jest.fn((cb: () => void) => cb()),
  };
  // Obsidian 1.11.4+ SecretStorage — in-memory fake (synchronous, dash-cased ids).
  secretStorage: any = (() => {
    const store = new Map<string, string>();
    return {
      setSecret: jest.fn((id: string, secret: string) => { store.set(id, secret); }),
      getSecret: jest.fn((id: string) => (store.has(id) ? store.get(id) : null)),
      listSecrets: jest.fn(() => Array.from(store.keys())),
    };
  })();
}

export class MarkdownView {
  editor: any;
  file?: any;

  constructor(editor?: any, file?: any) {
    this.editor = editor;
    this.file = file;
  }
}

export interface MockToggleComponent {
  value: boolean;
  changeHandler: (v: boolean) => void;
  setValue: (v: boolean) => MockToggleComponent;
  onChange: (fn: (v: boolean) => void) => MockToggleComponent;
}

export interface MockTextComponent {
  value: string;
  placeholder: string;
  changeHandler: (v: string) => void;
  disabled: boolean;
  inputEl: {
    type: string;
    min: string;
    max: string;
    step: string;
    dataset: Record<string, string>;
    addEventListener: jest.Mock;
    removeEventListener: jest.Mock;
  };
  setValue: (v: string) => MockTextComponent;
  setPlaceholder: (v: string) => MockTextComponent;
  setDisabled: (v: boolean) => MockTextComponent;
  onChange: (fn: (v: string) => void) => MockTextComponent;
}

export interface MockDropdownOption {
  value: string;
  label: string;
}

export interface MockDropdownComponent {
  value: string;
  options: MockDropdownOption[];
  changeHandler: (v: string) => void;
  selectEl: { empty: () => void };
  addOption: (value: string, label: string) => MockDropdownComponent;
  setValue: (v: string) => MockDropdownComponent;
  onChange: (fn: (v: string) => void) => MockDropdownComponent;
}

export interface MockButtonComponent {
  buttonText: string;
  clickHandler: () => void | Promise<void>;
  setButtonText: (v: string) => MockButtonComponent;
  onClick: (fn: () => void | Promise<void>) => MockButtonComponent;
}

export type MockSettingComponent =
  | { kind: 'toggle'; props: MockToggleComponent }
  | { kind: 'text'; props: MockTextComponent }
  | { kind: 'textarea'; props: MockTextComponent }
  | { kind: 'dropdown'; props: MockDropdownComponent }
  | { kind: 'button'; props: MockButtonComponent };

function createStubEl(tag: string): any {
  const el: any = {
    tagName: tag.toUpperCase(),
    children: [] as any[],
    textContent: '',
    className: '',
    dataset: {} as Record<string, string>,
    setText(text: string) {
      this.textContent = text;
    },
    empty() {
      this.children = [];
      this.textContent = '';
    },
    addClass(_cls: string) { return this; },
    removeClass(_cls: string) { return this; },
    toggleClass(_cls: string, _on?: boolean) { return this; },
    setAttribute(_k: string, _v: string) { return this; },
    addEventListener() { /* noop */ },
    removeEventListener() { /* noop */ },
    createEl(childTag: string, opts?: { text?: string; cls?: string }) {
      const child = createStubEl(childTag);
      if (opts?.text) child.textContent = opts.text;
      if (opts?.cls) child.className = opts.cls;
      this.children.push(child);
      return child;
    },
    createSpan(opts?: { text?: string; cls?: string }) {
      return this.createEl('span', opts);
    },
    createDiv(opts?: { text?: string; cls?: string }) {
      return this.createEl('div', opts);
    },
  };
  return el;
}

export class Setting {
  static instances: Setting[] = [];

  containerEl: any;
  components: MockSettingComponent[] = [];
  nameEl: any = createStubEl('div');
  descEl: any = createStubEl('div');
  settingEl: any = createStubEl('div');
  controlEl: any = createStubEl('div');

  constructor(containerEl: any) {
    this.containerEl = containerEl;
    Setting.instances.push(this);
  }

  setName = jest.fn().mockReturnThis();
  setDesc = jest.fn().mockReturnThis();
  setHeading = jest.fn().mockReturnThis();
  setClass = jest.fn().mockReturnThis();
  setTooltip = jest.fn().mockReturnThis();
  setDisabled = jest.fn().mockReturnThis();

  addToggle(cb?: (t: MockToggleComponent) => unknown): this {
    const component: MockToggleComponent = {
      value: false,
      changeHandler: () => undefined,
      setValue(v: boolean) {
        this.value = v;
        return this;
      },
      onChange(fn: (v: boolean) => void) {
        this.changeHandler = fn;
        return this;
      },
    };
    this.components.push({ kind: 'toggle', props: component });
    if (cb) cb(component);
    return this;
  }

  addText(cb?: (t: MockTextComponent) => unknown): this {
    const component: MockTextComponent = {
      value: '',
      placeholder: '',
      changeHandler: () => undefined,
      disabled: false,
      inputEl: { type: 'text', min: '', max: '', step: '', dataset: {}, addEventListener: jest.fn(), removeEventListener: jest.fn() },
      setValue(v: string) {
        this.value = v;
        return this;
      },
      setPlaceholder(v: string) {
        this.placeholder = v;
        return this;
      },
      setDisabled(v: boolean) {
        this.disabled = v;
        return this;
      },
      onChange(fn: (v: string) => void) {
        this.changeHandler = fn;
        return this;
      },
    };
    this.components.push({ kind: 'text', props: component });
    if (cb) cb(component);
    return this;
  }

  addTextArea(cb?: (t: MockTextComponent) => unknown): this {
    const component: MockTextComponent = {
      value: '',
      placeholder: '',
      changeHandler: () => undefined,
      disabled: false,
      inputEl: { type: 'textarea', min: '', max: '', step: '', dataset: {}, addEventListener: jest.fn(), removeEventListener: jest.fn() },
      setValue(v: string) {
        this.value = v;
        return this;
      },
      setPlaceholder(v: string) {
        this.placeholder = v;
        return this;
      },
      setDisabled(v: boolean) {
        this.disabled = v;
        return this;
      },
      onChange(fn: (v: string) => void) {
        this.changeHandler = fn;
        return this;
      },
    };
    this.components.push({ kind: 'textarea', props: component });
    if (cb) cb(component);
    return this;
  }

  addDropdown(cb?: (d: MockDropdownComponent) => unknown): this {
    const component: MockDropdownComponent = {
      value: '',
      options: [],
      changeHandler: () => undefined,
      selectEl: { empty: jest.fn() },
      addOption(value: string, label: string) {
        this.options.push({ value, label });
        return this;
      },
      setValue(v: string) {
        this.value = v;
        return this;
      },
      onChange(fn: (v: string) => void) {
        this.changeHandler = fn;
        return this;
      },
    };
    this.components.push({ kind: 'dropdown', props: component });
    if (cb) cb(component);
    return this;
  }

  addButton(cb?: (b: MockButtonComponent) => unknown): this {
    const component: MockButtonComponent = {
      buttonText: '',
      clickHandler: () => undefined,
      setButtonText(v: string) {
        this.buttonText = v;
        return this;
      },
      onClick(fn: () => void | Promise<void>) {
        this.clickHandler = fn;
        return this;
      },
      // Obsidian's ButtonComponent additionally exposes these chainable
      // helpers; tests don't assert on them but the production code calls
      // them and would crash without the stubs.
      setWarning() { return this; },
      setCta() { return this; },
      setClass() { return this; },
      setDisabled(_: boolean) { return this; },
      setIcon(_: string) { return this; },
      setTooltip(_: string) { return this; },
    } as any;
    this.components.push({ kind: 'button', props: component });
    if (cb) cb(component);
    return this;
  }

  addExtraButton(cb?: (b: any) => unknown): this {
    const component: any = {
      icon: '',
      tooltip: '',
      clickHandler: () => undefined,
      setIcon(v: string) { this.icon = v; return this; },
      setTooltip(v: string) { this.tooltip = v; return this; },
      setDisabled(_: boolean) { return this; },
      onClick(fn: () => void) { this.clickHandler = fn; return this; },
    };
    this.components.push({ kind: 'button', props: component });
    if (cb) cb(component);
    return this;
  }

  // Obsidian 1.11.x: attach an arbitrary BaseComponent (e.g. SecretComponent).
  addComponent(cb: (el: any) => unknown): this {
    const host = createStubEl('div');
    const component = cb(host);
    this.components.push({ kind: 'component', props: component } as any);
    return this;
  }
}

// Obsidian 1.11.4+ SecretComponent — minimal mock. Holds the selected secret
// name/id (not the value); `triggerChange` simulates the user picking one.
export class SecretComponent {
  app: any;
  containerEl: any;
  value = '';
  changeHandler: (value: string) => unknown = () => undefined;

  constructor(app: any, containerEl: any) {
    this.app = app;
    this.containerEl = containerEl;
  }

  setValue(value: string): this {
    this.value = value;
    return this;
  }

  onChange(cb: (value: string) => unknown): this {
    this.changeHandler = cb;
    return this;
  }

  triggerChange(value: string): this {
    this.value = value;
    this.changeHandler(value);
    return this;
  }
}

export class TextAreaComponent {
  inputEl: any;
  private _value = '';

  constructor(_container?: any) {
    this.inputEl = {
      addClass: jest.fn(),
      rows: 0,
      placeholder: '',
      focus: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
  }

  setValue(value: string): this {
    this._value = value;
    return this;
  }

  getValue(): string {
    return this._value;
  }
}

function makeStubContentEl(): any {
  function stubEl(): any {
    return {
      createEl: jest.fn().mockImplementation(() => stubEl()),
      createDiv: jest.fn().mockImplementation(() => stubEl()),
      createSpan: jest.fn().mockImplementation(() => stubEl()),
      addEventListener: jest.fn(),
      addClass: jest.fn(),
      setText: jest.fn(),
    };
  }
  return stubEl();
}

export class Component {
  load = jest.fn();
  unload = jest.fn();
  onload(): void {}
  onunload(): void {}
  addChild = jest.fn().mockReturnThis();
  removeChild = jest.fn().mockReturnThis();
  register = jest.fn();
  registerEvent = jest.fn();
  registerDomEvent = jest.fn();
  registerInterval = jest.fn();
}

export class Modal {
  app: any;
  modalEl: any = { addClass: jest.fn(), setAttribute: jest.fn() };
  containerEl: any = makeStubContentEl();
  contentEl: any = makeStubContentEl();
  titleEl: any = makeStubContentEl();

  constructor(app: any) {
    this.app = app;
  }

  open = jest.fn();
  close = jest.fn();
  setTitle = jest.fn().mockReturnThis();
  onOpen(): void {}
  onClose(): void {}
}

export class SuggestModal extends Modal {
  setPlaceholder = jest.fn();
  getSuggestions = jest.fn().mockReturnValue([]);
  renderSuggestion = jest.fn();
  onChooseSuggestion = jest.fn();
}

export class FuzzySuggestModal extends SuggestModal {
  getItems(): any[] {
    return [];
  }
  getItemText(_item: any): string {
    return '';
  }
  onChooseItem(_item: any, _evt?: any): void {}
}

class MockMenuItem {
  title = '';
  icon = '';
  disabled = false;
  clickHandler: (() => void) | null = null;

  setTitle = jest.fn((title: string) => {
    this.title = title;
    return this;
  });

  setIcon = jest.fn((icon: string) => {
    this.icon = icon;
    return this;
  });

  setDisabled = jest.fn((disabled: boolean) => {
    this.disabled = disabled;
    return this;
  });

  onClick = jest.fn((handler: () => void) => {
    this.clickHandler = handler;
    return this;
  });
}

export const MENU_SEPARATOR = Symbol('MenuSeparator');

export class Menu {
  static instances: Menu[] = [];

  // `items` mixes `MockMenuItem` (from `addItem`) and `MENU_SEPARATOR` symbols
  // (from `addSeparator`). Tests that access `items[i]` must handle both — the
  // `WorkOrderContextMenu` suite filters via `entry === MENU_SEPARATOR`. Older
  // tests that only ever call `addItem` (e.g. `ConversationController.test.ts`,
  // `MessageRenderer.test.ts`, `tests/integration/main.test.ts`) narrow `items`
  // to a separator-free shape and stay safe as long as their menu builders do
  // not start calling `addSeparator`. If you add `addSeparator` to one of those
  // menus, update its test's `items` cast at the same time.
  items: Array<MockMenuItem | typeof MENU_SEPARATOR> = [];
  showAtMouseEvent = jest.fn();

  constructor() {
    Menu.instances.push(this);
  }

  addItem(callback: (item: MockMenuItem) => MockMenuItem | void): this {
    const item = new MockMenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }

  addSeparator(): this {
    this.items.push(MENU_SEPARATOR);
    return this;
  }
}

const renderMarkdownMock = jest.fn<Promise<void>, [string, unknown, string, unknown]>().mockResolvedValue(undefined);

export const MarkdownRenderer = {
  render: jest.fn<Promise<void>, [unknown, string, unknown, string, unknown]>(
    (_app, markdown, el, sourcePath, component) => renderMarkdownMock(markdown, el, sourcePath, component),
  ),
  renderMarkdown: renderMarkdownMock,
};

export const setIcon = jest.fn();

// Mirrors Obsidian's real normalizePath: backslashes -> forward slashes,
// collapse duplicate slashes, trim surrounding whitespace and leading/trailing
// slashes. Kept faithful so storage-path tests can assert normalization.
export function normalizePath(path: string): string {
  let result = path.replace(/([\\/])+/g, '/').trim();
  result = result.replace(/(^\/+|\/+$)/g, '');
  return result === '' ? '/' : result;
}

// Notice mock that tracks constructor calls
export const Notice = jest.fn().mockImplementation((_message: string, _timeout?: number) => {});

function unquoteYaml(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseYamlValue(rawValue: string): unknown {
  if (!rawValue) return null;

  if (rawValue.startsWith('{') && rawValue.endsWith('}')) {
    try { return JSON.parse(rawValue); } catch { /* fall through */ }
  }

  if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
    return rawValue.slice(1, -1).split(',').map(item => unquoteYaml(item.trim())).filter(Boolean);
  }

  if (rawValue === 'true' || rawValue === 'false') {
    return rawValue === 'true';
  }

  const numberValue = Number(rawValue);
  if (!Number.isNaN(numberValue) && rawValue !== '') {
    return numberValue;
  }

  return unquoteYaml(rawValue);
}

export function parseYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split(/\r?\n/);
  let currentArrayKey: string | null = null;
  let currentArray: string[] = [];
  let blockScalarKey: string | null = null;
  let blockScalarStyle: 'literal' | 'folded' | null = null;
  let blockScalarLines: string[] = [];
  let blockScalarIndent: number | null = null;

  const flushArray = () => {
    if (currentArrayKey) {
      result[currentArrayKey] = currentArray;
      currentArrayKey = null;
      currentArray = [];
    }
  };

  const flushBlockScalar = () => {
    if (!blockScalarKey) return;
    let value: string;
    if (blockScalarStyle === 'literal') {
      value = blockScalarLines.join('\n');
    } else {
      value = blockScalarLines.join('\n').replace(/(?<!\n)\n(?!\n)/g, ' ').trim();
    }
    result[blockScalarKey] = value;
    blockScalarKey = null;
    blockScalarStyle = null;
    blockScalarLines = [];
    blockScalarIndent = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Handle block scalar content
    if (blockScalarKey) {
      if (trimmed === '') {
        blockScalarLines.push('');
        continue;
      }
      const leadingSpaces = line.match(/^(\s*)/)?.[1].length ?? 0;
      if (blockScalarIndent === null) {
        if (leadingSpaces === 0) {
          flushBlockScalar();
          // fall through to process this line
        } else {
          blockScalarIndent = leadingSpaces;
          blockScalarLines.push(line.slice(blockScalarIndent));
          continue;
        }
      } else if (leadingSpaces >= blockScalarIndent) {
        blockScalarLines.push(line.slice(blockScalarIndent));
        continue;
      } else {
        flushBlockScalar();
        // fall through
      }
    }

    // Handle YAML list items (- value)
    if (currentArrayKey && trimmed.startsWith('- ')) {
      currentArray.push(unquoteYaml(trimmed.slice(2).trim()));
      continue;
    }

    // Not a list item — flush any pending array
    if (currentArrayKey && trimmed !== '') {
      flushArray();
    }

    if (!trimmed) continue;

    const match = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1].trim();
    const rawValue = match[2].trim();
    if (!key) continue;

    // Check for block scalar indicator (| or >) with optional chomping
    const blockMatch = rawValue.match(/^([|>])([+-])?$/);
    if (blockMatch) {
      blockScalarKey = key;
      blockScalarStyle = blockMatch[1] === '|' ? 'literal' : 'folded';
      blockScalarLines = [];
      blockScalarIndent = null;
      continue;
    }

    if (!rawValue) {
      // Could be start of a YAML list or a null value — peek ahead
      currentArrayKey = key;
      currentArray = [];
      continue;
    }

    result[key] = parseYamlValue(rawValue);
  }

  if (blockScalarKey) flushBlockScalar();
  flushArray();

  return result;
}

// TFile class for instanceof checks
export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;

  constructor(path: string = '') {
    this.path = path;
    this.name = path.split('/').pop() || '';
    this.basename = this.name.replace(/\.[^.]+$/, '');
    this.extension = this.name.split('.').pop() || '';
  }
}

export class TFolder {
  path: string;
  name: string;
  children: any[] = [];

  constructor(path: string = '') {
    this.path = path;
    this.name = path.split('/').pop() || '';
  }
}

/**
 * Minimal stand-in for Obsidian's filesystem adapter. Production code does
 * `adapter instanceof FileSystemAdapter` to take a Node `fs` fast path; the
 * mock returns the same relative path so `getAbsolutePath()` callers receive
 * a deterministic value in tests.
 */
export class FileSystemAdapter {
  getFullPath(relativePath: string): string {
    return relativePath;
  }
}
