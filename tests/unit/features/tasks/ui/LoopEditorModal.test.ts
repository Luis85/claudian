// Mock LucideIconPicker so it doesn't need a real DOM (the Obsidian mock stubs
// lack setAttr, which the real picker calls on elements it creates).
jest.mock('../../../../../src/shared/components/LucideIconPicker', () => {
  const destroy = jest.fn();
  const MockLucideIconPicker = jest.fn().mockImplementation(() => ({ destroy }));
  return { LucideIconPicker: MockLucideIconPicker };
});

import { Notice, Setting } from 'obsidian';

import { LoopEditorModal } from '../../../../../src/features/tasks/ui/LoopEditorModal';
import type { LoopDefinition } from '../../../../../src/features/tasks/loops/loopTypes';

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
    };
  }[];
};
const settingInstances = (): MockSetting[] =>
  (Setting as unknown as { instances: MockSetting[] }).instances;

const mockApp: any = {};

// The Obsidian mock's contentEl stub (makeStubContentEl) doesn't include .empty().
// Patch it so onClose → contentEl.empty() succeeds.
function patchContentElEmpty(modal: LoopEditorModal): void {
  const contentEl = (modal as unknown as { contentEl: any }).contentEl;
  if (!contentEl.empty || typeof contentEl.empty !== 'function') {
    contentEl.empty = jest.fn();
  }
}

beforeEach(() => {
  (Setting as unknown as { instances: unknown[] }).instances = [];
  (Notice as jest.Mock).mockClear();
});

function makeExisting(): LoopDefinition {
  return {
    path: 'Agent Board/loops/my-loop.md',
    id: 'my-loop',
    name: 'My Loop',
    description: 'A test loop',
    icon: 'repeat',
    useWhen: 'A scenario.',
    approach: 'Do the thing.',
    steps: '1. Step one.',
    verify: 'It works.',
    notes: 'See wiki.',
  };
}

// Retrieve all button components from Setting instances.
function buttonComponents(): Array<{ buttonText: string; clickHandler: () => void | Promise<void> }> {
  return settingInstances()
    .flatMap((s) => s.components)
    .filter((c) => c.kind === 'button')
    .map((c) => c.props as { buttonText: string; clickHandler: () => void | Promise<void> });
}

// Retrieve all textarea components from Setting instances.
function textareaComponents(): Array<{ value: string; changeHandler: (v: string) => void }> {
  return settingInstances()
    .flatMap((s) => s.components)
    .filter((c) => c.kind === 'textarea')
    .map((c) => c.props as { value: string; changeHandler: (v: string) => void });
}

// Retrieve all text (non-area) components from Setting instances.
function textComponents(): Array<{ value: string; disabled?: boolean; changeHandler: (v: string) => void }> {
  return settingInstances()
    .flatMap((s) => s.components)
    .filter((c) => c.kind === 'text')
    .map((c) => c.props as { value: string; disabled?: boolean; changeHandler: (v: string) => void });
}

