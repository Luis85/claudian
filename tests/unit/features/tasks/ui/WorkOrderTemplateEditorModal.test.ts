// Mock LucideIconPicker so it doesn't need a real DOM (the Obsidian mock stubs
// lack setAttr, which the real picker calls on elements it creates).
jest.mock('../../../../../src/shared/components/LucideIconPicker', () => {
  const destroy = jest.fn();
  const MockLucideIconPicker = jest.fn().mockImplementation(() => ({ destroy }));
  return { LucideIconPicker: MockLucideIconPicker };
});

// ProviderRegistry — only getRegisteredProviderIds, isEnabled, and getChatUIConfig
// are called by WorkOrderTemplateEditorModal.
jest.mock('../../../../../src/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    getRegisteredProviderIds: jest.fn().mockReturnValue(['claude', 'codex']),
    isEnabled: jest.fn().mockReturnValue(true),
    getChatUIConfig: jest.fn().mockReturnValue({
      getModelOptions: jest.fn().mockReturnValue([
        { value: 'claude-opus-4', label: 'Claude Opus 4' },
        { value: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
      ]),
    }),
  },
}));

// LoopNoteStore.list — called asynchronously by populateLoopOptions.
jest.mock('../../../../../src/features/tasks/loops/LoopNoteStore', () => ({
  LoopNoteStore: jest.fn().mockImplementation(() => ({
    list: jest.fn().mockResolvedValue({
      loops: [
        { id: 'my-loop', name: 'My Loop', path: 'Agent Board/loops/my-loop.md', useWhen: '', approach: '', steps: '', verify: '', notes: '' },
      ],
    }),
  })),
}));

import { Notice, Setting } from 'obsidian';

import type { WorkOrderTemplate } from '../../../../../src/features/tasks/templates/templateTypes';
import { WorkOrderTemplateEditorModal } from '../../../../../src/features/tasks/ui/WorkOrderTemplateEditorModal';

// The mock Setting tracks all instances in a static array.
type MockSetting = InstanceType<typeof Setting> & {
  components: {
    kind: string;
    props: {
      buttonText?: string;
      clickHandler?: () => void | Promise<void>;
      value?: string;
      changeHandler?: (v: string) => void;
      disabled?: boolean;
      options?: Array<{ value: string; label: string }>;
    };
  }[];
};
const settingInstances = (): MockSetting[] =>
  (Setting as unknown as { instances: MockSetting[] }).instances;

const mockApp: any = {};

function makePlugin(): any {
  return {
    settings: {
      agentBoardLoopFolder: 'Agent Board/loops',
      providerConfigs: {
        claude: { enabled: true },
        codex: { enabled: true },
      },
    },
    app: {
      vault: {
        getMarkdownFiles: () => [],
        read: jest.fn().mockResolvedValue(''),
      },
    },
  };
}

// Patch contentEl.empty so onClose does not throw.
function patchContentElEmpty(modal: WorkOrderTemplateEditorModal): void {
  const contentEl = (modal as unknown as { contentEl: any }).contentEl;
  if (!contentEl.empty || typeof contentEl.empty !== 'function') {
    contentEl.empty = jest.fn();
  }
}

// Also patch modelDropdownContainer.empty since renderModelDropdown calls it.
// The Setting.controlEl stub (createStubEl) already has empty(), so this should
// be fine — but we patch just in case.
function patchControlElEmpty(modal: WorkOrderTemplateEditorModal): void {
  const mdContainer = (modal as unknown as { modelDropdownContainer: any }).modelDropdownContainer;
  if (mdContainer && (!mdContainer.empty || typeof mdContainer.empty !== 'function')) {
    mdContainer.empty = jest.fn();
  }
}

function buttonComponents(): Array<{ buttonText: string; clickHandler: () => void | Promise<void> }> {
  return settingInstances()
    .flatMap((s) => s.components)
    .filter((c) => c.kind === 'button')
    .map((c) => c.props as { buttonText: string; clickHandler: () => void | Promise<void> });
}

function textareaComponents(): Array<{ value: string; changeHandler: (v: string) => void }> {
  return settingInstances()
    .flatMap((s) => s.components)
    .filter((c) => c.kind === 'textarea')
    .map((c) => c.props as { value: string; changeHandler: (v: string) => void });
}

function textComponents(): Array<{ value: string; disabled?: boolean; changeHandler: (v: string) => void }> {
  return settingInstances()
    .flatMap((s) => s.components)
    .filter((c) => c.kind === 'text')
    .map((c) => c.props as { value: string; disabled?: boolean; changeHandler: (v: string) => void });
}

