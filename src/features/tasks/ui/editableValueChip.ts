import { setIcon } from 'obsidian';

export interface EditableValueChipOption {
  value: string;
  label: string;
}

export interface EditableValueChipOptions {
  /** Cell the chip is appended into. */
  parent: HTMLElement;
  /** Currently selected option value. */
  value: string;
  /** Picker options (excluding the optional leading empty option). */
  options: EditableValueChipOption[];
  /** Optional leading option, e.g. `{ value: '', label: 'Provider default' }`. */
  emptyOption?: EditableValueChipOption;
  /** Fired with the newly selected value when the user picks an option. */
  onChange: (value: string) => void;
}

export interface EditableValueChipHandle {
  /** The chip wrapper element. */
  el: HTMLElement;
  /** The transparent native picker overlaying the chip. */
  selectEl: HTMLSelectElement;
  /**
   * Repopulate the picker and reset the visible label. Used by dependent
   * fields (e.g. resetting Model when Provider changes).
   */
  setOptions(args: {
    value: string;
    options: EditableValueChipOption[];
    emptyOption?: EditableValueChipOption;
  }): void;
}

/**
 * Borderless Linear-style value chip: shows the current value + a decorative
 * chevron, with a transparent native `<select>` overlaying the whole chip so
 * the picker stays keyboard-operable. Shared by the work-order modal Properties
 * sidebar (Provider / Model / Priority) and reused by the Agents persona seam
 * for the Agent dropdown.
 */
export function renderEditableValueChip(
  options: EditableValueChipOptions,
): EditableValueChipHandle {
  const { parent, onChange } = options;

  const el = parent.createDiv({ cls: 'claudian-work-order-modal-chip' });
  const labelEl = el.createSpan({ cls: 'claudian-work-order-modal-chip-label' });
  const chevron = el.createSpan({ cls: 'claudian-work-order-modal-chip-chevron' });
  chevron.setAttr('aria-hidden', 'true');
  chevron.setAttr('data-icon', 'chevron-down');
  setIcon(chevron, 'chevron-down');

  const selectEl = el.createEl('select', { cls: 'claudian-work-order-modal-chip-select' });

  const labelFor = (
    value: string,
    list: EditableValueChipOption[],
    empty?: EditableValueChipOption,
  ): string => {
    if (empty && value === empty.value) return empty.label;
    return list.find((o) => o.value === value)?.label ?? value;
  };

  let currentList = options.options;
  let currentEmpty = options.emptyOption;

  const populate = (
    value: string,
    list: EditableValueChipOption[],
    empty?: EditableValueChipOption,
  ): void => {
    selectEl.empty();
    if (empty) selectEl.createEl('option', { value: empty.value, text: empty.label });
    for (const option of list) {
      selectEl.createEl('option', { value: option.value, text: option.label });
    }
    selectEl.value = value;
    currentList = list;
    currentEmpty = empty;
    labelEl.setText(labelFor(value, list, empty));
  };

  populate(options.value, options.options, options.emptyOption);

  selectEl.addEventListener('change', () => {
    // Keep the visible chip label in sync with the (transparent) picker, then
    // notify. Without this the sidebar shows the old value until reopen.
    labelEl.setText(labelFor(selectEl.value, currentList, currentEmpty));
    onChange(selectEl.value);
  });

  return {
    el,
    selectEl,
    setOptions: ({ value, options: list, emptyOption }) => {
      populate(value, list, emptyOption);
    },
  };
}
