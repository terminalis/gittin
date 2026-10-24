import { button, choiceRow, el, fileDialog } from './dom';
import { place } from '../platform';
export interface DiskChoices {
  compare?(): void; useDisk(): void; keepMine?(): void; saveAs?(): void; overwrite?(): void;
}
const message = (name: string) =>
  `${name} changed on disk since you opened it. Your unsaved changes are safe in ${place}.`;
/** The ways to settle a file that changed on disk, as rows saying what each does; Overwrite is red. */
export function conflictDialog(name: string, choices: DiskChoices) {
  return fileDialog('File changed on disk', (body, close) => {
    const run = (action: () => void) => () => { close(); action(); };
    const lead = el('div', { className: 'disk-change-message' }, el('p', { textContent: message(name) }));
    if (choices.compare) lead.append(button('Compare', run(choices.compare)));
    const rows: [label: string, effect: string, action: (() => void) | undefined, className: string][] = [
      ['Use disk version', 'Replaces your text; Undo brings it back.', choices.useDisk, ''],
      ['Save as…', 'Your text goes to a new file.', choices.saveAs, ''],
      ['Overwrite', 'Your text replaces the version on disk.', choices.overwrite, 'danger'],
    ];
    body.append(lead, ...rows.flatMap(([label, effect, action, className]) =>
      action ? [choiceRow(label, effect, run(action), className)] : []));
  }, { closeLabel: 'Cancel' });
}
export function diskChangeBanner(name: string, choices: DiskChoices, done: () => void) {
  return el('div', { id: 'disk-change', role: 'status' }, el('p', { textContent: message(name) }),
    button('Compare', () => choices.compare?.()),
    button('Keep my changes', () => { choices.keepMine?.(); done(); }),
    button('Use disk version', () => { choices.useDisk(); done(); }));
}