function dropdownComponents(): Array<{
  value: string;
  options: Array<{ value: string; label: string }>;
  changeHandler: (v: string) => void;
}> {
  return settingInstances()
    .flatMap((s) => s.components)
    .filter((c) => c.kind === 'dropdown')
    .map((c) => c.props as { value: string; options: Array<{ value: string; label: string }>; changeHandler: (v: string) => void });
}

function makeExistingTemplate(): WorkOrderTemplate {
  return {
    path: 'Agent Board/templates/bug-fix.md',
    name: 'bug-fix',
    description: 'Fix a bug',
    icon: 'bug',
    provider: 'claude',
    model: 'claude-sonnet-4',
    priority: '1 - high',
    loop: 'my-loop',
    body: '# {{title}}\n\n## Objective\n\nFix the bug.',
  };
}

beforeEach(() => {
  (Setting as unknown as { instances: unknown[] }).instances = [];
  (Notice as jest.Mock).mockClear();
});

describe('WorkOrderTemplateEditorModal — new mode (existing = null)', () => {
  it('sets a non-empty title on open', () => {
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, jest.fn());
    modal.onOpen();
    expect(modal.setTitle).toHaveBeenCalledWith(expect.any(String));
    const title = (modal.setTitle as jest.Mock).mock.calls[0][0] as string;
    expect(title.length).toBeGreaterThan(0);
  });

  it('renders a text component for the name field', () => {
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, jest.fn());
    modal.onOpen();
    expect(textComponents().length).toBeGreaterThanOrEqual(1);
  });

  it('renders a textarea component for the body field', () => {
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, jest.fn());
    modal.onOpen();
    expect(textareaComponents().length).toBeGreaterThanOrEqual(1);
  });

  it('renders save and cancel buttons', () => {
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, jest.fn());
    modal.onOpen();
    expect(buttonComponents().length).toBeGreaterThanOrEqual(2);
  });

  it('renders dropdown components for provider and priority', () => {
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, jest.fn());
    modal.onOpen();
    // Provider dropdown + Priority dropdown
    expect(dropdownComponents().length).toBeGreaterThanOrEqual(2);
  });

  it('provider dropdown includes the enabled provider ids', () => {
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, jest.fn());
    modal.onOpen();
    const dropdowns = dropdownComponents();
    // First dropdown is provider
    const providerDropdown = dropdowns[0];
    const values = providerDropdown.options.map((o) => o.value);
    // Should include empty default + 'claude' + 'codex'
    expect(values).toContain('');
    expect(values).toContain('claude');
    expect(values).toContain('codex');
  });

  it('uses different titles in new vs edit mode', () => {
    const newModal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, jest.fn());
    newModal.onOpen();
    const newTitle = (newModal.setTitle as jest.Mock).mock.calls[0][0] as string;

    (Setting as unknown as { instances: unknown[] }).instances = [];
    const editModal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), makeExistingTemplate(), jest.fn());
    editModal.onOpen();
    const editTitle = (editModal.setTitle as jest.Mock).mock.calls[0][0] as string;

    expect(newTitle).not.toBe(editTitle);
  });

  it('onClose does not throw', () => {
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, jest.fn());
    patchContentElEmpty(modal);
    modal.onOpen();
    patchControlElEmpty(modal);
    expect(() => modal.onClose()).not.toThrow();
  });

  it('onClose without prior onOpen does not throw', () => {
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, jest.fn());
    patchContentElEmpty(modal);
    expect(() => modal.onClose()).not.toThrow();
  });
});

describe('WorkOrderTemplateEditorModal — edit mode (existing defined)', () => {
  it('name field is disabled in edit mode', () => {
    const existing = makeExistingTemplate();
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), existing, jest.fn());
    modal.onOpen();

    const texts = textComponents();
    const nameField = texts.find((c) => c.value === existing.name);
    expect(nameField).toBeDefined();
    expect(nameField!.disabled).toBe(true);
  });

  it('prefills body textarea with existing body', () => {
    const existing = makeExistingTemplate();
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), existing, jest.fn());
    modal.onOpen();

    const areas = textareaComponents();
    const bodyField = areas.find((a) => a.value === existing.body);
    expect(bodyField).toBeDefined();
  });

  it('prefills the description text field with existing description', () => {
    const existing = makeExistingTemplate();
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), existing, jest.fn());
    modal.onOpen();

    const texts = textComponents();
    const descField = texts.find((c) => c.value === existing.description);
    expect(descField).toBeDefined();
  });

  it('sets the provider dropdown value from existing provider', () => {
    const existing = makeExistingTemplate();
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), existing, jest.fn());
    modal.onOpen();

    const dropdowns = dropdownComponents();
    const providerDropdown = dropdowns[0];
    expect(providerDropdown.value).toBe('claude');
  });

  it('sets the priority dropdown value from existing priority', () => {
    const existing = makeExistingTemplate();
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), existing, jest.fn());
    modal.onOpen();

    const dropdowns = dropdownComponents();
    // Second dropdown is priority
    const priorityDropdown = dropdowns[1];
    expect(priorityDropdown.value).toBe('1 - high');
  });

  it('onClose destroys the icon picker and does not throw', () => {
    const { LucideIconPicker } = jest.requireMock(
      '../../../../../src/shared/components/LucideIconPicker',
    ) as { LucideIconPicker: jest.Mock };
    LucideIconPicker.mockClear();
    const destroyMock = jest.fn();
    LucideIconPicker.mockImplementationOnce(() => ({ destroy: destroyMock }));

    const existing = makeExistingTemplate();
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), existing, jest.fn());
    patchContentElEmpty(modal);
    modal.onOpen();
    patchControlElEmpty(modal);
    modal.onClose();

    expect(destroyMock).toHaveBeenCalledTimes(1);
  });
});

