import { parseAcceptanceChecklist } from '../../../../../src/features/tasks/model/acceptanceChecklist';

describe('parseAcceptanceChecklist', () => {
  it('captures each checklist item with its checked state and label', () => {
    const md = '- [ ] one\n- [x] two\n- [X] three\nnot a checkbox';
    expect(parseAcceptanceChecklist(md)).toEqual([
      { checked: false, text: 'one' },
      { checked: true, text: 'two' },
      { checked: true, text: 'three' },
    ]);
  });

  it('supports asterisk bullets and leading indentation', () => {
    const md = '  * [x] indented\n* [ ] another';
    expect(parseAcceptanceChecklist(md)).toEqual([
      { checked: true, text: 'indented' },
      { checked: false, text: 'another' },
    ]);
  });

  it('ignores non-checkbox lines and trims trailing whitespace', () => {
    expect(parseAcceptanceChecklist('Just prose.\n- a plain bullet')).toEqual([]);
    expect(parseAcceptanceChecklist('')).toEqual([]);
    expect(parseAcceptanceChecklist('- [ ] trailing space   ')).toEqual([
      { checked: false, text: 'trailing space' },
    ]);
  });

  it('agrees with the done/total contract row-for-row', () => {
    const md = '- [x] a\n- [ ] b\n- [x] c';
    const items = parseAcceptanceChecklist(md);
    expect(items).toHaveLength(3);
    expect(items.filter((i) => i.checked)).toHaveLength(2);
  });
});
