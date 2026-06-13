/**
 * Claudian - ask-user-question option/custom-input row builders.
 *
 * Extracted from InlineAskUserQuestion so `renderQuestionTab` stays below the
 * complexity thresholds. Each builder appends one row into the supplied list
 * element (preserving DOM order) and returns it so the host can track it in
 * `currentItems`. All instance state is supplied through callbacks so these
 * stay free of class internals.
 */

import type { AskUserQuestionOption } from '../../../core/types/tools';

export interface AskOptionRowParams {
  option: AskUserQuestionOption;
  optIdx: number;
  isFocused: boolean;
  isSelected: boolean;
  isMulti: boolean;
  renderCheckbox: (parent: HTMLElement, checked: boolean) => void;
  onSelect: () => void;
}

/** Builds one selectable option row and returns it. */
export function renderAskOptionRow(listEl: HTMLElement, params: AskOptionRowParams): HTMLElement {
  const { option, optIdx, isFocused, isSelected, isMulti } = params;

  const row = listEl.createDiv({ cls: 'claudian-ask-item' });
  if (isFocused) row.addClass('is-focused');
  if (isSelected) row.addClass('is-selected');

  row.createSpan({ text: isFocused ? '›' : ' ', cls: 'claudian-ask-cursor' });
  row.createSpan({ text: `${optIdx + 1}. `, cls: 'claudian-ask-item-num' });

  if (isMulti) {
    params.renderCheckbox(row, isSelected);
  }

  const labelBlock = row.createDiv({ cls: 'claudian-ask-item-content' });
  const labelRow = labelBlock.createDiv({ cls: 'claudian-ask-label-row' });
  labelRow.createSpan({ text: option.label, cls: 'claudian-ask-item-label' });

  if (!isMulti && isSelected) {
    labelRow.createSpan({ text: ' ✓', cls: 'claudian-ask-check-mark' });
  }

  if (option.description) {
    labelBlock.createDiv({ text: option.description, cls: 'claudian-ask-item-desc' });
  }

  row.addEventListener('click', params.onSelect);
  return row;
}

export interface AskCustomRowParams {
  customIdx: number;
  isFocused: boolean;
  isMulti: boolean;
  isSecret: boolean;
  initialText: string;
  hasCustomText: boolean;
  renderCheckbox: (parent: HTMLElement, checked: boolean) => void;
  onInput: (value: string) => void;
  onFocusChange: (focused: boolean) => void;
  onRowClick: (inputEl: HTMLInputElement) => void;
}

/** Builds the free-text "other" row and returns it. */
export function renderAskCustomInputRow(listEl: HTMLElement, params: AskCustomRowParams): HTMLElement {
  const { customIdx, isFocused, isMulti, isSecret, initialText, hasCustomText } = params;

  const customRow = listEl.createDiv({ cls: 'claudian-ask-item claudian-ask-custom-item' });
  if (isFocused) customRow.addClass('is-focused');

  customRow.createSpan({ text: isFocused ? '›' : ' ', cls: 'claudian-ask-cursor' });
  customRow.createSpan({ text: `${customIdx + 1}. `, cls: 'claudian-ask-item-num' });

  if (isMulti) {
    params.renderCheckbox(customRow, hasCustomText);
  }

  const inputEl = customRow.createEl('input', {
    cls: 'claudian-ask-custom-text',
    value: initialText,
  });
  inputEl.setAttribute('type', isSecret ? 'password' : 'text');
  inputEl.setAttribute('placeholder', isSecret ? 'Enter secret.' : 'Type something.');

  inputEl.addEventListener('input', () => params.onInput(inputEl.value));
  inputEl.addEventListener('focus', () => params.onFocusChange(true));
  inputEl.addEventListener('blur', () => params.onFocusChange(false));
  customRow.addEventListener('click', () => params.onRowClick(inputEl));

  return customRow;
}