describe('WorkOrderTemplateEditorModal — handleSave validation', () => {
  function getSaveButton() {
    return buttonComponents()[0];
  }

  it('calls Notice and does not call onSave when name is empty', async () => {
    const onSave = jest.fn();
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, onSave);
    modal.onOpen();

    // Body has a default value; leave name empty
    await getSaveButton().clickHandler();

    expect(Notice).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls Notice and does not call onSave when body is empty', async () => {
    const onSave = jest.fn();
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, onSave);
    modal.onOpen();

    // Set name but clear body
    textComponents()[0]?.changeHandler('My Template');
    textareaComponents()[0]?.changeHandler('');

    await getSaveButton().clickHandler();

    expect(Notice).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onSave with trimmed name and body', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, onSave);
    modal.onOpen();

    textComponents()[0]?.changeHandler('  My Template  ');
    // Body has a non-empty default; that's sufficient to pass validation.

    await getSaveButton().clickHandler();

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.name).toBe('My Template');
    expect(typeof payload.body).toBe('string');
    expect(payload.body.length).toBeGreaterThan(0);
  });

  it('includes originalPath in payload when editing an existing template', async () => {
    const existing = makeExistingTemplate();
    const onSave = jest.fn().mockResolvedValue(undefined);
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), existing, onSave);
    modal.onOpen();

    // existing has a valid name and body — save should succeed
    await getSaveButton().clickHandler();

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.originalPath).toBe(existing.path);
  });

  it('originalPath is undefined when creating a new template', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, onSave);
    modal.onOpen();

    textComponents()[0]?.changeHandler('New Template');

    await getSaveButton().clickHandler();

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.originalPath).toBeUndefined();
  });

  it('empty description resolves to undefined in payload', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, onSave);
    modal.onOpen();

    textComponents()[0]?.changeHandler('Template');
    // description is textComponents()[1] (second text component)
    textComponents()[1]?.changeHandler('');

    await getSaveButton().clickHandler();

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.description).toBeUndefined();
  });

  it('shows a Notice and does not rethrow when onSave throws', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('disk full'));
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, onSave);
    modal.onOpen();

    textComponents()[0]?.changeHandler('Valid Template');

    await getSaveButton().clickHandler();

    expect(Notice).toHaveBeenCalledTimes(1);
    expect((Notice as jest.Mock).mock.calls[0][0]).toContain('disk full');
  });

  it('calls modal.close() after a successful save', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, onSave);
    modal.onOpen();

    textComponents()[0]?.changeHandler('My Template');

    await getSaveButton().clickHandler();

    expect((modal.close as jest.Mock)).toHaveBeenCalled();
  });

  it('cancel button calls modal.close() without triggering onSave', () => {
    const onSave = jest.fn();
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, onSave);
    modal.onOpen();

    // Cancel is the second button
    const cancelBtn = buttonComponents()[1];
    expect(cancelBtn).toBeDefined();
    cancelBtn.clickHandler?.();

    expect(onSave).not.toHaveBeenCalled();
    expect((modal.close as jest.Mock)).toHaveBeenCalled();
  });

  it('changing the provider dropdown updates model dropdown via renderModelDropdown', () => {
    const modal = new WorkOrderTemplateEditorModal(mockApp, makePlugin(), null, jest.fn());
    modal.onOpen();

    const dropdowns = dropdownComponents();
    const providerDropdown = dropdowns[0];
    // Simulate provider change
    expect(() => providerDropdown.changeHandler('claude')).not.toThrow();
  });
});