describe('LoopEditorModal — new mode (existing = null)', () => {
  it('sets a non-empty title on open', () => {
    const modal = new LoopEditorModal(mockApp, null, jest.fn());
    modal.onOpen();
    expect(modal.setTitle).toHaveBeenCalledWith(expect.any(String));
    const newTitle = (modal.setTitle as jest.Mock).mock.calls[0][0] as string;
    expect(newTitle.length).toBeGreaterThan(0);
  });

  it('renders at least five textarea components (useWhen, approach, steps, verify, notes)', () => {
    const modal = new LoopEditorModal(mockApp, null, jest.fn());
    modal.onOpen();
    expect(textareaComponents().length).toBeGreaterThanOrEqual(5);
  });

  it('uses a different title in new vs edit mode', () => {
    const newModal = new LoopEditorModal(mockApp, null, jest.fn());
    newModal.onOpen();
    const newTitle = (newModal.setTitle as jest.Mock).mock.calls[0][0] as string;

    (Setting as unknown as { instances: unknown[] }).instances = [];
    const editModal = new LoopEditorModal(mockApp, makeExisting(), jest.fn());
    editModal.onOpen();
    const editTitle = (editModal.setTitle as jest.Mock).mock.calls[0][0] as string;

    expect(newTitle).not.toBe(editTitle);
  });

  it('renders a save button and a cancel button', () => {
    const modal = new LoopEditorModal(mockApp, null, jest.fn());
    modal.onOpen();
    const buttons = buttonComponents();
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('onClose does not throw (icon picker teardown path)', () => {
    const modal = new LoopEditorModal(mockApp, null, jest.fn());
    patchContentElEmpty(modal);
    modal.onOpen();
    expect(() => modal.onClose()).not.toThrow();
  });
});

describe('LoopEditorModal — edit mode (existing defined)', () => {
  it('prefills the name text field (disabled) with the existing name', () => {
    const existing = makeExisting();
    const modal = new LoopEditorModal(mockApp, existing, jest.fn());
    modal.onOpen();

    const texts = textComponents();
    const nameField = texts.find((c) => c.value === existing.name);
    expect(nameField).toBeDefined();
    expect(nameField!.disabled).toBe(true);
  });

  it('prefills all textarea fields from the existing definition', () => {
    const existing = makeExisting();
    const modal = new LoopEditorModal(mockApp, existing, jest.fn());
    modal.onOpen();

    const areaValues = textareaComponents().map((a) => a.value);
    expect(areaValues).toContain(existing.approach);
    expect(areaValues).toContain(existing.steps);
    expect(areaValues).toContain(existing.verify);
    expect(areaValues).toContain(existing.notes);
    expect(areaValues).toContain(existing.useWhen);
  });

  it('onClose does not throw in edit mode (icon picker teardown)', () => {
    const modal = new LoopEditorModal(mockApp, makeExisting(), jest.fn());
    patchContentElEmpty(modal);
    modal.onOpen();
    expect(() => modal.onClose()).not.toThrow();
  });
});

describe('LoopEditorModal — handleSave validation', () => {
  // The save button is the first button rendered by onOpen (index 0).
  function getSaveButton() {
    return buttonComponents()[0];
  }

  it('calls Notice and does not call onSave when name is empty', async () => {
    const onSave = jest.fn();
    const modal = new LoopEditorModal(mockApp, null, onSave);
    modal.onOpen();

    // Provide approach content but leave name empty
    textareaComponents()[1]?.changeHandler('Do the approach.');

    await getSaveButton().clickHandler();

    expect(Notice).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls Notice and does not call onSave when both approach and steps are empty', async () => {
    const onSave = jest.fn();
    const modal = new LoopEditorModal(mockApp, null, onSave);
    modal.onOpen();

    // Set name so name validation passes
    textComponents()[0]?.changeHandler('Some Loop Name');
    // Leave approach (index 1) and steps (index 2) as '' (default)

    await getSaveButton().clickHandler();

    expect(Notice).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onSave with trimmed payload for a valid new loop (approach only)', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const modal = new LoopEditorModal(mockApp, null, onSave);
    modal.onOpen();

    textComponents()[0]?.changeHandler('  My New Loop  ');
    // approach is textarea index 1 (after useWhen=0)
    textareaComponents()[1]?.changeHandler('  Do the thing.  ');

    await getSaveButton().clickHandler();

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.name).toBe('My New Loop');
    expect(payload.approach).toBe('Do the thing.');
    expect(payload.originalPath).toBeUndefined();
  });

  it('accepts steps alone (without approach) as valid body content', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const modal = new LoopEditorModal(mockApp, null, onSave);
    modal.onOpen();

    textComponents()[0]?.changeHandler('Loop Name');
    // steps is textarea index 2
    textareaComponents()[2]?.changeHandler('1. Do step.');

    await getSaveButton().clickHandler();

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.name).toBe('Loop Name');
    expect(payload.steps).toBe('1. Do step.');
  });

  it('includes originalPath in payload when editing an existing loop', async () => {
    const existing = makeExisting();
    const onSave = jest.fn().mockResolvedValue(undefined);
    const modal = new LoopEditorModal(mockApp, existing, onSave);
    modal.onOpen();

    // existing.approach is pre-filled and non-empty — save should succeed
    await getSaveButton().clickHandler();

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.originalPath).toBe(existing.path);
    expect(payload.name).toBe(existing.name);
  });

  it('resolves empty description and icon strings to undefined in the payload', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const modal = new LoopEditorModal(mockApp, null, onSave);
    modal.onOpen();

    textComponents()[0]?.changeHandler('Loop Without Extras');
    textComponents()[1]?.changeHandler('');  // description → empty
    textareaComponents()[1]?.changeHandler('Do the approach.');

    await getSaveButton().clickHandler();

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.description).toBeUndefined();
    expect(payload.icon).toBeUndefined();
  });

  it('shows a Notice and does not rethrow when onSave throws', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('write failed'));
    const modal = new LoopEditorModal(mockApp, null, onSave);
    modal.onOpen();

    textComponents()[0]?.changeHandler('Valid Loop');
    textareaComponents()[1]?.changeHandler('Approach content');

    await getSaveButton().clickHandler();

    expect(Notice).toHaveBeenCalledTimes(1);
    expect((Notice as jest.Mock).mock.calls[0][0]).toContain('write failed');
  });

  it('calls modal.close() after a successful save', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const modal = new LoopEditorModal(mockApp, null, onSave);
    modal.onOpen();

    textComponents()[0]?.changeHandler('My Loop');
    textareaComponents()[1]?.changeHandler('Approach here');

    await getSaveButton().clickHandler();

    expect((modal.close as jest.Mock)).toHaveBeenCalled();
  });

  it('cancel button calls modal.close() without triggering onSave', () => {
    const onSave = jest.fn();
    const modal = new LoopEditorModal(mockApp, null, onSave);
    modal.onOpen();

    // Cancel is the second button (index 1)
    const cancelBtn = buttonComponents()[1];
    expect(cancelBtn).toBeDefined();
    cancelBtn.clickHandler?.();

    expect(onSave).not.toHaveBeenCalled();
    expect((modal.close as jest.Mock)).toHaveBeenCalled();
  });
});

describe('LoopEditorModal — onClose cleanup', () => {
  it('can open then close without throwing', () => {
    const modal = new LoopEditorModal(mockApp, null, jest.fn());
    patchContentElEmpty(modal);
    modal.onOpen();
    expect(() => modal.onClose()).not.toThrow();
  });

  it('onClose without prior onOpen does not throw (iconPicker is null)', () => {
    const modal = new LoopEditorModal(mockApp, null, jest.fn());
    patchContentElEmpty(modal);
    expect(() => modal.onClose()).not.toThrow();
  });

  it('destroys the icon picker on close', () => {
    const { LucideIconPicker } = jest.requireMock(
      '../../../../../src/shared/components/LucideIconPicker',
    ) as { LucideIconPicker: jest.Mock };

    LucideIconPicker.mockClear();
    const destroyMock = jest.fn();
    LucideIconPicker.mockImplementationOnce(() => ({ destroy: destroyMock }));

    const modal = new LoopEditorModal(mockApp, null, jest.fn());
    patchContentElEmpty(modal);
    modal.onOpen();
    modal.onClose();

    expect(destroyMock).toHaveBeenCalledTimes(1);
  });
});
