import { parseAcceptanceProgress } from '../../../../../src/features/tasks/model/acceptanceProgress';

describe('parseAcceptanceProgress', () => {
  it('counts checked and total checklist items', () => {
    const md = '- [ ] one\n- [x] two\n- [X] three\nnot a checkbox';
    expect(parseAcceptanceProgress(md)).toEqual({ done: 2, total: 3 });
  });

  it('supports asterisk bullets and leading indentation', () => {
    const md = '  * [x] indented\n* [ ] another';
    expect(parseAcceptanceProgress(md)).toEqual({ done: 1, total: 2 });
  });

  it('returns zero totals when there are no checklist items', () => {
    expect(parseAcceptanceProgress('Just prose.\n- a plain bullet')).toEqual({ done: 0, total: 0 });
    expect(parseAcceptanceProgress('')).toEqual({ done: 0, total: 0 });
  });
});
